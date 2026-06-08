"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import { WidgetConfig } from "@/types/widget";
import { getDefaultLayouts, getDefaultWidgets } from "@/lib/dashboard-config";
import { useProfile, type ProfileId } from "@/components/profile-context";

// Bump this when you change the default layout to force a reset
const LAYOUT_VERSION = 18;
const COLS = 12;

interface DashboardContextType {
  widgets: WidgetConfig[];
  layouts: Layout;
  layoutLocked: boolean;
  toggleWidget: (id: string) => void;
  ensureWidgetVisible: (id: string) => void;
  updateLayouts: (layouts: Layout) => void;
  resetLayout: () => void;
  autoArrange: () => void;
  toggleLayoutLock: () => void;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}

/**
 * Widget IDs that should always be placed first at the top of the grid.
 * Order matters — they are placed left-to-right in this order.
 */
const TOP_ROW_WIDGET_IDS = ["clock", "weather", "calendar"];

/**
 * Tight auto-arrange for a grid — fills the visible viewport with zero gaps
 * and zero scrolling.
 *
 * 1. Computes how many row-units fit on screen from the viewport height.
 * 2. Always places Clock, Weather, and Calendar in the top row.
 * 3. Packs remaining widgets into full-width rows (no horizontal gaps).
 * 4. Distributes row heights so total = available rows (no vertical gaps).
 *
 * Grid math (react-grid-layout):
 *   widget pixel height = h × rowHeight + (h − 1) × marginY
 *   total pixel height  = totalRows × (rowHeight + marginY) − marginY
 *
 * @param cols — number of grid columns (defaults to COLS=12)
 */
const ROW_HEIGHT = 80;
const MARGIN_Y = 16;
const CHROME_PX = 89; // 57px header + 32px grid padding (p-4 top+bottom)

export function compactLayout(items: Layout, visibleIds: Set<string>, cols: number = COLS): Layout {
  const visible = (items as readonly LayoutItem[]).filter((item) => visibleIds.has(item.i));
  const hidden = (items as readonly LayoutItem[]).filter((item) => !visibleIds.has(item.i));

  if (visible.length === 0) return [...hidden] as Layout;

  // ─── Compute available row units from viewport ──────────────
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 900;
  const availablePx = viewportH - CHROME_PX;
  // totalRows * (ROW_HEIGHT + MARGIN_Y) - MARGIN_Y <= availablePx
  // totalRows <= (availablePx + MARGIN_Y) / (ROW_HEIGHT + MARGIN_Y)
  const maxRows = Math.max(4, Math.floor((availablePx + MARGIN_Y) / (ROW_HEIGHT + MARGIN_Y)));

  // ─── Separate top-row widgets from the rest ─────────────────
  const topRowItems: LayoutItem[] = [];
  const remainingItems: LayoutItem[] = [];

  for (const item of visible) {
    if (TOP_ROW_WIDGET_IDS.includes(item.i)) {
      topRowItems.push(item);
    } else {
      remainingItems.push(item);
    }
  }

  topRowItems.sort(
    (a, b) => TOP_ROW_WIDGET_IDS.indexOf(a.i) - TOP_ROW_WIDGET_IDS.indexOf(b.i)
  );

  const placed: LayoutItem[] = [];

  // ─── Place top row ──────────────────────────────────────────
  const topRowH = topRowItems.length > 0 ? Math.max(2, ...topRowItems.map((i) => i.minH ?? 2)) : 0;

  if (topRowItems.length > 0) {
    const baseW = Math.floor(cols / topRowItems.length);
    let remainder = cols - baseW * topRowItems.length;
    let x = 0;
    for (const item of topRowItems) {
      const w = baseW + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      placed.push({ ...item, x, y: 0, w, h: topRowH });
      x += w;
    }
  }

  const rowsForRest = maxRows - topRowH;

  // ─── No remaining widgets: stretch top row to fill ──────────
  if (remainingItems.length === 0) {
    // Give top-row widgets the full height
    for (const p of placed) p.h = maxRows;
    return [...placed, ...hidden] as Layout;
  }

  // ─── Group remaining widgets into full-width rows ───────────
  // Sort by width descending for greedy packing
  remainingItems.sort((a, b) => (b.minW ?? 3) - (a.minW ?? 3) || (b.minH ?? 3) - (a.minH ?? 3));

  type RowGroup = { items: LayoutItem[]; minH: number };
  const rows: RowGroup[] = [];
  const unplaced = [...remainingItems];

  while (unplaced.length > 0) {
    const row: LayoutItem[] = [];
    let rowMinWidth = 0;

    for (let i = 0; i < unplaced.length; ) {
      const entry = unplaced[i];
      const minW = Math.min(entry.minW ?? 3, cols);
      if (rowMinWidth + minW <= cols) {
        row.push(entry);
        rowMinWidth += minW;
        unplaced.splice(i, 1);
      } else {
        i++;
      }
    }

    if (row.length === 0) {
      row.push(unplaced.shift()!);
    }

    // Row minH = max of minH of all widgets in this row
    const minH = Math.max(...row.map((item) => item.minH ?? 2));
    rows.push({ items: row, minH });
  }

  // ─── Distribute row heights to fill exactly rowsForRest ─────
  const totalMinH = rows.reduce((sum, r) => sum + r.minH, 0);
  const rowHeights: number[] = rows.map((r) => r.minH);

  if (totalMinH < rowsForRest) {
    // Extra rows to distribute — give proportionally more to each row
    let extra = rowsForRest - totalMinH;
    // Distribute one row at a time in round-robin to keep even
    while (extra > 0) {
      for (let i = 0; i < rowHeights.length && extra > 0; i++) {
        rowHeights[i]++;
        extra--;
      }
    }
  } else if (totalMinH > rowsForRest) {
    // Not enough space — clamp to minH, some scrolling may occur
    // (but at least there are no gaps)
  }

  // ─── Place rows ─────────────────────────────────────────────
  let y = topRowH;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const h = rowHeights[r];

    // Distribute cols among widgets in this row
    const minWidths = row.items.map((item) => Math.min(item.minW ?? 3, cols));
    const totalMinW = minWidths.reduce((sum, w) => sum + w, 0);
    const extraCols = cols - totalMinW;

    const widths: number[] = [];
    let assigned = 0;
    for (let i = 0; i < row.items.length; i++) {
      if (i === row.items.length - 1) {
        widths.push(cols - assigned);
      } else {
        // Distribute extra proportionally
        const preferredW = Math.max(row.items[i].minW ?? 3, Math.min(row.items[i].w, cols));
        const extraWant = Math.max(0, preferredW - minWidths[i]);
        const totalExtraWant = row.items.reduce((sum, it, idx) => sum + Math.max(0, Math.max(it.minW ?? 3, Math.min(it.w, cols)) - minWidths[idx]), 0);
        let extra = 0;
        if (totalExtraWant > 0) {
          extra = Math.round((extraWant / totalExtraWant) * extraCols);
        } else if (extraCols > 0) {
          extra = Math.round(extraCols / row.items.length);
        }
        const w = minWidths[i] + extra;
        widths.push(w);
        assigned += w;
      }
    }

    // Place widgets
    let x = 0;
    for (let i = 0; i < row.items.length; i++) {
      placed.push({
        ...row.items[i],
        x,
        y,
        w: widths[i],
        h,
      });
      x += widths[i];
    }
    y += h;
  }

  return [...placed, ...hidden] as Layout;
}

