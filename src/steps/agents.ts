import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FRONTENDS, devPorts, runCommand, type DevPorts, type StackConfig } from "../stack.ts";
import { describePreset, presetUrl } from "../theme.ts";

export async function writeAgentFiles(config: StackConfig) {
  const root = config.projectDir;
  const ports = devPorts(config);

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
  await writeFile(path.join(scriptsDir, "smoke.mjs"), smokeScript());
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

function themeDocs(config: StackConfig) {
  const apply = `\`${x(config)} shadcn@latest apply --preset <code>\` from \`apps/web\``;
  if (config.themeCss) {
    return `The theme lives in \`packages/ui/src/styles/globals.css\`: shadcn's default preset with the variables from \`${path.basename(config.themeCss)}\` merged over it. Change colors, radius, and fonts there by editing the variables in \`:root\`, \`.dark\`, and \`@theme inline\`. A font the stylesheet names must also be loaded, through an \`@import\` in the same file or a \`@fontsource\` package. Running ${apply} replaces the custom variables with a preset.`;
  }
  return `The theme is shadcn preset \`${config.presetCode}\` (${describePreset(config.presetCode)}). Open it at ${presetUrl(config.presetCode)}, and switch presets with ${apply}.`;
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

function fenceSection(config: StackConfig) {
  const pm = config.packageManager;
  return [
    `lefthook runs \`${runCommand(pm, "lint")}\` before every commit and \`${runCommand(pm, "check-types")}\` before every push. The hooks install with the dependencies; \`lefthook.yml\` defines them.`,
    "Never skip them: no `--no-verify`, `-n`, `LEFTHOOK=0`, or `core.hooksPath` changes. Claude Code and Cursor hooks in `.claude/settings.json` and `.cursor/hooks.json` block those commands. When a hook fails, fix what it reports. If the hook itself is wrong, ask a human before changing it.",
    "Lint baselines only shrink. Don't add a rule override or an ignore to get a commit through.",
  ].join("\n\n");
}

export function agentsMd(config: StackConfig, ports: DevPorts) {
  const pm = config.packageManager;
  return `# ${config.projectName}

A Rat Stack Plus app: ${frontendLabel(config)} on the web, Hono with oRPC on the server, Drizzle on Cloudflare D1, deployed with Alchemy to Cloudflare Workers.

## Layout

- \`apps/web\`: ${frontendLabel(config)} frontend. It calls the server through the oRPC client in \`src/utils/orpc.ts\`${config.auth === "better-auth" ? " and signs in through `src/lib/auth-client.ts`" : ""}.
- \`apps/server\`: Hono worker serving oRPC at \`/rpc\` and OpenAPI docs at \`/api-reference\`. \`src/index.ts\` wires the routes, \`src/context.ts\` builds the per-request context, and \`src/services.ts\` creates the database${config.auth === "better-auth" ? " and auth" : ""} clients from the worker env.
- \`packages/api\`: oRPC routers shared by server and web. Add procedures in \`src/routers\` and register them in \`src/routers/index.ts\`. \`publicProcedure\` is open${config.auth === "none" ? "" : "; `protectedProcedure` requires a session"}.
- \`packages/auth\`: ${config.auth === "better-auth" ? "Better Auth setup, created per request from the worker env" : config.auth === "clerk" ? "Clerk helpers for the server" : "empty until you add an auth provider"}.
- \`packages/db\`: Drizzle on D1. The schema is in \`src/schema\`, relations in \`src/relations.ts\`, and migrations in \`src/migrations\`. \`createDb(env)\` takes the worker's \`DB\` binding.
- \`packages/infra\`: \`alchemy.run.ts\` declares the D1 database, both workers, and their env. The server's binding types (\`ServerEnv\`) are inferred from it.
- \`packages/ui\`: shared shadcn/ui components (Base UI), hooks, and the theme in \`src/styles/globals.css\`.
- \`packages/config\`: shared TypeScript config.

## Commands

- \`${runCommand(pm, "dev")}\`: runs the server worker with Wrangler and a local D1 on port ${ports.server}, and the web app on port ${ports.web}. No Cloudflare account needed. It applies migrations from \`packages/db/src/migrations\` to the local D1 first.
- \`${runCommand(pm, "dev:web")}\`: runs only the web app on port ${ports.web}
- \`${runCommand(pm, "dev:cloud")}\`: runs Alchemy dev, which needs a Cloudflare profile (see below)
- \`${runCommand(pm, "check-types")}\`: type checks every package
- \`${runCommand(pm, "build")}\`: production builds
- \`${runCommand(pm, "lint")}\`: Oxlint
- \`${runCommand(pm, "db:generate")}\`: generates Drizzle migrations after a schema change
- \`${runCommand(pm, "plan")}\`: shows what \`deploy\` would change in Cloudflare without changing it
- \`${runCommand(pm, "deploy")}\` / \`${runCommand(pm, "destroy")}\`: deploy or tear down the Cloudflare stack

Alchemy needs a Cloudflare account in its profile for \`dev:cloud\`, \`plan\`, \`deploy\`, and \`destroy\`. A human runs this once:
\`cd packages/infra && ${x(config)} alchemy profile edit --profile default --add Cloudflare\`.

## Local dev

\`dev.config.json\` sets the host and ports for \`dev\`. \`scripts/dev-server.mjs\` and \`scripts/dev-web.mjs\` read it and pass the ports and URLs to Wrangler and the web dev server, overriding the URLs in the \`.env\` files. To move the stack, change \`serverPort\` and \`webPort\` there, and the \`dev.port\` values in \`packages/infra/alchemy.run.ts\` if you use \`dev:cloud\`.

To open the app from another device, such as a phone on the same Tailscale network, set the host to an address that device can reach: \`DEV_HOST=<tailscale-ip> ${runCommand(pm, "dev")}\`, or set \`host\` in \`dev.config.json\`. An IP address binds both servers to that address only, a hostname binds them to every interface, and either way the web app calls the server at that host.

## Bindings

A binding is a Cloudflare resource the worker reaches through its env, like \`DB\`. To add one:

1. Declare the resource in \`packages/infra/alchemy.run.ts\` and add it to the server worker's \`env\`. \`ServerEnv\` picks up its type, so \`ENV.<NAME>\` type checks in the server.
2. Mirror it in \`apps/server/wrangler.jsonc\` so \`dev\` can simulate it. That file is for local dev only; deploys ignore it.

Local dev runs on Wrangler's simulator, which covers some bindings and not others:

- D1, KV, R2, Durable Objects, Queues, and Workflows run locally with state under \`apps/server/.wrangler\`.
- Analytics Engine and Pipelines are stubs. \`writeDataPoint\` and \`send\` succeed and drop the data, so nothing can be read back. Test them with \`${runCommand(pm, "dev:cloud")}\` or a deploy.
- Secrets come from \`apps/server/.env\` in local dev and from the Alchemy config when deployed.

## UI

The starter pages live in \`apps/web/src/components\`: \`home-page.tsx\` for the landing page${config.auth === "none" ? "" : `, \`${config.auth === "clerk" ? "sign-in-gate.tsx" : "login-page.tsx"}\` for sign-in, and \`dashboard/\` for the sidebar dashboard`}. \`lib/site.ts\` holds the app name and links. Build on these or replace them.

Add components with \`${x(config)} shadcn@latest add <component>\` from \`apps/web\`; they land in \`packages/ui\`. Import them from \`${"@" + config.projectName}/ui/components/<name>\`. Components use Base UI, so compose with the \`render\` prop rather than \`asChild\`.

${themeDocs(config)}${config.rtl ? " Components use logical properties for RTL; set `dir=\"rtl\"` on the root element to flip the layout." : ""}

## Auth

${authSection(config)}

## Lint

${lintSection(config)}

${config.fence ? `## Fence

${fenceSection(config)}

` : ""}## Before you finish

Run \`${runCommand(pm, "lint")}\`, \`${runCommand(pm, "check-types")}\`, and \`${runCommand(pm, "build")}\` and fix every error.${config.agentTesting ? ` To prove a change in the running app, use the \`test-${config.projectName}\` skill in \`.agents/skills\`.` : ""}
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
2. \`${runCommand(pm, "check-types")}\`
3. \`${runCommand(pm, "build")}\`, which catches bundling errors that type checking misses.

## Launch

\`${runCommand(pm, "dev")}\` runs the server worker with Wrangler and a local D1 on http://${config.host}:${ports.server}, and the web app on http://${config.host}:${ports.web}. It needs no Cloudflare account. Migrations in \`packages/db/src/migrations\` are applied to the local D1 on every start.

These URLs come from \`dev.config.json\`; if it or \`DEV_HOST\` changes the host or ports, use those instead.

If the server port is taken, the dev script says so and exits. Do not stop a process you did not start. Move the stack instead: change \`serverPort\` and \`webPort\` in \`dev.config.json\`, and use the new ports below.

To check the app from another device, run \`DEV_HOST=<address> ${runCommand(pm, "dev")}\` with an address that device can reach, such as a Tailscale IP, and open http://<address>:${ports.web}.

Run dev in the background and record its PID so you stop only what you started.

## Ready and smoke test

The stack is ready when \`curl -s http://${config.host}:${ports.server}/\` prints \`OK\`. Then run \`${runCommand(pm, "smoke")}\`, which checks the server health route and that the web app answers 200. It reads \`dev.config.json\` and \`DEV_HOST\` like \`dev\` does. Set \`SERVER_URL\` and \`WEB_URL\` to point it elsewhere.

## Drive the app

- API: oRPC procedures are callable over OpenAPI; browse http://${config.host}:${ports.server}/api-reference for the routes and try them with \`curl\`.
- Web: open http://${config.host}:${ports.web}. Only drive a browser or other GUI when the human has explicitly asked for it in the current message. Otherwise finish with static proof and HTTP checks, and state which UI proof remains.${config.auth === "better-auth" ? `\n- Auth: sign up at http://${config.host}:${ports.web}/login with a throwaway email such as \`agent+<timestamp>@example.com\`. Local dev uses a local D1, so accounts never reach production.` : ""}${config.auth === "clerk" ? "\n- Auth: Clerk needs real keys in the `.env` files. Use a Clerk development instance and a test user, never a production instance." : ""}

## Evidence

Report the commands you ran, their result, and the HTTP responses or screenshots that show the change. Keep screenshots and logs out of the repository unless asked.

## Cleanup

Stop the dev process you started by its PID. Leave other processes alone. Local D1 state lives under \`apps/server/.wrangler\`; delete it only to reset test data you created.
`;
}

export function smokeScript() {
  return `// Checks that the local stack answers. Start it first with the dev script.
import { serverUrl as devServerUrl, webUrl as devWebUrl } from "./dev-config.mjs";

const serverUrl = process.env.SERVER_URL ?? devServerUrl;

const webUrl = process.env.WEB_URL ?? devWebUrl;

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
