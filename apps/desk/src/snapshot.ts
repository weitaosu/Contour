import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { slimEvent, type RawEvent } from "@contour/gemini";

/**
 * A frozen copy of Gemini's tradable events, so the demo keeps working (market list, ladders,
 * quotes) when Gemini's API is down. The desk refreshes the runtime copy in data/ whenever a live
 * list succeeds; `pnpm snapshot` writes the bundled copy in fixtures/demo/ that ships with the repo.
 */
export interface Snapshot {
  capturedAt: number; // unix ms
  note?: string;
  events: RawEvent[];
}

const root = resolve(process.cwd(), "../..");
export const RUNTIME_SNAPSHOT = process.env.SNAPSHOT_PATH ?? resolve(root, "data/gemini-snapshot.json");
export const BUNDLED_SNAPSHOT = resolve(root, "fixtures/demo/gemini-snapshot.json");

function read(path: string): Snapshot | null {
  try {
    if (!existsSync(path)) return null;
    const s = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
    return Array.isArray(s.events) && s.events.length ? s : null;
  } catch (err) {
    console.warn(`[snapshot] could not read ${path}:`, (err as Error).message);
    return null;
  }
}

/** The newest snapshot available: the desk's own runtime copy, or the one bundled with the repo. */
export function loadSnapshot(): Snapshot | null {
  const a = read(RUNTIME_SNAPSHOT);
  const b = read(BUNDLED_SNAPSHOT);
  if (a && b) return a.capturedAt >= b.capturedAt ? a : b;
  return a ?? b;
}

/**
 * Made-up demo markets (fixtures/demo/sample-markets.json), e.g. a multi-outcome Fed-decision race
 * modeled on real FOMC markets. Always served flagged as samples and never quotable.
 */
export const SAMPLE_MARKETS = resolve(root, "fixtures/demo/sample-markets.json");
let samples: { at: number; events: RawEvent[] } | null = null;
export function loadSamples(): RawEvent[] {
  if (samples && Date.now() - samples.at < 60_000) return samples.events;
  try {
    const events = existsSync(SAMPLE_MARKETS) ? ((JSON.parse(readFileSync(SAMPLE_MARKETS, "utf8")) as { events?: RawEvent[] }).events ?? []) : [];
    samples = { at: Date.now(), events };
  } catch (err) {
    console.warn(`[samples] could not read ${SAMPLE_MARKETS}:`, (err as Error).message);
    samples = { at: Date.now(), events: [] };
  }
  return samples.events;
}

/** Atomic write, so a crash mid-write never leaves a half snapshot behind. */
export function saveSnapshot(events: RawEvent[], path = RUNTIME_SNAPSHOT, capturedAt = Date.now(), note?: string) {
  mkdirSync(dirname(path), { recursive: true });
  const body: Snapshot = { capturedAt, ...(note ? { note } : {}), events: events.map(slimEvent) };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(body));
  renameSync(tmp, path);
}
