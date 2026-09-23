# Vision

Rat Stack Plus is a CLI that creates a full-stack TypeScript app on Cloudflare in one command. The app runs locally with no Cloudflare account, deploys with Alchemy when you're ready, and arrives with a real UI and lint rules that coding agents have to respect.

It's an unofficial project. It's inspired by Joel Hooks' [Rat Stack](https://github.com/joelhooks/rat-stack) ([ratstack.sh](https://ratstack.sh)) and draws heavily on its ideas. Joel doesn't maintain or endorse it, so please send questions and bugs here, not to him.

## What we took from Rat Stack

Rat Stack treats an app and its cloud as one typed program. Alchemy declares the infrastructure in TypeScript next to the code that uses it, and a fence of pinned versions, checks, and hooks raises the floor for anything an agent writes. Its own vision says "public GitHub is a steal-the-ideas surface," and that a project growing out of it should write its own vision. This is ours.

The ideas we kept:

- Infrastructure as code in the same repo and language as the app. `packages/infra/alchemy.run.ts` declares the D1 database and both workers.
- A floor that agents can't talk their way past. Oxlint runs anti-slop and @shadcn/lint on every project, and the baseline overrides only ever shrink.
- Instructions written for agents. Every project gets an `AGENTS.md` and a test skill that tells an agent how to prove a change instead of claiming it.

## Where we differ

Rat Stack is a hand-built stack with Effect and XState at its core, and it says plainly that it is not a thin `npm init`. Rat Stack Plus is closer to that: a generator. It doesn't copy Rat Stack's code, and the generated app doesn't use Effect or XState in app code.

Instead, Rat Stack Plus starts from [Better-T-Stack](https://www.better-t-stack.dev) (Hono, oRPC, Drizzle, Turborepo) and layers on:

- Cloudflare D1 as the database, with the first migration generated and a local Wrangler dev server so `dev` works on a fresh clone.
- A shadcn/ui package themed from a shadcn create preset, plus starter pages: a landing page, a sign-in page, and a sidebar dashboard.
- Oxlint with anti-slop and @shadcn/lint, and per-file baselines so a fresh project passes on day one.

The trade is depth for reach. You get a working app in a minute instead of a stack you study, and you can take on Rat Stack's heavier ideas later if your project needs them.

## Who it's for

People who want to start a Cloudflare app today, often with a coding agent doing much of the work, and want the result to look good and stay tidy without setting up the guardrails themselves.

## What stays true

- `dev` works right after `create`, with no accounts and no manual steps.
- A generated project passes lint and type checks before anyone touches it.
- Choices the CLI makes for you are written down in the generated `AGENTS.md`, so an agent never has to guess.
- Credit goes to the projects we build on: Rat Stack, Better-T-Stack, anti-slop, and shadcn.
