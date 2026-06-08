"use client";

import { useEffect } from "react";

/**
 * Custom event fired on `window` when the browser tab becomes visible again
 * after being hidden. Widgets can listen for this to refresh stale data or
 * reconnect dropped WebSocket connections.
 *
 * The event detail contains the duration (ms) the tab was hidden.
 */
export const TAB_VISIBLE_EVENT = "app:tab-visible";

export interface TabVisibleDetail {
  /** How long the tab was hidden, in milliseconds */
  hiddenDuration: number;
}

/**
 * Prevents Chrome (and other Chromium browsers) from aggressively throttling
 * this tab when it goes into the background.
 *
 * Two mechanisms are used:
 *
 * 1. **Web Locks API** – Holding an exclusive lock signals to the browser that
 *    the tab is doing meaningful work. Chrome will not apply "intensive
 *    throttling" (1 timer wake-up per minute after 5 min) to tabs holding a
 *    Web Lock.
 *
 * 2. **Page Visibility API** – When the tab becomes visible again, a custom
 *    `app:tab-visible` event is dispatched on `window` so that widgets can
 *    immediately refresh stale data or reconnect lost WebSocket connections.
 *
 * Usage: Call once in a top-level component (e.g. MainContent in page.tsx).
 */
export function useKeepAlive() {
  // --- Web Lock (prevents throttling) ---
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.locks) return;

    const controller = new AbortController();

    // Request a lock that is never released while the page is alive.
    // The lock holds an unresolved promise, keeping it active indefinitely.
    navigator.locks.request(
      "personal-assistant-keep-alive",
      { signal: controller.signal },
      () => new Promise<void>(() => {}) // never resolves → lock held forever
    ).catch(() => {
      // AbortError on cleanup — expected, ignore
    });

    return () => {
      controller.abort();
    };
  }, []);

  // --- Page Visibility (reconnect on focus) ---
  useEffect(() => {
    let hiddenAt: number | null = null;

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (document.visibilityState === "visible") {
        const duration = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = null;

        // Dispatch a custom event that widgets can listen for
        window.dispatchEvent(
          new CustomEvent<TabVisibleDetail>(TAB_VISIBLE_EVENT, {
            detail: { hiddenDuration: duration },
          })
        );
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
