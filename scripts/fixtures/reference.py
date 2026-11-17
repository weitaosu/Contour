"""Independent reference for the Contour compiler (numpy + SciPy).

Re-implements BUILD_PLAN section 6.1 normalization from the raw Gemini event and solves the
growth-optimal portfolio with SciPy SLSQP (a different algorithm from the TypeScript solver),
then writes fixtures/sol_calm.json. Usage:
    python3 -I scripts/fixtures/reference.py fixtures/raw/sol_nov20.json fixtures/sol_calm.json
"""
import json
import math
import sys
from datetime import datetime, timezone

import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm

CONFIDENCE = 0.5
STAKE = 100.0
BELIEF_SD = 3.0


def f(v):
    return None if v in (None, "") else float(v)


def main(src, dst):
    raw = json.load(open(src))
    cs = sorted(raw["contracts"], key=lambda c: float(c["strike"]["value"]))
    S = np.array([float(c["strike"]["value"]) for c in cs])
    n = len(S)
    ya = [f((c.get("prices") or {}).get("buy", {}).get("yes")) for c in cs]
    na = [f((c.get("prices") or {}).get("buy", {}).get("no")) for c in cs]
    bb = [f((c.get("prices") or {}).get("bestBid")) for c in cs]
    ba = [f((c.get("prices") or {}).get("bestAsk")) for c in cs]

    mids = []
    for i in range(n):
        bid = bb[i] if bb[i] is not None else (1 - na[i] if na[i] is not None else None)
        ask = ba[i] if ba[i] is not None else ya[i]
        mids.append((bid + ask) / 2 if bid is not None and ask is not None else np.nan)
    mids = np.array(mids)
    ok = ~np.isnan(mids)
    mids = np.interp(S, S[ok], mids[ok])  # linear, flat at the ends
    m = np.minimum.accumulate(np.clip(mids, 0, 1))
    q = np.empty(n + 1)
    q[0] = 1 - m[0]
    q[1:n] = m[:-1] - m[1:]
    q[n] = m[-1]
    q = np.maximum(q, 0.001)
    q /= q.sum()

    mb = np.concatenate([[S[0] - (S[1] - S[0]) / 2], (S[:-1] + S[1:]) / 2, [S[-1] + (S[-1] - S[-2]) / 2]])
    mu = float((q * mb).sum())
    sd = float(math.sqrt((q * (mb - mu) ** 2).sum()))

    cdf = norm.cdf((S - mu) / BELIEF_SD)
    belief = np.empty(n + 1)
    belief[0] = cdf[0]
    belief[1:n] = cdf[1:] - cdf[:-1]
    belief[n] = norm.sf((S[-1] - mu) / BELIEF_SD)
    belief = np.maximum(belief, 1e-4)
    belief /= belief.sum()
    p = CONFIDENCE * belief + (1 - CONFIDENCE) * q

    price, pay, names = [1.0], [np.ones(n + 1)], ["cash"]
    for i in range(n):
        if ya[i] is None or na[i] is None or not (0 < ya[i] < 1 and 0 < na[i] < 1) or ya[i] + na[i] < 1 - 1e-9:
            continue
        y = np.zeros(n + 1)
        y[i + 1:] = 1
        price += [ya[i], na[i]]
        pay += [y, 1 - y]
        names += [f"YES>={S[i]:g}", f"NO>={S[i]:g}"]
    price = np.array(price)
    R = np.array(pay) / price[:, None]
    K = len(price)

    obj = lambda x: -(p * np.log(np.maximum(x @ R, 1e-12))).sum()
    grad = lambda x: -(R * (p / np.maximum(x @ R, 1e-12))).sum(axis=1)
    res = minimize(obj, np.full(K, 1 / K), jac=grad, method="SLSQP", bounds=[(0, 1)] * K,
                   constraints=({"type": "eq", "fun": lambda x: x.sum() - 1, "jac": lambda x: np.ones(K)},),
                   options={"ftol": 1e-15, "maxiter": 10000})
    w = np.maximum(res.x, 0)
    w /= w.sum()
    W = w @ R
    elg = float((p * np.log(W)).sum())
    # Optimality certificate (KKT): g_k = sum_j p_j R_kj / W_j <= 1 for every instrument.
    kkt = float((R * (p / W)).sum(axis=1).max())
    assert kkt < 1 + 1e-6, f"reference not optimal: max g = {kkt}"

    out = {
        "description": "Real SOL ladder (Gemini SOL2611202200) with a calm-week forecast: market center, belief sd $3, confidence 0.5, $100. Reference computed by scripts/fixtures/reference.py (SciPy SLSQP), before post-processing.",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "event": raw,
        "inputs": {"beliefMean": mu, "beliefSd": BELIEF_SD, "belief": belief.tolist(), "confidence": CONFIDENCE, "stakeUsd": STAKE},
        "reference": {
            "solver": f"scipy SLSQP nit={int(res.nit)}; KKT max g = {kkt:.12f}",
            "marketProb": q.tolist(),
            "marketMean": mu,
            "marketSd": sd,
            "payoutByBucket": (STAKE * W).tolist(),
            "expectedLogGrowth": elg,
            "weights": {names[k]: float(w[k]) for k in range(K) if w[k] > 1e-6},
        },
    }
    json.dump(out, open(dst, "w"), indent=1)
    print(f"market mean {mu:.3f} sd {sd:.3f}; SLSQP {res.message} ELG {elg:.6f}")
    print("weights:", {k: round(v, 4) for k, v in out["reference"]["weights"].items()})
    print("payouts:", [round(x, 2) for x in out["reference"]["payoutByBucket"]])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
