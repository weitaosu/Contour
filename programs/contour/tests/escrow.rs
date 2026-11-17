//! LiteSVM tests for the Contour escrow: happy path, cancel, accept timeout, unwind after grace,
//! limits, and every failure case in BUILD_PLAN section 6.4, with vault invariants checked throughout.
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, program_pack::Pack, system_instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    contour::{ConfigParams, Position, PositionState},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC: u64 = 1_000_000;
const ACCEPT_TIMEOUT: i64 = 300;
const GRACE: i64 = 600;
const T0: i64 = 1_800_000_000; // a fixed "now" so day boundaries are deterministic

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    desk: Keypair,
    oracle: Keypair,
    user: Keypair,
    mint: Pubkey,
    user_token: Pubkey,
    desk_token: Pubkey,
    config: Pubkey,
}

fn pid() -> Pubkey {
    contour::id()
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Result<(), String> {
    svm.expire_blockhash();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
    let mut all: Vec<&Keypair> = vec![payer];
    for s in signers {
        if s.pubkey() != payer.pubkey() {
            all.push(s);
        }
    }
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp = ts;
    svm.set_sysvar(&c);
}

fn balance(svm: &LiteSVM, acct: &Pubkey) -> u64 {
    let a = svm.get_account(acct).expect("token account");
    spl_token::state::Account::unpack(&a.data).unwrap().amount
}

fn new_token_account(svm: &mut LiteSVM, payer: &Keypair, mint: &Pubkey, owner: &Pubkey) -> Pubkey {
    let kp = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Account::LEN);
    let ixs = [
        system_instruction::create_account(&payer.pubkey(), &kp.pubkey(), rent, spl_token::state::Account::LEN as u64, &spl_token::ID),
        spl_token::instruction::initialize_account3(&spl_token::ID, &kp.pubkey(), mint, owner).unwrap(),
    ];
    send(svm, &ixs, payer, &[&kp]).unwrap();
    kp.pubkey()
}

fn params(desk: Pubkey, oracle: Pubkey) -> ConfigParams {
    ConfigParams {
        desk,
        oracle,
        accept_timeout_secs: ACCEPT_TIMEOUT,
        settle_grace_secs: GRACE,
        max_stake: 500 * USDC,
        max_daily_stake: 1_000 * USDC,
    }
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/contour.so"));
    svm.add_program(pid(), bytes).unwrap();
    set_time(&mut svm, T0);
    let (admin, desk, oracle, user) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    for k in [&admin, &desk, &oracle, &user] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    // Test USDC mint (6 decimals).
    let mint_kp = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
    let ixs = [
        system_instruction::create_account(&admin.pubkey(), &mint_kp.pubkey(), rent, spl_token::state::Mint::LEN as u64, &spl_token::ID),
        spl_token::instruction::initialize_mint2(&spl_token::ID, &mint_kp.pubkey(), &admin.pubkey(), None, 6).unwrap(),
    ];
    send(&mut svm, &ixs, &admin, &[&mint_kp]).unwrap();
    let mint = mint_kp.pubkey();
    let user_token = new_token_account(&mut svm, &admin, &mint, &user.pubkey());
    let desk_token = new_token_account(&mut svm, &admin, &mint, &desk.pubkey());
    for (acct, amt) in [(user_token, 5_000 * USDC), (desk_token, 100_000 * USDC)] {
        let ix = spl_token::instruction::mint_to(&spl_token::ID, &mint, &acct, &admin.pubkey(), &[], amt).unwrap();
        send(&mut svm, &[ix], &admin, &[]).unwrap();
    }
    let config = Pubkey::find_program_address(&[contour::CONFIG_SEED], &pid()).0;
    let ix = Instruction::new_with_bytes(
        pid(),
        &contour::instruction::Initialize { params: params(desk.pubkey(), oracle.pubkey()) }.data(),
        contour::accounts::Initialize { admin: admin.pubkey(), config, usdc_mint: mint, system_program: system_program::ID }.to_account_metas(None),
    );
    send(&mut svm, &[ix], &admin, &[]).unwrap();
    Env { svm, admin, desk, oracle, user, mint, user_token, desk_token, config }
}

