"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { PREF, savePreference } from "@/lib/core/preferences";
import { TOOL } from "./top-tools";

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

export function ThemeToggle() {
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

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        savePreference(PREF.theme, next);
        apply(next);
      }}
      title={`Theme: ${LABEL[theme]} — switch to ${LABEL[next]}`}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
      className={TOOL}
    >
      <Icon className="h-4.5 w-4.5" />
    </button>
  );
}
