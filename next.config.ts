import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on its Node worker and native canvas runtime. Keeping
  // these packages external preserves their server-side initialization.
  serverExternalPackages: ["pdf-parse", "pdf-parse/worker", "@napi-rs/canvas"],
};

export default nextConfig;
