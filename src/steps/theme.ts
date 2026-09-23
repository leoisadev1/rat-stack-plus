import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPackageBin } from "../exec.ts";
import type { StackConfig } from "../stack.ts";

const POINTER_RULE = `
@layer base {
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
`;

/**
 * Applies the shadcn preset to the shared UI package. `shadcn apply` only detects
 * a framework from the app directory, and writes through the app's components.json
 * into packages/ui.
 */
export async function applyTheme(config: StackConfig) {
  const webDir = path.join(config.projectDir, "apps/web");
  const strayUtils = path.join(webDir, "src/lib/utils.ts");
  const hadUtils = existsSync(strayUtils);

  await runPackageBin("shadcn", "shadcn", ["apply", "--preset", config.presetCode, "--yes"], webDir);

  // shadcn apply writes `export { cn } from "cn"` into the app, which has no `cn`
  // dependency. The app already imports cn from the UI package.
  if (!hadUtils && existsSync(strayUtils)) await rm(strayUtils);

  await inheritPresetFont(config.projectDir);
  if (config.pointer) await addPointerCursor(config.projectDir);
  if (config.rtl) await enableRtl(config.projectDir, webDir);
}

// shadcn apply sets the preset font on <html>, but the upstream stylesheet also
// puts font-sans on <body>, which wins and falls back to an unloaded Inter for
// mono presets. Let the body inherit from <html>.
async function inheritPresetFont(projectDir: string) {
  const cssPath = path.join(projectDir, "packages/ui/src/styles/globals.css");
  const css = await readFile(cssPath, "utf8");
  await writeFile(cssPath, css.replace("@apply font-sans bg-background text-foreground;", "@apply bg-background text-foreground;"));
}

async function addPointerCursor(projectDir: string) {
  const cssPath = path.join(projectDir, "packages/ui/src/styles/globals.css");
  const css = await readFile(cssPath, "utf8");
  if (css.includes("cursor: pointer")) return;
  await writeFile(cssPath, `${css.trimEnd()}\n${POINTER_RULE}`);
}

async function enableRtl(projectDir: string, webDir: string) {
  await runPackageBin("shadcn", "shadcn", ["migrate", "rtl", "--yes"], webDir);
  // The migration updates the app's components.json; keep the UI package in step
  // so components added later from packages/ui are RTL-aware too.
  const uiConfigPath = path.join(projectDir, "packages/ui/components.json");
  const uiConfig = JSON.parse(await readFile(uiConfigPath, "utf8")) as Record<string, unknown>;
  await writeFile(uiConfigPath, `${JSON.stringify({ ...uiConfig, rtl: true }, null, 2)}\n`);
}
