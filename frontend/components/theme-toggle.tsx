"use client";

import { IconButton, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, MenuLabel } from "@/components/m3";
import { useTheme, type ThemePreference } from "@/components/theme-provider";

/** Light / dark / system theme menu (persisted by ThemeProvider). */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon={resolvedTheme === "dark" ? "dark_mode" : "light_mode"} label="Theme" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
          <MenuRadioItem value="light">Light</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
          <MenuRadioItem value="system">System</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
