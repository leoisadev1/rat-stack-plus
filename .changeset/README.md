# Changesets

Every change that affects the published CLI needs a changeset. It's a small Markdown file in this folder that names the bump and says what changed for people who run the CLI.

```sh
bun run changeset
```

Pick `patch` for fixes, `minor` for new options or generated files, and `major` for anything that breaks an existing command or flag. Write the summary for users, not reviewers: "Generated apps deploy without a second `CORS_ORIGIN` edit" is better than "fix alchemy.run.ts template". Commit the file with your change.

Only changes to what ships need one: `src`, `vendor`, `package.json`, `tsdown.config.ts`, and the README, which appears on npm. CI, tests, and other docs don't. For a shipped change that users won't notice, such as a refactor, run `bun run changeset --empty`.

## How a release happens

1. A pull request with a changeset merges into `main`.
2. The Release workflow opens or updates a pull request named `chore: version package`. It bumps the version in `package.json`, writes `CHANGELOG.md`, and deletes the used changesets.
3. Merging that pull request runs the workflow again. With no changesets left, it publishes to npm with trusted publishing, tags the release, and creates a GitHub release.