fn pdas(owner: &Pubkey, nonce: u64) -> (Pubkey, Pubkey, Pubkey) {
    let position = Pubkey::find_program_address(&[contour::POSITION_SEED, owner.as_ref(), &nonce.to_le_bytes()], &pid()).0;
    let vault = Pubkey::find_program_address(&[contour::VAULT_SEED, position.as_ref()], &pid()).0;
    let limits = Pubkey::find_program_address(&[contour::LIMITS_SEED, owner.as_ref()], &pid()).0;
    (position, vault, limits)
}

fn open(e: &mut Env, nonce: u64, stake: u64, schedule: Vec<u64>, expiry_ts: i64) -> Result<Pubkey, String> {
    let owner = e.user.insecure_clone();
    open_as(e, &owner, e.user_token, nonce, stake, schedule, expiry_ts)
}

fn open_as(e: &mut Env, owner: &Keypair, owner_token: Pubkey, nonce: u64, stake: u64, schedule: Vec<u64>, expiry_ts: i64) -> Result<Pubkey, String> {
    let (position, vault, limits) = pdas(&owner.pubkey(), nonce);
    let ix = Instruction::new_with_bytes(
        pid(),
        &contour::instruction::OpenPosition { nonce, market_id: [7u8; 32], forecast_hash: [9u8; 32], stake, schedule, expiry_ts }.data(),
        contour::accounts::OpenPosition {
            owner: owner.pubkey(),
            config: e.config,
            position,
            vault,
            limits,
            owner_token,
            usdc_mint: e.mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut e.svm, &[ix], owner, &[]).map(|_| position)
}

fn accept_with(e: &mut Env, position: Pubkey, signer: &Keypair, desk_token: Pubkey) -> Result<(), String> {
    let vault = Pubkey::find_program_address(&[contour::VAULT_SEED, position.as_ref()], &pid()).0;
    let ix = Instruction::new_with_bytes(
        pid(),
        &contour::instruction::AcceptPosition {}.data(),
        contour::accounts::AcceptPosition { desk: signer.pubkey(), config: e.config, position, vault, desk_token, usdc_mint: e.mint, token_program: spl_token::ID }
            .to_account_metas(None),
    );
    send(&mut e.svm, &[ix], signer, &[])
}

fn accept(e: &mut Env, position: Pubkey) -> Result<(), String> {
    let desk = e.desk.insecure_clone();
    let dt = e.desk_token;
    accept_with(e, position, &desk, dt)
}

fn cancel_with(e: &mut Env, position: Pubkey, signer: &Keypair, owner_token: Pubkey) -> Result<(), String> {
    let vault = Pubkey::find_program_address(&[contour::VAULT_SEED, position.as_ref()], &pid()).0;
    let ix = Instruction::new_with_bytes(
        pid(),
        &contour::instruction::CancelPosition {}.data(),
        contour::accounts::CancelPosition { owner: signer.pubkey(), config: e.config, position, vault, owner_token, usdc_mint: e.mint, token_program: spl_token::ID }
            .to_account_metas(None),
    );
    send(&mut e.svm, &[ix], signer, &[])
}

fn settle_with(e: &mut Env, position: Pubkey, signer: &Keypair, bucket: u8, score_bps: i32) -> Result<(), String> {
    let vault = Pubkey::find_program_address(&[contour::VAULT_SEED, position.as_ref()], &pid()).0;
    let ix = Instruction::new_with_bytes(
        pid(),
        &contour::instruction::SettlePosition { bucket, score_bps }.data(),
        contour::accounts::SettlePosition {
            oracle: signer.pubkey(),
            config: e.config,
            position,
            vault,
            owner_token: e.user_token,
            desk_token: e.desk_token,
            usdc_mint: e.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut e.svm, &[ix], signer, &[])
}

fn settle(e: &mut Env, position: Pubkey, bucket: u8, score_bps: i32) -> Result<(), String> {
    let oracle = e.oracle.insecure_clone();
    settle_with(e, position, &oracle, bucket, score_bps)
}

fn unwind(e: &mut Env, position: Pubkey, caller: &Keypair) -> Result<(), String> {
    let vault = Pubkey::find_program_address(&[contour::VAULT_SEED, position.as_ref()], &pid()).0;
    let ix = Instruction::new_with_bytes(
        pid(),
        &contour::instruction::UnwindPosition {}.data(),
        contour::accounts::UnwindPosition {
            caller: caller.pubkey(),
            config: e.config,
            position,
            vault,
            owner_token: e.user_token,
            desk_token: e.desk_token,
            usdc_mint: e.mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut e.svm, &[ix], caller, &[])
}

fn position(e: &Env, p: &Pubkey) -> Position {
    let a = e.svm.get_account(p).unwrap();
    Position::try_deserialize(&mut a.data.as_slice()).unwrap()
}

fn vault_of(p: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[contour::VAULT_SEED, p.as_ref()], &pid()).0
}

fn sched() -> Vec<u64> {
    vec![70 * USDC, 110 * USDC, 150 * USDC, 90 * USDC]
}

#[test]
fn happy_path_open_accept_settle() {
    let mut e = setup();
    let (u0, d0) = (balance(&e.svm, &e.user_token), balance(&e.svm, &e.desk_token));
    let p = open(&mut e, 1, 100 * USDC, sched(), T0 + 3_600).unwrap();
    assert_eq!(balance(&e.svm, &vault_of(&p)), 100 * USDC);
    let pos = position(&e, &p);
    assert_eq!(pos.state, PositionState::Open);
    assert_eq!(pos.max_payout, 150 * USDC);
    assert_eq!(pos.schedule, sched());

    accept(&mut e, p).unwrap();
    // While Active, vault = max(stake, max_payout).
    assert_eq!(balance(&e.svm, &vault_of(&p)), 150 * USDC);
    assert_eq!(balance(&e.svm, &e.desk_token), d0 - 50 * USDC);
    assert_eq!(position(&e, &p).state, PositionState::Active);

    assert!(settle(&mut e, p, 2, 1234).unwrap_err().contains("Custom")); // TooEarly
    set_time(&mut e.svm, T0 + 3_600);
    settle(&mut e, p, 2, 1234).unwrap();
    let pos = position(&e, &p);
    assert_eq!(pos.state, PositionState::Settled);
    assert_eq!(pos.outcome_bucket, 2);
    assert_eq!(pos.score_bps, 1234);
    assert_eq!(balance(&e.svm, &vault_of(&p)), 0);
    assert_eq!(balance(&e.svm, &e.user_token), u0 - 100 * USDC + 150 * USDC);
    assert_eq!(balance(&e.svm, &e.desk_token), d0 - 50 * USDC);
    // Settling twice fails (wrong state).
    assert!(settle(&mut e, p, 2, 0).is_err());
}

#[test]
fn settle_pays_schedule_and_returns_rest_to_desk() {
    let mut e = setup();
    let (u0, d0) = (balance(&e.svm, &e.user_token), balance(&e.svm, &e.desk_token));
    let p = open(&mut e, 2, 100 * USDC, sched(), T0 + 10).unwrap();
    accept(&mut e, p).unwrap();
    set_time(&mut e.svm, T0 + 10);
    settle(&mut e, p, 0, -500).unwrap();
    // User gets 70; desk gets 150 - 70 = 80 back after posting 50: net +30 for desk, -30 for user.
    assert_eq!(balance(&e.svm, &e.user_token), u0 - 30 * USDC);
    assert_eq!(balance(&e.svm, &e.desk_token), d0 + 30 * USDC);
    assert_eq!(balance(&e.svm, &vault_of(&p)), 0);
}

#[test]
fn cancel_while_open_refunds_and_blocks_accept() {
    let mut e = setup();
    let u0 = balance(&e.svm, &e.user_token);
    let p = open(&mut e, 3, 100 * USDC, sched(), T0 + 3_600).unwrap();
    // Only the owner can cancel.
    let stranger = Keypair::new();
    e.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ut = e.user_token;
    assert!(cancel_with(&mut e, p, &stranger, ut).is_err());
    let user = e.user.insecure_clone();
    cancel_with(&mut e, p, &user, ut).unwrap();
    assert_eq!(position(&e, &p).state, PositionState::Cancelled);
    assert_eq!(balance(&e.svm, &e.user_token), u0);
    assert_eq!(balance(&e.svm, &vault_of(&p)), 0);
    assert!(accept(&mut e, p).is_err());
}

#[test]
fn accept_after_timeout_fails_then_user_cancels() {
    let mut e = setup();
    let p = open(&mut e, 4, 100 * USDC, sched(), T0 + 3_600).unwrap();
    set_time(&mut e.svm, T0 + ACCEPT_TIMEOUT + 1);
    assert!(accept(&mut e, p).is_err());
    let user = e.user.insecure_clone();
    let ut = e.user_token;
    cancel_with(&mut e, p, &user, ut).unwrap();
}

#[test]
fn accept_at_timeout_boundary_succeeds() {
    let mut e = setup();
    let p = open(&mut e, 5, 100 * USDC, sched(), T0 + 3_600).unwrap();
    set_time(&mut e.svm, T0 + ACCEPT_TIMEOUT);
    accept(&mut e, p).unwrap();
}

#[test]
fn unwind_after_grace_returns_stake_and_collateral() {
    let mut e = setup();
    let (u0, d0) = (balance(&e.svm, &e.user_token), balance(&e.svm, &e.desk_token));
    let p = open(&mut e, 6, 100 * USDC, sched(), T0 + 100).unwrap();
    accept(&mut e, p).unwrap();
    let anyone = Keypair::new();
    e.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    set_time(&mut e.svm, T0 + 100 + GRACE);
    assert!(unwind(&mut e, p, &anyone).is_err()); // grace not elapsed (strictly greater required)
    set_time(&mut e.svm, T0 + 100 + GRACE + 1);
    unwind(&mut e, p, &anyone).unwrap();
    assert_eq!(position(&e, &p).state, PositionState::Unwound);
    assert_eq!(balance(&e.svm, &e.user_token), u0);
    assert_eq!(balance(&e.svm, &e.desk_token), d0);
    assert_eq!(balance(&e.svm, &vault_of(&p)), 0);
    // Cannot settle after unwind.
    assert!(settle(&mut e, p, 1, 0).is_err());
}

#[test]
fn unwind_requires_active() {
    let mut e = setup();
    let p = open(&mut e, 7, 100 * USDC, sched(), T0 + 100).unwrap();
    set_time(&mut e.svm, T0 + 100 + GRACE + 1);
    let user = e.user.insecure_clone();
    assert!(unwind(&mut e, p, &user).is_err());
}

#[test]
fn stake_limits() {
    let mut e = setup();
    assert!(open(&mut e, 10, 0, sched(), T0 + 100).is_err());
    assert!(open(&mut e, 11, 501 * USDC, sched(), T0 + 100).is_err());
    open(&mut e, 12, 500 * USDC, sched(), T0 + 100).unwrap();
    open(&mut e, 13, 400 * USDC, sched(), T0 + 100).unwrap();
    // 500 + 400 + 101 > 1000 daily limit.
    assert!(open(&mut e, 14, 101 * USDC, sched(), T0 + 100).is_err());
    open(&mut e, 15, 100 * USDC, sched(), T0 + 100).unwrap();
    // Next UTC day the limit resets.
    set_time(&mut e.svm, T0 + 86_400);
    open(&mut e, 16, 500 * USDC, sched(), T0 + 90_000).unwrap();
}

#[test]
fn schedule_and_expiry_validation() {
    let mut e = setup();
    assert!(open(&mut e, 20, 100 * USDC, vec![100 * USDC], T0 + 100).is_err());
    assert!(open(&mut e, 21, 100 * USDC, vec![USDC; 41], T0 + 100).is_err());
    open(&mut e, 22, 100 * USDC, vec![USDC; 40], T0 + 100).unwrap();
    assert!(open(&mut e, 23, 100 * USDC, sched(), T0).is_err());
    assert!(open(&mut e, 24, 100 * USDC, sched(), T0 - 1).is_err());
}

#[test]
fn wrong_signers_fail() {
    let mut e = setup();
    let p = open(&mut e, 30, 100 * USDC, sched(), T0 + 10).unwrap();
    // A stranger with their own funded token account cannot accept.
    let stranger = Keypair::new();
    e.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let admin = e.admin.insecure_clone();
    let mint = e.mint;
    let st = new_token_account(&mut e.svm, &admin, &mint, &stranger.pubkey());
    let ix = spl_token::instruction::mint_to(&spl_token::ID, &mint, &st, &admin.pubkey(), &[], 1_000 * USDC).unwrap();
    send(&mut e.svm, &[ix], &admin, &[]).unwrap();
    assert!(accept_with(&mut e, p, &stranger, st).is_err());
    accept(&mut e, p).unwrap();
    set_time(&mut e.svm, T0 + 10);
    // Desk cannot post the outcome; only the oracle can.
    let desk = e.desk.insecure_clone();
    assert!(settle_with(&mut e, p, &desk, 1, 0).is_err());
    assert!(settle_with(&mut e, p, &stranger, 1, 0).is_err());
    settle(&mut e, p, 1, 0).unwrap();
}

#[test]
fn wrong_states_fail() {
    let mut e = setup();
    let p = open(&mut e, 40, 100 * USDC, sched(), T0 + 10).unwrap();
    set_time(&mut e.svm, T0 + 10);
    assert!(settle(&mut e, p, 1, 0).is_err()); // settle while Open
    set_time(&mut e.svm, T0);
    accept(&mut e, p).unwrap();
    assert!(accept(&mut e, p).is_err()); // accept twice
    let user = e.user.insecure_clone();
    let ut = e.user_token;
    assert!(cancel_with(&mut e, p, &user, ut).is_err()); // cancel after accept
    set_time(&mut e.svm, T0 + 10);
    assert!(settle(&mut e, p, 4, 0).is_err()); // bucket out of range (len 4)
    settle(&mut e, p, 3, 0).unwrap();
}

#[test]
fn update_config_admin_only() {
    let mut e = setup();
    let mut p2 = params(e.desk.pubkey(), e.oracle.pubkey());
    p2.settle_grace_secs = 30;
    let user = e.user.insecure_clone();
    let ix = |signer: Pubkey, p: ConfigParams, config: Pubkey| {
        Instruction::new_with_bytes(
            pid(),
            &contour::instruction::UpdateConfig { params: p }.data(),
            contour::accounts::UpdateConfig { admin: signer, config }.to_account_metas(None),
        )
    };
    assert!(send(&mut e.svm, &[ix(user.pubkey(), p2.clone(), e.config)], &user, &[]).is_err());
    let admin = e.admin.insecure_clone();
    send(&mut e.svm, &[ix(admin.pubkey(), p2, e.config)], &admin, &[]).unwrap();
    let a = e.svm.get_account(&e.config).unwrap();
    let c = contour::Config::try_deserialize(&mut a.data.as_slice()).unwrap();
    assert_eq!(c.settle_grace_secs, 30);
}
