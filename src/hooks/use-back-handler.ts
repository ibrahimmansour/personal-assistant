"use client";

/**
 * History-backed dismissal for overlay surfaces.
 *
 * The app is a single page with a single history entry, so on a phone the
 * system back gesture (Android) or the browser/PWA back button had nothing to
 * pop: it walked straight out of the app even with an expanded widget, the AI
 * panel or the sidebar drawer covering the screen. Every dismissible surface
 * registers a *layer* here instead. Opening one pushes a history entry;
 * pressing back pops the topmost layer and calls its `onBack` rather than
 * leaving the app.
 *
 * The layer stack is module-level and LIFO so nesting works: expand a widget,
 * open an email inside it, and two backs undo them in order.
 *
 * Closing a surface by its own control (the X button, Escape, swipe-to-dismiss)
 * has to unwind the matching history entry too, otherwise back would replay a
 * navigation the user already undid. That is what the effect cleanup does with
 * `history.go()`; `pendingProgrammatic` marks those pops as ours so the
 * popstate listener doesn't treat them as a user gesture and dismiss a second
 * layer.
 */

import { useEffect, useRef } from "react";

interface BackLayer {
  id: number;
  onBack: () => void;
}

const layers: BackLayer[] = [];
let seq = 0;
/** Count of history.go() calls we issued ourselves and expect a popstate for. */
let pendingProgrammatic = 0;
let listeners = 0;

function handlePopState() {
  if (pendingProgrammatic > 0) {
    pendingProgrammatic--;
    return;
  }
  const layer = layers.pop();
  // No layer left means the user is backing out of the app's base entry —
  // let the browser do what it normally would.
  layer?.onBack();
}

/** Ref-counted subscription so the listener exists only while layers can register. */
function subscribe(): () => void {
  if (listeners++ === 0) {
    window.addEventListener("popstate", handlePopState);
  }
  return () => {
    if (--listeners === 0) {
      window.removeEventListener("popstate", handlePopState);
    }
  };
}

/**
 * Imperatively push a back layer. Returns a disposer that unwinds the history
 * entry if the surface closed some other way.
 *
 * Prefer `useBackHandler` for a surface whose open/closed state is a boolean;
 * this primitive exists for navigations that repeat (each workspace switch
 * pushes its own entry, the way a page navigation would).
 */
export function pushBackLayer(onBack: () => void): () => void {
  const id = ++seq;
  layers.push({ id, onBack });
  window.history.pushState({ paLayer: id }, "");

  return () => {
    const idx = layers.findIndex((l) => l.id === id);
    // Gone already: the back gesture itself popped us, and the history entry
    // went with it.
    if (idx === -1) return;
    // Anything stacked above us is being torn down along with this surface, so
    // drop those entries in the same trip.
    const count = layers.length - idx;
    layers.splice(idx);
    pendingProgrammatic++;
    window.history.go(-count);
  };
}

/**
 * Route the back gesture to `onBack` while `active` is true.
 *
 * `onBack` is read through a ref, so an inline closure is fine — only `active`
 * flipping pushes or unwinds a history entry.
 */
export function useBackHandler(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => subscribe(), []);

  useEffect(() => {
    if (!active) return;
    return pushBackLayer(() => onBackRef.current());
  }, [active]);
}
