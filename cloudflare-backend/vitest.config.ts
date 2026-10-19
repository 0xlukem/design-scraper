import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/platform-stub.ts", import.meta.url),
      ),
    },
  },
  test: { testTimeout: 30000, hookTimeout: 30000 },
});
