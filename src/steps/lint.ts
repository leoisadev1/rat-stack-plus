import { existsSync } from "node:fs";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../exec.ts";
import type { PackageManager, StackConfig } from "../stack.ts";

export const SHADCN_LINT_VERSION = "0.2.0";
const ANTI_SLOP_DIR = "tools/oxlint/anti-slop";

const ANTI_SLOP_RULES = [
  "no-array-filter-map",
  "no-reduce-accumulator-copy",
  "no-chained-type-assertions",
  "no-conditional-empty-object-spread",
  "no-known-value-widening",
  "no-module-mocking",
  "no-object-parameters",
  "no-reflect-apply",
  "no-reflect-get",
  "no-runtime-typeof",
  "no-shape-in-symbol-names",
  "no-unknown-parameters",
  "no-unknown-returns",
  "no-unknown-type-aliases",
  "no-unsafe-dictionary-type",
  "no-widen-then-assert",
  "require-readable-spacing",
  "require-safety-comment-for-type-assertion",
];

const ANTI_SLOP_EFFECT_RULES = [
  "no-manual-effect-error-tag",
  "no-manual-tag-comparison",
  "no-manual-tagged-construction",
  "no-service-constructor-imports",
  "prefer-effect-match",
];

const SHADCN_RULES = [
  "no-restyle",
  "no-raw-colors",
  "no-arbitrary-values",
  "no-inline-styles",
  "no-unknown-classes",
  "require-static-classes",
];

/** Directories agents write into; linting them only produces noise. */
const AGENT_DIRS = [
  ".agent/**", ".agents/**", ".claude/**", ".codex/**", ".cursor/**",
  ".gemini/**", ".opencode/**", ".pi/**", ".windsurf/**",
];

type Severity = "off" | "warn" | "error";
type RuleEntry = Severity | [Severity, ...unknown[]];

export interface OxlintConfig {
  $schema?: string;
  plugins?: string[];
  categories?: Record<string, Severity>;
  ignorePatterns?: string[];
  jsPlugins?: (string | { name: string; specifier: string })[];
  settings?: Record<string, unknown>;
  rules?: Record<string, RuleEntry>;
  overrides?: { files: string[]; rules: Record<string, RuleEntry> }[];
  env?: Record<string, boolean>;
}

export interface LintOptions {
  antiSlop: boolean;
  antiSlopEffect: boolean;
  shadcnLint: boolean;
  uiImport: string;
}

function ruleMap(prefix: string, rules: readonly string[], severity: Severity) {
  return Object.fromEntries(rules.map((rule) => [`${prefix}/${rule}`, severity]));
}

export function buildOxlintConfig(base: OxlintConfig, options: LintOptions): OxlintConfig {
  const jsPlugins: NonNullable<OxlintConfig["jsPlugins"]> = [...(base.jsPlugins ?? [])];
  const ignorePatterns = new Set([...(base.ignorePatterns ?? []), ...AGENT_DIRS]);
  let rules: Record<string, RuleEntry> = { ...base.rules };
  let settings = base.settings;
  const ownedRules: Record<string, RuleEntry> = {};

  if (options.antiSlop) {
    ignorePatterns.add(`${ANTI_SLOP_DIR}/**`);
    jsPlugins.push({ name: "anti-slop", specifier: `./${ANTI_SLOP_DIR}/index.ts` });
    rules = { ...rules, "oxc/no-accumulating-spread": "error", ...ruleMap("anti-slop", ANTI_SLOP_RULES, "error") };
    Object.assign(ownedRules, ruleMap("anti-slop", ANTI_SLOP_RULES, "off"));

    if (options.antiSlopEffect) {
      jsPlugins.push({ name: "anti-slop-effect", specifier: `./${ANTI_SLOP_DIR}/effect/index.ts` });
      rules = { ...rules, ...ruleMap("anti-slop-effect", ANTI_SLOP_EFFECT_RULES, "error") };
    }
  }

  if (options.shadcnLint) {
    jsPlugins.push("@shadcn/lint");
    rules = { ...rules, ...ruleMap("shadcn", SHADCN_RULES, "error") };
    settings = { ...settings, shadcn: { ui: options.uiImport } };
    Object.assign(ownedRules, ruleMap("shadcn", SHADCN_RULES, "off"));
  }

  // packages/ui/src/components is shadcn registry code that `shadcn add` overwrites.
  // It defines the design system, so the rules that police its consumers don't apply.
  const overrides = [...(base.overrides ?? [])];
  if (Object.keys(ownedRules).length > 0) {
    overrides.push({ files: ["packages/ui/src/components/**"], rules: ownedRules });
  }

  return {
    ...base,
    ignorePatterns: [...ignorePatterns],
    ...(jsPlugins.length > 0 ? { jsPlugins } : {}),
    ...(settings ? { settings } : {}),
    rules,
    ...(overrides.length > 0 ? { overrides } : {}),
  };
}

