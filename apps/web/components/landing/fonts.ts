import { DM_Sans, Inter } from "next/font/google";

/**
 * The landing style's type, shared by every page that uses it (the landing page and the market
 * browser): a regular-weight grotesk for display, Inter for everything you read or press.
 */
export const display = DM_Sans({ subsets: ["latin"], weight: ["400"], variable: "--font-landing-display", display: "swap" });
export const body = Inter({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-landing-body", display: "swap" });

/** Put on the page's root, next to the `lp-root` class, to make both fonts available. */
export const fontVars = `${display.variable} ${body.variable}`;
