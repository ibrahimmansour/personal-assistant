"use client";

/**
 * Touch gesture hooks built on Pointer Events (works for touch + mouse + trackpad).
 *
 * Three primitives:
 *   - useEdgeSwipe  → drag-from-screen-edge to open a drawer/panel
 *   - useSwipe      → directional swipe on an element with threshold + velocity
 *   - useLongPress  → long-press detection on an element
 *
 * All hooks are no-ops above a configurable breakpoint (default md: 768px) so
 * desktop trackpads / mouse users are unaffected.
 *
 * Pointer Events were chosen over TouchEvent so the same code works for
 * touch, pen, and mouse without separate handlers.
 */

import { useEffect, useRef, useState } from "react";

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Returns true when viewport width is below the mobile breakpoint. */
function useIsMobile(maxWidth = 767): boolean {
  // Initialize from the matchMedia synchronously so we can avoid a
  // setState-inside-effect on first mount. SSR is safeguarded with the typeof
  // window check.
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [maxWidth]);
  return isMobile;
}

/** True when the event target lies inside an interactive control we shouldn't hijack. */
function isInsideInteractive(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return !!el.closest(
    'input, textarea, select, [contenteditable="true"], .xterm, .xterm-screen, .ProseMirror, [data-no-swipe], .react-grid-item.react-draggable-dragging, [role="slider"]'
  );
}

/** True when the event target is inside an element that scrolls horizontally. */
function isInsideHorizontalScroller(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    const overflowX = style.overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      cur.scrollWidth > cur.clientWidth + 1
    ) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

/** True when the event target is inside an element that scrolls vertically AND is not yet at the top. */
function isInsideVerticalScroller(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      cur.scrollHeight > cur.clientHeight + 1
    ) {
      // Only consider it "blocking" the swipe if the user has scrolled away
      // from the top — at the top we want a swipe-down to dismiss.
      if (cur.scrollTop > 0) return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

// ─── Multi-touch guard ──────────────────────────────────────────────────────

/**
 * Live touch/pen pointer ids, tracked window-wide in the capture phase so a
 * gesture hook always sees a second finger land before its own handlers run.
 *
 * Every hook below bails out while more than one pointer is down: a two-finger
 * gesture belongs to the browser (pinch-zoom), not to our swipe/long-press
 * handlers. Without this a pinch inside an expanded widget reads as a
 * one-finger swipe — the card drags away and the widget dismisses instead of
 * zooming — and an edge-started pinch hits `preventDefault()` in useEdgeSwipe,
 * which cancels the zoom outright.
 */
const activePointers = new Set<number>();
let pointerTrackers = 0;

function handleGlobalPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse") return;
  // A primary pointer means no other finger is down, so anything still in the
  // set leaked (pointerup is missed when an element is removed mid-gesture).
  if (e.isPrimary) activePointers.clear();
  activePointers.add(e.pointerId);
}

function handleGlobalPointerEnd(e: PointerEvent) {
  activePointers.delete(e.pointerId);
}

/** Ref-counted subscription to the window-wide pointer tracker. */
function trackPointers(): () => void {
  if (pointerTrackers++ === 0) {
    window.addEventListener("pointerdown", handleGlobalPointerDown, { passive: true, capture: true });
    window.addEventListener("pointerup", handleGlobalPointerEnd, { passive: true, capture: true });
    window.addEventListener("pointercancel", handleGlobalPointerEnd, { passive: true, capture: true });
  }
  return () => {
    if (--pointerTrackers === 0) {
      window.removeEventListener("pointerdown", handleGlobalPointerDown, { capture: true });
      window.removeEventListener("pointerup", handleGlobalPointerEnd, { capture: true });
      window.removeEventListener("pointercancel", handleGlobalPointerEnd, { capture: true });
      activePointers.clear();
    }
  };
}

/** True while more than one finger is on the screen (pinch/rotate in progress). */
function isMultiTouch(): boolean {
  return activePointers.size > 1;
}

// ─── useEdgeSwipe ───────────────────────────────────────────────────────────

export interface UseEdgeSwipeOptions {
  /** Screen edge to track. */
  edge: "left" | "right";
  /** Pixel width of the live edge-trigger zone. */
  edgeWidth?: number;
  /** Callback fired with live progress 0..1 while the user is dragging. */
  onProgress?: (progress: number) => void;
  /** Callback fired when the user completes the swipe past the threshold. */
  onOpen?: () => void;
  /** Pixel distance required to register as an "open". */
  threshold?: number;
  /** Whether the hook should be active. Pass false to temporarily disable. */
  enabled?: boolean;
}

/**
 * Edge-swipe handler — listens on `window` for pointer-down within `edgeWidth`
 * pixels of the chosen edge, tracks the drag, and invokes onOpen() once the
 * user crosses the threshold.
 *
 * Use `onProgress` to drive a live drawer-follow-finger animation if desired.
 */
