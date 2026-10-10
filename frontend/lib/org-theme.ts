import { generateTheme, themeToCss, DEFAULT_SEED } from "@/app/theme";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Re-generates the M3 tokens from an org seed colour and swaps the root style element live. */
export function applyOrgTheme(seed: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("md-sys-color");
  if (!el) return;
  const hex = seed && HEX.test(seed) ? seed : DEFAULT_SEED;
  el.textContent = themeToCss(generateTheme(hex));
}
