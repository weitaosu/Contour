# Contour — trade your whole view

Contour turns a forecast into a position on **Gemini Prediction Markets**. You draw where you think an outcome will land, next to where the market thinks it will land, and Contour buys the set of yes/no contracts that pays most where the two disagree. The payout schedule is locked in a **Solana escrow** before any trade is placed, and every settled position records how your forecast scored against the market's.

Built for UBC 2026 (DeFi track · Best use of Solana · Gemini bounty · QuickNode bounty). The math is standard and cited where it's used; see [Background and references](#background-and-references).

> **What is simulated in this demo.** Escrow deposits, desk collateral, settlement payouts and forecast scores are real **Solana devnet** transactions with a test USDC mint. The desk's hedge on Gemini runs in **paper mode**: each leg is "filled" at the live Gemini ask if the ask is at or below the quoted price, and every such fill is labelled *simulated fill at live quote* in the UI. No order is sent to Gemini unless `EXECUTION_MODE=live` **and** `ALLOW_LIVE_ORDERS=true` are both set (they are not in this build).

---

## The problem

Prediction markets list whole distributions but only let you trade one point of them. About half of Gemini's active events are ladders of 6–33 strikes that together price a full probability curve, yet a trader can only say "yes" or "no" at one strike:

- **People think in ranges; the market sells points.** "SOL ends the week around $73, give or take $3" has no contract.
- **Right on direction, wrong on strike pays zero.**
- **Sizing is left to the user.** A 21-strike ladder is 42 instruments; choosing how much of each is a portfolio problem.
- **Results don't separate skill from luck.** There is no record of what a trader believed before the outcome.

## How it works

1. **Read the market.** A ladder of contracts becomes one probability curve over its outcome buckets, the prediction-market version of reading state prices off a strip of options [Breeden & Litzenberger 1978]. Each bucket is in effect an Arrow–Debreu security [Arrow 1964]: it pays $1 in exactly one outcome. Only tight two-sided quotes (spread ≤ 20¢, not crossed) count as evidence. Gaps are interpolated, long unpriced tails taper along a normal fitted to the priced strikes, and every value is held inside its own quote. The curve is then forced to fall with the strike (running minimum), differenced, floored at 0.001 and renormalized. Ladders whose prices contradict each other by more than 5¢ are refused.
2. **Take your view.** Pick an outlook (*Higher*, *Lower*, *Stays near*, *Big move*; *Later* / *Sooner* on date ladders), then fine-tune with two sliders: *Where* (center) and *How sure* (0.4×–1.6× the market's width). You can also drag the bars by hand, or give each named outcome your own odds. **Follow your view** (100%, 75%, 50% or any other weight; default 100%) blends your curve with the market's. Lower settings lean on the market's odds and put in less, so being wrong costs less. On price ladders, *Protect* builds insurance for a holding instead of a view.
3. **Compile.** The solver chooses the growth-optimal mix [Kelly 1956] of cash plus YES/NO contracts **bought at the ask**, maximizing `Σ p̃ⱼ log Wⱼ` with Cover's multiplicative update [Cover 1984]. Post-processing in integer USDC base units drops dust legs, rounds to the quantity step, caps legs at quoted depth, and recomputes the schedule, so legs + cash equal the stake exactly. The screen shows the payout in every outcome and four key numbers: most you can make, most you can lose, profit zone, and chance of profit (the market's odds and yours). If the forecast is too close to the market to cover spreads and fees, Contour says so and refuses the trade.
4. **See how likely each result is.** A dropdown under the panels compares the position with putting the whole amount on the single best contract. It opens with one verdict line, then an "out of 100 bets" dot grid where each dot fills by the money it brings back [Galesic et al. 2009; Kay et al. 2016], then the chance of every result. When the money put in can't be spread across outcomes (the best position is one contract plus cash), the screen says so: it's one bet sized down, not a hedge.
5. **Confirm once.** Review the bet, then sign one Solana transaction: `open_position` deposits your USDC stake and writes the payout schedule plus a SHA-256 hash of your forecast and the market snapshot. Without a wallet, the same quote fills into a paper portfolio in the browser at Gemini's live prices.
6. **Desk accepts and hedges.** A QuickNode Stream on the program delivers `PositionOpened` to the desk, which checks the on-chain schedule equals the quote, re-prices, posts collateral (`max payout − stake`) into the vault, and hedges the legs (paper mode).
7. **Settle and score.** At expiry the desk reads Gemini's settlement, posts the outcome bucket and the score `ln(p_you / p_market)` for that bucket, a relative logarithmic score [Good 1952; Gneiting & Raftery 2007]. The escrow pays your scheduled amount and returns the rest to the desk.

