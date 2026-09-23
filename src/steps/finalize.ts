import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../exec.ts";
import type { StackConfig } from "../stack.ts";

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

  const gitignorePath = path.join(projectDir, ".gitignore");
  const gitignore = await readFile(gitignorePath, "utf8");
  if (!/^\.alchemy\/?$/m.test(gitignore)) {
    await appendFile(gitignorePath, "\n# Alchemy local state\n.alchemy\n");
  }
}

export type GitResult = "committed" | "initialized" | "skipped";

/** Initializes git and commits only when the user has a git identity; never invents one. */
export async function initGit(config: StackConfig): Promise<GitResult> {
  if (!config.git) return "skipped";
  const cwd = config.projectDir;
  const probe = await run("git", ["--version"], cwd, true).catch(() => undefined);
  if (!probe || probe.code !== 0) return "skipped";

  await run("git", ["init", "--initial-branch=main"], cwd);
  const name = await run("git", ["config", "user.name"], cwd, true);
  const email = await run("git", ["config", "user.email"], cwd, true);
  if (name.code !== 0 || email.code !== 0 || !name.output.trim() || !email.output.trim()) {
    return "initialized";
  }

  await run("git", ["add", "-A"], cwd);
  const commit = await run("git", ["commit", "-m", "Initial commit from create-rat-stack-plus", "--no-verify"], cwd, true);
  return commit.code === 0 ? "committed" : "initialized";
}
