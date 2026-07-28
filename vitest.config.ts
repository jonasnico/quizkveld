import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pipeline and the site are separate builds that share only pipeline/schema.ts,
    // but they share one test runner so `pnpm test` stays a single command.
    include: ["pipeline/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
