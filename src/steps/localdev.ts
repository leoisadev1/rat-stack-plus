import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../exec.ts";
import { devPorts, type Auth, type DevPorts, type Frontend, type StackConfig } from "../stack.ts";

const WRANGLER_VERSION = "^4";

/**
 * Makes `dev` work without a Cloudflare account. Alchemy dev refuses to start
 * until a Cloudflare profile exists, so `dev` runs the server worker with
 * Wrangler and a local D1 next to the web app, and Alchemy dev moves to
 * `dev:cloud`. Deploys still go through Alchemy.
 */
export async function setupLocalDev(config: StackConfig) {
  const root = config.projectDir;
  const serverDir = path.join(root, "apps/server");
  const webDir = path.join(root, "apps/web");
  const ports = devPorts(config);

  await writeFile(path.join(serverDir, "wrangler.jsonc"), wranglerConfig(config.projectName));
  await writeFile(path.join(root, "dev.config.json"), devConfigJson(config.host, ports));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "scripts/dev-config.mjs"), devConfigModule());
  await writeFile(path.join(root, "scripts/dev-server.mjs"), devServerScript(config.auth));
  await writeFile(path.join(root, "scripts/dev-web.mjs"), devWebScript(config.frontend));

  await updatePackage(path.join(serverDir, "package.json"), (pkg) => ({
    ...pkg,
    scripts: { dev: "node ../../scripts/dev-server.mjs", ...pkg.scripts },
    devDependencies: { ...pkg.devDependencies, wrangler: WRANGLER_VERSION },
  }));
  await updatePackage(path.join(webDir, "package.json"), (pkg) => ({
    ...pkg,
    scripts: { ...pkg.scripts, dev: "node ../../scripts/dev-web.mjs", "dev:bare": "node ../../scripts/dev-web.mjs" },
  }));
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
  const turbo = JSON.parse(await readFile(turboPath, "utf8")) as {
    tasks?: Record<string, unknown>;
    globalPassThroughEnv?: string[];
  };
  turbo.tasks = { ...turbo.tasks, "dev:cloud": { cache: false, persistent: true } };
  // Turbo's strict env mode hides variables it doesn't know about from tasks.
  turbo.globalPassThroughEnv = [...new Set([...(turbo.globalPassThroughEnv ?? []), "DEV_HOST"])];
  await writeFile(turboPath, `${JSON.stringify(turbo, null, 2)}\n`);

  await applyDevPorts(config);
}

/**
 * The dev wrappers pass ports and URLs on the command line, but Alchemy's dev
 * mode, the Vite config, and the .env fallbacks carry their own copies. Point
 * them all at the chosen ports.
 */
async function applyDevPorts(config: StackConfig) {
  const root = config.projectDir;
  const ports = devPorts(config);
  const serverUrl = `http://${config.host}:${ports.server}`;
  const webUrl = `http://${config.host}:${ports.web}`;

  await edit(path.join(root, "packages/infra/alchemy.run.ts"), (source) => setAlchemyDevPorts(source, ports));
  await edit(path.join(root, "apps/server/.env"), (source) =>
    source
      .replace(/^BETTER_AUTH_URL=http:\/\/localhost:\d+$/m, `BETTER_AUTH_URL=${serverUrl}`)
      .replace(/^CORS_ORIGIN=http:\/\/localhost:\d+$/m, `CORS_ORIGIN=${webUrl}`),
  );
  await edit(path.join(root, "apps/web/.env"), (source) =>
    source.replace(/^((?:VITE|NEXT_PUBLIC)_SERVER_URL)=http:\/\/localhost:\d+$/m, `$1=${serverUrl}`),
  );
  // scripts/dev-web.mjs passes the port, so the Vite config shouldn't pin its own.
  await edit(path.join(root, "apps/web/vite.config.ts"), (source) => source.replace(/\n\s*server: \{\s*port: \d+,?\s*\},/, ""));
  await edit(path.join(root, "apps/web/next.config.ts"), allowDevHost);
  await edit(path.join(root, "README.md"), (source) =>
    source
      .replaceAll("http://localhost:3001", webUrl)
      .replaceAll("http://localhost:5173", webUrl)
      .replaceAll("http://localhost:3000", serverUrl),
  );
}

