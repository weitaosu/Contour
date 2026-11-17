# Contour — trade your whole view

Contour turns a forecast into a position on **Gemini Prediction Markets**. You draw where you think an outcome will land, next to where the market thinks it will land, and Contour buys the set of yes/no contracts that pays most where the two disagree. The payout schedule is locked in a **Solana escrow** before any trade is placed, and every settled position records how your forecast scored against the market's.

Built for UBC 2026 (DeFi track · Best use of Solana · Gemini bounty · QuickNode bounty). Whitepaper: https://claude.ai/artifact/ABWLewkyznzDGmEZwonPp4

> **What is simulated in this demo.** Escrow deposits, desk collateral, settlement payouts and forecast scores are real **Solana devnet** transactions with a test USDC mint. The desk's hedge on Gemini runs in **paper mode**: each leg is "filled" at the live Gemini ask if the ask is at or below the quoted price, and every such fill is labelled *simulated fill at live quote* in the UI. No order is sent to Gemini unless `EXECUTION_MODE=live` **and** `ALLOW_LIVE_ORDERS=true` are both set (they are not in this build).

---

## The problem

Prediction markets list whole distributions but only let you trade one point of them. About half of Gemini's active events are ladders of 6–33 strikes that together price a full probability curve, yet a trader can only say "yes" or "no" at one strike:

- **People think in ranges; the market sells points.** "SOL ends the week around $73, give or take $3" has no contract.
- **Right on direction, wrong on strike pays zero.**
- **Sizing is left to the user.** A 21-strike ladder is 42 instruments; choosing how much of each is a portfolio problem.
- **Results don't separate skill from luck.** There is no record of what a trader believed before the outcome.

## How it works

