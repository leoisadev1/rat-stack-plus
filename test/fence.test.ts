import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockHookBypassScript, installHooksScript, lefthookConfig } from "../src/steps/fence.ts";
import { DEFAULT_CHOICES } from "../src/stack.ts";

const script = path.join(mkdtempSync(path.join(tmpdir(), "rsp-fence-")), "block-hook-bypass.mjs");
writeFileSync(script, blockHookBypassScript());

function hook(payload: unknown) {
  const result = spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

const claude = (command: string) => hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
const cursor = (command: string) => hook({ command });

describe("block-hook-bypass", () => {
  it.each([
    "git commit --no-verify -m wip",
    "git push --no-verify",
    "cd app && git commit -nm wip",
    "git commit -n -m wip",
    "LEFTHOOK=0 git commit -m wip",
    "git -c core.hooksPath=/dev/null commit -m wip",
    "/usr/bin/git commit --no-verify",
  ])("denies %s", (command) => {
    expect(claude(command).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(cursor(command).permission).toBe("deny");
  });

  it.each(["git commit -m 'no verify needed'", "git status", "git log -n 5", "npm run lint -- --no-verify", "bun run check-types"])(
    "allows %s",
    (command) => {
      expect(claude(command)).toBeUndefined();
      expect(cursor(command)).toEqual({ permission: "allow" });
    },
  );

  it("ignores payloads it can't parse", () => {
    const result = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("lefthookConfig", () => {
  it("uses the project's package manager", () => {
    const config = { ...DEFAULT_CHOICES, projectName: "app", projectDir: "/tmp/app", presetCode: "x", host: "localhost", port: 3000, packageManager: "pnpm" as const };
    expect(lefthookConfig(config)).toContain("run: pnpm run lint");
    expect(lefthookConfig(config)).toContain("run: pnpm run check-types");
  });
});

describe("installHooksScript", () => {
  it("leaves an enclosing repository's hooks alone", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "rsp-parent-"));
    spawnSync("git", ["init", "-q"], { cwd: parent });
    const app = path.join(parent, "app");
    mkdirSync(app);
    writeFileSync(path.join(app, "install.mjs"), installHooksScript());

    const result = spawnSync(process.execPath, ["install.mjs"], { cwd: app, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(parent, ".git/hooks/pre-commit"))).toBe(false);
  });
});
