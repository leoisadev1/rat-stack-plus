import { mkdir } from "node:fs/promises";
import path from "node:path";
import { create } from "create-better-t-stack";
import type { StackConfig } from "../stack.ts";
import { install } from "./lint.ts";

/**
 * Better-T-Stack generates the workspace: Hono on Workers, oRPC, Drizzle on D1,
 * Alchemy infra in packages/infra, and a shared shadcn package in packages/ui.
 * The rest of the pipeline layers Rat Stack Plus defaults on top.
 */
export async function scaffold(config: StackConfig) {
  // Better-T-Stack rejects project paths outside process.cwd(), so create the
  // project from its parent directory.
  const cwd = process.cwd();
  const parent = path.dirname(config.projectDir);
  await mkdir(parent, { recursive: true });
  process.chdir(parent);
  const result = await create(path.basename(config.projectDir), {
    frontend: [config.frontend],
    backend: "hono",
    runtime: "workers",
    api: "orpc",
    database: "sqlite",
    orm: "drizzle",
    dbSetup: "d1",
    auth: config.auth,
    payments: "none",
    addons: ["turborepo", "oxlint"],
    examples: [],
    webDeploy: "cloudflare",
    serverDeploy: "cloudflare",
    packageManager: config.packageManager,
    // Installed below with captured output so it doesn't break the spinner.
    install: false,
    git: false,
    directoryConflict: "error",
    renderTitle: false,
    disableAnalytics: true,
  }).finally(() => process.chdir(cwd));

  if (result.isErr()) {
    throw new Error(`Better-T-Stack could not create the project: ${result.error.message}`);
  }
  const projectDirectory = result.value.projectDirectory;
  await install(config.packageManager, projectDirectory);
  return projectDirectory;
}
