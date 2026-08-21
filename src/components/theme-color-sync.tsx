"use client";

import { useEffect } from "react";

/**
 * Keeps `<meta name="theme-color">` on the actual page background.
 *
 * The tag drives the system chrome an installed PWA draws behind — the Android
 * status bar and the iOS scroll-past-the-end overscroll area. A static pair of
 * `prefers-color-scheme` values can't track this app: the theme is class-driven
 * (next-themes light/dark/system) *and* the accent picker swaps `--background`
 * to nine different values, so the OS preference alone says nothing about what
 * is on screen. A user on a dark OS who picks the light theme got a black
 * status bar sitting on a white page.
 *
 * Reading the resolved background off the DOM rather than mapping every theme
 * to a hex literal means new accents need no entry here. The read happens in an
 * effect (never during render) on a MutationObserver for the `class` attribute,
 * which is exactly what both next-themes and the appearance provider mutate.
 */
export function ThemeColorSync() {
  useEffect(() => {
    const html = document.documentElement;

    const sync = () => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!meta) return;
      const bg = getComputedStyle(document.body).backgroundColor;
      // Skip the transparent/empty result some browsers report before the
      // stylesheet has applied — leaving the previous value beats a flash.
      if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") return;
      if (meta.content !== bg) meta.content = bg;
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