/**
 * Small, meaning-preserving fixes for classes the templates ship with that the
 * shadcn rules reject. Anything not listed here lands in the lint baseline.
 */
const TEMPLATE_FIXES: [RegExp, string][] = [
  [/\s+className="text-indigo-600 hover:text-indigo-800"/g, ""],
  [/\btext-red-500\b/g, "text-destructive"],
];

export function fixTemplateClasses(source: string): string {
  return TEMPLATE_FIXES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), source);
}

export interface Diagnostic {
  code: string;
  filename: string;
}

/** Override `files` are globs, so route segments like `[id]` or `(group)` must be escaped to match literally. */
export function escapeGlob(file: string) {
  return file.replace(/[\\*?[\]{}()!]/g, "\\$&");
}

/**
 * Turns the diagnostics left in freshly generated code into per-file overrides
 * that downgrade exactly those rules to warnings. New files get the full rules;
 * fixing a baselined file and deleting its override tightens it.
 */
export function baselineOverrides(diagnostics: readonly Diagnostic[]): NonNullable<OxlintConfig["overrides"]> {
  const byFile = new Map<string, Set<string>>();
  for (const { code, filename } of diagnostics) {
    const rule = oxlintRuleName(code);
    if (!rule) continue;
    const rules = byFile.get(filename) ?? new Set<string>();
    rules.add(rule);
    byFile.set(filename, rules);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, rules]) => ({
      files: [escapeGlob(file)],
      rules: Object.fromEntries([...rules].sort().map((rule) => [rule, "warn" as const])),
    }));
}

/** Oxlint reports `anti-slop(rule-name)`; config keys are `anti-slop/rule-name`. */
export function oxlintRuleName(code: string): string | undefined {
  const match = /^([\w@/-]+)\(([\w-]+)\)$/.exec(code);
  if (!match) return undefined;
  const [, plugin, rule] = match;
  const prefix = plugin === "eslint" ? "" : `${plugin === "typescript-eslint" ? "typescript" : plugin}/`;
  return `${prefix}${rule}`;
}

/** The vendored rules ship next to this file's package root, whether running from src/ or the dist/ bundle. */
function vendorAntiSlop() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(dir, "vendor/anti-slop");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find the vendored anti-slop rules.");
    dir = parent;
  }
}

