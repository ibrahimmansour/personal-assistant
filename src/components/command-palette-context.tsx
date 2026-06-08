"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { WidgetType } from "@/types/widget";

interface CommandPaletteState {
  /** Whether the command palette is open */
  open: boolean;
  /** If set, pre-filter results to this widget type */
  filterWidget: WidgetType | null;
  /** The currently expanded (fullscreen) widget, if any */
  expandedWidget: WidgetType | null;
  /** Sequence counter — incremented to signal all widgets to collapse */
  collapseSeq: number;
  /** Open the command palette, optionally pre-filtered to a widget type */
  openSearch: (widgetType?: WidgetType) => void;
  /** Close the command palette */
  closeSearch: () => void;
  /** Set open state directly (for keyboard shortcut toggle) */
  setOpen: (open: boolean) => void;
  /** Clear the widget filter */
  clearFilter: () => void;
  /** Report that a widget has been expanded or collapsed */
  setExpandedWidget: (widgetType: WidgetType | null) => void;
  /** Collapse all currently expanded widgets */
  collapseAllWidgets: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteState | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [filterWidget, setFilterWidget] = useState<WidgetType | null>(null);
  const [expandedWidget, setExpandedWidgetState] = useState<WidgetType | null>(null);
  const [collapseSeq, setCollapseSeq] = useState(0);

  const openSearch = useCallback((widgetType?: WidgetType) => {
    setFilterWidget(widgetType ?? null);
    setOpenState(true);
  }, []);

  const closeSearch = useCallback(() => {
    setOpenState(false);
    // Clear filter after a brief delay so it doesn't flash during close animation
    setTimeout(() => setFilterWidget(null), 200);
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(() => {
      // Don't auto-filter when opening via Cmd+P — the user likely wants
      // to navigate away. openSearch() already sets the filter explicitly
      // when invoked from a widget's search button.
      if (!next) {
        setTimeout(() => setFilterWidget(null), 200);
      }
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => {
    setFilterWidget(null);
  }, []);

  const setExpandedWidget = useCallback((widgetType: WidgetType | null) => {
    setExpandedWidgetState(widgetType);
  }, []);

  const collapseAllWidgets = useCallback(() => {
    setCollapseSeq((s) => s + 1);
  }, []);

  return (
    <CommandPaletteContext.Provider
      value={{ open, filterWidget, expandedWidget, collapseSeq, openSearch, closeSearch, setOpen, clearFilter, setExpandedWidget, collapseAllWidgets }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}
