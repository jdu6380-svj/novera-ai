import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on its Node worker and native canvas runtime. Keeping
  // these packages external preserves their server-side initialization.
  serverExternalPackages: [
    "pdf-parse",
    "pdf-parse/worker",
    "@napi-rs/canvas",
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/chi_sim",
  ],
  outputFileTracingIncludes: {
    "/api/v1/documents/*/process": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/chi_sim/**/*",
    ],
    "/api/v1/documents/*/complete": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/chi_sim/**/*",
    ],
    "/api/v1/processing-jobs/*/retry": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/chi_sim/**/*",
    ],
  },
};

export default nextConfig;
