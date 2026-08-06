import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
  outputFileTracingIncludes: {
    "/api/export/package": ["./worker-runtime/**/*"],
  },
  serverExternalPackages: ["ag-psd", "archiver", "sharp"],
};

export default nextConfig;
