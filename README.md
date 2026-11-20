# Contour

Prediction markets ask yes or no, and every bet is all-or-nothing: slightly wrong means you lose everything you put in. Most people's beliefs aren't that binary.

Contour lets you trade the middle ground. Instead of putting everything on one outcome, it spreads your position across contracts so you can express a view like "somewhere in this range" or "a big move either way," while controlling how much you can lose in every scenario.

**[Watch the demo video](https://www.loom.com/share/9456b6bb004c4a3c9c87ddff0074c373)**

**Why it matters:** prediction markets have grown fast, and what they need next is liquidity. Contour draws in cautious traders and lets existing bettors put in more without betting it all on one outcome. Spreading a view across more contracts adds liquidity to every pool it touches.

## How it works

1. **Pick a market.** Sports, crypto, commodities and more, live from Gemini's prediction markets API. The grey curve shows where traders expect the outcome to land.
2. **Shape your view.** Choose what you expect to happen, then drag your curve over the range you believe in. Your payout in every outcome updates on the right as you go.
3. **Place it.** Review the order and confirm it from your wallet.
4. **Track it.** The portfolio shows open positions, past trades and live P&L. Close a position early whenever you like.

In short, Contour is a new layer on top of Gemini's prediction markets: you win more often, with smaller payouts. That brings the cautious majority in, and their money brings the liquidity.

## Run it

Needs Node ≥ 22 and pnpm 10.

```bash
pnpm install
cp apps/desk/.env.example apps/desk/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev        # desk on :4000, web app on :3000
pnpm test
```

Escrow and settlement run on Solana devnet with test USDC. Orders on Gemini are simulated at live prices (paper mode). Not investment advice.

## Team

Weitao Su · David Sun · Marc Jeric Teo Ong
