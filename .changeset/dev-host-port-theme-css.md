---
"create-rat-stack-plus": minor
---

Add `--port` and `--host`. Generated apps keep their dev address and ports in `dev.config.json`, which the dev scripts, auth and CORS URLs, and smoke test all read, and `DEV_HOST` opens the app to other devices for one run. `--theme` now accepts a path to a theme CSS file, which is merged over shadcn's default preset. Fresh projects lint without warnings, TanStack Start's `check-types` no longer runs a full Vite build, and the CLI prints one line per step instead of spinner frames in a non-interactive shell. `AGENTS.md` now covers every package, local dev, and adding Cloudflare bindings.
