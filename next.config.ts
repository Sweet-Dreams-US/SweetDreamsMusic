import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  // 2026-09 media pivot: recording sessions + studio booking are gone. The old
  // marketing/booking URLs still get organic + social traffic, so send them to
  // the /recording landing page (explains the change + the partner studio).
  // Exact-path matches only — /book/invite/[token] and /book/success keep
  // working for any historical session links.
  async redirects() {
    return [
      { source: '/book', destination: '/recording', permanent: true },
      { source: '/pricing', destination: '/recording', permanent: true },
      { source: '/engineers', destination: '/recording', permanent: true },
    ];
  },
};

export default nextConfig;
