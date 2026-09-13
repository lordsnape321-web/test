import type { NextConfig } from "next";

/**
 * This app lives one level inside the git repo (`test/react-expo-laravel-futsal-app`).
 * Turbopack walks up the tree to guess a workspace root, and when it lands on the repo
 * root it resolves module formats against a package.json that isn't there — which
 * surfaces as:
 *
 *   ./src/app/layout.tsx
 *   Specified module format (CommonJs) is not matching the module format of the
 *   source code (EcmaScript Modules)
 *
 * Pinning the root to this folder keeps resolution anchored next to the real
 * package.json. `next` is always launched from the project directory (npm run
 * dev / build / start), so cwd is exactly the app root.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
