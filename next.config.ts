import type { NextConfig } from "next";

// Every page here shows live, per-user data, so the classic (non-Cache
// Components) model is used: pages read the session cookie and render on each
// request; mutations call revalidatePath().
const nextConfig: NextConfig = {
  // PGlite ships WebAssembly + data files that must be loaded from node_modules
  // at runtime rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
