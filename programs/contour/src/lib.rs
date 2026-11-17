//! Contour escrow.
//!
//! A user deposits a USDC stake and a payout schedule (one amount per outcome bucket). The desk
//! accepts by depositing collateral so the vault holds the largest payout. At expiry the oracle
//! posts the outcome bucket and the forecast score; the vault pays the user the scheduled amount
//! and returns the rest to the desk. Timeouts protect the user if the desk never accepts or the
//! outcome is never posted.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("BrTbVXVsKMNYQiAfRohLCK2tH5wSpEgwvc8TctWrVT7g");

pub const CONFIG_SEED: &[u8] = b"config";
pub const POSITION_SEED: &[u8] = b"position";
pub const VAULT_SEED: &[u8] = b"vault";
pub const LIMITS_SEED: &[u8] = b"limits";
pub const MAX_BUCKETS: usize = 40;
pub const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod contour {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.usdc_mint = ctx.accounts.usdc_mint.key();
        c.bump = ctx.bumps.config;
        c.apply(&params);
        Ok(())
    }

    /// Admin-only parameter update. Moves no funds.
    pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        ctx.accounts.config.apply(&params);
        Ok(())
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        nonce: u64,
        market_id: [u8; 32],
        forecast_hash: [u8; 32],
        stake: u64,
        schedule: Vec<u64>,
        expiry_ts: i64,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        require!(schedule.len() >= 2 && schedule.len() <= MAX_BUCKETS, ContourError::InvalidSchedule);
        require!(stake > 0, ContourError::InvalidStake);
        require!(stake <= cfg.max_stake, ContourError::StakeTooLarge);
        require!(expiry_ts > now, ContourError::ExpiryInPast);

        // Daily limit per owner (UTC day buckets).
        let limits = &mut ctx.accounts.limits;
        let today = now - now.rem_euclid(SECONDS_PER_DAY);
        if limits.owner == Pubkey::default() {
            limits.owner = ctx.accounts.owner.key();
            limits.bump = ctx.bumps.limits;
        }
        if limits.day_start_ts != today {
            limits.day_start_ts = today;
            limits.staked_today = 0;
        }
        let staked = limits.staked_today.checked_add(stake).ok_or(ContourError::MathOverflow)?;
        require!(staked <= cfg.max_daily_stake, ContourError::DailyLimit);
        limits.staked_today = staked;

        let max_payout = *schedule.iter().max().unwrap();

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.owner_token.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            stake,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let p = &mut ctx.accounts.position;
        p.owner = ctx.accounts.owner.key();
        p.nonce = nonce;
        p.market_id = market_id;
        p.forecast_hash = forecast_hash;
        p.stake = stake;
        p.schedule = schedule.clone();
        p.max_payout = max_payout;
        p.opened_ts = now;
        p.expiry_ts = expiry_ts;
        p.state = PositionState::Open;
        p.outcome_bucket = u8::MAX;
        p.score_bps = 0;
        p.bump = ctx.bumps.position;
        p.vault_bump = ctx.bumps.vault;

        emit!(PositionOpened {
            position: p.key(),
            owner: p.owner,
            nonce,
            market_id,
            forecast_hash,
            stake,
            schedule,
            max_payout,
            opened_ts: now,
            expiry_ts,
        });
        Ok(())
    }

    pub fn accept_position(ctx: Context<AcceptPosition>) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let p = &ctx.accounts.position;
        require!(p.state == PositionState::Open, ContourError::WrongState);
        require!(now <= p.opened_ts + cfg.accept_timeout_secs, ContourError::AcceptTimeout);
        let collateral = p.max_payout.saturating_sub(p.stake);
        if collateral > 0 {
            token::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.desk_token.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                        authority: ctx.accounts.desk.to_account_info(),
                    },
                ),
                collateral,
                ctx.accounts.usdc_mint.decimals,
            )?;
        }
        let p = &mut ctx.accounts.position;
        p.state = PositionState::Active;
        emit!(PositionAccepted {
            position: p.key(),
            owner: p.owner,
            market_id: p.market_id,
            collateral,
            vault_balance: p.stake.max(p.max_payout),
            ts: now,
        });
        Ok(())
    }

    pub fn cancel_position(ctx: Context<CancelPosition>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.position.state == PositionState::Open, ContourError::WrongState);
        let amount = ctx.accounts.vault.amount;
        pay_from_vault(
            &ctx.accounts.position,
            &ctx.accounts.vault,
            &ctx.accounts.owner_token,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.token_program,
            amount,
        )?;
        let p = &mut ctx.accounts.position;
        p.state = PositionState::Cancelled;
        emit!(PositionCancelled { position: p.key(), owner: p.owner, market_id: p.market_id, refund: amount, ts: now });
        Ok(())
    }

    pub fn settle_position(ctx: Context<SettlePosition>, bucket: u8, score_bps: i32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let p = &ctx.accounts.position;
        require!(p.state == PositionState::Active, ContourError::WrongState);
        require!(now >= p.expiry_ts, ContourError::TooEarly);
        require!((bucket as usize) < p.schedule.len(), ContourError::BucketOutOfRange);
        let vault_amount = ctx.accounts.vault.amount;
        let payout = p.schedule[bucket as usize].min(vault_amount);
        let rest = vault_amount - payout;
        pay_from_vault(p, &ctx.accounts.vault, &ctx.accounts.owner_token, &ctx.accounts.usdc_mint, &ctx.accounts.token_program, payout)?;
        pay_from_vault(p, &ctx.accounts.vault, &ctx.accounts.desk_token, &ctx.accounts.usdc_mint, &ctx.accounts.token_program, rest)?;
        let p = &mut ctx.accounts.position;
        p.state = PositionState::Settled;
        p.outcome_bucket = bucket;
        p.score_bps = score_bps;
        emit!(PositionSettled {
            position: p.key(),
            owner: p.owner,
            market_id: p.market_id,
            bucket,
            payout,
            desk_amount: rest,
            score_bps,
            ts: now,
        });
        Ok(())
    }

    pub fn unwind_position(ctx: Context<UnwindPosition>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        let p = &ctx.accounts.position;
        require!(p.state == PositionState::Active, ContourError::WrongState);
        require!(now > p.expiry_ts + cfg.settle_grace_secs, ContourError::GraceNotElapsed);
        let vault_amount = ctx.accounts.vault.amount;
        let to_owner = p.stake.min(vault_amount);
        let to_desk = vault_amount - to_owner;
        pay_from_vault(p, &ctx.accounts.vault, &ctx.accounts.owner_token, &ctx.accounts.usdc_mint, &ctx.accounts.token_program, to_owner)?;
        pay_from_vault(p, &ctx.accounts.vault, &ctx.accounts.desk_token, &ctx.accounts.usdc_mint, &ctx.accounts.token_program, to_desk)?;
        let p = &mut ctx.accounts.position;
        p.state = PositionState::Unwound;
        emit!(PositionUnwound { position: p.key(), owner: p.owner, market_id: p.market_id, owner_amount: to_owner, desk_amount: to_desk, ts: now });
        Ok(())
    }
}

