import { isIPv4 } from "node:net";
import path from "node:path";

export const FRONTENDS = [
  { value: "tanstack-start", label: "TanStack Start", hint: "recommended" },
  { value: "next", label: "Next.js" },
  { value: "react-router", label: "React Router" },
] as const;

export const AUTH_PROVIDERS = [
  { value: "better-auth", label: "Better Auth", hint: "stored in D1" },
  { value: "clerk", label: "Clerk", hint: "hosted user management" },
  { value: "none", label: "No auth" },
] as const;

export const PACKAGE_MANAGERS = [
  { value: "bun", label: "bun" },
  { value: "pnpm", label: "pnpm" },
  { value: "npm", label: "npm" },
] as const;

export type Frontend = (typeof FRONTENDS)[number]["value"];
export type Auth = (typeof AUTH_PROVIDERS)[number]["value"];
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]["value"];

export interface StackConfig {
  projectName: string;
  projectDir: string;
  frontend: Frontend;
  auth: Auth;
  packageManager: PackageManager;
  presetCode: string;
  /** A theme stylesheet merged over the preset, set by `--theme ./theme.css`. */
  themeCss?: string;
  /** Address the dev servers bind to and advertise, such as a Tailscale IP. */
  host: string;
  /** The server's dev port. The web app runs on the next port up. */
  port: number;
  pointer: boolean;
  rtl: boolean;
  antiSlop: boolean;
  shadcnLint: boolean;
  agentTesting: boolean;
  fence: boolean;
  git: boolean;
}

export type StackChoices = Omit<StackConfig, "projectName" | "projectDir" | "presetCode" | "themeCss" | "host" | "port">;

export const DEFAULT_HOST = "localhost";
export const DEFAULT_PORT = 3000;

export interface DevPorts {
  server: number;
  web: number;
}

export function devPorts(config: Pick<StackConfig, "port">): DevPorts {
  return { server: config.port, web: config.port + 1 };
}

/** The server port must leave room for the web app on the next port. */
export function validatePort(value: string): string | undefined {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_534) return "Use a port from 1024 to 65534.";
  return undefined;
}

/** A hostname or IPv4 address other devices can reach, such as a Tailscale address. */
export function validateHost(value: string): string | undefined {
  if (value === "0.0.0.0" || value === "::") {
    return "Use the address other devices open, such as a Tailscale IP or hostname. Hostnames bind every interface on their own.";
  }
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value)) return `"${value}" is not a hostname or IPv4 address.`;
  // The dev scripts treat four dotted numbers as an IP and bind it, so it has to be a real one.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) && !isIPv4(value)) return `"${value}" is not a valid IPv4 address.`;
  return undefined;
}

export const DEFAULT_CHOICES: StackChoices = {
  frontend: "tanstack-start",
  auth: "better-auth",
  packageManager: "bun",
  pointer: true,
  rtl: false,
  antiSlop: true,
  shadcnLint: true,
  agentTesting: true,
  fence: true,
  git: true,
};

export function isFrontend(value: string): value is Frontend {
  return FRONTENDS.some((option) => option.value === value);
}

export function isAuth(value: string): value is Auth {
  return AUTH_PROVIDERS.some((option) => option.value === value);
}

export function isPackageManager(value: string): value is PackageManager {
  return PACKAGE_MANAGERS.some((option) => option.value === value);
}

export function resolveProject(input: string, cwd: string) {
  const projectDir = path.resolve(cwd, input);
  return { projectDir, projectName: path.basename(projectDir) };
}

/** Package names become npm scopes (`@name/ui`), so keep them to npm-safe characters. */
export function validateProjectName(name: string): string | undefined {
  if (!name) return "Enter a project name.";
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return "Use lowercase letters, digits, '.', '_' or '-', starting with a letter or digit.";
  }
  return undefined;
}

export function runCommand(pm: PackageManager, script: string) {
  return pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`;
}
