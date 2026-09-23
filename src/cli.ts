import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { Command, Option } from "commander";
import pc from "picocolors";
import { CommandError, tail } from "./exec.ts";
import {
  AUTH_PROVIDERS,
  DEFAULT_CHOICES,
  FRONTENDS,
  PACKAGE_MANAGERS,
  isAuth,
  isFrontend,
  isPackageManager,
  resolveProject,
  runCommand,
  validateProjectName,
  type Auth,
  type Frontend,
  type PackageManager,
  type StackConfig,
} from "./stack.ts";
import { parseDevPorts, writeAgentFiles } from "./steps/agents.ts";
import { fixRootScripts, initGit } from "./steps/finalize.ts";
import { setupLint } from "./steps/lint.ts";
import { generateMigrations, setupLocalDev } from "./steps/localdev.ts";
import { scaffold } from "./steps/scaffold.ts";
import { applyTheme } from "./steps/theme.ts";
import { buildStarterUi } from "./steps/ui.ts";
import { CURATED_THEMES, describePreset, presetUrl, resolvePresetCode } from "./theme.ts";

const VERSION = "0.1.0";

interface Flags {
  frontend?: string;
  auth?: string;
  packageManager?: string;
  theme?: string;
  pointer?: boolean;
  rtl?: boolean;
  antiSlop?: boolean;
  shadcnLint?: boolean;
  agentTesting?: boolean;
  git?: boolean;
  yes?: boolean;
}

const TOGGLES = [
  { key: "pointer", label: "Pointer cursor on buttons" },
  { key: "rtl", label: "RTL support", hint: "logical properties via shadcn migrate rtl" },
  { key: "antiSlop", label: "anti-slop lint rules", hint: "dmmulroy/anti-slop" },
  { key: "shadcnLint", label: "shadcn lint rules", hint: "@shadcn/lint" },
  { key: "agentTesting", label: "Agent testing skill", hint: "AGENTS.md, test skill, smoke script" },
  { key: "git", label: "Initialize git" },
] as const;

type ToggleKey = (typeof TOGGLES)[number]["key"];

const program = new Command()
  .name("create-rat-stack-plus")
  .description("Scaffold a full-stack app on Cloudflare: Alchemy, D1, Turborepo, Oxlint, and a themed shadcn/ui package.")
  .version(VERSION)
  .argument("[directory]", "where to create the project")
  .addOption(new Option("--frontend <frontend>", "web framework").choices(FRONTENDS.map((f) => f.value)))
  .addOption(new Option("--auth <auth>", "auth provider").choices(AUTH_PROVIDERS.map((a) => a.value)))
  .addOption(
    new Option("--pm, --package-manager <pm>", "package manager").choices(PACKAGE_MANAGERS.map((m) => m.value)),
  )
  .option("--theme <theme>", `"random", a curated theme (${Object.keys(CURATED_THEMES).join(", ")}), a preset code, or a shadcn create URL`)
  .option("--pointer", "pointer cursor on buttons")
  .option("--no-pointer", "skip: pointer cursor on buttons")
  .option("--rtl", "right-to-left support")
  .option("--no-rtl", "skip: right-to-left support")
  .option("--anti-slop", "anti-slop Oxlint rules")
  .option("--no-anti-slop", "skip: anti-slop Oxlint rules")
  .option("--shadcn-lint", "@shadcn/lint Oxlint rules")
  .option("--no-shadcn-lint", "skip: @shadcn/lint Oxlint rules")
  .option("--agent-testing", "AGENTS.md, agent test skill, and smoke script")
  .option("--no-agent-testing", "skip: AGENTS.md, agent test skill, and smoke script")
  .option("--git", "initialize a git repository")
  .option("--no-git", "skip: initialize a git repository")
  .option("-y, --yes", "accept defaults for anything not passed as a flag")
  .action(main);

function exitIfCancelled<T>(value: T | symbol): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  // SAFETY: Clack only resolves to a symbol on cancel, handled above; answers here are strings or lists.
  return value as Exclude<T, symbol>;
}

function detectPackageManager(): PackageManager {
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm")) return "pnpm";
  if (agent.startsWith("npm")) return "npm";
  return "bun";
}

