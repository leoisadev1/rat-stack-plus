// Packs the CLI the way npm will publish it, installs the tarball into an empty
// project, and runs the installed bins. Catches missing files and a broken shebang.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (!existsSync(path.join(root, "dist/cli.mjs"))) throw new Error("dist/cli.mjs is missing; run the build first.");

const temporary = await mkdtemp(path.join(tmpdir(), "rat-stack-plus-pack-"));
const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } });

try {
  const [pack] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], root)) as [
    { filename: string; files: { path: string }[] },
  ];
  const files = pack.files.map((file) => file.path);

  for (const required of ["dist/cli.mjs", "vendor/anti-slop/index.ts", "vendor/anti-slop/LICENSE", "README.md", "LICENSE"]) {
    if (!files.includes(required)) throw new Error(`The package is missing ${required}.`);
  }

  const consumer = path.join(temporary, "consumer");
  run("mkdir", ["-p", consumer], temporary);
  await writeFile(path.join(consumer, "package.json"), `${JSON.stringify({ name: "consumer", private: true })}\n`);
  run("npm", ["install", path.join(temporary, pack.filename)], consumer);

  for (const bin of ["create-rat-stack-plus", "rat-stack-plus"]) {
    const help = run(path.join(consumer, "node_modules/.bin", bin), ["--help"], consumer);
    if (!help.includes("Usage: create-rat-stack-plus")) throw new Error(`${bin} --help printed unexpected output.`);
  }

  console.log(`${pack.filename}: ${files.length} files, both bins run.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
