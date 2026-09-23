import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly output: string,
  ) {
    super(`Command failed: ${command}`);
  }
}

export interface RunResult {
  code: number;
  output: string;
}

/** Runs a command, capturing combined output. Rejects on a non-zero exit unless `allowFailure`. */
export function run(
  command: string,
  args: readonly string[],
  cwd: string,
  allowFailure = false,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: process.env.CI ?? "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      // npm and pnpm are .cmd shims on Windows and need a shell. Everything else
      // runs directly so arguments keep their boundaries.
      shell: process.platform === "win32" && (command === "npm" || command === "pnpm"),
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, output };
      if (result.code !== 0 && !allowFailure) {
        reject(new CommandError([command, ...args].join(" "), output));
        return;
      }
      resolve(result);
    });
  });
}

/** Runs a bin shipped by one of this CLI's dependencies, so versions stay pinned. */
export function runPackageBin(pkg: string, bin: string, args: readonly string[], cwd: string) {
  const manifestPath = packageManifest(pkg);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: string | Record<string, string> };
  const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[bin];
  if (!relative) throw new Error(`${pkg} does not ship a "${bin}" binary.`);
  const script = path.join(path.dirname(manifestPath), relative);
  return run(process.execPath, [script, ...args], cwd);
}

/** Finds a dependency's package.json even when its exports map hides it. */
function packageManifest(pkg: string) {
  let dir = path.dirname(require.resolve(pkg));
  while (!existsSync(path.join(dir, "package.json")) || path.basename(dir) !== pkg.split("/").at(-1)) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate the ${pkg} package.`);
    dir = parent;
  }
  return path.join(dir, "package.json");
}

export function tail(output: string, lines = 30) {
  return output.trimEnd().split("\n").slice(-lines).join("\n");
}
