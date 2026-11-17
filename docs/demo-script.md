# Demo script (2–3 minutes)

Before recording
- Desk running with the QuickNode Stream delivering to it (check `GET /health` and the Stream dashboard), web on devnet.
- Phantom on **devnet**, wallet funded via the in-app "Get test USDC" button (1,000 USDC + 0.05 SOL).
- Earlier the same day: open a position on a same-day ladder (hourly or the 5 PM ET daily) so it has settled by recording time. Keep its `/p/<pubkey>` URL.
- Open `/replay` once so it is computed.

Recording
1. **Home → "Open the SOL November 20 ladder."** "This grey curve is what the market thinks, read from 20 Gemini contracts at once."
2. **Narrow the forecast.** Drag *How sure* to about ±$3 and set *Confidence* to 50%. Point at the payout bars and the five numbers: worst case, best case, chance of profit if you're right vs if the market's right, and "if the market is right, expected return $98.5 — that's the spread you pay." (Shortcut URL: `/m/SOL2611202200?w=0.6&c=0.5`.)
3. **Comparison card.** "The single best contract for the same view pays more if it hits and $0 if it doesn't; Contour keeps a floor."
4. **Confirm with Phantom.** One signature. The position page opens: *Opened* → within seconds the QuickNode Stream event arrives, the desk posts collateral (*Collateral posted*, explorer link) and hedges (*Hedged*, every fill labelled "simulated fill at live quote"). Show the forecast hash *Verified* in the browser.
5. **The settled position from earlier.** Outcome bucket highlighted, payout received, forecast score (ln of your probability over the market's), stored on-chain. Then **Record** (`/me`).
6. **Replay.** State the sample size out loud; "an illustration, not proof: same forecasts, Contour's worst case and variance versus one contract."

Say once: escrow, collateral and payouts are real devnet transactions with test USDC; the desk's Gemini hedge is paper-traded at live quotes.
