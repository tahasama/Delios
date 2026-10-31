"use client";

import { useEffect, useState } from "react";

/** Whether the app is in dark mode now (the `dark` class on the page), following every change of theme. */
export function useDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => watch.disconnect();
  }, []);
  return dark;
}
