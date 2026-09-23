import { describe, expect, it } from "vitest";
import { baselineOverrides, buildOxlintConfig, escapeGlob, fixTemplateClasses, oxlintRuleName } from "../src/steps/lint.ts";
import { parseDevPorts } from "../src/steps/agents.ts";

const base = { plugins: ["typescript"], ignorePatterns: ["dist"], rules: { "no-console": "warn" as const } };
const all = { antiSlop: true, antiSlopEffect: true, shadcnLint: true, uiImport: "@app/ui/components" };

describe("buildOxlintConfig", () => {
  it("registers both plugins, rules, and the shadcn setting", () => {
    const config = buildOxlintConfig(base, all);
    expect(config.jsPlugins).toEqual([
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
      "@shadcn/lint",
    ]);
    expect(config.rules?.["anti-slop/no-object-parameters"]).toBe("error");
    expect(config.rules?.["anti-slop-effect/prefer-effect-match"]).toBe("error");
    expect(config.rules?.["shadcn/no-raw-colors"]).toBe("error");
    expect(config.rules?.["no-console"]).toBe("warn");
    expect(config.settings).toEqual({ shadcn: { ui: "@app/ui/components" } });
    expect(config.ignorePatterns).toContain("tools/oxlint/anti-slop/**");
    expect(config.ignorePatterns).toContain(".claude/**");
  });

  it("turns consumer rules off inside the UI package", () => {
    const override = buildOxlintConfig(base, all).overrides?.at(-1);
    expect(override?.files).toEqual(["packages/ui/src/components/**"]);
    expect(override?.rules["shadcn/no-restyle"]).toBe("off");
    expect(override?.rules["anti-slop/require-readable-spacing"]).toBe("off");
  });

  it("adds nothing when both toggles are off", () => {
    const config = buildOxlintConfig(base, { ...all, antiSlop: false, shadcnLint: false });
    expect(config.jsPlugins).toBeUndefined();
    expect(config.overrides).toBeUndefined();
    expect(config.settings).toBeUndefined();
    expect(config.rules).toEqual(base.rules);
  });

  it("skips effect rules unless requested", () => {
    const config = buildOxlintConfig(base, { ...all, antiSlopEffect: false, shadcnLint: false });
    expect(config.jsPlugins).toHaveLength(1);
    expect(Object.keys(config.rules ?? {}).some((rule) => rule.startsWith("anti-slop-effect/"))).toBe(false);
  });
});

describe("fixTemplateClasses", () => {
  it("drops raw link colors and maps red text to the destructive token", () => {
    const source = `<Button variant="link" className="text-indigo-600 hover:text-indigo-800">x</Button>
<p className="text-red-500 text-sm">error</p>`;
    expect(fixTemplateClasses(source)).toBe(`<Button variant="link">x</Button>
<p className="text-destructive text-sm">error</p>`);
  });
});

describe("oxlintRuleName", () => {
  it("maps diagnostic codes to config keys", () => {
    expect(oxlintRuleName("anti-slop(no-object-parameters)")).toBe("anti-slop/no-object-parameters");
    expect(oxlintRuleName("shadcn(no-raw-colors)")).toBe("shadcn/no-raw-colors");
    expect(oxlintRuleName("eslint(no-unused-vars)")).toBe("no-unused-vars");
    expect(oxlintRuleName("typescript-eslint(no-explicit-any)")).toBe("typescript/no-explicit-any");
    expect(oxlintRuleName("not a code")).toBeUndefined();
  });
});

describe("baselineOverrides", () => {
  it("groups rules per file as warnings, sorted", () => {
    expect(
      baselineOverrides([
        { code: "shadcn(no-raw-colors)", filename: "b.tsx" },
        { code: "shadcn(no-arbitrary-values)", filename: "a.tsx" },
        { code: "shadcn(no-raw-colors)", filename: "a.tsx" },
        { code: "shadcn(no-raw-colors)", filename: "a.tsx" },
      ]),
    ).toEqual([
      { files: ["a.tsx"], rules: { "shadcn/no-arbitrary-values": "warn", "shadcn/no-raw-colors": "warn" } },
      { files: ["b.tsx"], rules: { "shadcn/no-raw-colors": "warn" } },
    ]);
  });
});

describe("escapeGlob", () => {
  it("escapes Next.js route segments so they match literally", () => {
    expect(escapeGlob("src/app/[id]/page.tsx")).toBe("src/app/\\[id\\]/page.tsx");
    expect(escapeGlob("src/(group)/a.ts")).toBe("src/\\(group\\)/a.ts");
    expect(escapeGlob("src/[...slug]/*.ts")).toBe("src/\\[...slug\\]/\\*.ts");
    expect(baselineOverrides([{ code: "eslint(no-console)", filename: "app/[id]/page.tsx" }])[0]?.files).toEqual([
      "app/\\[id\\]/page.tsx",
    ]);
  });
});

describe("parseDevPorts", () => {
  it("reads server then web ports", () => {
    expect(parseDevPorts("dev: { port: 4000 } ... dev: { port: 4001 }")).toEqual({ server: 4000, web: 4001 });
    expect(parseDevPorts("")).toEqual({ server: 3000, web: 3001 });
  });
});
