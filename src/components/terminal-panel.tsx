"use client";

/**
 * TerminalPanel — a standalone, embeddable terminal component.
 * Creates its own PTY session via WebSocket. Does NOT use WidgetWrapper.
 * Use this to embed a terminal inside any widget's expanded overlay.
 */

import { cn } from "@/lib/utils";
import { TerminalSquare, X } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = "ws://localhost:4445";

// ─── Color helpers (shared with terminal-widget) ─────────────────────────────

function resolveColor(cssValue: string, fallback: string): string {
  if (!cssValue) return fallback;
  try {
    const el = document.createElement("div");
    el.style.color = cssValue;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.body.removeChild(el);
    if (!computed || computed === "") return fallback;
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return fallback;
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  } catch {
    return fallback;
  }
}

function getCssVarHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return resolveColor(raw, fallback);
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getTermTheme() {
  const dark = isDarkMode();
  const bg = getCssVarHex("--card", dark ? "#1c1c1e" : "#ffffff");
  const fg = getCssVarHex("--foreground", dark ? "#e4e4e7" : "#18181b");
  const cursor = getCssVarHex("--primary", dark ? "#a78bfa" : "#6d28d9");

  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: dark ? "rgba(167, 139, 250, 0.3)" : "rgba(109, 40, 217, 0.2)",
    selectionForeground: undefined,
    selectionInactiveBackground: dark ? "rgba(167, 139, 250, 0.15)" : "rgba(109, 40, 217, 0.1)",
    black: dark ? "#18181b" : "#27272a",
    red: dark ? "#f87171" : "#dc2626",
    green: dark ? "#4ade80" : "#16a34a",
    yellow: dark ? "#facc15" : "#ca8a04",
    blue: dark ? "#60a5fa" : "#2563eb",
    magenta: dark ? "#c084fc" : "#9333ea",
    cyan: dark ? "#22d3ee" : "#0891b2",
    white: dark ? "#e4e4e7" : "#f4f4f5",
    brightBlack: dark ? "#52525b" : "#a1a1aa",
    brightRed: dark ? "#fca5a5" : "#ef4444",
    brightGreen: dark ? "#86efac" : "#22c55e",
    brightYellow: dark ? "#fde68a" : "#eab308",
    brightBlue: dark ? "#93c5fd" : "#3b82f6",
    brightMagenta: dark ? "#d8b4fe" : "#a855f7",
    brightCyan: dark ? "#67e8f9" : "#06b6d4",
    brightWhite: dark ? "#fafafa" : "#ffffff",
  };
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TerminalPanelProps {
  /** Working directory for the shell */
  cwd?: string;
  /** Command to run immediately after shell init */
  command?: string;
  /** Label shown in the header */
  label?: string;
  /** Called when the user clicks the close button */
  onClose?: () => void;
  /** Additional className for the outer container */
  className?: string;
  /** Ref that callers can use to send text directly into the PTY */
  pasteRef?: React.MutableRefObject<((text: string) => void) | null>;
}

export function TerminalPanel({ cwd, command, label, onClose, className, pasteRef }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [alive, setAlive] = useState(true);
  const [connecting, setConnecting] = useState(true);
  const roRef = useRef<ResizeObserver | null>(null);

  // ── Create terminal session ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const container = containerRef.current;
      if (!container) return;

      try {
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        const { WebLinksAddon } = await import("@xterm/addon-web-links");
        await import("@xterm/xterm/css/xterm.css");

        if (cancelled) return;

        const theme = getTermTheme();
        const terminal = new Terminal({
          cursorBlink: true,
          cursorStyle: "block",
          fontSize: 13,
          fontFamily: "Menlo, Monaco, 'Courier New', monospace",
          lineHeight: 1.2,
          theme,
          allowProposedApi: true,
          scrollback: 5000,
          convertEol: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        terminal.open(container);
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // Build WebSocket URL
        const wsUrl = new URL(WS_URL);
        if (cwd) wsUrl.searchParams.set("cwd", cwd);
        if (command) wsUrl.searchParams.set("cmd", command);

        const ws = new WebSocket(wsUrl.toString());
        wsRef.current = ws;

        // Expose paste function to callers via ref
        if (pasteRef) {
          pasteRef.current = (text: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input", data: text }));
              terminal.focus();
            }
          };
        }

        ws.onopen = () => {
          if (cancelled) return;
          setConnecting(false);
          try {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims) ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          } catch {}
          terminal.focus();
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "output") {
              terminal.write(msg.data);
            } else if (msg.type === "exit") {
              terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
              setAlive(false);
            }
          } catch {
            terminal.write(event.data);
          }
        };

        ws.onclose = () => setAlive(false);
        ws.onerror = () => {
          setConnecting(false);
          setAlive(false);
        };

        terminal.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        });

        // ResizeObserver
        const ro = new ResizeObserver(() => {
          requestAnimationFrame(() => {
            try {
              fitAddon.fit();
              const dims = fitAddon.proposeDimensions();
              if (dims && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
              }
            } catch {}
          });
        });
        ro.observe(container);
        roRef.current = ro;
      } catch {
        setConnecting(false);
        setAlive(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      try { wsRef.current?.close(); } catch {}
      try { terminalRef.current?.dispose(); } catch {}
      terminalRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
      if (pasteRef) pasteRef.current = null;
    };
  }, []); // intentionally run only once on mount — cwd/command are initial values

  // ── Theme sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (terminalRef.current) {
        terminalRef.current.options.theme = getTermTheme();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("relative flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          <span>{label || "Terminal"}</span>
          {!alive && <span className="text-xs text-muted-foreground">(exited)</span>}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Close terminal panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden px-1 py-1"
        onMouseDown={(e) => e.stopPropagation()}
      />

      {connecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/80">
          <span className="text-xs text-muted-foreground">Connecting...</span>
        </div>
      )}
    </div>
  );
}