1. **Read the market.** A ladder of "≥ strike" contracts becomes one probability curve over n+1 outcome buckets: mid prices (with a `1 − buy.no` bid fallback) are forced non-increasing (running minimum), then differenced, floored at 0.001 and renormalized.
2. **Take your view.** Two sliders — *Where* (center) and *How sure* (0.4×–1.6× the market's width) — or drag the bars by hand. A **confidence dial** (default 0.25, "trust the market" → "trust my forecast") blends your curve with the market's.
3. **Compile.** The solver chooses the growth-optimal (Kelly) mix of cash plus YES/NO contracts **bought at the ask**, maximizing `Σ p̃ⱼ log Wⱼ` with Cover's multiplicative update. Post-processing in integer USDC base units drops dust legs, rounds to the quantity step, caps legs at quoted depth, and recomputes the schedule — so legs + cash equal the stake exactly. The screen shows the payout per outcome and **five numbers**: stake, worst case, best case, chance of profit if you're right, chance of profit if the market's right — plus "if the market is right, this position is expected to return $X". If the forecast is too close to the market to cover spreads, Contour says so and refuses the trade.
4. **Confirm once.** You sign one Solana transaction: `open_position` deposits your USDC stake and writes the payout schedule plus a SHA-256 hash of your forecast and the market snapshot.
5. **Desk accepts and hedges.** A QuickNode Stream on the program delivers `PositionOpened` to the desk, which checks the on-chain schedule equals the quote, re-prices, posts collateral (`max payout − stake`) into the vault, and hedges the legs (paper mode).
6. **Settle and score.** At expiry the desk reads Gemini's settlement, posts the outcome bucket and the score `ln(p_you / p_market)` for that bucket; the escrow pays your scheduled amount and returns the rest to the desk.

### What is unique

- **A forecast compiler, not an order ticket.** Distribution in, sized multi-leg position out — the same engine a forecasting model or agent can call (`POST /quote`).
- **A collateralized, multi-outcome payout schedule as an on-chain primitive.** No solvency risk: the most the position can ever pay is in escrow before the desk trades.
- **A forecast record that cannot be backdated.** The forecast hash is on-chain before the outcome exists; anyone can recompute it from the stored preimage (the position page does this in your browser).
- **It refuses bad trades** and always shows the cost of being wrong.

## Architecture

```
contour/
  apps/web        Next.js 16 (App Router), Tailwind v4 (DESIGN.md tokens), wallet adapter, SVG charts (d3-scale)
  apps/desk       Fastify service: markets, quotes, Stream webhook, executor, scheduler, recorder, replay, faucet (SQLite)
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
pnpm test          # 20 TypeScript tests: compiler fixture + properties, classifier, desk webhook/handler/live guard
```

There are three ways to run it. Pick the first that answers your question.

### A. Look around: live markets, forecast screen, quotes (no keys, ~1 minute)

```bash
cp apps/desk/.env.example apps/desk/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev:desk      # terminal 1 -> http://localhost:4000
pnpm dev:web       # terminal 2 -> http://localhost:3000
```

Everything that reads Gemini works: the market list, the forecast screen (sliders, drag-to-reshape, payouts, the five numbers, comparison, legs), desk quotes and `/replay`. Without desk keys the desk logs `[chain] disabled` and the Confirm button stays off: that is expected.

### B. Full flow on a local Solana validator (no devnet SOL, no accounts, ~3 minutes)

Install the Solana CLI ([guide](https://solana.com/docs/intro/installation)), then:

```bash
pnpm local:up          # starts solana-test-validator with the compiled program (programs/contour/build/contour.so),
                       # generates git-ignored keys in keys/, creates a test USDC mint, funds the desk, initializes Config,
                       # and writes apps/desk/.env.localnet + apps/web/.env.localnet
pnpm dev:desk:local    # terminal 1
pnpm dev:web:local     # terminal 2
pnpm e2e:local         # terminal 3: wallet -> faucet -> quote -> open_position -> desk accepts + hedges; checks the vault
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
| `pnpm recorder` | 5-minute Gemini ladder snapshots into `data/desk.sqlite` (feeds `/replay`) |
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
- **Desk collateral.** `max_payout − stake`, posted at accept. The desk is fully hedged when its legs fill at the quoted asks (escrow payout + leg payoff − collateral − leg cost = 0 in every bucket); its economics are capital lockup plus basis risk if a leg fails to fill. A production desk would charge a fee on stake; this build does not.
- **Trusted outcome post.** The oracle key posts the bucket. It cannot change the schedule or withhold funds, and the outcome is publicly checkable against Gemini's settlement (`resolutionSide` per contract, `settlement.value` per event). If no outcome is posted within `settle_grace_secs` after expiry, anyone can unwind: the user gets the stake back, the desk its collateral.
- **Timeouts.** If the desk does not accept within `accept_timeout_secs` (300 s), it can no longer accept and the user cancels for a full refund. The desk only accepts when the on-chain schedule, stake, expiry and market equal its stored quote, the quote was ≤ 60 s old at open, and re-pricing at current asks costs ≤ 1% over the stake.
- **Limits.** Per-position (`max_stake`, 500 USDC on devnet) and per-wallet daily (`max_daily_stake`) caps are enforced by the program. The confidence dial defaults to 0.25 and the log objective keeps every payout above zero.
- **Named outcomes.** Categorical events are tradable only from an explicit allowlist (`DEMNOM2028`, `REPNOM2028`: exactly one nominee). Those markets list no "Other" outcome; if an unlisted candidate wins, no bucket resolves yes, the desk refuses to post an inconsistent outcome, and the position unwinds after the grace period (user gets the stake back). That residual risk sits with the desk's hedge, not the user.
- **Only exclusive markets.** Threshold ladders (all strikes `above`, or `over` for `sports-total`), contiguous weather buckets, and an explicit allowlist of named-outcome events. Spreads, player props and non-exclusive events ("who will leave office") are rejected; ladders with > 39 strikes exceed the 40-bucket schedule.
- **Limits of paper mode.** Paper fills assume the top-of-book ask is available in the quoted size. Gemini's public book shows only the YES side; NO asks without a mirroring YES bid exist, so NO depth is treated as unknown (uncapped) rather than zero. Thin ladders mean positions are sized in hundreds of dollars.

## Gemini API usage

Public data (no key), verified Nov 17, 2026:

| Endpoint | Used for |
| --- | --- |
| `GET /v1/prediction-markets/events?status=&category=&limit=&offset=` | market list, recorder (one call per category per 5 min) |
| `GET /v1/prediction-markets/events/{ticker}` | full ladder for the forecast screen and quotes; settlement for the scheduler |
| `GET /v1/book/{instrumentSymbol}` | depth at the quoted ask (leg caps, "largest stake this ladder absorbs") |

Facts that shaped the code: price ladders come back as `type: "categorical"`, `template: "prices-ladder"` with `strike.type === "above"`, and **unsorted**; `bestBid` can be null while both asks exist; yes + no asks can be **momentarily crossed** (we saw SOL ≥ $79 at 0.20 / 0.40), so crossed strikes are excluded from quotes and flagged; settled contracts report `resolutionSide` (`yes`/`no`) and `settlementValue`, and the event reports `settlement.value` and `resolvedAt` (~8 s after expiry); the bucket is the number of `yes` strikes, cross-checked against the value. No rate-limit headers are returned; the client budgets ≤ 1 request/s (Gemini documents ~120/min for public endpoints).

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

## Replay

The recorder stores every crypto price ladder (hourly, daily, weekly, monthly) and quoted weather ladder every 5 minutes, plus each ladder's outcome. `/replay` takes the snapshot 30 min (hourly), 6 h (daily, weather) or 24 h (weekly/monthly) before expiry, applies fixed test forecasts (market ±½ sd, market narrowed to 0.6×) at confidence 0.5, and compares a $100 Contour position with the single best contract for the same forecast: count, mean, standard deviation, worst return, share profitable, and cumulative lines. The sample size is printed on the page. It is an illustration, not proof.

## Tests

- `packages/core`: `fixtures/sol_calm.json` is a real SOL ladder with a reference computed by an **independent** solver (`scripts/fixtures/reference.py`, SciPy SLSQP, with a KKT optimality check). The TypeScript normalization matches the reference market curve to 1e-9 and the solver matches payouts within $0.50 and expected log growth within 0.0005. Property tests (fast-check): weights sum to 1, every payout is positive, legs + cash equal the stake to the base unit, confidence 0 leaves ≥ 95% cash, crossed quotes still give a valid curve and are never traded. Classifier tests on recorded Gemini events.
- `apps/desk`: live-order guard, webhook HMAC and payload extraction, and the event handler (real `PositionOpened` logs) — idempotent, refuses a schedule that differs from the quote, accepts exactly once when it matches.
- `programs/contour`: 12 LiteSVM tests (`cargo test -p contour`).

## What comes next

Verifiable settlement (a proof that the value came from Gemini, or several reporters with a dispute window); a forecast API for agents; public forecasters whose scored wallets others can fund; more venues routed by the same compiler; bring-your-own Gemini account with the chain used only for the forecast record.

Not investment advice, not insurance. Devnet only.
