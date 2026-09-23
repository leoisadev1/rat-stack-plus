import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  outExtensions: () => ({ js: ".mjs" }),
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
