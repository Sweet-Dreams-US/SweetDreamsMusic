import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Monorepo: trace files up to the repo root (packages/core imports).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fweeyjnqwxywmpmnqpts.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'customer-w6h9o08eg118alny.cloudflarestream.com',
      },
    ],
  },
};

export default nextConfig;