### What is new, and what isn't

The pieces are not new: payoffs built from a strip of claims, Kelly sizing and log scoring are decades old, and Paradigm's *Distribution Markets* [White 2024] sketches a market where whole distributions trade. What Contour adds is putting them together on markets that already exist:

- **A forecast compiler, not an order ticket.** Distribution in, sized multi-leg position out, on Gemini's existing ladders rather than a new market that needs its own liquidity. It's the same engine a forecasting model or agent can call (`POST /quote`).
- **A collateralized, multi-outcome payout schedule as an on-chain primitive.** No solvency risk: the most the position can ever pay is in escrow before the desk trades.
- **A forecast record that cannot be backdated.** The forecast hash is on-chain before the outcome exists; anyone can recompute it from the stored preimage (the position page does this in your browser).
- **It refuses bad trades, shows the cost of being wrong, and says when a position is only a smaller bet rather than a hedge.**

## Architecture

```
contour/
  apps/web        Next.js 16 (App Router), Tailwind v4 (DESIGN.md tokens), wallet adapter, SVG charts (d3-scale)
  apps/desk       Fastify service: markets, quotes, Stream webhook, executor, scheduler, recorder, faucet (SQLite)
  packages/core   Pure TS: ladder normalization, beliefs, compiler, scoring, settlement mapping, hashing. No I/O.
  packages/gemini Gemini REST client (public + signed), rate limiter
  packages/chain  Anchor IDL, PDA helpers, instruction builders, event decoding
  programs/contour Anchor escrow program (Rust)
  infra/quicknode  Stream filter
  fixtures/        sol_calm.json (compiler fixture), raw Gemini events, replay data
```

```
 Web app ── forecast, quote ──▶ Desk (compiler) ── orders (paper) ──▶ Gemini
    │ deposit + schedule            ▲      │ collateral, outcome
    ▼                               │      ▼
 Solana escrow ── events ──▶ QuickNode Stream ── webhook ──┘
```

Data flow: (1) web calls desk for markets and quotes (desk uses `gemini` + `core`); (2) web sends `open_position` from the user's wallet; (3) a QuickNode Stream filtered to the program posts transactions to `POST /hooks/quicknode`; (4) desk sees `PositionOpened`, re-checks the quote, sends `accept_position`, executes legs; (5) at expiry desk reads Gemini's settlement and sends `settle_position`; (6) web reads position state from chain and live updates from the desk over server-sent events.

## Run it from a fresh clone

Prerequisites: **Node ≥ 22** and **pnpm 10** (`corepack enable`). The Solana CLI is needed only for option B.

```bash
git clone <this repo> contour && cd contour
pnpm install
pnpm test          # 98 TypeScript tests: compiler fixture + properties, market classifier and settlement, QC, desk webhook/handler/live guard
```

There are three ways to run it. Pick the first that answers your question.

### A. Look around: live markets, forecast screen, quotes (no keys, ~1 minute)

```bash
cp apps/desk/.env.example apps/desk/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev           # starts the desk (http://localhost:4000) and the web app (http://localhost:3000) together
```

Everything that reads Gemini works: the market list, the forecast screen (outlooks, sliders, drag-to-reshape, payouts, key numbers, the results dropdown, the comparison, legs), and desk quotes. Trading needs a connected devnet wallet; the Portfolio tab shows its positions valued live. Without desk keys the desk logs `[chain] disabled` and on-chain confirmation stays off: that is expected.

### B. Full flow on a local Solana validator (no devnet SOL, no accounts, ~3 minutes)

