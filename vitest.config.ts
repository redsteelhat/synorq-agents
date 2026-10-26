import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"], fileParallelism: false },
  esbuild: { jsx: "automatic", jsxImportSource: "hono/jsx" },
});
