import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"], fileParallelism: false },
  oxc: { jsx: { runtime: "automatic", importSource: "hono/jsx" } },
});
