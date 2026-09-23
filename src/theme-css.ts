import { DEFAULT_PRESET_CONFIG, encodePreset } from "shadcn/preset";

/**
 * A CSS theme lands on shadcn's default preset, which sets up the components,
 * icons, and font. The file's variables then override the preset's.
 */
export const CSS_THEME_BASE_PRESET = encodePreset({ ...DEFAULT_PRESET_CONFIG, iconLibrary: "lucide" });

/** Blocks whose declarations merge into the same block in globals.css. */
const MERGED_BLOCKS = [":root", ".dark", "@theme inline", "@theme"];

export function isCssThemePath(value: string) {
  return /\.css$/i.test(value.trim());
}

type Chunk =
  | { kind: "statement"; text: string; start: number; end: number }
  | { kind: "block"; prelude: string; body: string; start: number; bodyStart: number; end: number };

/** Splits a stylesheet into its top-level statements and blocks, skipping comments and strings. */
function topLevelChunks(css: string): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (css.startsWith("/*", i)) {
      const close = css.indexOf("*/", i + 2);
      i = close === -1 ? css.length : close + 2;
      if (css.slice(start, i).trim().startsWith("/*")) start = i;
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipString(css, i);
      continue;
    }
    if (char === ";") {
      chunks.push({ kind: "statement", text: css.slice(start, i + 1).trim(), start, end: i + 1 });
      start = i + 1;
    } else if (char === "{") {
      const close = matchingBrace(css, i);
      chunks.push({ kind: "block", prelude: css.slice(start, i).trim(), body: css.slice(i + 1, close), start, bodyStart: i + 1, end: close + 1 });
      i = close + 1;
      start = i;
      continue;
    }
    i += 1;
  }
  return chunks;
}

function skipString(css: string, open: number) {
  const quote = css[open];
  let i = open + 1;
  while (i < css.length && css[i] !== quote) i += css[i] === "\\" ? 2 : 1;
  return i + 1;
}

function matchingBrace(css: string, open: number) {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const close = css.indexOf("*/", i + 2);
      i = close === -1 ? css.length : close + 2;
      continue;
    }
    const char = css[i];
    if (char === '"' || char === "'") {
      i = skipString(css, i);
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error("The theme CSS has an unclosed `{`.");
}

/** The `property: value` pairs of a flat block body, in order. */
function declarations(body: string): [string, string][] {
  const result: [string, string][] = [];
  const text = body.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (i === text.length || (char === ";" && depth === 0)) {
      const declaration = text.slice(start, i).trim();
      const colon = declaration.indexOf(":");
      if (colon > 0) result.push([declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]);
      start = i + 1;
    }
  }
  return result;
}

function normalize(prelude: string) {
  return prelude.replaceAll(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sets each declaration in a block body, replacing the property's value when it's already there. */
function mergeDeclarations(body: string, updates: [string, string][]) {
  let next = body;
  const added: string[] = [];
  for (const [property, value] of updates) {
    const pattern = new RegExp(`(^|[;{\\s])(${escapeRegExp(property)})\\s*:[^;]*;`);
    if (pattern.test(next)) {
      next = next.replace(pattern, (_match, before: string) => `${before}${property}: ${value};`);
    } else {
      added.push(`  ${property}: ${value};`);
    }
  }
  if (added.length === 0) return next;
  return `${next.trimEnd()}\n${added.join("\n")}\n`;
}

/**
 * Merges a theme stylesheet into the generated globals.css. Variables in `:root`,
 * `.dark`, and `@theme` override the preset's or join them, `@import`s go first,
 * and any other rules are appended at the end.
 */
export function mergeThemeCss(globals: string, theme: string, source = "theme.css") {
  const themeChunks = topLevelChunks(theme);
  const updates = new Map<string, [string, string][]>();
  const extraBlocks: string[] = [];
  const imports: string[] = [];
  const otherStatements: string[] = [];

  for (const chunk of themeChunks) {
    if (chunk.kind === "statement") {
      if (/^@import\b/.test(chunk.text)) imports.push(chunk.text);
      else otherStatements.push(chunk.text);
      continue;
    }
    const prelude = normalize(chunk.prelude);
    if (MERGED_BLOCKS.includes(prelude) && !chunk.body.includes("{")) {
      updates.set(prelude, [...(updates.get(prelude) ?? []), ...declarations(chunk.body)]);
    } else {
      extraBlocks.push(theme.slice(chunk.start, chunk.end).trim());
    }
  }

  const variables = [...updates.values()].flat().filter(([property]) => property.startsWith("--"));
  if (variables.length === 0) {
    throw new Error(`${source} sets no CSS variables in :root, .dark, or @theme. Export a shadcn theme, for example from https://ui.shadcn.com/themes or tweakcn.`);
  }

  let merged = globals;
  const pending = new Map(updates);
  // Edit from the end so earlier offsets stay valid.
  for (const chunk of topLevelChunks(globals).toReversed()) {
    if (chunk.kind !== "block") continue;
    const prelude = normalize(chunk.prelude);
    const update = pending.get(prelude);
    if (!update) continue;
    pending.delete(prelude);
    merged = `${merged.slice(0, chunk.bodyStart)}${mergeDeclarations(chunk.body, update)}${merged.slice(chunk.end - 1)}`;
  }

  // Tailwind inlines `@import "tailwindcss"`, so an import after it would follow rules,
  // which CSS forbids. The theme's imports go first.
  const newImports = imports.filter((line) => !merged.includes(line));
  if (newImports.length > 0) merged = `${newImports.join("\n")}\n${merged}`;

  const appended = [
    ...otherStatements,
    ...[...pending].map(([prelude, update]) => `${prelude} {\n${update.map(([property, value]) => `  ${property}: ${value};`).join("\n")}\n}`),
    ...extraBlocks,
  ];
  if (appended.length > 0) merged = `${merged.trimEnd()}\n\n/* From ${source} */\n${appended.join("\n\n")}\n`;
  return merged;
}
