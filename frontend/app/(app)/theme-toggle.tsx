"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { PREF, savePreference } from "@/lib/core/preferences";

type Theme = "light" | "dark" | "system";
const ORDER: Theme[] = ["light", "dark", "system"];
const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "Same as device" };

/**
 * Applies the theme to <html> and keeps it in cookies. The server reads them
 * (app/layout.tsx) and sends the next page already in this theme. For "Same as
 * device" it also notes whether the device is dark now.
 */
function apply(theme: Theme) {
  const deviceDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && deviceDark));
  savePreference(PREF.deviceDark, deviceDark ? "1" : "0");
}

function savedTheme(): Theme {
  const found = document.cookie.split("; ").find((one) => one.startsWith(`${PREF.theme}=`))?.split("=")[1] as Theme | undefined;
  return found && ORDER.includes(found) ? found : "system";
}

/** Light · Dark · Same as device, three plain choices in the account menu (owner: not a cycling button in the bar). */
export function ThemeChoice() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = savedTheme();
    setTheme(saved);
    apply(saved);
  }, []);

  // Follow the device while on "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div role="group" aria-label="Theme" className="seg flex w-full">
      {ORDER.map((one) => {
        const Icon = one === "dark" ? Moon : one === "light" ? Sun : Monitor;
        return (
          <button
            key={one}
            type="button"
            aria-pressed={theme === one}
            onClick={() => {
              setTheme(one);
              savePreference(PREF.theme, one);
              apply(one);
            }}
            className="segment flex-1 justify-center gap-1 px-2 text-xs"
          >
            <Icon className="h-3.5 w-3.5" />
            {LABEL[one]}
          </button>
        );
      })}
    </div>
  );
}