export function useEdgeSwipe({
  edge,
  edgeWidth = 24,
  onProgress,
  onOpen,
  threshold = 60,
  enabled = true,
}: UseEdgeSwipeOptions) {
  const isMobile = useIsMobile();
  const startRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const decidedRef = useRef<"horizontal" | "vertical" | null>(null);

  const onProgressRef = useRef(onProgress);
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onProgressRef.current = onProgress; });
  useEffect(() => { onOpenRef.current = onOpen; });

  useEffect(() => {
    if (!enabled || !isMobile) return;
    const untrack = trackPointers();

    function abort() {
      startRef.current = null;
      decidedRef.current = null;
      onProgressRef.current?.(0);
    }

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse") return; // only touch/pen
      // Second finger down — hand the gesture back to the browser (pinch-zoom).
      if (isMultiTouch()) {
        abort();
        return;
      }
      const w = window.innerWidth;
      const inEdge =
        edge === "left" ? e.clientX <= edgeWidth : e.clientX >= w - edgeWidth;
      if (!inEdge) return;
      if (isInsideInteractive(e.target)) return;
      startRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      decidedRef.current = null;
    }

    function handlePointerMove(e: PointerEvent) {
      if (!startRef.current) return;
      if (e.pointerId !== startRef.current.id) return;
      if (isMultiTouch()) {
        abort();
        return;
      }
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      if (decidedRef.current === null) {
        // Decide axis after 8px of movement
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decidedRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
      if (decidedRef.current !== "horizontal") {
        // User is scrolling vertically, abandon
        startRef.current = null;
        onProgressRef.current?.(0);
        return;
      }

      // Only count motion in the "opening" direction
      const opening = edge === "left" ? dx : -dx;
      if (opening <= 0) {
        onProgressRef.current?.(0);
        return;
      }
      // Prevent the page from scrolling once we've committed to horizontal
      e.preventDefault();
      const progress = Math.min(1, opening / threshold);
      onProgressRef.current?.(progress);
    }

    function handlePointerUp(e: PointerEvent) {
      if (!startRef.current) return;
      if (e.pointerId !== startRef.current.id) return;
      const dx = e.clientX - startRef.current.x;
      const opening = edge === "left" ? dx : -dx;
      const elapsed = Date.now() - startRef.current.t;
      const velocity = opening / Math.max(1, elapsed); // px/ms
      const passed = opening > threshold || velocity > 0.4;
      startRef.current = null;
      decidedRef.current = null;
      onProgressRef.current?.(0);
      if (passed) onOpenRef.current?.();
    }

    function handlePointerCancel() {
      startRef.current = null;
      decidedRef.current = null;
      onProgressRef.current?.(0);
    }

    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      untrack();
    };
  }, [edge, edgeWidth, threshold, enabled, isMobile]);
}

// ─── useSwipe ───────────────────────────────────────────────────────────────

export interface UseSwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** Live progress 0..1 in the dominant direction (handy for transient overlays). */
  onProgress?: (info: { dx: number; dy: number; axis: "horizontal" | "vertical" | null }) => void;
  /** Min pixel distance to register a swipe. */
  threshold?: number;
  /** Min velocity (px/ms) that qualifies as a flick even below threshold. */
  velocityThreshold?: number;
  /** When true, the swipe handler is disabled. */
  disabled?: boolean;
  /** Pixels from the edge of the bound element where pointer-down is *ignored* (avoids conflicts with edge-swipes). */
  edgeExclusion?: number;
  /** Restrict to one axis. */
  axis?: "horizontal" | "vertical" | "both";
  /** Skip swipes that begin inside an element that scrolls along the gesture axis. */
  ignoreOnScrollers?: boolean;
}

/**
 * Generic directional-swipe handler bound to a ref.
 * Returns a ref to attach to the target element (or pass an existing one via opts).
 */