function directoryProblem(projectDir: string, projectName: string) {
  const invalid = validateProjectName(projectName);
  if (invalid) return invalid;
  if (existsSync(projectDir) && !statSync(projectDir).isDirectory()) {
    return `${projectDir} exists and is not a directory.`;
  }
  if (existsSync(projectDir) && readdirSync(projectDir).length > 0) {
    return `${projectDir} already exists and is not empty.`;
  }
  return undefined;
}

async function main(directory: string | undefined, flags: Flags) {
  const interactive = !flags.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  p.intro(pc.bgMagenta(pc.black(" rat stack plus ")));

  let input = directory;
  if (!input) {
    input = interactive
      ? exitIfCancelled(
          await p.text({
            message: "Project directory",
            placeholder: "my-app",
            defaultValue: "my-app",
            validate: (value) => {
              const { projectDir, projectName } = resolveProject(value || "my-app", process.cwd());
              return directoryProblem(projectDir, projectName);
            },
          }),
        )
      : "my-app";
  }
  const { projectDir, projectName } = resolveProject(input || "my-app", process.cwd());
  const problem = directoryProblem(projectDir, projectName);
  if (problem) fail(problem);

  const frontend: Frontend =
    flags.frontend && isFrontend(flags.frontend)
      ? flags.frontend
      : interactive
        ? exitIfCancelled(
            await p.select<Frontend>({
              message: "Web frontend",
              options: FRONTENDS.map((option) => ({ ...option })),
              initialValue: DEFAULT_CHOICES.frontend,
            }),
          )
        : DEFAULT_CHOICES.frontend;

  const auth: Auth =
    flags.auth && isAuth(flags.auth)
      ? flags.auth
      : interactive
        ? exitIfCancelled(
            await p.select<Auth>({
              message: "Auth",
              options: AUTH_PROVIDERS.map((option) => ({ ...option })),
              initialValue: DEFAULT_CHOICES.auth,
            }),
          )
        : DEFAULT_CHOICES.auth;

  const packageManager: PackageManager =
    flags.packageManager && isPackageManager(flags.packageManager)
      ? flags.packageManager
      : interactive
        ? exitIfCancelled(
            await p.select<PackageManager>({
              message: "Package manager",
              options: PACKAGE_MANAGERS.map((option) => ({ ...option })),
              initialValue: detectPackageManager(),
            }),
          )
        : detectPackageManager();

  const presetCode = await chooseTheme(flags.theme, interactive);
  const toggles = await chooseToggles(flags, interactive);

  const config: StackConfig = { projectName, projectDir, frontend, auth, packageManager, presetCode, ...toggles };
  await build(config);
}

