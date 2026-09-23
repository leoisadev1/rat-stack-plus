import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../exec.ts";
import { runCommand, type StackConfig } from "../stack.ts";

export const LEFTHOOK_VERSION = "2.1.14";

/**
 * The fence, after Rat Stack's: git hooks run lint before a commit and type
 * checks before a push, and agent hooks refuse commands that skip them.
 * Runs before lint setup, whose install pulls in lefthook.
 */
export async function writeFence(config: StackConfig) {
  const root = config.projectDir;
  await writeFile(path.join(root, "lefthook.yml"), lefthookConfig(config));

  const hooksDir = path.join(root, "scripts/hooks");
  await mkdir(hooksDir, { recursive: true });
  await writeFile(path.join(hooksDir, "install.mjs"), installHooksScript());
  await writeFile(path.join(hooksDir, "block-hook-bypass.mjs"), blockHookBypassScript());

  await mergeJson(path.join(root, ".claude/settings.json"), (settings) => ({
    ...settings,
    hooks: {
      ...settings.hooks,
      PreToolUse: [
        ...(settings.hooks?.PreToolUse ?? []),
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/block-hook-bypass.mjs"' }],
        },
      ],
    },
  }));
  await mergeJson(path.join(root, ".cursor/hooks.json"), (hooks) => ({
    version: 1,
    ...hooks,
    hooks: {
      ...hooks.hooks,
      beforeShellExecution: [
        ...(hooks.hooks?.beforeShellExecution ?? []),
        { command: "node scripts/hooks/block-hook-bypass.mjs", matcher: "git", failClosed: true },
      ],
    },
  }));

  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  pkg.scripts = { ...pkg.scripts, prepare: "node scripts/hooks/install.mjs" };
  pkg.devDependencies = { ...pkg.devDependencies, lefthook: LEFTHOOK_VERSION };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * Installs the git hooks once the repository exists; `prepare` ran before `git init`.
 * Goes through the package manager so lefthook is on PATH.
 */
export async function installGitHooks(config: StackConfig) {
  await run(config.packageManager, ["run", "prepare"], config.projectDir);
}

interface HookFile {
  version?: number;
  hooks?: Record<string, unknown[] | undefined>;
  [key: string]: unknown;
}

async function mergeJson(file: string, update: (value: HookFile) => HookFile) {
  const current = existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as HookFile) : {};
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(update(current), null, 2)}\n`);
}

export function lefthookConfig(config: StackConfig) {
  return `# The fence: lint before every commit, type checks before every push.
# Agents are blocked from skipping these hooks; see scripts/hooks/block-hook-bypass.mjs.
pre-commit:
  commands:
    lint:
      run: ${runCommand(config.packageManager, "lint")}

pre-push:
  commands:
    check-types:
      run: ${runCommand(config.packageManager, "check-types")}
`;
}

export function installHooksScript() {
  return `// Runs from the prepare script. lefthook fails outside a git repository, which is
// normal while a package is being installed from a tarball or before \`git init\`.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });

// Outside a repository, or inside an enclosing one such as a monorepo: leave its hooks alone.
if (git.status !== 0 || realpathSync(git.stdout.trim()) !== realpathSync(process.cwd())) process.exit(0);

const lefthook = spawnSync("lefthook", ["install"], { stdio: "inherit", shell: process.platform === "win32" });

process.exit(lefthook.status ?? 1);
`;
}

export function blockHookBypassScript() {
  return `// Agent hook for Claude Code and Cursor. Refuses git commands that skip the
// lefthook hooks. Adapted from Rat Stack's fence (github.com/joelhooks/rat-stack).
const GIT = /(?:^|[\\s;&|()])(?:[^\\s;&|()]*\\/)?git(?=$|[\\s;&|()])/;

const BYPASSES = [
  /--no-verify(?=$|[\\s;&|()])/,
  /\\bgit\\s+(?:-[^\\s]+\\s+)*commit\\b[^;&|]*\\s-[a-zA-Z]*n[a-zA-Z]*(?=$|\\s)/,
  /core\\.hooksPath/,
  /\\bLEFTHOOK=(?:0|false)\\b/,
];

const REASON =
  "Blocked: this command skips the git hooks. Fix what the hook reports instead, or ask the human before changing the hook policy.";

let raw = "";

for await (const chunk of process.stdin) raw += chunk;

let payload;

try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const command = payload.tool_input?.command ?? payload.command ?? "";

const claude = payload.hook_event_name === "PreToolUse" || "tool_name" in payload;

const blocked = GIT.test(command) && BYPASSES.some((pattern) => pattern.test(command));

if (claude) {
  if (blocked) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON },
      }),
    );
  }
} else {
  console.log(
    JSON.stringify(blocked ? { permission: "deny", user_message: REASON, agent_message: REASON } : { permission: "allow" }),
  );
}
`;
}
