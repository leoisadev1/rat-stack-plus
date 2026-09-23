import { describe, expect, it } from "vitest";
import { isCssThemePath, mergeThemeCss } from "../src/theme-css.ts";

const globals = `@import "tailwindcss";
@import "@fontsource-variable/inter";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --primary: oklch(0.2 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.1 0 0);
  --primary: oklch(0.9 0 0);
}

@theme inline {
  --color-background: var(--background);
  --font-sans: "Inter Variable", sans-serif;
}

@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
`;

const theme = `/* Exported theme */
@import url("https://fonts.googleapis.com/css2?family=Geist&display=swap");

:root {
  --primary: oklch(0.55 0.2 260); /* brand */
  --brand: #5e9bff;
}

.dark {
  --primary: oklch(0.7 0.15 260);
}

@theme inline {
  --font-sans: "Geist", sans-serif;
  --color-brand: var(--brand);
}

kbd {
  font-family: var(--font-mono);
}
`;

describe("mergeThemeCss", () => {
  const merged = mergeThemeCss(globals, theme);

  it("overrides preset variables and adds new ones in the same block", () => {
    expect(merged).toContain("  --primary: oklch(0.55 0.2 260);\n  --radius: 0.625rem;\n  --brand: #5e9bff;\n}");
    expect(merged).toContain("  --primary: oklch(0.7 0.15 260);");
    expect(merged).toContain('--font-sans: "Geist", sans-serif;');
    expect(merged).toContain("--color-brand: var(--brand);");
    expect(merged).not.toContain('"Inter Variable"');
    expect(merged.match(/^:root \{/gm)).toHaveLength(1);
  });

  it("puts imports before Tailwind and appends other rules", () => {
    expect(merged.startsWith('@import url("https://fonts.googleapis.com/css2?family=Geist&display=swap");\n@import "tailwindcss";')).toBe(true);
    expect(merged.trimEnd().endsWith("kbd {\n  font-family: var(--font-mono);\n}")).toBe(true);
    expect(merged).toContain("/* From theme.css */");
  });

  it("keeps the rest of globals.css intact", () => {
    expect(merged).toContain("@layer base {\n  body {\n    @apply bg-background text-foreground;\n  }\n}");
    expect(merged).toContain("--color-background: var(--background);");
  });

  it("is stable when applied twice", () => {
    expect(mergeThemeCss(merged, theme).replace(/\n\n\/\* From theme\.css \*\/[\s\S]*$/, "")).toBe(
      merged.replace(/\n\n\/\* From theme\.css \*\/[\s\S]*$/, ""),
    );
  });

  it("keeps semicolons inside quoted values", () => {
    expect(mergeThemeCss(globals, ':root { --label: "a;b"; --x: 1; }')).toMatch(/--label: "a;b";\n[\s\S]*--x: 1;/);
  });

  it("rejects CSS without theme variables", () => {
    expect(() => mergeThemeCss(globals, "kbd { color: red; }", "brand.css")).toThrow(/brand\.css sets no CSS variables/);
  });
});

describe("isCssThemePath", () => {
  it("matches .css paths only", () => {
    expect(isCssThemePath("./theme.css")).toBe(true);
    expect(isCssThemePath("b1adQ3rfU")).toBe(false);
  });
});
