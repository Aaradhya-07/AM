import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: [
    "@anvilmark/contract",
    "@anvilmark/hardware-sizing",
    "@anvilmark/project-contract",
    "@anvilmark/context",
    "@anvilmark/scanner",
    "@anvilmark/conformance",
  ],
  allowedDevOrigins: [
    "*.preview.emergentagent.com",
    "*.preview.emergentcf.cloud",
    "*.cluster-5.preview.emergentcf.cloud",
    "*.emergentagent.com",
    "*.emergentcf.cloud",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // The scanner type-checks the Atlas fixture, so TypeScript reads its standard
  // library declarations from disk at runtime. File tracing cannot see those
  // reads; without them the deployed function analyzes nothing. The glob uses
  // pnpm's real package path because TypeScript resolves its lib directory
  // from its real location, and node_modules/typescript is a traced symlink.
  outputFileTracingIncludes: {
    "/api/playground/check": [
      "../../node_modules/.pnpm/typescript@*/node_modules/typescript/lib/lib*.d.ts",
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        "fs/promises": false,
        module: false,
        path: false,
        os: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
