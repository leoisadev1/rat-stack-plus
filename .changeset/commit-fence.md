---
"create-rat-stack-plus": minor
---

Add a commit fence, on by default. Generated apps get lefthook hooks that run lint before each commit and type checks before each push, plus Claude Code and Cursor hooks that block `--no-verify` and other ways to skip them. Generated apps also get a `plan` script that previews a deploy with `alchemy plan`.
