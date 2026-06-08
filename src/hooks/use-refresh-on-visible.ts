"use client";

import { useEffect } from "react";
import { TAB_VISIBLE_EVENT, type TabVisibleDetail } from "./use-keep-alive";

/**
 * Runs a callback when the browser tab becomes visible again after being hidden.
 *
 * @param callback - Invoked with the duration (ms) the tab was hidden.
 *                   Only fires if the tab was hidden for at least `minHiddenMs`.
 * @param minHiddenMs - Minimum hidden duration before firing (default: 30 000 ms = 30s).
 *                      This avoids unnecessary refetches for quick alt-tabs.
 */
export function useRefreshOnVisible(
  callback: (hiddenDuration: number) => void,
  minHiddenMs = 30_000
) {
  useEffect(() => {
    function handleTabVisible(e: Event) {
      const { hiddenDuration } = (e as CustomEvent<TabVisibleDetail>).detail;
      if (hiddenDuration >= minHiddenMs) {
        callback(hiddenDuration);
      }
    }

    window.addEventListener(TAB_VISIBLE_EVENT, handleTabVisible);
    return () => {
      window.removeEventListener(TAB_VISIBLE_EVENT, handleTabVisible);
    };
  }, [callback, minHiddenMs]);
}
