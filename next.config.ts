import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-pdf historically crashed Next.js's App Router route handlers
  // before bundling excluded it from the server bundle — fixed upstream,
  // but keeping this is cheap insurance (see react-pdf.org/compatibility).
  serverExternalPackages: ["@react-pdf/renderer"],
  // The report-card PDF reads its font files from /assets/fonts at runtime (lib/reportFonts.ts). Next only
  // ships files it can see being imported, so tell it to include them with the report-card route.
  outputFileTracingIncludes: {
    "/api/report-cards/**": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
