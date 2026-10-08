import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // `next dev` memetakan prefix itu sendiri lewat tsconfig `paths`, jadi alias
    // harus dideklarasikan ulang di sini.
      "@": projectRoot.replace(/[\\/]$/, "") + "/src",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});