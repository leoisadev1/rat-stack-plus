import { decodePreset, encodePreset, isPresetCode } from "shadcn/preset";
import { describe, expect, it } from "vitest";
import { CURATED_THEMES, describePreset, presetUrl, randomPresetConfig, resolvePresetCode } from "../src/theme.ts";

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe("resolvePresetCode", () => {
  it("encodes every curated theme with lucide icons", () => {
    for (const name of Object.keys(CURATED_THEMES)) {
      const code = resolvePresetCode(name);
      expect(isPresetCode(code)).toBe(true);
      expect(decodePreset(code)?.iconLibrary).toBe("lucide");
    }
  });

  it("keeps curated values", () => {
    const config = decodePreset(resolvePresetCode("emerald-mist"));
    expect(config).toMatchObject({ style: "maia", baseColor: "mist", theme: "emerald", font: "inter" });
  });

  it("produces valid random presets that always use lucide", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const code = resolvePresetCode("random", seeded(seed));
      expect(decodePreset(code)?.iconLibrary).toBe("lucide");
      expect(decodePreset(code)?.baseColor).not.toBe("gray");
    }
  });

  it("rejects the gray base color, which the registry doesn't serve", () => {
    expect(() => resolvePresetCode(encodePreset({ baseColor: "gray" }))).toThrow(/gray/);
  });

  it("accepts a raw code and a shadcn create URL", () => {
    const code = resolvePresetCode("emerald-mist");
    expect(resolvePresetCode(code)).toBe(code);
    expect(resolvePresetCode(presetUrl(code))).toBe(code);
  });

  it("forces lucide on a pasted preset", () => {
    const code = resolvePresetCode("b7Br7G7Ci");
    expect(decodePreset(code)?.iconLibrary).toBe("lucide");
  });

  it("rejects unknown input", () => {
    expect(() => resolvePresetCode("not a theme")).toThrow();
  });
});

describe("randomPresetConfig", () => {
  it("is deterministic for a given random source", () => {
    expect(randomPresetConfig(seeded(7))).toEqual(randomPresetConfig(seeded(7)));
  });
});

describe("describePreset", () => {
  it("summarizes a preset", () => {
    expect(describePreset(resolvePresetCode("amber-editorial"))).toBe(
      "vega / amber on stone / public-sans + lora / radius small",
    );
  });
});
