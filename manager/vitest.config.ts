import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "src",
    include: ["**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000
  }
});
