import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPackageBin } from "../exec.ts";
import type { StackConfig } from "../stack.ts";
import { starterUiFiles } from "../templates/ui.ts";
import { describePreset, presetUrl } from "../theme.ts";

const COMPONENTS = [
  "avatar",
  "badge",
  "breadcrumb",
  "card",
  "dropdown-menu",
  "empty",
  "field",
  "input",
  "label",
  "separator",
  "sidebar",
  "skeleton",
  "spinner",
  "tooltip",
];

/** Files from the upstream template that the starter UI replaces. */
const REPLACED = ["components/header.tsx", "app/dashboard/dashboard.tsx"];

/**
 * Replaces the upstream starter pages with shadcn ones: a landing page, a login
 * card, and a sidebar dashboard. Components come from the preset's registry, so
 * the pages pick up its style, fonts, and colors.
 */
export async function buildStarterUi(config: StackConfig) {
  const webDir = path.join(config.projectDir, "apps/web");
  const srcDir = path.join(webDir, "src");
  const scope = `@${config.projectName}`;

  // --overwrite keeps the run non-interactive; the existing files came from the same preset.
  await runPackageBin("shadcn", "shadcn", ["add", ...COMPONENTS, "--yes", "--overwrite"], webDir);
  await moveHookToUiPackage(config.projectDir, srcDir);

  for (const file of REPLACED) await rm(path.join(srcDir, file), { force: true });

  const files = starterUiFiles({
    scope,
    title: displayName(config.projectName),
    frontend: config.frontend,
    auth: config.auth,
    presetCode: config.presetCode,
    presetLabel: describePreset(config.presetCode),
    presetUrl: presetUrl(config.presetCode),
  });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(srcDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  if (config.frontend === "tanstack-start") await updateTanstackRoot(srcDir);
  if (config.frontend === "next") await updateNextLayout(srcDir, displayName(config.projectName));
  if (config.frontend === "react-router") await updateReactRouterRoot(srcDir);
}

/** "my-app" becomes "My App". */
export function displayName(projectName: string) {
  return projectName
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// shadcn writes hooks through the app's components.json, but the sidebar in
// packages/ui imports use-mobile from the UI package.
async function moveHookToUiPackage(projectDir: string, srcDir: string) {
  const from = path.join(srcDir, "hooks/use-mobile.ts");
  if (!existsSync(from)) return;
  const toDir = path.join(projectDir, "packages/ui/src/hooks");
  await mkdir(toDir, { recursive: true });
  await rename(from, path.join(toDir, "use-mobile.ts"));
  await rm(path.join(srcDir, "hooks"), { recursive: true, force: true });
}

const HEADER_WRAPPER = /<div className="[^"]*h-svh[^"]*">\s*<Header \/>\s*(<Outlet \/>|\{children\})\s*<\/div>/;
const HEADER_IMPORT = /^import Header from .*\n/m;

/** Drops the upstream header grid; every page now brings its own layout. */
function unwrapHeader(source: string, file: string) {
  if (!HEADER_WRAPPER.test(source)) throw new Error(`Could not find the header layout in ${file}.`);
  return source.replace(HEADER_WRAPPER, "$1").replace(HEADER_IMPORT, "");
}

async function edit(file: string, update: (source: string) => string) {
  await writeFile(file, update(await readFile(file, "utf8")));
}

async function updateTanstackRoot(srcDir: string) {
  const file = path.join(srcDir, "routes/__root.tsx");
  await edit(file, (source) => {
    const next = unwrapHeader(source, file)
      .replace(`<html lang="en" className="dark">`, `<html lang="en" suppressHydrationWarning>`)
      .replace(
        "<Outlet />",
        `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>\n<Outlet />`,
      )
      .replace("<Toaster richColors />", "<Toaster richColors />\n</ThemeProvider>");
    return `import { ThemeProvider } from "next-themes";\n${next}`;
  });
}

async function updateNextLayout(srcDir: string, title: string) {
  const file = path.join(srcDir, "app/layout.tsx");
  await edit(file, (source) =>
    unwrapHeader(source, file)
      .replace(/title: "[^"]*"/, `title: ${JSON.stringify(title)}`)
      .replace(/description: "[^"]*"/, `description: "Built with Rat Stack Plus"`),
  );
}

async function updateReactRouterRoot(srcDir: string) {
  const file = path.join(srcDir, "root.tsx");
  await edit(file, (source) =>
    unwrapHeader(source, file)
      .replace(`defaultTheme="dark"`, `defaultTheme="system"\n enableSystem`)
      // next-themes sets the class on <html> before hydration.
      .replace(`<html lang="en">`, `<html lang="en" suppressHydrationWarning>`),
  );
}
