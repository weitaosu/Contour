import { createHmac } from "node:crypto";

/**
 * Signed Gemini client for sandbox/live order placement (stretch).
 * Headers per Gemini's REST auth scheme: X-GEMINI-APIKEY, X-GEMINI-PAYLOAD (base64 JSON),
 * X-GEMINI-SIGNATURE (hex HMAC-SHA384 of the payload).
 */
export type ExecutionMode = "paper" | "sandbox" | "live";

export function executionMode(env: NodeJS.ProcessEnv = process.env): ExecutionMode {
  const m = (env.EXECUTION_MODE ?? "paper").toLowerCase();
  return m === "live" || m === "sandbox" ? m : "paper";
}

/** Throws unless BOTH live flags are set. Call before any live order. */
export function assertLiveAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.EXECUTION_MODE !== "live" || env.ALLOW_LIVE_ORDERS !== "true") {
    throw new Error("Live orders are disabled: set EXECUTION_MODE=live and ALLOW_LIVE_ORDERS=true to enable.");
  }
}

export interface PlaceOrderRequest {
  symbol: string; // instrumentSymbol from the API, never constructed
  side: "buy" | "sell";
  outcome: "yes" | "no";
  quantity: string;
  price: string;
  orderType?: "limit";
  timeInForce?: "immediate-or-cancel" | "good-til-cancel";
}

export class GeminiSignedClient {
  constructor(private base: string, private apiKey: string, private apiSecret: string) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const payload = { request: path, nonce: Date.now().toString(), ...body };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    const sig = createHmac("sha384", this.apiSecret).update(b64).digest("hex");
    const res = await fetch(new URL(path, this.base), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": "0",
        "X-GEMINI-APIKEY": this.apiKey,
        "X-GEMINI-PAYLOAD": b64,
        "X-GEMINI-SIGNATURE": sig,
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`Gemini ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  termsStatus() {
    return this.post<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status", {});
  }

  placeOrder(o: PlaceOrderRequest) {
    return this.post<Record<string, unknown>>("/v1/prediction-markets/order", {
      symbol: o.symbol,
      side: o.side,
      outcome: o.outcome,
      quantity: o.quantity,
      price: o.price,
      orderType: o.orderType ?? "limit",
      timeInForce: o.timeInForce ?? "immediate-or-cancel",
    });
  }
}
