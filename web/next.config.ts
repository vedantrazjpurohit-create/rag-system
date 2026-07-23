import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// Next requires outputFileTracingRoot and turbopack.root to be identical.
// Use the monorepo root (parent of web/) so both match Next's monorepo detection.
const appDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(appDir, "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  // Native / wasm packages must not be bundled into the route chunk
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js", "sharp"],
  experimental: {
    proxyClientMaxBodySize: "150mb",
  },
};

export default nextConfig;
