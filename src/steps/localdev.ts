import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../exec.ts";
import type { StackConfig } from "../stack.ts";
import type { DevPorts } from "./agents.ts";

const WRANGLER_VERSION = "^4";

/**
 * Makes `dev` work without a Cloudflare account. Alchemy dev refuses to start
 * until a Cloudflare profile exists, so `dev` runs the server worker with
 * Wrangler and a local D1 next to the web app, and Alchemy dev moves to
 * `dev:cloud`. Deploys still go through Alchemy.
 */
export async function setupLocalDev(config: StackConfig, ports: DevPorts) {
  const root = config.projectDir;
  const serverDir = path.join(root, "apps/server");

  await writeFile(path.join(serverDir, "wrangler.jsonc"), wranglerConfig(config.projectName, ports.server));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "scripts/dev-server.mjs"), devServerScript());

  await updatePackage(path.join(serverDir, "package.json"), (pkg) => ({
    ...pkg,
    scripts: { dev: "node ../../scripts/dev-server.mjs", ...pkg.scripts },
    devDependencies: { ...pkg.devDependencies, wrangler: WRANGLER_VERSION },
  }));
  await updatePackage(path.join(root, "apps/web/package.json"), (pkg) => {
    const bare = pkg.scripts?.["dev:bare"];
    return bare ? { ...pkg, scripts: { dev: bare, ...pkg.scripts } } : pkg;
  });
  await updatePackage(path.join(root, "packages/infra/package.json"), (pkg) => {
    if (!pkg.scripts?.dev) return pkg;
    const { dev, ...scripts } = pkg.scripts;
    return { ...pkg, scripts: { "dev:cloud": dev, ...scripts } };
  });
  await updatePackage(path.join(root, "package.json"), (pkg) => ({
    ...pkg,
    scripts: { ...pkg.scripts, "dev:cloud": `turbo run dev:cloud -F @${config.projectName}/infra` },
  }));

  const turboPath = path.join(root, "turbo.json");
  const turbo = JSON.parse(await readFile(turboPath, "utf8")) as { tasks?: Record<string, unknown> };
  turbo.tasks = { ...turbo.tasks, "dev:cloud": { cache: false, persistent: true } };
  await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);
}

/** Ships the initial migration so a fresh local D1 has the schema on first `dev`. */
export async function generateMigrations(config: StackConfig) {
  await run(config.packageManager, ["run", "db:generate"], path.join(config.projectDir, "packages/db"));
}

export function wranglerConfig(projectName: string, port: number) {
  return `// Local development only: \`dev\` runs this worker with Wrangler and a local D1.
// Deploys go through packages/infra/alchemy.run.ts, which ignores this file.
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${projectName}-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${projectName}-local",
      "database_id": "local",
      "migrations_dir": ".wrangler/migrations"
    }
  ],
  "dev": { "port": ${port} }
}
`;
}

export function devServerScript() {
  return `// Runs the server worker locally with Wrangler and a local D1, no Cloudflare account needed.
// Wrangler reads flat .sql files, while Drizzle writes one folder per migration, so the
// migrations are copied into .wrangler/migrations and applied before the worker starts.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const serverDir = process.cwd();
const wranglerConfig = readFileSync(path.join(serverDir, "wrangler.jsonc"), "utf8");
const port = Number(/"port":\\s*(\\d+)/.exec(wranglerConfig)?.[1] ?? 8787);
const drizzleDir = path.resolve(serverDir, "../../packages/db/src/migrations");
const wranglerDir = path.join(serverDir, ".wrangler/migrations");

const inUse = await new Promise((resolve) => {
  const socket = net.connect({ port, host: "localhost" });
  socket.once("connect", () => {
    socket.end();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
});
if (inUse) {
  console.error(
    \`Port \${port} is already in use, so the server cannot start.\\n\` +
      \`Stop whatever is using it, or move the server to a free port: change "dev.port" in\\n\` +
      \`apps/server/wrangler.jsonc and every localhost:\${port} URL in apps/server/.env and apps/web/.env.\`,
  );
  process.exit(1);
}

mkdirSync(wranglerDir, { recursive: true });
if (existsSync(drizzleDir)) {
  for (const entry of readdirSync(drizzleDir, { withFileTypes: true })) {
    const sql = path.join(drizzleDir, entry.name, "migration.sql");
    if (entry.isDirectory() && existsSync(sql)) copyFileSync(sql, path.join(wranglerDir, \`\${entry.name}.sql\`));
  }
}

const shell = process.platform === "win32";
const migrate = spawnSync("wrangler", ["d1", "migrations", "apply", "DB", "--local"], { stdio: "inherit", shell });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const dev = spawnSync("wrangler", ["dev"], { stdio: "inherit", shell });
process.exit(dev.status ?? 0);
`;
}

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function updatePackage(file: string, update: (pkg: PackageJson) => PackageJson) {
  const pkg = JSON.parse(await readFile(file, "utf8")) as PackageJson;
  await writeFile(file, `${JSON.stringify(update(pkg), null, 2)}\n`);
}
