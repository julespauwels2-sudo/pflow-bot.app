import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Mesures (pas dans `npx vitest run`) : npx vitest run --config scripts/mesures/vitest.config.ts */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { include: ["scripts/mesures/**/*.mesure.ts"], environment: "node", testTimeout: 600_000 },
});
