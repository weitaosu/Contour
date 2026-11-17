import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@contour/core", "@contour/chain"],
  turbopack: {
    // @anchor-lang/core's browser bundle mentions fs (for a Node-only helper); stub it in the browser.
    resolveAlias: { fs: { browser: "./lib/empty.js" } },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
