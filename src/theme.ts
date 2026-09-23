import {
  PRESET_BASE_COLORS,
  PRESET_MENU_ACCENTS,
  PRESET_RADII,
  PRESET_STYLES,
  decodePreset,
  encodePreset,
  isPresetCode,
  type PresetConfig,
} from "shadcn/preset";

/**
 * Named starting points. Every preset keeps lucide icons because the generated
 * app imports `lucide-react` directly; switching icon libraries would break it.
 */
export const CURATED_THEMES = {
  "emerald-mist": {
    style: "maia",
    baseColor: "mist",
    theme: "emerald",
    chartColor: "mist",
    font: "inter",
    fontHeading: "inherit",
    radius: "medium",
  },
  "violet-terminal": {
    style: "lyra",
    baseColor: "zinc",
    theme: "violet",
    chartColor: "violet",
    font: "jetbrains-mono",
    fontHeading: "inherit",
    radius: "none",
  },
  "amber-editorial": {
    style: "vega",
    baseColor: "stone",
    theme: "amber",
    chartColor: "amber",
    font: "public-sans",
    fontHeading: "lora",
    radius: "small",
  },
  "sky-grotesk": {
    style: "nova",
    baseColor: "neutral",
    theme: "sky",
    chartColor: "blue",
    font: "space-grotesk",
    fontHeading: "inherit",
    radius: "large",
  },
  "rose-taupe": {
    style: "mira",
    baseColor: "taupe",
    theme: "rose",
    chartColor: "rose",
    font: "figtree",
    fontHeading: "instrument-serif",
    radius: "medium",
  },
} satisfies Record<string, Partial<PresetConfig>>;

export type CuratedThemeName = keyof typeof CURATED_THEMES;

const ACCENT_THEMES = [
  "amber", "blue", "cyan", "emerald", "fuchsia", "green", "indigo", "lime", "orange",
  "pink", "purple", "red", "rose", "sky", "teal", "violet", "yellow",
] as const satisfies readonly PresetConfig["theme"][];

const BODY_FONTS = [
  "inter", "geist", "figtree", "dm-sans", "manrope", "outfit", "public-sans",
  "ibm-plex-sans", "instrument-sans", "space-grotesk", "nunito-sans", "jetbrains-mono",
] as const satisfies readonly PresetConfig["font"][];

const HEADING_FONTS = [
  "inherit", "inherit", "inherit", "lora", "instrument-serif", "playfair-display", "eb-garamond",
] as const satisfies readonly PresetConfig["fontHeading"][];

/** shadcn/preset lists `gray`, but the registry rejects it with a 400. */
const UNSUPPORTED_BASE_COLORS: readonly string[] = ["gray"];

const BASE_COLORS = PRESET_BASE_COLORS.filter((color) => !UNSUPPORTED_BASE_COLORS.includes(color));

type RandomSource = () => number;

function pick<T>(values: readonly T[], random: RandomSource): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error("Cannot pick from an empty list.");
  return value;
}

/** A random but coherent preset: an accent theme on a neutral base, a readable body font. */
export function randomPresetConfig(random: RandomSource = Math.random): Partial<PresetConfig> {
  const theme = pick(ACCENT_THEMES, random);
  return {
    style: pick(PRESET_STYLES, random),
    baseColor: pick(BASE_COLORS, random),
    theme,
    chartColor: random() < 0.5 ? theme : pick(ACCENT_THEMES, random),
    iconLibrary: "lucide",
    font: pick(BODY_FONTS, random),
    fontHeading: pick(HEADING_FONTS, random),
    radius: pick(PRESET_RADII, random),
    menuAccent: pick(PRESET_MENU_ACCENTS, random),
    menuColor: "default",
  };
}

export function isCuratedTheme(value: string): value is CuratedThemeName {
  return Object.hasOwn(CURATED_THEMES, value);
}

/** Accepts `random`, a curated theme name, a preset code, or a ui.shadcn.com/create URL. */
export function resolvePresetCode(input: string, random: RandomSource = Math.random): string {
  const value = input.trim();
  if (value === "random") return encodePreset(randomPresetConfig(random));
  if (isCuratedTheme(value)) return encodePreset({ ...CURATED_THEMES[value], iconLibrary: "lucide" });

  const code = presetCodeFromUrl(value) ?? value;
  const config = isPresetCode(code) ? decodePreset(code) : null;
  if (!config) {
    throw new Error(
      `"${input}" is not a theme. Use "random", one of ${Object.keys(CURATED_THEMES).join(", ")}, or a preset code from https://ui.shadcn.com/create.`,
    );
  }
  if (UNSUPPORTED_BASE_COLORS.includes(config.baseColor)) {
    throw new Error(
      `The shadcn registry doesn't serve the "${config.baseColor}" base color yet. Pick another base color in https://ui.shadcn.com/create.`,
    );
  }
  if (config.iconLibrary !== "lucide") {
    return encodePreset({ ...config, iconLibrary: "lucide" });
  }
  return code;
}

function presetCodeFromUrl(value: string): string | undefined {
  if (!/^https?:\/\//.test(value)) return undefined;
  return new URL(value).searchParams.get("preset") ?? undefined;
}

export function describePreset(code: string): string {
  const config = decodePreset(code);
  if (!config) return code;
  const heading = config.fontHeading === "inherit" ? "" : ` + ${config.fontHeading}`;
  return `${config.style} / ${config.theme} on ${config.baseColor} / ${config.font}${heading} / radius ${config.radius}`;
}

export function presetUrl(code: string): string {
  return `https://ui.shadcn.com/create?preset=${code}`;
}

export const THEMING_DOCS_URL = "https://ui.shadcn.com/docs/theming";

/** How the generated app and docs describe its theme: a preset, or a CSS file merged over the base preset. */
export interface ThemeInfo {
  label: string;
  url: string;
  linkLabel: string;
  /** Ends the home page description: "themed with ...". */
  source: string;
}

export function themeInfo(config: { presetCode: string; themeCss?: string | undefined }): ThemeInfo {
  if (config.themeCss) {
    const file = config.themeCss.split(/[\\/]/).at(-1) ?? config.themeCss;
    return { label: `Custom theme from ${file}`, url: THEMING_DOCS_URL, linkLabel: "Theming guide", source: "your own theme CSS" };
  }
  return {
    label: describePreset(config.presetCode),
    url: presetUrl(config.presetCode),
    linkLabel: `Open preset ${config.presetCode}`,
    source: "your shadcn preset",
  };
}
