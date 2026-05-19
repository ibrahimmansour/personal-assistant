---
name: terminal-pty
description: Work with the xterm.js terminal widget, the node-pty WebSocket server, and inter-widget terminal communication
---

## When to Use

Use this skill when modifying the terminal widget, the PTY WebSocket server, or integrating terminal functionality into other widgets.

## Architecture

```
terminal-widget.tsx (client)
    ↓ WebSocket (ws://localhost:4445)
pty-server.mjs (server, port 4445)
    ↓ node-pty
zsh shell (real PTY)
```

The terminal runs as a **separate process** from Next.js, launched concurrently by `server/dev-launcher.mjs`.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/widgets/terminal-widget.tsx` | xterm.js terminal UI, multi-tab support |
| `server/pty-server.mjs` | WebSocket server that spawns real zsh shells via node-pty |
| `server/dev-launcher.mjs` | Concurrent launcher for Next.js + PTY server |
| `src/components/terminal-context.tsx` | React context for inter-widget terminal communication |

## PTY Server (server/pty-server.mjs)

Standalone ESM module using `ws` and `node-pty`:

```javascript
import { WebSocketServer } from "ws";
import pty from "node-pty";

const PORT = process.env.PTY_PORT || 4445;
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  // Parse cwd and initial command from URL query params
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cwd = url.searchParams.get("cwd") || process.env.HOME;
  const cmd = url.searchParams.get("cmd");

  const shell = pty.spawn("zsh", [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });

  // Bidirectional data flow
  shell.onData((data) => ws.send(data));
  ws.on("message", (msg) => {
    const str = msg.toString();
    // Handle resize messages (JSON with cols/rows)
    try {
      const parsed = JSON.parse(str);
      if (parsed.type === "resize") shell.resize(parsed.cols, parsed.rows);
      else shell.write(str);
    } catch {
      shell.write(str);
    }
  });

  // Send initial command if provided
  if (cmd) shell.write(cmd + "\n");

  ws.on("close", () => shell.kill());
});
```

## Terminal Widget Key Patterns

### Multi-tab support
Each tab has its own WebSocket connection and xterm.js instance. Tabs are stored in state with `id`, `title`, `cwd`, `ws`, `terminal`.

### WebSocket connection
```typescript
const wsUrl = `ws://localhost:4445?cwd=${encodeURIComponent(cwd)}${cmd ? `&cmd=${encodeURIComponent(cmd)}` : ""}`;
const ws = new WebSocket(wsUrl);
```

### xterm.js setup
```typescript
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  fontFamily: "var(--font-mono), monospace",
  theme: { /* read from CSS variables */ },
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.loadAddon(new WebLinksAddon());
terminal.open(containerRef.current);
fitAddon.fit();
```

### Resize handling
```typescript
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  ws.send(JSON.stringify({
    type: "resize",
    cols: terminal.cols,
    rows: terminal.rows,
  }));
});
```

## Terminal Context (Inter-Widget Communication)

The `TerminalContext` allows other widgets to open terminal tabs:

```typescript
// In TerminalProvider
interface TerminalContextType {
  openTerminal: (cwd?: string, cmd?: string) => void;
  // ... tab management
}

// Usage in another widget (e.g., files-widget.tsx):
const { openTerminal } = useTerminal();
openTerminal("/path/to/directory", "ls -la");
```

## Theme Integration

Terminal colors are read from CSS custom properties at mount time:

```typescript
function getTerminalTheme() {
  const style = getComputedStyle(document.documentElement);
  return {
    background: cssToHex(style.getPropertyValue("--background")),
    foreground: cssToHex(style.getPropertyValue("--foreground")),
    cursor: cssToHex(style.getPropertyValue("--primary")),
    // ... ANSI color mappings
  };
}
```

## Rules

1. **The PTY server is a separate process** — not part of the Next.js build
2. **Use `ws://localhost:4445`** for WebSocket connections (configurable via `PTY_PORT`)
3. **Each tab = one WebSocket + one PTY** — connections are 1:1
4. **Send resize as JSON** — `{ type: "resize", cols, rows }`, not raw text
5. **Clean up on unmount** — close WebSocket, kill terminal instance
6. **Read theme from CSS variables** — don't hardcode terminal colors
7. **Use `FitAddon`** to auto-size terminal to container
8. **Pass `cwd` and `cmd` as URL query params** to the WebSocket server
