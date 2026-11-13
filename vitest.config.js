import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-env.js"],
    include: ["tests/**/*.test.js"],
    // Integration files each start an in-memory MongoDB; running them one at a time keeps memory and ports predictable.
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 20000,
  },
});
