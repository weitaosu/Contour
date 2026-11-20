/**
 * Class names for the landing page's stylesheet (landing.css). The repo's Turbopack config runs
 * every .css file through Tailwind as plain global CSS, so CSS modules aren't hashed here: the
 * classes are global and namespaced "lp-" instead.
 */
import "./landing.css";

export const s = {
  root: "lp-root",
  display: "lp-display",
  pill: "lp-pill",
  pillDark: "lp-pillDark",
  pillLine: "lp-pillLine",
  grain: "lp-grain",
  stage: "lp-stage",
  haze: "lp-haze",
  rim: "lp-rim",
  band: "lp-band",
  bandLavender: "lp-bandLavender",
  seam: "lp-seam",
  seamTop: "lp-seamTop",
  seamBottom: "lp-seamBottom",
  link: "lp-link",
} as const;