async function chooseTheme(flag: string | undefined, interactive: boolean) {
  if (flag) {
    try {
      return resolvePresetCode(flag);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (!interactive) return resolvePresetCode("random");

  const choice = exitIfCancelled(
    await p.select<string>({
      message: "shadcn theme",
      options: [
        { value: "random", label: "Surprise me", hint: "random preset" },
        ...Object.keys(CURATED_THEMES).map((name) => ({
          value: name,
          label: name,
          hint: describePreset(resolvePresetCode(name)),
        })),
        { value: "custom", label: "Paste a preset", hint: "code or ui.shadcn.com/create URL" },
      ],
      initialValue: "random",
    }),
  );
  if (choice !== "custom") return resolvePresetCode(choice);

  const custom = exitIfCancelled(
    await p.text({
      message: "Preset code or URL",
      placeholder: "https://ui.shadcn.com/create?preset=...",
      validate: (value) => {
        try {
          resolvePresetCode(value ?? "");
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    }),
  );
  return resolvePresetCode(custom);
}

async function chooseToggles(flags: Flags, interactive: boolean): Promise<Record<ToggleKey, boolean>> {
  const values = Object.fromEntries(
    TOGGLES.map(({ key }) => [key, flags[key] ?? DEFAULT_CHOICES[key]]),
  ) as Record<ToggleKey, boolean>;
  const unset = TOGGLES.filter(({ key }) => flags[key] === undefined);
  if (!interactive || unset.length === 0) return values;

  const selected = exitIfCancelled(
    await p.multiselect<ToggleKey>({
      message: "Extras",
      options: unset.map(({ key, label, ...rest }) => ({
        value: key,
        label,
        ...("hint" in rest ? { hint: rest.hint } : {}),
      })),
      initialValues: unset.filter(({ key }) => values[key]).map(({ key }) => key),
      required: false,
    }),
  );
  for (const { key } of unset) values[key] = selected.includes(key);
  return values;
}

async function step<T>(label: string, done: string, task: () => Promise<T>): Promise<T> {
  const spin = p.spinner();
  spin.start(label);
  try {
    const result = await task();
    spin.stop(done);
    return result;
  } catch (error) {
    spin.error(`${label} failed`);
    if (error instanceof CommandError) {
      p.log.error(`${error.command}\n\n${tail(error.output)}`);
    } else {
      p.log.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

async function build(config: StackConfig) {
  const frontendLabel = FRONTENDS.find((f) => f.value === config.frontend)?.label;
  const authLabel = AUTH_PROVIDERS.find((a) => a.value === config.auth)?.label;
  p.log.info(
    [
      `${pc.bold(config.projectName)}  ${pc.dim(config.projectDir)}`,
      `${frontendLabel} + Hono + oRPC, Drizzle on D1, ${authLabel}, ${config.packageManager}`,
      `Theme ${config.presetCode} (${describePreset(config.presetCode)})`,
    ].join("\n"),
  );

  await step("Scaffolding and installing dependencies", "Project scaffolded", () => scaffold(config));
  await step("Applying the shadcn preset", "Theme applied", () => applyTheme(config));
  await step("Building the starter UI", "Starter UI ready", () => buildStarterUi(config));
  const ports = parseDevPorts(readFileSync(path.join(config.projectDir, "packages/infra/alchemy.run.ts"), "utf8"));
  // Local dev and agent files come before lint so their scripts are linted and baselined with everything else.
  await step("Setting up local dev", "Local dev ready", async () => {
    await fixRootScripts(config.projectDir);
    await generateMigrations(config);
    await setupLocalDev(config, ports);
  });
  await step("Writing agent files", "Agent files written", () => writeAgentFiles(config));
  const lint = await step("Setting up Oxlint", "Oxlint configured", () => setupLint(config));
  const git = await step("Initializing git", "Git ready", () => initGit(config));

  if (!lint.lintPasses) {
    p.log.warn(`Oxlint still reports errors. Run the lint script to see them.\n${pc.dim(tail(lint.output, 15))}`);
  } else if (lint.baselinedFiles > 0) {
    p.log.info(
      `Lint passes. ${lint.baselinedFiles} template file${lint.baselinedFiles === 1 ? " keeps its" : "s keep their"} existing issues as warnings; see the overrides at the end of .oxlintrc.json.`,
    );
  }
  if (git === "initialized") {
    p.log.info("Git repository created without a commit because no git user.name/user.email is set.");
  }

  const x = { bun: "bunx", pnpm: "pnpm dlx", npm: "npx" }[config.packageManager];
  p.note(
    [
      `cd ${cdTarget(config.projectDir)}`,
      `${runCommand(config.packageManager, "dev")}   ${pc.dim(`# server :${ports.server} and web :${ports.web}, local D1, no account needed`)}`,
      "",
      pc.dim("To deploy, add Cloudflare to your Alchemy profile once, then deploy:"),
      `(cd packages/infra && ${x} alchemy profile edit --profile default --add Cloudflare)`,
      runCommand(config.packageManager, "deploy"),
      "",
      pc.dim(`Theme: ${presetUrl(config.presetCode)}`),
    ].join("\n"),
    "Next steps",
  );
  p.outro("Done.");
}

/** Shortest way to reach the project from where the CLI ran. */
function cdTarget(projectDir: string) {
  const relative = path.relative(process.cwd(), projectDir);
  return relative.startsWith("..") && relative.split(path.sep).filter((part) => part === "..").length > 1
    ? projectDir
    : relative;
}

function fail(message: string): never {
  p.cancel(message);
  process.exit(1);
}

await program.parseAsync();
