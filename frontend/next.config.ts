import type { NextConfig } from "next";

// BCC_PAGES=1 builds the static GitHub Pages demo (see scripts/build-pages.mjs).
const pages = process.env.BCC_PAGES === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  ...(pages ? { output: "export" as const, basePath, trailingSlash: true, images: { unoptimized: true } } : {}),
};
export default config;
