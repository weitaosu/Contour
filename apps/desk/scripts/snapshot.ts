/**
 * Freeze every tradable Gemini market into fixtures/demo/gemini-snapshot.json, the copy that ships
 * with the repo. When Gemini's API is down, the desk serves this (or its own newer runtime copy in
 * data/) so the demo can still be clicked through. Run while Gemini is up:  pnpm snapshot
 */
import "dotenv/config";
import { tryNormalize } from "@contour/core";
import { GeminiPublicClient, type RawEvent } from "@contour/gemini";
import { config } from "../src/config";
import { BUNDLED_SNAPSHOT, saveSnapshot } from "../src/snapshot";

const client = new GeminiPublicClient(config.geminiBase);
const all: RawEvent[] = [];
for (const category of config.marketCategories) {
  try {
    const events = await client.listAllEvents({ status: "active", category }, 100, 5);
    all.push(...events);
    console.log(`${category}: ${events.length} events`);
  } catch (err) {
    console.warn(`${category}: ${(err as Error).message}`);
  }
}

const now = Date.now();
const tradable = all.filter((e) => new Date(e.expiryDate).getTime() > now && "ladder" in tryNormalize(e, { categoricalAllowlist: config.categoricalAllowlist }));
if (!tradable.length) {
  console.error("Gemini returned no tradable markets, so the existing snapshot was left as it is.");
  process.exit(1);
}
saveSnapshot(tradable, BUNDLED_SNAPSHOT, now);
console.log(`Froze ${tradable.length} tradable markets (of ${all.length} events) into ${BUNDLED_SNAPSHOT}`);
