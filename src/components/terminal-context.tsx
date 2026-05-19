"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

/**
 * Request to open a new terminal tab, dispatched from any widget.
 */
export interface TerminalTabRequest {
  /** Working directory for the new terminal */
  cwd?: string;
  /** Command to run immediately after shell init */
  command?: string;
  /** Label for the tab (e.g. "claude" or "opencode") */
  label?: string;
  /** Unique request counter */
  seq: number;
}

interface TerminalContextType {
  /** Current pending terminal request (null if none) */
  request: TerminalTabRequest | null;
  /** Request a new terminal tab from outside the terminal widget */
  openTerminalTab: (opts?: { cwd?: string; command?: string; label?: string }) => void;
  /** Called by the terminal widget once it has handled the request */
  clearRequest: () => void;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

let seqCounter = 0;

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<TerminalTabRequest | null>(null);

  const openTerminalTab = useCallback(
    (opts?: { cwd?: string; command?: string; label?: string }) => {
      seqCounter += 1;
      setRequest({
        cwd: opts?.cwd,
        command: opts?.command,
        label: opts?.label,
        seq: seqCounter,
      });
    },
    []
  );

  const clearRequest = useCallback(() => {
    setRequest(null);
  }, []);

  return (
    <TerminalContext.Provider value={{ request, openTerminalTab, clearRequest }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminal must be used within TerminalProvider");
  return ctx;
}