Install the Solana CLI ([guide](https://solana.com/docs/intro/installation)), then:

```bash
pnpm local:up          # starts solana-test-validator with the compiled program (programs/contour/build/contour.so),
                       # generates git-ignored keys in keys/, creates a test USDC mint, funds the desk, initializes Config,
                       # and writes apps/desk/.env.localnet + apps/web/.env.localnet
pnpm dev:local         # desk + web against the local validator (http://localhost:3000)
pnpm e2e:local         # in a second terminal: wallet -> faucet -> quote -> open_position -> desk accepts + hedges; checks the vault
```

`e2e:local` prints `E2E OK` when the vault holds exactly `max(stake, max payout)` and the desk has recorded its fills. To click through in a browser instead, point Phantom at `http://127.0.0.1:8899` (Settings → Developer settings) and use the in-app *Get test USDC* button.

QuickNode cannot stream a local validator, so `.env.localnet` sets `LOCAL_EVENT_SOURCE=websocket` and the desk subscribes to the program's logs over the validator's websocket. The desk refuses this setting for any non-local RPC: on devnet the QuickNode Stream is always the event source.

### C. Devnet (what the demo runs)

The program is deployed at `BrTbVXVsKMNYQiAfRohLCK2tH5wSpEgwvc8TctWrVT7g`; its `Config` is controlled by the team's admin key, so to run your own desk against devnet, deploy your own copy:

```bash
# Rust + Solana CLI + Anchor 1.2.2 (avm install 1.2.2)
solana-keygen new -o keys/admin.json; solana-keygen new -o keys/desk.json; solana-keygen new -o keys/oracle.json
anchor keys sync && anchor build && ./scripts/sync-idl.sh     # new program ID, rebuilt IDL
cp target/deploy/contour-keypair.json keys/program.json
# fund keys/admin.json with ~3 devnet SOL at https://faucet.solana.com, then:
./scripts/deploy-devnet.sh                                    # deploy + mint + desk funding + Config; prints env lines
```

Then put the printed `USDC_MINT` / `PROGRAM_ID` into `apps/desk/.env` and `apps/web/.env.local`, set `SOLANA_RPC_URL=https://api.devnet.solana.com`, create the QuickNode Stream (next section, with your desk's public URL as destination and its token as `QUICKNODE_STREAM_TOKEN`), and run `pnpm dev:desk` / `pnpm dev:web`.

### Program tests

```bash
anchor build && cargo test -p contour      # 12 LiteSVM tests with a warped clock
```

### Other commands

| Command | What it does |
| --- | --- |
| `pnpm recorder` | 5-minute Gemini ladder snapshots into `data/desk.sqlite` (market history for later analysis) |
| `pnpm e2e:devnet` | the end-to-end check against a devnet desk |
| `python3 -I scripts/fixtures/reference.py fixtures/raw/sol_nov20.json fixtures/sol_calm.json` | regenerate the compiler fixture with the independent SciPy solver |
| `docker build -f apps/desk/Dockerfile -t contour-desk .` | desk image for hosting (mount keys and a `/data` volume) |

`scripts/post-tx-as-stream.ts` is a **test tool** that replays a real transaction to the webhook in the exact shape and HMAC signature our Stream produces (`E2E_POST_STREAM=1`). It is not a fallback.

## How Contour uses Solana

- **Program ID (devnet):** `BrTbVXVsKMNYQiAfRohLCK2tH5wSpEgwvc8TctWrVT7g` · **Test USDC mint:** `8Uwf97QUwPHF4ppzQDCqUWCB6AEweJiSc2iRevqbukYZ` · **Config PDA:** `4J37TeKjuyMLSWEs961MGgLtC4SQLxCf7ryAbPNVAFge`
- **Accounts:** `Config` PDA `["config"]` (admin, desk, oracle, USDC mint, accept timeout, settle grace, per-position and daily stake caps); `Position` PDA `["position", owner, nonce]` (market id = sha256(ticker), forecast hash, stake, schedule ≤ 40 buckets, max payout, timestamps, state, outcome bucket, score); vault token account PDA `["vault", position]` owned by the position PDA; `UserLimits` PDA `["limits", owner]`.
- **Instructions:** `initialize`, `update_config` (admin, moves no funds), `open_position`, `accept_position` (desk), `cancel_position` (owner, while Open), `settle_position(bucket, score_bps)` (oracle, after expiry), `unwind_position` (anyone, after expiry + grace).
- **Events** (`PositionOpened/Accepted/Cancelled/Settled/Unwound`) carry position, owner, market id, amounts, schedule and timestamps so the Stream consumer never needs a read RPC call.
- **Invariants (tested):** while Active the vault holds `max(stake, max_payout)`; settle/unwind pay out exactly the vault balance and leave it at zero; wrong signer, wrong state, early settle, out-of-range bucket and limit breaches all fail. 12 LiteSVM tests with a warped clock cover happy path, cancel, accept timeout (and its boundary), unwind after grace, limits including the UTC-day reset, and every failure case.

## Economic design and risk assumptions

- **Who holds what.** The user's stake and the desk's collateral sit in a program-owned vault. The desk hedges on Gemini with its own funds; the user's payout never depends on those fills.
- **Only what's at risk is escrowed.** The solver keeps part of the stake as cash, which would come back in every outcome. Locking it would change nothing for either side (the desk's collateral, `max_payout − stake`, is the same with or without it), so the on-chain stake is the contracts plus fees only, every scheduled payout is lowered by the cash, and the cash stays in the user's wallet. Profit and loss per outcome are unchanged; the user just doesn't tie up money (or daily limit) that isn't at risk.
- **Desk collateral.** `max_payout − stake`, posted at accept. The desk is fully hedged when its legs fill at the quoted asks (escrow payout + leg payoff − collateral − leg cost = 0 in every bucket); its economics are capital lockup plus basis risk if a leg fails to fill. A production desk would charge a fee on stake; this build does not.
- **Trusted outcome post.** The oracle key posts the bucket. It cannot change the schedule or withhold funds, and the outcome is publicly checkable against Gemini's settlement (`resolutionSide` per contract, `settlement.value` per event). If no outcome is posted within `settle_grace_secs` after expiry, anyone can unwind: the user gets the stake back, the desk its collateral.
- **Timeouts.** If the desk does not accept within `accept_timeout_secs` (300 s), it can no longer accept and the user cancels for a full refund. The desk only accepts when the on-chain schedule, stake, expiry and market equal its stored quote, the quote was ≤ 60 s old at open, and re-pricing at current asks costs no more than the escrowed stake plus 1% of the full amount the user set.
- **Limits.** Per-position (`max_stake`, 500 USDC on devnet) and per-wallet daily (`max_daily_stake`) caps are enforced by the program. The log objective keeps every payout above zero; *Follow your view* below 100% leans on the market's odds and puts in less.
- **Sizing is not hedging.** When Gemini's prices don't reward spreading a view across contracts, the best position is one contract plus cash held back. The ticket and the results dropdown then say it's one bet sized down, so holding cash back is never presented as a hedge. The test: the market's chance of the outcomes where the money put in comes back neither in full nor at nothing (under 5% means little to no spread).
- **Limits of paper mode.** Paper fills assume the top-of-book ask is available in the quoted size. Gemini's public book shows only the YES side; NO asks without a mirroring YES bid exist, so NO depth is treated as unknown (uncapped) rather than zero. Thin ladders mean positions are sized in hundreds of dollars.

### Which Gemini markets trade

One payout schedule needs outcomes where exactly one happens. Contour accepts a market only when that's provable from its structure or from Gemini's own rules, and only while the firm prices agree. On Nov 19, 2026 the desk listed 582 tradable markets out of 1,665 open events it read.

| Market shape | Examples | How it becomes outcomes |
| --- | --- | --- |
| "At or above" ladders | SOL, BTC, gold price; "Above 7%"; "8+ wins"; Rotten Tomatoes scores | Strikes from `strike.type === "above"` (or `over` for `sports-total`), else from the labels ("8,000 or above", "Above N", "Over N", "N+"); n strikes give n + 1 buckets |
| "At or below" and date ladders | "How low will the S&P get"; "When will Stripe announce an IPO?" ("Before Jun 1, 2027") | The same, read the other way: a contract's YES pays in the buckets below its strike. Contracts, prices and orders stay exactly as Gemini quotes them; only the payout mapping and the curve flip. Dates format to the ladder's precision ("Dec 2026", "In Jan 2027") |
| Contiguous ranges | Weather highs; S&P / NASDAQ year-end | One "X or below", ranges that meet edge to edge, one "Y or above" |
| Named races | Party nominees, Super Bowl, MVP, Game Awards | Gemini's rules for every contract say *mutually exclusive*, and firm bids add up to no more than $1.05 plus a cent per outcome (stale bids on long shots don't count) |
| Races whose winner may not be listed | 2028 president, French election | An extra **Someone else** outcome when the asks leave over 5% for it, paid when every listed contract resolves NO. Races of more than 39 outcomes keep the 39 likeliest and fold the rest into it |
| Games | Every moneyline game (and its Tie, where listed) | An extra **No result** outcome for postponed or cancelled games |
| Single yes/no questions | "Will the SAVE Act become law?" | Two outcomes, Yes and No, from the one contract |

Contracts that have already settled (a date ladder's past months, the levels an index has already hit) are dropped from a live ladder. Each desk quote records its exact contracts and its extra outcome, and settlement, on-chain and paper, rebuilds that same ladder. If the rebuilt ladder doesn't match the quote, the position is not settled; it unwinds after the grace period with the stake refunded. Protection, collars, covered calls and spreads need an "at or above" price ladder and are off elsewhere.

Still refused: point spreads and player props; "which of these will happen" lists where several can come true; price ladders over 39 strikes (the schedule holds 40 buckets); markets quoted too thinly to read (fewer than 3 firm strikes); and ladders whose prices contradict each other.

## Gemini API usage

Public data (no key), verified Nov 17, 2026:

| Endpoint | Used for |
| --- | --- |
| `GET /v1/prediction-markets/categories` | the categories to list (all of them except `Live`) |
| `GET /v1/prediction-markets/events?status=&category=&limit=&offset=` | market list (up to 1,500 events per category; a failed category is retried once, then kept from the last refresh), recorder (one call per category per 5 min) |
| `GET /v1/prediction-markets/events/{ticker}` | full ladder for the forecast screen and quotes; settlement for the scheduler |
| `GET /v1/book/{instrumentSymbol}` | depth at the quoted ask (leg caps, "largest stake this ladder absorbs") |

Facts that shaped the code: price ladders come back as `type: "categorical"`, `template: "prices-ladder"` with `strike.type === "above"`, and **unsorted**; `bestBid` can be null while both asks exist; yes + no asks can be **momentarily crossed** (we saw SOL ≥ $79 at 0.20 / 0.40), so crossed strikes are excluded from quotes and flagged; settled contracts report `resolutionSide` (`yes`/`no`) and `settlementValue`, and the event reports `settlement.value` and `resolvedAt` (~8 s after expiry); the bucket is the number of strikes that came true on the "at or above" side (a "Before …" contract does when it resolves NO), cross-checked against the value on price ladders. Date ladders settle their early contracts month by month while the event is still open, and contracts can carry `status: "settled"` long before the event does. Many markets have no strike field at all, so their shape comes from the labels. No rate-limit headers are returned; the client budgets ≤ 1 request/s (Gemini documents ~120/min for public endpoints).

Trading: the order endpoint is `POST /v1/prediction-markets/order` (limit orders, HMAC-SHA384 signed headers, after the terms-acceptance check). A sandbox exists at `api.sandbox.gemini.com` with a separate account; this build stays in paper mode (`packages/gemini/src/signed.ts` has the signed client and the two-flag live guard).

## QuickNode Stream configuration

| Setting | Value |
| --- | --- |
| Network | Solana **devnet** |
| Dataset | Block (transactions with `meta.logMessages`) |
| Filter | `infra/quicknode/filter.js`: keeps transactions whose account keys include the Contour program ID; returns `{ signature, slot, blockTime, logs }` |
| Destination | Webhook → `POST https://<desk-host>/hooks/quicknode`, compression off |
| Security | The desk verifies `x-qn-signature` = hex HMAC-SHA256(security token, `x-qn-nonce` + `x-qn-timestamp` + body) with a constant-time compare; unsigned deliveries are rejected |

**Why.** The Stream is the desk's only trigger: it learns of every `open`, `accept`, `cancel`, `settle` and `unwind` without polling, decodes Anchor events straight from the logs (no follow-up RPC), and processes them idempotently by signature. The desk then pushes the decoded events to the browser over server-sent events, which drive the live position page.

## Tests

- `packages/core`: `fixtures/sol_calm.json` is a real SOL ladder with a reference computed by an **independent** solver (`scripts/fixtures/reference.py`, SciPy SLSQP, with a KKT optimality check). The TypeScript normalization matches the reference market curve to 1e-9 and the solver matches payouts within $0.50 and expected log growth within 0.0005. Property tests (fast-check): weights sum to 1, every payout is positive, legs + cash equal the stake to the base unit, confidence 0 leaves ≥ 95% cash, crossed quotes still give a valid curve and are never traded. Classifier tests on market shapes recorded from Gemini. For every newly tradable family (date, "or below", "Above N" / "N+" ladders, races with Someone else, games, yes/no questions, races over 40 outcomes), each outcome is settled in turn, the ladder is rebuilt the way the desk does at expiry, and the same outcome must come back. 83 tests.
- `apps/desk`: live-order guard, webhook HMAC and payload extraction, and the event handler (real `PositionOpened` logs): idempotent, refuses a schedule that differs from the quote, accepts exactly once when it matches. 15 tests.
- `programs/contour`: 12 LiteSVM tests (`cargo test -p contour`).

## What comes next

Verifiable settlement (a proof that the value came from Gemini, or several reporters with a dispute window); a forecast API for agents; public forecasters whose scored wallets others can fund; more venues routed by the same compiler; bring-your-own Gemini account with the chain used only for the forecast record.

## Background and references

Contour combines well-established results; none of the math below is new. Where each one is used:

| Used for | Reference |
| --- | --- |
| Buckets as claims that pay $1 in exactly one outcome; a ladder spans every payout schedule over its buckets | Arrow, K. J. (1964). The role of securities in the optimal allocation of risk-bearing. *Review of Economic Studies*, 31(2), 91–96. |
| Reading the market's probability curve from a strip of contract prices | Breeden, D. T., & Litzenberger, R. H. (1978). Prices of state-contingent claims implicit in option prices. *Journal of Business*, 51(4), 621–651. |
| Sizing: maximizing expected log wealth under the user's (blended) view | Kelly, J. L. (1956). A new interpretation of information rate. *Bell System Technical Journal*, 35(4), 917–926. |
| The solver: the multiplicative update for log-optimal portfolios | Cover, T. M. (1984). An algorithm for maximizing expected log investment return. *IEEE Transactions on Information Theory*, 30(2), 369–373. |
| The forecast score `ln(p_you / p_market)` | Good, I. J. (1952). Rational decisions. *Journal of the Royal Statistical Society, Series B*, 14(1), 107–114. |
| Why the log score rewards honest forecasts (a strictly proper scoring rule) | Gneiting, T., & Raftery, A. E. (2007). Strictly proper scoring rules, prediction, and estimation. *Journal of the American Statistical Association*, 102(477), 359–378. |
| Prediction-market prices as probabilities, and their limits | Wolfers, J., & Zitzewitz, E. (2004). Prediction markets. *Journal of Economic Perspectives*, 18(2), 107–126. |
| Market scoring rules, the automated-market-maker alternative to an order book | Hanson, R. (2003). Combinatorial information market design. *Information Systems Frontiers*, 5(1), 107–119. |
| The "out of 100 bets" dot grid | Galesic, M., Garcia-Retamero, R., & Gigerenzer, G. (2009). Using icon arrays to communicate medical risks: overcoming low numeracy. *Health Psychology*, 28(2), 210–216. |
| Dots that each stand for an equally likely result | Kay, M., Kola, T., Hullman, J. R., & Munson, S. A. (2016). When (ish) is my bus? User-centered visualizations of uncertainty in everyday, mobile predictive systems. *Proceedings of CHI 2016*, 5092–5103. |
| Related work: a market where whole distributions trade, with an L2-norm market maker (a design note, not peer-reviewed) | White, D. (2024). *Distribution Markets*. Paradigm. https://www.paradigm.xyz/writing/distribution-markets |

How Contour differs from distribution markets [White 2024]: both treat a position as a payoff over outcomes, fully collateralized up front. Distribution markets price moves along the curve with a new automated market maker that needs its own liquidity. Contour has no curve of its own to move: it reads the market's curve from Gemini's existing ladders, buys the contracts at the ask, and sizes the position by expected log growth rather than by a market-maker invariant.

Not investment advice, not insurance. Devnet only.