export function useSwipe<T extends HTMLElement = HTMLDivElement>(
  options: UseSwipeOptions
) {
  const isMobile = useIsMobile();
  const ref = useRef<T | null>(null);
  const optsRef = useRef(options);
  useEffect(() => { optsRef.current = options; });

  useEffect(() => {
    if (!isMobile) return;
    const el = ref.current;
    if (!el) return;
    const untrack = trackPointers();

    let start: { x: number; y: number; t: number; id: number } | null = null;
    let decided: "horizontal" | "vertical" | null = null;

    function abort() {
      start = null;
      decided = null;
      optsRef.current.onProgress?.({ dx: 0, dy: 0, axis: null });
    }

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse") return;
      if (optsRef.current.disabled) return;
      // Second finger down — the browser owns this gesture (pinch-zoom).
      if (isMultiTouch()) {
        abort();
        return;
      }
      if (isInsideInteractive(e.target)) return;
      // Allow nested swipe handlers to opt out of an ancestor's swipe by
      // marking themselves with [data-swipe-stop].
      if (
        e.target instanceof Element &&
        e.target.closest("[data-swipe-stop]") &&
        el &&
        !el.hasAttribute("data-swipe-stop")
      ) {
        // Pointer-down landed inside a child that has its own swipe handler;
        // skip this ancestor.
        return;
      }
      const exclusion = optsRef.current.edgeExclusion ?? 0;
      if (exclusion > 0 && el) {
        const rect = el.getBoundingClientRect();
        if (
          e.clientX - rect.left < exclusion ||
          rect.right - e.clientX < exclusion
        ) {
          return;
        }
      }
      start = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      decided = null;
    }

    function handlePointerMove(e: PointerEvent) {
      if (!start) return;
      if (e.pointerId !== start.id) return;
      if (isMultiTouch()) {
        abort();
        return;
      }
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (decided === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        decided = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
        // Bail out if axis disabled
        const axis = optsRef.current.axis ?? "both";
        if (axis !== "both" && axis !== decided) {
          start = null;
          return;
        }
        // Bail if start was inside a scroller along the active axis
        if (optsRef.current.ignoreOnScrollers) {
          if (decided === "horizontal" && isInsideHorizontalScroller(e.target)) {
            start = null;
            return;
          }
          if (decided === "vertical" && isInsideVerticalScroller(e.target)) {
            start = null;
            return;
          }
        }
      }
      optsRef.current.onProgress?.({ dx, dy, axis: decided });
    }

    function handlePointerUp(e: PointerEvent) {
      if (!start) return;
      if (e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const elapsed = Date.now() - start.t;
      const threshold = optsRef.current.threshold ?? 60;
      const vth = optsRef.current.velocityThreshold ?? 0.5;
      start = null;
      decided = null;
      optsRef.current.onProgress?.({ dx: 0, dy: 0, axis: null });

      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax > ay) {
        const v = ax / Math.max(1, elapsed);
        if (ax > threshold || v > vth) {
          if (dx > 0) optsRef.current.onSwipeRight?.();
          else optsRef.current.onSwipeLeft?.();
        }
      } else {
        const v = ay / Math.max(1, elapsed);
        if (ay > threshold || v > vth) {
          if (dy > 0) optsRef.current.onSwipeDown?.();
          else optsRef.current.onSwipeUp?.();
        }
      }
    }

    function handlePointerCancel() {
      start = null;
      decided = null;
      optsRef.current.onProgress?.({ dx: 0, dy: 0, axis: null });
    }

    el.addEventListener("pointerdown", handlePointerDown, { passive: true });
    el.addEventListener("pointermove", handlePointerMove, { passive: true });
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("pointercancel", handlePointerCancel);
      untrack();
    };
  }, [isMobile]);

  return ref;
}

// ─── useLongPress ───────────────────────────────────────────────────────────

export interface UseLongPressOptions {
  onLongPress: () => void;
  /** Hold duration in ms before firing. */
  ms?: number;
  /** Cancel if the pointer moves more than this many pixels. */
  moveTolerance?: number;
  disabled?: boolean;
}

export function useLongPress<T extends HTMLElement = HTMLDivElement>(
  options: UseLongPressOptions
) {
  const isMobile = useIsMobile();
  const ref = useRef<T | null>(null);
  const optsRef = useRef(options);
  useEffect(() => { optsRef.current = options; });

  useEffect(() => {
    if (!isMobile) return;
    const el = ref.current;
    if (!el) return;
    const untrack = trackPointers();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let fired = false;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse") return;
      if (optsRef.current.disabled) return;
      // A pinch is not a long press — drop any pending timer and stay out.
      if (isMultiTouch()) {
        clear();
        return;
      }
      if (isInsideInteractive(e.target)) return;
      startX = e.clientX;
      startY = e.clientY;
      fired = false;
      clear();
      timer = setTimeout(() => {
        fired = true;
        timer = null;
        // Haptic feedback on supported devices
        if ("vibrate" in navigator) {
          try { navigator.vibrate(8); } catch { /* noop */ }
        }
        optsRef.current.onLongPress();
      }, optsRef.current.ms ?? 500);
    }

    function handlePointerMove(e: PointerEvent) {
      if (!timer) return;
      if (isMultiTouch()) {
        clear();
        return;
      }
      const tol = optsRef.current.moveTolerance ?? 8;
      if (Math.abs(e.clientX - startX) > tol || Math.abs(e.clientY - startY) > tol) {
        clear();
      }
    }

    function handlePointerUp() {
      clear();
    }

    function handleContextMenu(e: Event) {
      // If we just fired a long-press, suppress the native context menu.
      if (fired) e.preventDefault();
    }

    el.addEventListener("pointerdown", handlePointerDown, { passive: true });
    el.addEventListener("pointermove", handlePointerMove, { passive: true });
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("pointercancel", handlePointerUp);
    el.addEventListener("contextmenu", handleContextMenu);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("pointercancel", handlePointerUp);
      el.removeEventListener("contextmenu", handleContextMenu);
      clear();
      untrack();
    };
  }, [isMobile]);

  return ref;
}

// ─── Convenience: expose useIsMobile so call sites can branch UI ─────────────

export { useIsMobile };
