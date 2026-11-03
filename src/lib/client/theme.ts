/**
 * Theme resolution shared by the inline boot script and the toggle: a saved choice
 * ("light" | "dark") wins, otherwise follow the system preference.
 */
export const THEME_KEY = "theme";

export function applyTheme(saved: string | null) {
  const theme = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
}

/** Inline <head> script: runs before paint and keeps following the system while no choice is saved. */
export const themeBootScript = `(function(){var k=${JSON.stringify(THEME_KEY)};function s(){try{return localStorage.getItem(k)}catch(e){return null}}
var apply=${applyTheme.toString()};apply(s());
matchMedia('(prefers-color-scheme: light)').addEventListener('change',function(){apply(s())})})()`;
