"use client";

/**
 * App-level pinch-zoom for installed PWAs.
 *
 * In a normal mobile browser tab nothing extra is needed: the viewport meta
 * ships `user-scalable=yes` with no `maximum-scale`, and every full-viewport
 * surface pairs `touch-pan-y` with `touch-pinch-zoom`, so the browser's own
 * pinch-zoom works. Installed PWAs are the gap this hook fills — Chrome's
 * WebAPK (`display-mode: standalone`) and iOS home-screen apps
 * (`navigator.standalone`) turn the browser's page zoom off entirely, so the
 * viewport meta and the touch-action pairings have nothing left to enable and
 * pinching does literally nothing.
 *
 * The zoom is applied as CSS `zoom` on <html>, not `transform: scale`. `zoom`
 * reflows the layout at the new scale, so the content keeps fitting the
 * viewport width (no pan affordance to build), inner scrollers keep working,
 * and text re-rasterizes crisply instead of being magnified as a bitmap.
 *
 * Listeners are passive and never call preventDefault(). The surfaces being
 * pinched declare `touch-action: pan-y pinch-zoom`, which in standalone — with
 * pinch-zoom unavailable — reduces to `pan-y`, and a pan the browser is already
 * permitted to run cannot be cancelled from JS. A two-finger drag may therefore
 * scroll the surface underneath as well; ENGAGE_PX below keeps an incidental
 * two-finger scroll from registering as a zoom.
 *
 * Distances are measured with `screenX`/`screenY` rather than `clientX`/
 * `clientY`: client coordinates are CSS pixels of the zoomed document, so
 * feeding them back into the scale calculation while we mutate `zoom` would
 * make the gesture chase itself.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "pa-app-zoom";

/**
 * Zoom-out floor. The mobile/desktop split is a 768px media query against the
 * *zoomed* viewport width, so zooming out too far would flip a phone into the
 * desktop layout (and mount react-grid-layout) mid-gesture. 0.8 keeps every
 * common phone width below the breakpoint.
 */
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 3;

/** Finger-distance change (device px) required before a two-finger drag counts as a pinch. */
const ENGAGE_PX = 12;

/** Snap back to exactly 1 inside this band so the default state is reachable. */
const SNAP_EPSILON = 0.06;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** True when the app runs without browser chrome, where native page zoom is disabled. */
function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  return ["standalone", "fullscreen", "minimal-ui"].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
  );
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY);
}

function readStoredZoom(): number {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? clampZoom(parsed) : 1;
}

export interface UsePinchZoomResult {
  /** Current zoom factor (1 = unzoomed). */
  zoom: number;
  /** True while two fingers are actively driving the zoom. */
  pinching: boolean;
  /** True when this hook owns zooming (installed PWA on a phone). */
  active: boolean;
  /** Return to 1x. */
  reset: () => void;
}

/**
 * Drives CSS `zoom` on <html> from a two-finger pinch. No-op unless the app is
 * running standalone on a phone-sized viewport — in a browser tab the native
 * gesture already works and doubling up would compound the two scales.
 */
export function usePinchZoom(maxWidth = 767): UsePinchZoomResult {
  const [active, setActive] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pinching, setPinching] = useState(false);

  // Live zoom for the gesture math; state lags behind by a render.
  const zoomRef = useRef(1);
  const gestureRef = useRef<{
    startDistance: number;
    startZoom: number;
    engaged: boolean;
  } | null>(null);

  /**
   * Push a zoom factor to the DOM. Deliberately does not touch React state:
   * restoring the persisted zoom on mount would otherwise cascade a render out
   * of the effect body for a value only the badge ever reads.
   */
  const writeZoom = useCallback((next: number) => {
    const value = clampZoom(next);
    zoomRef.current = value;
    document.documentElement.style.setProperty("--app-zoom", String(value));
    return value;
  }, []);

  /** Same, but publishes the value for the live percentage readout. */
  const applyZoom = useCallback(
    (next: number) => setZoom(writeZoom(next)),
    [writeZoom]
  );

  const reset = useCallback(() => {
    applyZoom(1);
    window.localStorage.setItem(STORAGE_KEY, "1");
  }, [applyZoom]);

  // Decide whether this hook is in charge, and track the viewport crossing the
  // mobile breakpoint (a rotation into tablet width hands zooming back).
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const evaluate = () => setActive(mql.matches && isStandaloneDisplay());
    evaluate();
    mql.addEventListener("change", evaluate);
    return () => mql.removeEventListener("change", evaluate);
  }, [maxWidth]);

  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      // Hand zooming back to the browser: drop both the class and the variable
      // so nothing lingers if the viewport widens or the app opens in a tab.
      root.classList.remove("app-zoom");
      root.style.removeProperty("--app-zoom");
      zoomRef.current = 1;
      return;
    }

    root.classList.add("app-zoom");
    writeZoom(readStoredZoom());

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) {
        gestureRef.current = null;
        return;
      }
      gestureRef.current = {
        startDistance: touchDistance(e.touches[0], e.touches[1]),
        startZoom: zoomRef.current,
        engaged: false,
      };
    }

    function handleTouchMove(e: TouchEvent) {
      const gesture = gestureRef.current;
      if (!gesture || e.touches.length !== 2) return;
      const distance = touchDistance(e.touches[0], e.touches[1]);
      if (!gesture.engaged) {
        if (Math.abs(distance - gesture.startDistance) < ENGAGE_PX) return;
        gesture.engaged = true;
        setPinching(true);
      }
      if (gesture.startDistance <= 0) return;
      const raw = gesture.startZoom * (distance / gesture.startDistance);
      const snapped = Math.abs(raw - 1) < SNAP_EPSILON ? 1 : raw;
      applyZoom(Math.round(snapped * 100) / 100);
    }

    function handleTouchEnd(e: TouchEvent) {
      if (e.touches.length >= 2) return;
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture?.engaged) return;
      setPinching(false);
      window.localStorage.setItem(STORAGE_KEY, String(zoomRef.current));
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      gestureRef.current = null;
    };
  }, [active, applyZoom, writeZoom]);

  return { zoom, pinching, active, reset };
}
