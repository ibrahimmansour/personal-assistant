"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { WidgetType } from "@/types/widget";

/**
 * Navigation request dispatched from the command palette (or anywhere else)
 * to tell a specific widget to expand and show a particular item.
 */
export interface WidgetNavRequest {
  /** Which widget to navigate to */
  widgetType: WidgetType;
  /** Optional item ID within that widget (email id, PR id, etc.) */
  itemId?: string;
  /** Optional search query to pre-fill the widget's search */
  searchQuery?: string;
  /** Unique request counter so the same itemId can be re-requested */
  seq: number;
}

interface WidgetNavContextType {
  /** Current pending navigation request (null if none) */
  request: WidgetNavRequest | null;
  /** Dispatch a navigation request */
  navigateTo: (widgetType: WidgetType, itemId?: string, searchQuery?: string) => void;
  /** Called by the widget once it has handled the request */
  clearRequest: () => void;
}

const WidgetNavContext = createContext<WidgetNavContextType | null>(null);

let seqCounter = 0;

export function WidgetNavProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<WidgetNavRequest | null>(null);

  const navigateTo = useCallback(
    (widgetType: WidgetType, itemId?: string, searchQuery?: string) => {
      seqCounter += 1;
      setRequest({ widgetType, itemId, searchQuery, seq: seqCounter });
    },
    []
  );

  const clearRequest = useCallback(() => {
    setRequest(null);
  }, []);

  return (
    <WidgetNavContext.Provider value={{ request, navigateTo, clearRequest }}>
      {children}
    </WidgetNavContext.Provider>
  );
}

export function useWidgetNav() {
  const ctx = useContext(WidgetNavContext);
  if (!ctx) throw new Error("useWidgetNav must be used within WidgetNavProvider");
  return ctx;
}

/**
 * Convenience hook for a specific widget.
 * Returns { expandRequested, onExpandHandled, pendingItemId }
 * so the widget can pass expandRequested/onExpandHandled to WidgetWrapper
 * and handle pendingItemId to select the right item.
 */
export function useWidgetNavFor(widgetType: WidgetType) {
  const { request, clearRequest } = useWidgetNav();
  const [expandRequested, setExpandRequested] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (
      request &&
      request.widgetType === widgetType &&
      request.seq !== lastSeqRef.current
    ) {
      lastSeqRef.current = request.seq;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingItemId(request.itemId ?? null);
      setPendingSearchQuery(request.searchQuery ?? null);
      setExpandRequested(true);
      // Clear the global request so other widgets don't react
      clearRequest();
    }
  }, [request, widgetType, clearRequest]);

  const onExpandHandled = useCallback(() => {
    setExpandRequested(false);
  }, []);

  const clearPendingItem = useCallback(() => {
    setPendingItemId(null);
  }, []);

  const clearPendingSearch = useCallback(() => {
    setPendingSearchQuery(null);
  }, []);

  return { expandRequested, onExpandHandled, pendingItemId, clearPendingItem, pendingSearchQuery, clearPendingSearch };
}