fn pay_from_vault<'info>(
    position: &Account<'info, Position>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let nonce = position.nonce.to_le_bytes();
    let seeds: &[&[u8]] = &[POSITION_SEED, position.owner.as_ref(), &nonce, &[position.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: position.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

// ---------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub desk: Pubkey,
    pub oracle: Pubkey,
    pub usdc_mint: Pubkey,
    pub accept_timeout_secs: i64,
    pub settle_grace_secs: i64,
    pub max_stake: u64,
    pub max_daily_stake: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigParams {
    pub desk: Pubkey,
    pub oracle: Pubkey,
    pub accept_timeout_secs: i64,
    pub settle_grace_secs: i64,
    pub max_stake: u64,
    pub max_daily_stake: u64,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        require!(self.accept_timeout_secs > 0 && self.settle_grace_secs >= 0, ContourError::InvalidConfig);
        require!(self.max_stake > 0 && self.max_daily_stake >= self.max_stake, ContourError::InvalidConfig);
        Ok(())
    }
}

impl Config {
    fn apply(&mut self, p: &ConfigParams) {
        self.desk = p.desk;
        self.oracle = p.oracle;
        self.accept_timeout_secs = p.accept_timeout_secs;
        self.settle_grace_secs = p.settle_grace_secs;
        self.max_stake = p.max_stake;
        self.max_daily_stake = p.max_daily_stake;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum PositionState {
    Open,
    Active,
    Settled,
    Cancelled,
    Unwound,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub nonce: u64,
    pub market_id: [u8; 32],
    pub forecast_hash: [u8; 32],
    pub stake: u64,
    #[max_len(40)]
    pub schedule: Vec<u64>,
    pub max_payout: u64,
    pub opened_ts: i64,
    pub expiry_ts: i64,
    pub state: PositionState,
    pub outcome_bucket: u8,
    pub score_bps: i32,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserLimits {
    pub owner: Pubkey,
    pub day_start_ts: i64,
    pub staked_today: u64,
    pub bump: u8,
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ContourError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint @ ContourError::WrongMint)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, owner.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        init,
        payer = owner,
        seeds = [VAULT_SEED, position.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = position
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + UserLimits::INIT_SPACE,
        seeds = [LIMITS_SEED, owner.key().as_ref()],
        bump
    )]
    pub limits: Account<'info, UserLimits>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptPosition<'info> {
    pub desk: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = desk @ ContourError::Unauthorized, has_one = usdc_mint @ ContourError::WrongMint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POSITION_SEED, position.owner.as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [VAULT_SEED, position.key().as_ref()], bump = position.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = desk)]
    pub desk_token: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelPosition<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint @ ContourError::WrongMint)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = owner @ ContourError::Unauthorized, seeds = [POSITION_SEED, owner.key().as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [VAULT_SEED, position.key().as_ref()], bump = position.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettlePosition<'info> {
    pub oracle: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = oracle @ ContourError::Unauthorized, has_one = usdc_mint @ ContourError::WrongMint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POSITION_SEED, position.owner.as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [VAULT_SEED, position.key().as_ref()], bump = position.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, constraint = owner_token.owner == position.owner @ ContourError::WrongOwner)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, constraint = desk_token.owner == config.desk @ ContourError::WrongOwner)]
    pub desk_token: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnwindPosition<'info> {
    /// Anyone may unwind once the grace period has passed.
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint @ ContourError::WrongMint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POSITION_SEED, position.owner.as_ref(), &position.nonce.to_le_bytes()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [VAULT_SEED, position.key().as_ref()], bump = position.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, constraint = owner_token.owner == position.owner @ ContourError::WrongOwner)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, constraint = desk_token.owner == config.desk @ ContourError::WrongOwner)]
    pub desk_token: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct PositionOpened {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub market_id: [u8; 32],
    pub forecast_hash: [u8; 32],
    pub stake: u64,
    pub schedule: Vec<u64>,
    pub max_payout: u64,
    pub opened_ts: i64,
    pub expiry_ts: i64,
}