/** Next blocks dev assets for origins other than localhost, so allow the host scripts/dev-web.mjs passes. */
export function allowDevHost(source: string) {
  if (source.includes("allowedDevOrigins")) return source;
  return source.replace(
    /(const nextConfig: NextConfig = \{\n)/,
    "$1  // scripts/dev-web.mjs sets DEV_HOST when the app is opened from another device.\n  allowedDevOrigins: process.env.DEV_HOST ? [process.env.DEV_HOST] : [],\n",
  );
}

/** Alchemy declares the server's dev port first and the web app's second. */
export function setAlchemyDevPorts(source: string, ports: DevPorts) {
  let index = 0;
  return source.replace(/(dev:\s*\{\s*port:\s*)\d+/g, (_match, prefix: string) => {
    index += 1;
    return `${prefix}${index === 1 ? ports.server : ports.web}`;
  });
}

async function edit(file: string, update: (source: string) => string) {
  if (!existsSync(file)) return;
  await writeFile(file, update(await readFile(file, "utf8")));
}

/** Ships the initial migration so a fresh local D1 has the schema on first `dev`. */
export async function generateMigrations(config: StackConfig) {
  await run(config.packageManager, ["run", "db:generate"], path.join(config.projectDir, "packages/db"));
}

export function wranglerConfig(projectName: string) {
  return `// Local development only: \`dev\` runs this worker with Wrangler and a local D1.
// Deploys go through packages/infra/alchemy.run.ts, which ignores this file.
// The dev port comes from dev.config.json; scripts/dev-server.mjs passes it to Wrangler.
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
  ]
}
`;
}

export function devConfigJson(host: string, ports: DevPorts) {
  return `${JSON.stringify({ host, serverPort: ports.server, webPort: ports.web }, null, 2)}\n`;
}

export function devConfigModule() {
  return `// Reads dev.config.json, the one place that sets the local dev host and ports.
// DEV_HOST overrides the host for one run, for example DEV_HOST=100.64.0.1 to open
// the app from another device on your Tailscale network.
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../dev.config.json", import.meta.url), "utf8"));

export const host = process.env.DEV_HOST || config.host || "localhost";

if (host === "0.0.0.0" || host === "::") {
  console.error("Set DEV_HOST to the address other devices open, such as a Tailscale IP. Hostnames bind every interface on their own.");
  process.exit(1);
}

export const serverPort = Number(config.serverPort);

export const webPort = Number(config.webPort);

export const isLocal = host === "localhost" || host === "127.0.0.1";

export const isIp = /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host);

// Localhost and IP addresses bind only that address. A hostname binds every interface,
// since it may resolve to more than one.
export const bindHost = isLocal || isIp ? host : "0.0.0.0";

export const serverUrl = \`http://\${host}:\${serverPort}\`;

export const webUrl = \`http://\${host}:\${webPort}\`;
`;
}

export function devServerScript(auth: Auth) {
  const vars = auth === "better-auth" ? `"--var", \`BETTER_AUTH_URL:\${serverUrl}\`, "--var", \`CORS_ORIGIN:\${webUrl}\`` : `"--var", \`CORS_ORIGIN:\${webUrl}\``;
  return `// Runs the server worker locally with Wrangler and a local D1, no Cloudflare account needed.
// Wrangler reads flat .sql files, while Drizzle writes one folder per migration, so the
// migrations are copied into .wrangler/migrations and applied before the worker starts.
// The port and URLs come from dev.config.json and override the ones in apps/server/.env.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { ${auth === "better-auth" ? "bindHost, serverPort, serverUrl, webUrl" : "bindHost, serverPort, webUrl"} } from "./dev-config.mjs";

const serverDir = process.cwd();

const drizzleDir = path.resolve(serverDir, "../../packages/db/src/migrations");

const wranglerDir = path.join(serverDir, ".wrangler/migrations");

const inUse = await new Promise((resolve) => {
  const socket = net.connect({ port: serverPort, host: bindHost === "0.0.0.0" ? "localhost" : bindHost });

  socket.once("connect", () => {
    socket.end();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
});

if (inUse) {
  console.error(
    \`Port \${serverPort} is already in use, so the server cannot start.\\n\` +
      \`Stop whatever is using it, or move the stack to free ports: change serverPort and webPort in dev.config.json.\`,
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

const args = ["dev", "--port", String(serverPort), "--ip", bindHost, ${vars}];

const dev = spawnSync("wrangler", args, { stdio: "inherit", shell });

process.exit(dev.status ?? 0);
`;
}

const WEB_DEV: Record<Frontend, { bin: string; args: string; urlVar: string }> = {
  "tanstack-start": { bin: "vite", args: `"dev", "--port", String(webPort), "--strictPort", "--host", bindHost`, urlVar: "VITE_SERVER_URL" },
  "react-router": {
    bin: "react-router",
    args: `"dev", "--port", String(webPort), "--strictPort", "--host", bindHost`,
    urlVar: "VITE_SERVER_URL",
  },
  next: { bin: "next", args: `"dev", "--port", String(webPort), "--hostname", bindHost`, urlVar: "NEXT_PUBLIC_SERVER_URL" },
};

export function devWebScript(frontend: Frontend) {
  const web = WEB_DEV[frontend];
  const allowHost =
    frontend === "next"
      ? "// next.config.ts reads DEV_HOST to allow the dev origin.\nif (!isLocal) env.DEV_HOST = host;"
      : "// Vite only answers requests for localhost and IP addresses unless the host is allowed.\nif (!isLocal && !isIp) env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = host;";
  return `// Runs the web dev server on the host and port from dev.config.json, pointed at the
// local server. The server URL overrides the one in apps/web/.env.
import { spawnSync } from "node:child_process";
import { ${frontend === "next" ? "bindHost, host, isLocal" : "bindHost, host, isIp, isLocal"}, serverUrl, webPort } from "./dev-config.mjs";

const env = { ...process.env, ${web.urlVar}: serverUrl };

${allowHost}

const dev = spawnSync("${web.bin}", [${web.args}], { stdio: "inherit", env, shell: process.platform === "win32" });

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
