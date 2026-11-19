import { BetweenHorizontalStart, Coins, ShieldHalf, TrendingUpDown, type LucideIcon } from "lucide-react";
import { capChoices, isReversed, type Ladder } from "@contour/core";

/**
 * Strategies beyond the four everyday outlooks and "Protect what you hold". They live in the
 * collapsed "More strategies" list so the main screen stays simple; the everyday options keep the
 * big tiles. Listed from simplest to most sophisticated. To add one: add an entry here, then handle
 * its key in ForecastScreen (its controls in the order panel, and how its position is built).
 */
export type StrategyKey = "range" | "spread" | "covered" | "collar";

/**
 * Off for now: the advanced strategies made the screen too busy. Everything below (and the engine in
 * packages/core/src/protect.ts, the desk support and the tests) is kept; set this to true to bring
 * the collapsed "More strategies" section back.
 */
export const MORE_STRATEGIES_ENABLED = false;

export interface StrategyDef {
  key: StrategyKey;
  title: string;
  /** One line, plain words: what it's for, not how it works. */
  sub: string;
  level: "Intermediate" | "Advanced";
  icon: LucideIcon;
  /** Whether this market can support it. */
  available: (ladder: Ladder) => boolean;
}

// Spreads, collars and covered calls are built on "at or above" strikes, so not on "Before …" ladders.
const priceLadder = (l: Ladder) => l.kind === "threshold" && l.cuts !== null && !isReversed(l);

export const MORE_STRATEGIES: StrategyDef[] = [
  {
    key: "range",
    title: "Range",
    sub: "Pick the two prices you think it lands between.",
    level: "Intermediate",
    icon: BetweenHorizontalStart,
    available: (l) => l.cuts !== null && l.marketProb.length >= 4,
  },
  {
    key: "spread",
    title: "Spread",
    sub: "Make more the further it moves your way, up to a limit.",
    level: "Intermediate",
    icon: TrendingUpDown,
    available: (l) => priceLadder(l) && l.strikes.length >= 3,
  },
  {
    key: "covered",
    title: "Covered call",
    sub: "Earn on what you hold, by giving up gains above a cap.",
    level: "Advanced",
    icon: Coins,
    available: (l) => priceLadder(l) && capChoices(l).length > 0,
  },
  {
    key: "collar",
    title: "Collar",
    sub: "Protect what you hold for less, by giving up gains above a cap.",
    level: "Advanced",
    icon: ShieldHalf,
    available: (l) => priceLadder(l) && capChoices(l).length > 0,
  },
];
