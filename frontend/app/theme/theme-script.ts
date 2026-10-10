export const THEME_STORAGE_KEY = "intervue-theme";

/**
 * Inline script executed in <head> before first paint: resolves the persisted
 * preference (light / dark / system) and sets the `.dark` / `.light` class on
 * <html> so there is no flash of the wrong theme.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var c=document.documentElement.classList;c.remove("light","dark");c.add(d?"dark":"light");document.documentElement.dataset.themePreference=p;}catch(e){}})();`;
