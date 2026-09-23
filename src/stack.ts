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
  pointer: boolean;
  rtl: boolean;
  antiSlop: boolean;
  shadcnLint: boolean;
  agentTesting: boolean;
  git: boolean;
}

export type StackChoices = Omit<StackConfig, "projectName" | "projectDir" | "presetCode">;

export const DEFAULT_CHOICES: StackChoices = {
  frontend: "tanstack-start",
  auth: "better-auth",
  packageManager: "bun",
  pointer: true,
  rtl: false,
  antiSlop: true,
  shadcnLint: true,
  agentTesting: true,
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
