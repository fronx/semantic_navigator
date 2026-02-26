import type { NextConfig } from "next";

const nextConfig = {
  // Include artifact data files in the serverless function bundle.
  // Required for Vercel git-based deployments: Next.js traces file dependencies
  // automatically but won't find these (they're read via dynamic fs.readFile paths).
  outputFileTracingIncludes: {
    "/artifact/api/**": ["./data/artifact/**"],
  },
} satisfies NextConfig;

export default nextConfig;
