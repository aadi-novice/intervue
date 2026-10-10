/**
 * Default brand seed color. Later this becomes an org setting (white-label),
 * so nothing outside `app/theme/` should reference raw colors.
 */
export const DEFAULT_SEED = "#4F5BD5";

/**
 * Source colors for semantic extension roles. They are harmonised towards the
 * seed with `Blend.harmonize` so they sit comfortably in any org palette.
 */
export const EXTENSION_SOURCES = {
  ai: "#8B5CF6",
  "match-strong": "#1E9E5A",
  "match-medium": "#C88A04",
  "match-weak": "#D03E55",
} as const;

export type ExtensionColorName = keyof typeof EXTENSION_SOURCES;