#[event]
pub struct PositionAccepted {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market_id: [u8; 32],
    pub collateral: u64,
    pub vault_balance: u64,
    pub ts: i64,
}

#[event]
pub struct PositionCancelled {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market_id: [u8; 32],
    pub refund: u64,
    pub ts: i64,
}

#[event]
pub struct PositionSettled {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market_id: [u8; 32],
    pub bucket: u8,
    pub payout: u64,
    pub desk_amount: u64,
    pub score_bps: i32,
    pub ts: i64,
}

#[event]
pub struct PositionUnwound {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market_id: [u8; 32],
    pub owner_amount: u64,
    pub desk_amount: u64,
    pub ts: i64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum ContourError {
    #[msg("Schedule must have between 2 and 40 buckets")]
    InvalidSchedule,
    #[msg("Stake must be positive")]
    InvalidStake,
    #[msg("Stake exceeds the per-position maximum")]
    StakeTooLarge,
    #[msg("Stake exceeds the daily limit for this wallet")]
    DailyLimit,
    #[msg("Expiry must be in the future")]
    ExpiryInPast,
    #[msg("Position is not in the required state")]
    WrongState,
    #[msg("The desk's accept window has passed")]
    AcceptTimeout,
    #[msg("Too early: the market has not expired")]
    TooEarly,
    #[msg("Outcome bucket out of range")]
    BucketOutOfRange,
    #[msg("Settlement grace period has not elapsed")]
    GraceNotElapsed,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("Token mint does not match the configured USDC mint")]
    WrongMint,
    #[msg("Token account owner does not match")]
    WrongOwner,
    #[msg("Invalid config parameters")]
    InvalidConfig,
}
