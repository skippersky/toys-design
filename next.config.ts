import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
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
