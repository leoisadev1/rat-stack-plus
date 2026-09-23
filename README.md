# Rat Stack Plus

Scaffolds a typed full-stack monorepo that deploys to Cloudflare. You pick a web framework, an auth provider, a package manager, and a shadcn theme. The CLI generates the project, restyles its UI package with the theme, sets up Oxlint with anti-slop and shadcn lint rules, and writes instructions and a test skill for coding agents.

```sh
bunx create-rat-stack-plus my-app
```

`npx create-rat-stack-plus` and `pnpm dlx create-rat-stack-plus` work too. Requires Node 22.12 or later.

Rat Stack Plus is inspired by Joel Hooks' [Rat Stack](https://github.com/joelhooks/rat-stack) and draws heavily on its ideas: infrastructure declared in TypeScript with Alchemy, and a lint and instruction floor that keeps coding agents honest. It's an unofficial project that Joel doesn't maintain or endorse. [VISION.md](VISION.md) explains what it borrows and where it differs.

## What you get

```
my-app/
├── apps/
│   ├── server/     Hono worker serving oRPC and OpenAPI docs
│   └── web/        TanStack Start, Next.js, or React Router
├── packages/
│   ├── api/        oRPC routers shared by server and web
│   ├── auth/       Better Auth or Clerk
│   ├── config/     shared TypeScript config
│   ├── db/         Drizzle schema and migrations for D1
│   ├── infra/      alchemy.run.ts: D1 database and both workers
│   └── ui/         shadcn/ui components on Base UI, plus the theme
├── tools/oxlint/anti-slop/
├── scripts/hooks/  lefthook installer and the agent hook that blocks --no-verify
├── AGENTS.md
├── dev.config.json  local dev address and ports
├── lefthook.yml
├── .agents/skills/test-my-app/SKILL.md
├── turbo.json
└── .oxlintrc.json
```

