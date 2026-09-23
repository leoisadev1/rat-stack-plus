import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FRONTENDS, runCommand, type StackConfig } from "../stack.ts";
import { describePreset, presetUrl } from "../theme.ts";

export interface DevPorts {
  server: number;
  web: number;
}

/** Reads the dev ports Alchemy binds from packages/infra/alchemy.run.ts (server first, then web). */
export function parseDevPorts(alchemyRun: string): DevPorts {
  const ports = [...alchemyRun.matchAll(/port:\s*(\d+)/g)].map((match) => Number(match[1]));
  return { server: ports[0] ?? 3000, web: ports[1] ?? 3001 };
}

export async function writeAgentFiles(config: StackConfig) {
  const root = config.projectDir;
  const alchemyRun = await readFile(path.join(root, "packages/infra/alchemy.run.ts"), "utf8");
  const ports = parseDevPorts(alchemyRun);

  await writeFile(path.join(root, "AGENTS.md"), agentsMd(config, ports));
  if (!existsSync(path.join(root, "CLAUDE.md"))) {
    await writeFile(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
  }

  if (!config.agentTesting) return;

  const skillName = `test-${config.projectName}`;
  const skillDir = path.join(root, ".agents/skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), testingSkill(config, ports, skillName));

  // Claude Code reads .claude/skills; point it at the same skill instead of copying it.
  const claudeSkills = path.join(root, ".claude/skills");
  await mkdir(claudeSkills, { recursive: true });
  const link = path.join(claudeSkills, skillName);
  if (!existsSync(link)) await symlink(path.join("../../.agents/skills", skillName), link, "dir");

  const scriptsDir = path.join(root, "scripts");
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(path.join(scriptsDir, "smoke.mjs"), smokeScript(ports));
  await addScript(root, "smoke", "node scripts/smoke.mjs");
}

async function addScript(root: string, name: string, command: string) {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { scripts?: Record<string, string> };
  pkg.scripts = { ...pkg.scripts, [name]: command };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function frontendLabel(config: StackConfig) {
  return FRONTENDS.find((option) => option.value === config.frontend)?.label ?? config.frontend;
}

function x(config: StackConfig) {
  return { bun: "bunx", pnpm: "pnpm dlx", npm: "npx" }[config.packageManager];
}

function authSection(config: StackConfig) {
  if (config.auth === "better-auth") {
    return "Auth is Better Auth. It is configured in `packages/auth/src/index.ts` and its tables live in `packages/db/src/schema/auth.ts`. Sessions are stored in D1.";
  }
  if (config.auth === "clerk") {
    return "Auth is Clerk. Put the publishable and secret keys in the app and server `.env` files before running dev. Never commit them.";
  }
  return "There is no auth. Add Better Auth or Clerk later with `npx create-better-t-stack add`.";
}

function lintSection(config: StackConfig) {
  const lines = [
    `Oxlint runs with \`${runCommand(config.packageManager, "lint")}\`. \`${runCommand(config.packageManager, "lint:fix")}\` applies autofixes and formats with oxfmt.`,
  ];
  if (config.antiSlop) {
    lines.push(
      "anti-slop is vendored in `tools/oxlint/anti-slop`. The project owns these rules; edit them there. A type assertion needs a `// SAFETY:` comment that says why it holds.",
    );
  }
  if (config.shadcnLint) {
    lines.push(
      "@shadcn/lint keeps app code on the design system: use component variants and theme tokens, never raw palette colors, arbitrary values, or inline styles. To restyle a component, change it in `packages/ui/src/components`.",
    );
  }
  lines.push(
    "Overrides at the end of `.oxlintrc.json` that set rules to `warn` for single files are the baseline from scaffolding. When you touch one of those files, fix its warnings and delete its override.",
  );
  return lines.join("\n\n");
}

export function agentsMd(config: StackConfig, ports: DevPorts) {
  const pm = config.packageManager;
  return `# ${config.projectName}

A Rat Stack Plus app: ${frontendLabel(config)} on the web, Hono with oRPC on the server, Drizzle on Cloudflare D1, deployed with Alchemy to Cloudflare Workers.

## Layout

- \`apps/web\`: ${frontendLabel(config)} frontend
- \`apps/server\`: Hono worker serving oRPC at \`/rpc\` and OpenAPI docs at \`/api-reference\`
- \`packages/api\`: oRPC routers shared by server and web
- \`packages/auth\`: auth setup
- \`packages/db\`: Drizzle schema and migrations for D1
- \`packages/ui\`: shared shadcn/ui components (Base UI) and the theme in \`src/styles/globals.css\`
- \`packages/infra\`: \`alchemy.run.ts\` declares the D1 database and both workers
- \`packages/config\`: shared TypeScript config

## Commands

- \`${runCommand(pm, "dev")}\`: runs the server worker with Wrangler and a local D1 on port ${ports.server}, and the web app on port ${ports.web}. No Cloudflare account needed. It applies migrations from \`packages/db/src/migrations\` to the local D1 first.
- \`${runCommand(pm, "dev:web")}\`: runs only the web app on port ${ports.web}
- \`${runCommand(pm, "dev:cloud")}\`: runs Alchemy dev, which needs a Cloudflare profile (see below)
- \`${runCommand(pm, "check-types")}\`: type checks every package${config.frontend === "tanstack-start" ? " and builds the web app" : ""}
- \`${runCommand(pm, "build")}\`: production builds
- \`${runCommand(pm, "lint")}\`: Oxlint
- \`${runCommand(pm, "db:generate")}\`: generates Drizzle migrations after a schema change
- \`${runCommand(pm, "deploy")}\` / \`${runCommand(pm, "destroy")}\`: deploy or tear down the Cloudflare stack

\`apps/server/wrangler.jsonc\` is for local dev only. Bindings and deploys live in \`packages/infra/alchemy.run.ts\`, so keep the two in sync when you add a binding.

Alchemy needs a Cloudflare account in its profile for \`dev:cloud\`, \`deploy\`, and \`destroy\`. A human runs this once:
\`cd packages/infra && ${x(config)} alchemy profile edit --profile default --add Cloudflare\`.

## UI

The starter pages live in \`apps/web/src/components\`: \`home-page.tsx\` for the landing page${config.auth === "none" ? "" : `, \`${config.auth === "clerk" ? "sign-in-gate.tsx" : "login-page.tsx"}\` for sign-in, and \`dashboard/\` for the sidebar dashboard`}. \`lib/site.ts\` holds the app name and links. Build on these or replace them.

Add components with \`${x(config)} shadcn@latest add <component>\` from \`apps/web\`; they land in \`packages/ui\`. Import them from \`${"@" + config.projectName}/ui/components/<name>\`. Components use Base UI, so compose with the \`render\` prop rather than \`asChild\`.

The theme is shadcn preset \`${config.presetCode}\` (${describePreset(config.presetCode)}). Open it at ${presetUrl(config.presetCode)}, and switch presets with \`${x(config)} shadcn@latest apply --preset <code>\` from \`apps/web\`.${config.rtl ? " Components use logical properties for RTL; set `dir=\"rtl\"` on the root element to flip the layout." : ""}

## Auth

${authSection(config)}

## Lint

${lintSection(config)}

## Before you finish

Run ${config.frontend === "tanstack-start" ? `\`${runCommand(pm, "lint")}\` and \`${runCommand(pm, "check-types")}\`` : `\`${runCommand(pm, "lint")}\`, \`${runCommand(pm, "check-types")}\`, and \`${runCommand(pm, "build")}\``} and fix every error.${config.agentTesting ? ` To prove a change in the running app, use the \`test-${config.projectName}\` skill in \`.agents/skills\`.` : ""}
`;
}

export function testingSkill(config: StackConfig, ports: DevPorts, skillName: string) {
  const pm = config.packageManager;
  return `---
name: ${skillName}
description: Launch, verify, and smoke test the ${config.projectName} app (${frontendLabel(config)} web + Hono worker with a local D1). Use when asked to test, run, reproduce, or verify a change in ${config.projectName}.
---

# Test ${config.projectName}

## Static proof (always available)

Run from the repository root and fix every error before claiming a change works:

1. \`${runCommand(pm, "lint")}\`
2. \`${runCommand(pm, "check-types")}\`${config.frontend === "tanstack-start" ? ". This also runs the web production build, so it catches bundling errors." : ""}${config.frontend === "tanstack-start" ? "" : `
3. \`${runCommand(pm, "build")}\`, which catches bundling errors that type checking misses.`}

## Launch

\`${runCommand(pm, "dev")}\` runs the server worker with Wrangler and a local D1 on http://localhost:${ports.server}, and the web app on http://localhost:${ports.web}. It needs no Cloudflare account. Migrations in \`packages/db/src/migrations\` are applied to the local D1 on every start.

If the server port is taken, the dev script says so and exits. Do not stop a process you did not start. Move the server instead: change \`dev.port\` in \`apps/server/wrangler.jsonc\` and every \`localhost:${ports.server}\` URL in \`apps/server/.env\` and \`apps/web/.env\`.

Run dev in the background and record its PID so you stop only what you started.

## Ready and smoke test

The stack is ready when \`curl -s http://localhost:${ports.server}/\` prints \`OK\`. Then run \`${runCommand(pm, "smoke")}\`, which checks the server health route and that the web app answers 200. Set \`SERVER_URL\` and \`WEB_URL\` to point it elsewhere.

## Drive the app

- API: oRPC procedures are callable over OpenAPI; browse http://localhost:${ports.server}/api-reference for the routes and try them with \`curl\`.
- Web: open http://localhost:${ports.web}. Only drive a browser or other GUI when the human has explicitly asked for it in the current message. Otherwise finish with static proof and HTTP checks, and state which UI proof remains.${config.auth === "better-auth" ? `\n- Auth: sign up at http://localhost:${ports.web}/login with a throwaway email such as \`agent+<timestamp>@example.com\`. Local dev uses a local D1, so accounts never reach production.` : ""}${config.auth === "clerk" ? "\n- Auth: Clerk needs real keys in the `.env` files. Use a Clerk development instance and a test user, never a production instance." : ""}

## Evidence

Report the commands you ran, their result, and the HTTP responses or screenshots that show the change. Keep screenshots and logs out of the repository unless asked.

## Cleanup

Stop the dev process you started by its PID. Leave other processes alone. Local D1 state lives under \`apps/server/.wrangler\`; delete it only to reset test data you created.
`;
}

export function smokeScript(ports: DevPorts) {
  return `// Checks that the local stack answers. Start it first with the dev script.
const serverUrl = process.env.SERVER_URL ?? "http://localhost:${ports.server}";
const webUrl = process.env.WEB_URL ?? "http://localhost:${ports.web}";

async function check(name, url, expectBody) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await response.text();

    const ok = response.ok && (expectBody === undefined || body.trim() === expectBody);
    console.log(\`\${ok ? "pass" : "fail"}  \${name}  \${url}  \${response.status}\`);

    return ok;
  } catch (error) {
    console.log(\`fail  \${name}  \${url}  \${error.cause?.code ?? error.message}\`);

    return false;
  }
}

const results = [await check("server", \`\${serverUrl}/\`, "OK"), await check("web", webUrl)];
process.exit(results.every(Boolean) ? 0 : 1);
`;
}
