# create-rat-stack-plus

## 0.2.0

### Minor Changes

- de261b2: Add a commit fence, on by default. Generated apps get lefthook hooks that run lint before each commit and type checks before each push, plus Claude Code and Cursor hooks that block `--no-verify` and other ways to skip them. Generated apps also get a `plan` script that previews a deploy with `alchemy plan`.
- de261b2: Add `--port` and `--host`. Generated apps keep their dev address and ports in `dev.config.json`, which the dev scripts, auth and CORS URLs, and smoke test all read, and `DEV_HOST` opens the app to other devices for one run. `--theme` now accepts a path to a theme CSS file, which is merged over shadcn's default preset. Fresh projects lint without warnings, TanStack Start's `check-types` no longer runs a full Vite build, and the CLI prints one line per step instead of spinner frames in a non-interactive shell. `AGENTS.md` now covers every package, local dev, and adding Cloudflare bindings.
