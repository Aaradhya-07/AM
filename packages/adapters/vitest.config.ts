import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Tool fixtures spawn real subprocesses; bound competing suites while
    // retaining their original deadlines and assertions.
    maxWorkers: 2,
  },
});