export async function setupLint(config: StackConfig) {
  const root = config.projectDir;
  const oxlintrcPath = path.join(root, ".oxlintrc.json");
  const base = JSON.parse(await readFile(oxlintrcPath, "utf8")) as OxlintConfig;
  const oxlintVersion = await installedVersion(root, "oxlint");
  const antiSlopEffect = config.antiSlop && (await workspaceDependsOn(root, "effect"));

  if (config.antiSlop) {
    await cp(vendorAntiSlop(), path.join(root, ANTI_SLOP_DIR), { recursive: true });
  }

  await updateRootPackage(root, (pkg) => {
    const devDependencies = { ...pkg.devDependencies };
    // anti-slop needs @oxlint/plugins pinned to exactly the resolved oxlint version.
    if (config.antiSlop) {
      devDependencies.oxlint = oxlintVersion;
      devDependencies["@oxlint/plugins"] = oxlintVersion;
    }
    if (config.shadcnLint) devDependencies["@shadcn/lint"] = SHADCN_LINT_VERSION;
    return {
      ...pkg,
      scripts: { ...pkg.scripts, lint: "oxlint", "lint:fix": "oxlint --fix && oxfmt --write" },
      devDependencies,
    };
  });
  await install(config.packageManager, root);

  const uiImport = await uiImportPath(root);
  const lintConfig = buildOxlintConfig(base, {
    antiSlop: config.antiSlop,
    antiSlopEffect,
    shadcnLint: config.shadcnLint,
    uiImport,
  });
  await writeJson(oxlintrcPath, lintConfig);

  if (config.shadcnLint) await fixTemplates(path.join(root, "apps/web/src"));

  // Autofix what the rules can fix themselves (mostly readable spacing), then format.
  await run(process.execPath, [oxlintBin(root), "--fix"], root, true);
  await run(process.execPath, [oxfmtBin(root), "--write"], root, true);

  const remaining = await lintDiagnostics(root);
  const baseline = baselineOverrides(remaining);
  if (baseline.length > 0) {
    await writeJson(oxlintrcPath, { ...lintConfig, overrides: [...(lintConfig.overrides ?? []), ...baseline] });
  }

  // Format last so the config written above matches the project's oxfmt style.
  await run(process.execPath, [oxfmtBin(root), "--write"], root, true);
  const final = await run(process.execPath, [oxlintBin(root)], root, true);
  return { baselinedFiles: baseline.length, lintPasses: final.code === 0, output: final.output };
}

async function lintDiagnostics(root: string): Promise<Diagnostic[]> {
  const result = await run(process.execPath, [oxlintBin(root), "--format", "json"], root, true);
  const start = result.output.indexOf("{");
  if (start === -1) throw new Error(`Could not read oxlint output:\n${result.output}`);
  const report = JSON.parse(result.output.slice(start)) as { diagnostics: Diagnostic[] };
  return report.diagnostics.map(({ code, filename }) => ({ code, filename: filename.split(path.sep).join("/") }));
}

async function fixTemplates(dir: string) {
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(tsx|jsx)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const source = await readFile(file, "utf8");
    const fixed = fixTemplateClasses(source);
    if (fixed !== source) await writeFile(file, fixed);
  }
}

function oxlintBin(root: string) {
  return path.join(root, "node_modules/oxlint/bin/oxlint");
}

function oxfmtBin(root: string) {
  return path.join(root, "node_modules/oxfmt/bin/oxfmt");
}

async function installedVersion(root: string, pkg: string) {
  const manifest = JSON.parse(await readFile(path.join(root, "node_modules", pkg, "package.json"), "utf8"));
  return manifest.version as string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

async function updateRootPackage(root: string, update: (pkg: PackageJson) => PackageJson) {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
  await writeJson(pkgPath, update(pkg));
}

async function workspaceDependsOn(root: string, dependency: string) {
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const name of await readdir(groupDir)) {
      const pkgPath = path.join(groupDir, name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
      if (pkg.dependencies?.[dependency] || pkg.devDependencies?.[dependency]) return true;
    }
  }
  return false;
}

async function uiImportPath(root: string) {
  const uiConfig = JSON.parse(await readFile(path.join(root, "packages/ui/components.json"), "utf8")) as {
    aliases?: { ui?: string };
  };
  const ui = uiConfig.aliases?.ui;
  if (!ui) throw new Error("packages/ui/components.json has no ui alias.");
  return ui;
}

export async function install(pm: PackageManager, cwd: string) {
  // Commands run with CI=1 to keep tools non-interactive; pnpm reads that as frozen-lockfile.
  await run(pm, pm === "pnpm" ? ["install", "--no-frozen-lockfile"] : ["install"], cwd);
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