/** Profile-scoped storage keys */
function storageKeys(profile: ProfileId) {
  return {
    widgets: `dashboard-widgets-${profile}`,
    layout: `dashboard-layout-${profile}`,
    version: `dashboard-version-${profile}`,
    layoutLocked: `dashboard-layout-locked-${profile}`,
  };
}

/** Debounced save to server API */
function useDebouncedSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((profile: ProfileId, widgets: WidgetConfig[], layouts: Layout) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, widgets, layouts, version: LAYOUT_VERSION }),
      }).catch(() => {});
    }, 500);
  }, []);

  return save;
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useProfile();
  const [widgets, setWidgets] = useState<WidgetConfig[]>(getDefaultWidgets(activeProfile));
  const [layouts, setLayouts] = useState<Layout>(getDefaultLayouts(activeProfile));
  const [layoutLocked, setLayoutLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const debouncedSave = useDebouncedSave();
  const currentProfile = useRef(activeProfile);

  // Load state when profile changes
  useEffect(() => {
    currentProfile.current = activeProfile;
    setLoaded(false);

    async function load() {
      const keys = storageKeys(activeProfile);
      const defWidgets = getDefaultWidgets(activeProfile);
      const defLayouts = getDefaultLayouts(activeProfile);

      // Load layout lock state from localStorage (simple boolean, no server persistence needed)
      try {
        const savedLock = localStorage.getItem(keys.layoutLocked);
        if (savedLock === "true") setLayoutLocked(true);
        else setLayoutLocked(false);
      } catch { setLayoutLocked(false); }

      try {
        // Try server file first
        const res = await fetch(`/api/dashboard?profile=${activeProfile}`);
        const data = await res.json();

        if (data.saved && data.version === LAYOUT_VERSION) {
          if (data.widgets) setWidgets(data.widgets);
          if (data.layouts) setLayouts(data.layouts);
          setLoaded(true);
          return;
        }

        // Server file missing or version mismatch - try localStorage
        const savedVersion = localStorage.getItem(keys.version);
        if (savedVersion === String(LAYOUT_VERSION)) {
          const savedWidgets = localStorage.getItem(keys.widgets);
          const savedLayouts = localStorage.getItem(keys.layout);
          if (savedWidgets) setWidgets(JSON.parse(savedWidgets));
          else setWidgets(defWidgets);
          if (savedLayouts) setLayouts(JSON.parse(savedLayouts));
          else setLayouts(defLayouts);
        } else {
          setWidgets(defWidgets);
          setLayouts(defLayouts);
        }
      } catch {
        // Fallback to localStorage
        try {
          const savedVersion = localStorage.getItem(keys.version);
          if (savedVersion === String(LAYOUT_VERSION)) {
            const savedWidgets = localStorage.getItem(keys.widgets);
            const savedLayouts = localStorage.getItem(keys.layout);
            if (savedWidgets) setWidgets(JSON.parse(savedWidgets));
            else setWidgets(defWidgets);
            if (savedLayouts) setLayouts(JSON.parse(savedLayouts));
            else setLayouts(defLayouts);
          } else {
            setWidgets(defWidgets);
            setLayouts(defLayouts);
          }
        } catch {
          setWidgets(defWidgets);
          setLayouts(defLayouts);
        }
      }
      setLoaded(true);
    }
    load();
  }, [activeProfile]);

  const persistBoth = useCallback(
    (newWidgets: WidgetConfig[], newLayouts: Layout) => {
      const keys = storageKeys(currentProfile.current);
      localStorage.setItem(keys.widgets, JSON.stringify(newWidgets));
      localStorage.setItem(keys.layout, JSON.stringify(newLayouts));
      localStorage.setItem(keys.version, String(LAYOUT_VERSION));
      debouncedSave(currentProfile.current, newWidgets, newLayouts);
    },
    [debouncedSave]
  );

  const toggleWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const next = prev.map((w) =>
          w.id === id ? { ...w, visible: !w.visible } : w
        );
        // Re-compact the layout so widgets fill the viewport cleanly
        if (!layoutLocked) {
          const visibleIds = new Set(next.filter((w) => w.visible).map((w) => w.id));
          const arranged = compactLayout(layouts, visibleIds);
          setLayouts(arranged);
          persistBoth(next, arranged);
        } else {
          persistBoth(next, layouts);
        }
        return next;
      });
    },
    [layouts, persistBoth, layoutLocked]
  );

  const ensureWidgetVisible = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const widget = prev.find((w) => w.id === id);
        if (!widget || widget.visible) return prev; // already visible
        const next = prev.map((w) =>
          w.id === id ? { ...w, visible: true } : w
        );
        // Re-compact the layout so the newly-visible widget fits cleanly
        if (!layoutLocked) {
          const visibleIds = new Set(next.filter((w) => w.visible).map((w) => w.id));
          const arranged = compactLayout(layouts, visibleIds);
          setLayouts(arranged);
          persistBoth(next, arranged);
        } else {
          persistBoth(next, layouts);
        }
        return next;
      });
    },
    [layouts, persistBoth, layoutLocked]
  );

  const updateLayouts = useCallback(
    (newLayouts: Layout) => {
      setLayouts(newLayouts);
      persistBoth(widgets, newLayouts);
    },
    [widgets, persistBoth]
  );

  const resetLayout = useCallback(() => {
    const defWidgets = getDefaultWidgets(currentProfile.current);
    const defLayouts = getDefaultLayouts(currentProfile.current);
    setWidgets(defWidgets);
    setLayouts(defLayouts);
    persistBoth(defWidgets, defLayouts);
  }, [persistBoth]);

  const autoArrange = useCallback(() => {
    if (layoutLocked) return; // Don't auto-arrange when layout is locked
    const visibleIds = new Set(widgets.filter((w) => w.visible).map((w) => w.id));
    const arranged = compactLayout(layouts, visibleIds);
    setLayouts(arranged);
    persistBoth(widgets, arranged);
  }, [widgets, layouts, persistBoth, layoutLocked]);

  const toggleLayoutLock = useCallback(() => {
    setLayoutLocked((prev) => {
      const next = !prev;
      try {
        const keys = storageKeys(currentProfile.current);
        localStorage.setItem(keys.layoutLocked, String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Cmd+Shift+A → auto-arrange (only when layout is not locked)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "a") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        if (!layoutLocked) autoArrange();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [autoArrange, layoutLocked]);

  return (
    <DashboardContext.Provider
      value={{ widgets, layouts, layoutLocked, toggleWidget, ensureWidgetVisible, updateLayouts, resetLayout, autoArrange, toggleLayoutLock }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
