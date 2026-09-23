import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../exec.ts";
import type { StackConfig } from "../stack.ts";
import { installGitHooks } from "./fence.ts";

/**
 * Repairs Better-T-Stack output. Its `dev:server` script filters on a package
 * named `hono` with a `dev:bare` task; neither exists. The server only runs
 * through the `dev` task, so drop the script rather than ship one that fails.
 */
export async function fixRootScripts(projectDir: string) {
  const pkgPath = path.join(projectDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { scripts?: Record<string, string> };
  if (pkg.scripts?.["dev:server"]?.includes("-F hono")) {
    const { "dev:server": _removed, ...scripts } = pkg.scripts;
    pkg.scripts = scripts;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // `dev:web` runs `turbo run dev:bare -F web`, but turbo.json never declares the
  // task, so turbo refuses to run it. Declare it like `dev`.
  const turboPath = path.join(projectDir, "turbo.json");
  const turbo = JSON.parse(await readFile(turboPath, "utf8")) as { tasks?: Record<string, unknown> };
  if (turbo.tasks && !turbo.tasks["dev:bare"]) {
    turbo.tasks = { ...turbo.tasks, "dev:bare": { cache: false, persistent: true } };
    await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);
  }

  // Alchemy can diff the stack against Cloudflare without deploying. Expose it next to deploy.
  const infraPath = path.join(projectDir, "packages/infra/package.json");
  const infra = JSON.parse(await readFile(infraPath, "utf8")) as { name: string; scripts?: Record<string, string> };
  if (infra.scripts?.deploy && !infra.scripts.plan) {
    infra.scripts = { ...infra.scripts, plan: "alchemy plan" };
    await writeFile(infraPath, `${JSON.stringify(infra, null, 2)}\n`);
    const root = JSON.parse(await readFile(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    root.scripts = { ...root.scripts, plan: `turbo run plan -F ${infra.name} --` };
    await writeFile(pkgPath, `${JSON.stringify(root, null, 2)}\n`);
    if (turbo.tasks && !turbo.tasks.plan) {
      turbo.tasks = { ...turbo.tasks, plan: { cache: false, interactive: true } };
      await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);
    }
  }

  // The server's env module pulls in its Cloudflare types with a triple-slash path
  // reference, which Oxlint flags. tsconfig already includes the file.
  const envPath = path.join(projectDir, "apps/server/src/env.server.ts");
  if (existsSync(envPath)) {
    const source = await readFile(envPath, "utf8");
    await writeFile(envPath, source.replace(/^\/\/\/ <reference path="\.\.\/cloudflare-env\.d\.ts" \/>\n/m, ""));
  }

  // React Router's server entry annotates onError's parameter as `unknown`, which the
  // anti-slop rules flag. The callback type already gives it that type.
  const entryPath = path.join(projectDir, "apps/web/src/entry.server.tsx");
  if (existsSync(entryPath)) {
    const source = await readFile(entryPath, "utf8");
    await writeFile(entryPath, source.replace("onError(error: unknown)", "onError(error)"));
  }

  const gitignorePath = path.join(projectDir, ".gitignore");
  const gitignore = await readFile(gitignorePath, "utf8");
  if (!/^\.alchemy\/?$/m.test(gitignore)) {
    await appendFile(gitignorePath, "\n# Alchemy local state\n.alchemy\n");
  }
}

export const ROUTER_CLI_VERSION = "^1.167.38";

/** The Start plugin appends this to the route tree; `tsr generate` needs it spelled out. */
export const START_ROUTE_TREE_FOOTER = [
  "import type { getRouter } from './router.tsx'",
  "import type { createStart } from '@tanstack/react-start'",
  "declare module '@tanstack/react-start' {",
  "  interface Register {",
  "    ssr: true",
  "    router: Awaited<ReturnType<typeof getRouter>>",
  "  }",
  "}",
].join("\n");

/**
 * TanStack Start's `check-types` runs a full `vite build` just to produce the
 * route tree. `tsr generate` writes the same file in a fraction of the time.
 * Turbo also expects every `check-types` to write `dist/`, and warns for the
 * packages that only type check, so those declare what they really write.
 */
export async function fixCheckTypes(config: StackConfig) {
  const root = config.projectDir;
  const webDir = path.join(root, "apps/web");
  const webPkgPath = path.join(webDir, "package.json");
  const webPkg = JSON.parse(await readFile(webPkgPath, "utf8")) as PackageJson;
  const webCheck = webPkg.scripts?.["check-types"];

  if (config.frontend === "tanstack-start" && webCheck?.includes("vite build")) {
    const tsrConfig = {
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      routeTreeFileFooter: [START_ROUTE_TREE_FOOTER],
    };
    await writeFile(path.join(webDir, "tsr.config.json"), `${JSON.stringify(tsrConfig, null, 2)}\n`);
    webPkg.scripts = { ...webPkg.scripts, "check-types": webCheck.replace("vite build", "tsr generate") };
    webPkg.devDependencies = { ...webPkg.devDependencies, "@tanstack/router-cli": ROUTER_CLI_VERSION };
    await writeFile(webPkgPath, `${JSON.stringify(webPkg, null, 2)}\n`);
  }

  for (const dir of ["apps/server", "apps/web", "packages/infra", "packages/ui"]) {
    const pkgPath = path.join(root, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
    const script = pkg.scripts?.["check-types"];
    if (!script || script === "tsc -b") continue;
    await writeFile(
      path.join(root, dir, "turbo.json"),
      `${JSON.stringify({ extends: ["//"], tasks: { "check-types": { outputs: checkTypesOutputs(script) } } }, null, 2)}\n`,
    );
  }
}

/** Files a `check-types` script generates, so Turbo caches them instead of warning. */
export function checkTypesOutputs(script: string) {
  if (script.includes("tsr generate")) return ["src/routeTree.gen.ts"];
  if (script.includes("react-router typegen")) return [".react-router/types/**"];
  return [];
}

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type GitResult = "committed" | "initialized" | "skipped";

/** Initializes git and commits only when the user has a git identity; never invents one. */
export async function initGit(config: StackConfig): Promise<GitResult> {
  if (!config.git) return "skipped";
  const cwd = config.projectDir;
  const probe = await run("git", ["--version"], cwd, true).catch(() => undefined);
  if (!probe || probe.code !== 0) return "skipped";

  await run("git", ["init", "--initial-branch=main"], cwd);
  if (config.fence) await installGitHooks(config);
  const name = await run("git", ["config", "user.name"], cwd, true);
  const email = await run("git", ["config", "user.email"], cwd, true);
  if (name.code !== 0 || email.code !== 0 || !name.output.trim() || !email.output.trim()) {
    return "initialized";
  }

  await run("git", ["add", "-A"], cwd);
  const commit = await run("git", ["commit", "-m", "Initial commit from create-rat-stack-plus", "--no-verify"], cwd, true);
  return commit.code === 0 ? "committed" : "initialized";
}
