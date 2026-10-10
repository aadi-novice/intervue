import {
  argbFromHex,
  Blend,
  DynamicColor,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeExpressive,
  SchemeTonalSpot,
  TonalPalette,
} from "@material/material-color-utilities";
import { DEFAULT_SEED, EXTENSION_SOURCES, type ExtensionColorName } from "./seed";

export type SchemeVariant = "tonalSpot" | "expressive";

/** Map of CSS custom property name (without `--md-sys-color-`) → hex value. */
export type ColorTokens = Record<string, string>;

export interface GeneratedTheme {
  seed: string;
  variant: SchemeVariant;
  light: ColorTokens;
  dark: ColorTokens;
}

/** M3 system color roles we emit as `--md-sys-color-<role>`. */
const ROLES: Record<string, DynamicColor> = {
  primary: MaterialDynamicColors.primary,
  "on-primary": MaterialDynamicColors.onPrimary,
  "primary-container": MaterialDynamicColors.primaryContainer,
  "on-primary-container": MaterialDynamicColors.onPrimaryContainer,
  secondary: MaterialDynamicColors.secondary,
  "on-secondary": MaterialDynamicColors.onSecondary,
  "secondary-container": MaterialDynamicColors.secondaryContainer,
  "on-secondary-container": MaterialDynamicColors.onSecondaryContainer,
  tertiary: MaterialDynamicColors.tertiary,
  "on-tertiary": MaterialDynamicColors.onTertiary,
  "tertiary-container": MaterialDynamicColors.tertiaryContainer,
  "on-tertiary-container": MaterialDynamicColors.onTertiaryContainer,
  error: MaterialDynamicColors.error,
  "on-error": MaterialDynamicColors.onError,
  "error-container": MaterialDynamicColors.errorContainer,
  "on-error-container": MaterialDynamicColors.onErrorContainer,
  background: MaterialDynamicColors.background,
  "on-background": MaterialDynamicColors.onBackground,
  surface: MaterialDynamicColors.surface,
  "on-surface": MaterialDynamicColors.onSurface,
  "surface-variant": MaterialDynamicColors.surfaceVariant,
  "on-surface-variant": MaterialDynamicColors.onSurfaceVariant,
  "surface-dim": MaterialDynamicColors.surfaceDim,
  "surface-bright": MaterialDynamicColors.surfaceBright,
  "surface-container-lowest": MaterialDynamicColors.surfaceContainerLowest,
  "surface-container-low": MaterialDynamicColors.surfaceContainerLow,
  "surface-container": MaterialDynamicColors.surfaceContainer,
  "surface-container-high": MaterialDynamicColors.surfaceContainerHigh,
  "surface-container-highest": MaterialDynamicColors.surfaceContainerHighest,
  "surface-tint": MaterialDynamicColors.surfaceTint,
  outline: MaterialDynamicColors.outline,
  "outline-variant": MaterialDynamicColors.outlineVariant,
  "inverse-surface": MaterialDynamicColors.inverseSurface,
  "inverse-on-surface": MaterialDynamicColors.inverseOnSurface,
  "inverse-primary": MaterialDynamicColors.inversePrimary,
  scrim: MaterialDynamicColors.scrim,
  shadow: MaterialDynamicColors.shadow,
};

/** Tones used for custom (extension) color groups, matching M3 custom colors. */
const EXT_TONES = {
  light: { color: 40, on: 100, container: 90, onContainer: 10 },
  dark: { color: 80, on: 20, container: 30, onContainer: 90 },
} as const;

function buildScheme(seed: Hct, isDark: boolean, variant: SchemeVariant): DynamicScheme {
  return variant === "expressive"
    ? new SchemeExpressive(seed, isDark, 0)
    : new SchemeTonalSpot(seed, isDark, 0);
}

function extensionTokens(seedArgb: number, mode: "light" | "dark"): ColorTokens {
  const out: ColorTokens = {};
  const t = EXT_TONES[mode];
  for (const name of Object.keys(EXTENSION_SOURCES) as ExtensionColorName[]) {
    const harmonized = Blend.harmonize(argbFromHex(EXTENSION_SOURCES[name]), seedArgb);
    const palette = TonalPalette.fromInt(harmonized);
    out[name] = hexFromArgb(palette.tone(t.color));
    out[`on-${name}`] = hexFromArgb(palette.tone(t.on));
    out[`${name}-container`] = hexFromArgb(palette.tone(t.container));
    out[`on-${name}-container`] = hexFromArgb(palette.tone(t.onContainer));
  }
  return out;
}

function schemeTokens(scheme: DynamicScheme): ColorTokens {
  const out: ColorTokens = {};
  for (const [name, color] of Object.entries(ROLES)) {
    out[name] = hexFromArgb(color.getArgb(scheme));
  }
  return out;
}

/**
 * Generate M3 light + dark color tokens from a seed color.
 * Uses `SchemeTonalSpot` by default (`expressive` for marketing surfaces).
 */
export function generateTheme(
  seedHex: string = DEFAULT_SEED,
  variant: SchemeVariant = "tonalSpot",
): GeneratedTheme {
  const seedArgb = argbFromHex(seedHex);
  const seed = Hct.fromInt(seedArgb);
  return {
    seed: seedHex,
    variant,
    light: { ...schemeTokens(buildScheme(seed, false, variant)), ...extensionTokens(seedArgb, "light") },
    dark: { ...schemeTokens(buildScheme(seed, true, variant)), ...extensionTokens(seedArgb, "dark") },
  };
}

function declarations(tokens: ColorTokens): string {
  return Object.entries(tokens)
    .map(([k, v]) => `--md-sys-color-${k}:${v};`)
    .join("");
}

/**
 * Serialise a theme to CSS. Light tokens live on `:root` and `.light`, dark on
 * `.dark`, so any subtree can opt into either scheme (used by the gallery).
 */
export function themeToCss(theme: GeneratedTheme): string {
  return (
    `:root,.light{color-scheme:light;${declarations(theme.light)}}` +
    `.dark{color-scheme:dark;${declarations(theme.dark)}}`
  );
}

/** CSS for the default seed — computed once per server process. */
export const defaultThemeCss = themeToCss(generateTheme(DEFAULT_SEED));
