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
├── AGENTS.md
├── .agents/skills/test-my-app/SKILL.md
├── turbo.json
└── .oxlintrc.json
```

These parts are fixed: Hono on Cloudflare Workers, oRPC, Drizzle with SQLite on Cloudflare D1, Alchemy for infrastructure, Turborepo, Oxlint with oxfmt, and shadcn/ui on Base UI. [Better-T-Stack](https://www.better-t-stack.dev) generates the base project, and this CLI layers the rest on top.

## Options

Run without flags to answer prompts. Pass `--yes` to take the defaults for anything you didn't set. In a non-interactive shell the CLI behaves as if you passed `--yes`.

| Flag | Values | Default |
| --- | --- | --- |
| `--frontend` | `tanstack-start`, `next`, `react-router` | `tanstack-start` |
| `--auth` | `better-auth`, `clerk`, `none` | `better-auth` |
| `--pm` | `bun`, `pnpm`, `npm` | the one that ran the CLI, else `bun` |
| `--theme` | see [Themes](#themes) | `random` |
| `--pointer` / `--no-pointer` | pointer cursor on buttons | on |
| `--rtl` / `--no-rtl` | right-to-left support | off |
| `--anti-slop` / `--no-anti-slop` | anti-slop Oxlint rules | on |
| `--shadcn-lint` / `--no-shadcn-lint` | @shadcn/lint Oxlint rules | on |
| `--agent-testing` / `--no-agent-testing` | test skill and smoke script | on |
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

The CLI runs `shadcn apply` with the preset, which rewrites the components in `packages/ui` and adds the fonts. Icons stay on lucide whatever the preset says, because the generated app imports `lucide-react` directly. The summary at the end prints the preset URL so you can open the theme in shadcn create and tweak it.

To change the theme later, run `shadcn apply --preset <code>` from `apps/web`.

`--pointer` adds a base-layer rule that gives enabled buttons `cursor: pointer`. `--rtl` runs `shadcn migrate rtl`, which converts the components to logical properties such as `ms-2` and `ps-4`. Set `dir="rtl"` on the root element to flip the layout.

## Lint

Oxlint runs with the generated project's `lint` script, and `lint:fix` applies autofixes and formats with oxfmt.

anti-slop comes from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). It isn't published to npm, so the CLI copies it into `tools/oxlint/anti-slop` and the project owns it from then on. It pins `@oxlint/plugins` to the exact Oxlint version, which the rules require. The Effect rules are enabled because `packages/infra` depends on Effect.

[@shadcn/lint](https://github.com/shadcn-ui/lint) keeps app code on the design system. It rejects raw palette colors, arbitrary values, inline styles, and classes that restyle a component from outside. Those rules are off inside `packages/ui/src/components`, where the components themselves are defined.

The generated templates break some of these rules. The CLI fixes what it safely can, runs the autofixes, and turns whatever remains into per-file overrides at the end of `.oxlintrc.json` that downgrade those rules to warnings. A fresh project passes lint, new files get the full rules, and you tighten a baselined file by fixing it and deleting its override.

## Agent files

`AGENTS.md` describes the layout, commands, theme, auth, and lint rules. `CLAUDE.md` imports it. With agent testing on, the CLI also writes:

- `.agents/skills/test-<name>/SKILL.md`, with a symlink at `.claude/skills/test-<name>`. It tells an agent how to prove a change: lint and type check first, then launch the stack, wait for readiness, smoke test, and clean up.
- `scripts/smoke.mjs`, run with the `smoke` script. It checks that the server answers `OK` on port 3000 and the web app answers on port 3001.

## Running the project

One command runs everything locally, with no Cloudflare account:

```sh
cd my-app
bun run dev   # server on http://localhost:3000, web on http://localhost:3001
```

Turborepo starts the server and the web app side by side. The server runs under Wrangler with a local D1 database, and the migrations the CLI generated are applied to it on every start. If port 3000 is taken, the dev script says so; change `dev.port` in `apps/server/wrangler.jsonc` and the `localhost:3000` URLs in `apps/server/.env` and `apps/web/.env`. `bun run dev:web` runs only the web app.

Deploying goes through Alchemy, which needs a Cloudflare account in its profile. Set that up once, then deploy:

```sh
(cd packages/infra && bunx alchemy profile edit --profile default --add Cloudflare)
bun run deploy
```

`bun run dev:cloud` runs Alchemy's own dev mode, which also needs the profile.

With Clerk, put your keys in `apps/web/.env` and `apps/server/.env` first. `deploy` and `destroy` deploy or tear down the Cloudflare resources.

## Fixes to the generated project

Better-T-Stack 3.44.1 output has a few problems, which the CLI corrects:

- `dev:server` filters on a package that doesn't exist. The CLI removes it; `dev` runs the server.
- `alchemy dev` refuses to start without a Cloudflare profile, so `dev` fails for anyone who hasn't set one up. The CLI adds `apps/server/wrangler.jsonc` and `scripts/dev-server.mjs` so `dev` runs the server with Wrangler and a local D1, and moves Alchemy dev to `dev:cloud`.
- The migrations folder starts empty, so a fresh database has no tables. The CLI generates the first migration.
- `dev:web` calls a turbo task that `turbo.json` never declares. The CLI adds it.
- `shadcn apply` writes an `apps/web/src/lib/utils.ts` that imports a missing `cn` package. The CLI deletes it; the app already imports `cn` from the UI package.
- `.alchemy`, where Alchemy keeps local state, is added to `.gitignore`.

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
