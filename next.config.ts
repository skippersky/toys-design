import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/export/package": ["./worker-runtime/**/*"],
  },
  serverExternalPackages: ["ag-psd", "archiver", "sharp"],
};

export default nextConfig;
