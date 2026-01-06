import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile local packages that need ESM support
  transpilePackages: ["umapper"],
};

export default nextConfig;
