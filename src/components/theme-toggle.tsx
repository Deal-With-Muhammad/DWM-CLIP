"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const CHANGED = "dwm-clip-theme";

// The theme lives on <html data-theme> (set before the page draws, see app/layout.tsx). The button reads it from there.
const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
};
const isDark = () => document.documentElement.dataset.theme === "dark";

/** Switches between the light and dark theme, and remembers the choice on this device. Light is the default. */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-subtle"
      onClick={() => {
        if (dark) delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = "dark";
        try {
          localStorage.setItem(CHANGED, dark ? "light" : "dark");
        } catch {}
        window.dispatchEvent(new Event(CHANGED));
      }}
    >
      {dark ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </button>
  );
}
