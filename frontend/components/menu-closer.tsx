"use client";

import { useEffect } from "react";

/**
 * The top bar's menus (`<details data-menu>`: your name's menu, the project list) close as menus do: on picking
 * something in them, on Escape, and on a click anywhere outside. Mounted once in the app's layout; the menus stay
 * plain markup drawn on the server.
 */
export function MenuCloser() {
  useEffect(() => {
    const open = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]"));
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      for (const menu of open()) if (!menu.contains(target)) menu.open = false;
    };
    const onClick = (e: MouseEvent) => {
      const picked = (e.target as HTMLElement).closest("a, button[type=submit]");
      if (!picked) return;
      const menu = picked.closest<HTMLDetailsElement>("details[data-menu]");
      // After the click has done its work (a link followed, a form sent), the menu folds.
      if (menu) setTimeout(() => { menu.open = false; }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const menus = open();
      if (!menus.length) return;
      for (const menu of menus) menu.open = false;
      menus[0].querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