These parts are fixed: Hono on Cloudflare Workers, oRPC, Drizzle with SQLite on Cloudflare D1, Alchemy for infrastructure, Turborepo, Oxlint with oxfmt, and shadcn/ui on Base UI. [Better-T-Stack](https://www.better-t-stack.dev) generates the base project, and this CLI layers the rest on top.

## Options

Run without flags to answer prompts. Pass `--yes` to take the defaults for anything you didn't set. In a non-interactive shell the CLI behaves as if you passed `--yes`, and prints one line per step instead of animating a spinner.

| Flag | Values | Default |
| --- | --- | --- |
| `--frontend` | `tanstack-start`, `next`, `react-router` | `tanstack-start` |
| `--auth` | `better-auth`, `clerk`, `none` | `better-auth` |
| `--pm` | `bun`, `pnpm`, `npm` | the one that ran the CLI, else `bun` |
| `--theme` | see [Themes](#themes) | `random` |
| `--port` | the server's dev port; the web app uses the next one | `3000` |
| `--host` | the address the dev servers advertise, such as a Tailscale IP | `localhost` |
| `--pointer` / `--no-pointer` | pointer cursor on buttons | on |
| `--rtl` / `--no-rtl` | right-to-left support | off |
| `--anti-slop` / `--no-anti-slop` | anti-slop Oxlint rules | on |
| `--shadcn-lint` / `--no-shadcn-lint` | @shadcn/lint Oxlint rules | on |
| `--agent-testing` / `--no-agent-testing` | test skill and smoke script | on |
| `--fence` / `--no-fence` | lefthook git hooks, and agent hooks that block skipping them | on |
| `--git` / `--no-git` | `git init` | on |

```sh
bunx create-rat-stack-plus my-app --frontend next --auth clerk --pm pnpm --theme violet-terminal --rtl
```

## Themes

`--theme` takes any of these:

- `random` draws a preset from the shadcn create options: style, base color, accent, fonts, radius, and menu accent.
- A curated name: `emerald-mist`, `violet-terminal`, `amber-editorial`, `sky-grotesk`, or `rose-taupe`.
- A preset code from [ui.shadcn.com/create](https://ui.shadcn.com/create), such as `b7Br7G7Ci`.
- The full create URL, such as `https://ui.shadcn.com/create?preset=b7Br7G7Ci`.
- A path to a CSS file ending in `.css`, such as `./theme.css`. See [Theme CSS files](#theme-css-files).

The CLI runs `shadcn apply` with the preset, which rewrites the components in `packages/ui` and adds the fonts. Icons stay on lucide whatever the preset says, because the generated app imports `lucide-react` directly. The summary at the end prints the preset URL so you can open the theme in shadcn create and tweak it.

To change the theme later, run `shadcn apply --preset <code>` from `apps/web`.

### Theme CSS files

A theme exported from [tweakcn](https://tweakcn.com) or the [shadcn themes page](https://ui.shadcn.com/themes) is a CSS file with variables in `:root`, `.dark`, and `@theme inline`. Pass its path to use it:

```sh
bunx create-rat-stack-plus my-app --theme ./theme.css
```

The CLI applies shadcn's default preset for the components and icons, then merges the file into `packages/ui/src/styles/globals.css`. Each variable in the file replaces the preset's value or is added next to them. `@import` rules, such as a Google Fonts URL, go at the top of the file, because CSS doesn't allow them after Tailwind's rules. Any other rules are appended at the end. The CLI rejects a file that sets no variables.

The file sets font names but can't load the fonts, so include an `@import` for them or install them yourself. Running `shadcn apply` afterwards replaces the merged variables with the preset's.

`--pointer` adds a base-layer rule that gives enabled buttons `cursor: pointer`. `--rtl` runs `shadcn migrate rtl`, which converts the components to logical properties such as `ms-2` and `ps-4`. Set `dir="rtl"` on the root element to flip the layout.

## Lint

Oxlint runs with the generated project's `lint` script, and `lint:fix` applies autofixes and formats with oxfmt.

anti-slop comes from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). It isn't published to npm, so the CLI copies it into `tools/oxlint/anti-slop` and the project owns it from then on. It pins `@oxlint/plugins` to the exact Oxlint version, which the rules require. The Effect rules are enabled because `packages/infra` depends on Effect.

[@shadcn/lint](https://github.com/shadcn-ui/lint) keeps app code on the design system. It rejects raw palette colors, arbitrary values, inline styles, and classes that restyle a component from outside. Those rules are off inside `packages/ui/src/components`, where the components themselves are defined.

The generated templates break some of these rules. The CLI fixes what it safely can, runs the autofixes, and turns whatever remains into per-file overrides at the end of `.oxlintrc.json` that downgrade those rules to warnings. A fresh project passes lint, new files get the full rules, and you tighten a baselined file by fixing it and deleting its override.

## Agent files

`AGENTS.md` describes the layout, commands, theme, auth, and lint rules. `CLAUDE.md` imports it. With agent testing on, the CLI also writes:

- `.agents/skills/test-<name>/SKILL.md`, with a symlink at `.claude/skills/test-<name>`. It tells an agent how to prove a change: lint and type check first, then launch the stack, wait for readiness, smoke test, and clean up.
- `scripts/smoke.mjs`, run with the `smoke` script. It reads the address and ports from `dev.config.json`, then checks that the server answers `OK` and the web app answers.

## Commit fence

Rat Stack keeps agents honest with a fence: git hooks that run checks, and agent hooks that refuse to skip them. Rat Stack Plus ports the idea. With the fence on, the CLI writes:

- `lefthook.yml`, which runs `lint` before every commit and `check-types` before every push. The `prepare` script installs the hooks after each dependency install, and does nothing outside a git repository.
- `scripts/hooks/block-hook-bypass.mjs`, registered as a Claude Code `PreToolUse` hook in `.claude/settings.json` and a Cursor `beforeShellExecution` hook in `.cursor/hooks.json`. It denies git commands that use `--no-verify`, `commit -n`, `LEFTHOOK=0`, or `core.hooksPath`.
- A Fence section in `AGENTS.md` that tells agents to fix hook failures instead of working around them, and that lint baselines only shrink.

## Running the project

One command runs everything locally, with no Cloudflare account:

```sh
cd my-app
bun run dev   # server on http://localhost:3000, web on http://localhost:3001
```

Turborepo starts the server and the web app side by side. The server runs under Wrangler with a local D1 database, and the migrations the CLI generated are applied to it on every start. `bun run dev:web` runs only the web app.

Local D1, KV, R2, Durable Objects, Queues, and Workflows all run in Wrangler's simulator. Analytics Engine and Pipelines have no local simulator: writes succeed and go nowhere. `AGENTS.md` explains how to add a binding.

The address and ports live in `dev.config.json` at the root:

```json
{ "host": "localhost", "serverPort": 3000, "webPort": 3001 }
```

Both dev scripts, the auth and CORS URLs, and the smoke test read it, so moving a port means editing one file. If a port is taken, the dev script says so. `--port` and `--host` set these values when the project is generated.

To open the app from another device, set the host to an address that device can reach, such as a Tailscale IP, or pass it for one run:

```sh
DEV_HOST=100.64.0.1 bun run dev
```

An IP address binds only that interface. A hostname binds every interface, because the dev servers can't bind a name.

Deploying goes through Alchemy, which needs a Cloudflare account in its profile. Set that up once, then deploy:

```sh
(cd packages/infra && bunx alchemy profile edit --profile default --add Cloudflare)
bun run deploy
```

`bun run plan` shows what a deploy would change without changing anything. `bun run dev:cloud` runs Alchemy's own dev mode, which also needs the profile.

With Clerk, put your keys in `apps/web/.env` and `apps/server/.env` first. `deploy` and `destroy` deploy or tear down the Cloudflare resources.

## Fixes to the generated project

Better-T-Stack 3.44.1 output has a few problems, which the CLI corrects:

- `dev:server` filters on a package that doesn't exist. The CLI removes it; `dev` runs the server.
- `alchemy dev` refuses to start without a Cloudflare profile, so `dev` fails for anyone who hasn't set one up. The CLI adds `apps/server/wrangler.jsonc` and `scripts/dev-server.mjs` so `dev` runs the server with Wrangler and a local D1, and moves Alchemy dev to `dev:cloud`.
- The migrations folder starts empty, so a fresh database has no tables. The CLI generates the first migration.
- `dev:web` calls a turbo task that `turbo.json` never declares. The CLI adds it.
- `shadcn apply` writes an `apps/web/src/lib/utils.ts` that imports a missing `cn` package. The CLI deletes it; the app already imports `cn` from the UI package.
- There's no way to preview a deploy. The CLI adds a `plan` script that runs `alchemy plan`.
- `.alchemy`, where Alchemy keeps local state, is added to `.gitignore`.
- TanStack Start's `check-types` runs a full `vite build` to produce the route tree. The CLI swaps it for `tsr generate`, and declares each package's `check-types` outputs so Turborepo stops warning about missing ones.
- The generated `cn` package is too old for `@shadcn/lint`, which warns and falls back to its own copy. With shadcn lint on, the CLI moves it to 0.3.2 or later.
- The server's env module has a triple-slash path reference that Oxlint flags. The CLI removes it; `tsconfig.json` already includes the file.

Git makes the initial commit only when `user.name` and `user.email` are set. Otherwise the repository is created without a commit.

## Develop

```sh
bun install
bun run check          # types, lint, unit tests
bun run build          # dist/cli.mjs
bun run dev my-app     # run from source
bun run check-package  # pack, install, and run the published CLI
```

Releases go through [Changesets](https://changesets.dev). Add one with `bun run changeset` for any change users will notice. [.changeset/README.md](.changeset/README.md) explains the version pull request and how npm publishing works.
