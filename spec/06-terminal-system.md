# 06 — Terminal System

> Complete specification of the PTY server, WebSocket protocol, xterm.js integration, and terminal components.

## Architecture

```
┌───────────────────────────────────┐
│  Browser                          │
│  ┌─────────────────────────────┐  │
│  │ terminal-widget.tsx         │  │
│  │  Tab 1 → xterm.js instance │──────── WebSocket ──┐
│  │  Tab 2 → xterm.js instance │──────── WebSocket ──┤
│  │  Tab 3 → xterm.js instance │──────── WebSocket ──┤
│  └─────────────────────────────┘  │                  │
│  ┌─────────────────────────────┐  │                  │
│  │ terminal-panel.tsx          │  │                  │
│  │  (files widget side panel)  │──────── WebSocket ──┤
│  └─────────────────────────────┘  │                  │
│  ┌─────────────────────────────┐  │                  │
│  │ tasks-widget.tsx            │  │                  │
│  │  (AI terminal side panel)   │──────── WebSocket ──┤
│  └─────────────────────────────┘  │                  │
└───────────────────────────────────┘                  │
                                                       │
                                              ws://localhost:4445
                                                       │
┌──────────────────────────────────────────────────────┤
│  server/pty-server.mjs (port 4445)                   │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Per-connection:                                  │ │
│  │  → Parse ?cwd=...&cmd=... from URL             │ │
│  │  → pty.spawn("zsh", [], { cwd, env })          │ │
│  │  → Bidirectional JSON message relay             │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## PTY WebSocket Server

**File:** `server/pty-server.mjs` (110 lines)
**Port:** 4445 (configurable via `PTY_PORT` env var)
**Shell:** `zsh` (or `SHELL` env var)
**Terminal type:** `xterm-256color`
**Initial size:** 80 cols x 24 rows

### Connection Flow

1. Client connects to `ws://localhost:4445?cwd={path}&cmd={command}`
2. Server parses URL query parameters
3. Spawns PTY: `pty.spawn(shell, [], { name: "xterm-256color", cols: 80, rows: 24, cwd, env })`
4. If `cmd` param present: writes command to PTY after 300ms delay (allows shell to initialize)
5. Bidirectional relay begins

### WebSocket Protocol

**Client → Server:**

```typescript
// User typed input
{ type: "input", data: string }

// Terminal resized
{ type: "resize", cols: number, rows: number }
```

Falls back to treating raw strings as input if JSON parsing fails.

**Server → Client:**

```typescript
// PTY output (terminal data)
{ type: "output", data: string }

// PTY process exited
{ type: "exit", exitCode: number, signal: number }
```

### Shutdown

Listens for `SIGINT` and `SIGTERM`. Kills all PTY processes and closes all WebSocket connections gracefully.

---

## Terminal Widget

**File:** `src/components/widgets/terminal-widget.tsx` (471 lines)

Multi-tab terminal emulator embedded as a dashboard widget.

### Session Management

Sessions are stored in a **module-level Map** (not React state) to survive re-renders:

```typescript
const sessions = new Map<string, {
  term: Terminal;         // xterm.js instance
  ws: WebSocket;
  fitAddon: FitAddon;
  alive: boolean;
  containerRef: HTMLDivElement | null;
}>();
```

Tab IDs are stored in React state for rendering: `tabs: string[]`, `activeTab: string | null`.

### Tab Lifecycle

**Creating a tab:**
1. Generate unique tab ID: `tab-{counter}`
2. Dynamic import of xterm.js modules (client-only):
   ```typescript
   const { Terminal } = await import("@xterm/xterm");
   const { FitAddon } = await import("@xterm/addon-fit");
   const { WebLinksAddon } = await import("@xterm/addon-web-links");
   ```
3. Create Terminal instance with theme colors from CSS variables
4. Construct WebSocket URL: `ws://localhost:4445?cwd={cwd}&cmd={command}`
5. Connect WebSocket, wire up data relay
6. Load addons (FitAddon, WebLinksAddon)
7. Open terminal in container div
8. Fit to container size

**Closing a tab:**
1. Close WebSocket
2. Dispose xterm.js Terminal
3. Remove from sessions Map
4. Remove tab ID from state
5. Switch to adjacent tab or null

### Theme Synchronization

The terminal theme must match the application theme (light/dark + color accent).

**Approach:** MutationObserver on `<html>` element watches for class changes:

```typescript
const observer = new MutationObserver(() => {
  // Re-read CSS variables from document
  // Convert oklch values to hex for xterm
  // Apply to all active terminal instances
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
```

**oklch → hex conversion:** Helper functions resolve computed CSS variable values to hex strings that xterm.js can use:

```typescript
function resolveColor(varName: string): string {
  const style = getComputedStyle(document.documentElement);
  const value = style.getPropertyValue(varName).trim();
  // Parse oklch and convert to hex
}
```

### Terminal Theme Colors

| xterm Property | CSS Variable Source |
|---------------|-------------------|
| `background` | `--background` |
| `foreground` | `--foreground` |
| `cursor` | `--primary` |
| `cursorAccent` | `--background` |
| `selectionBackground` | `--primary` (with alpha) |

### ResizeObserver

Each tab has a ResizeObserver that calls `fitAddon.fit()` when the container dimensions change:

```typescript
const ro = new ResizeObserver(() => {
  fitAddon.fit();
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  }
});
ro.observe(containerDiv);
```

### External Tab Requests

Consumes `TerminalContext`:
```typescript
const { request: termRequest, clearRequest: clearTermRequest } = useTerminal();
```

When a request arrives (e.g., from files widget "Open terminal here"):
1. Creates new tab with specified `cwd`, `command`, and `label`
2. Clears the request

### Header Actions

- **New tab button** — creates default tab
- **Paste button** — (when tab is active and alive)

---

## Terminal Panel Component

**File:** `src/components/terminal-panel.tsx` (277 lines)

Standalone embeddable terminal component used as a side panel in the files widget's expanded view.

### Props

```typescript
interface TerminalPanelProps {
  cwd?: string;           // Working directory
  command?: string;        // Command to run after shell init
  label?: string;          // Display label
  onClose?: () => void;    // Close callback
  className?: string;
  pasteRef?: React.MutableRefObject<((text: string) => void) | null>;
}
```

### Key Difference from Terminal Widget

- Creates its own independent PTY session (not managed by the tab system)
- Single session per component instance
- `pasteRef` allows parent to send text directly to the PTY (e.g., drag-and-drop file path from file browser)
- Simpler lifecycle: mount → connect → unmount → disconnect

### Same Internals

- Dynamic import of xterm.js
- WebSocket to `ws://localhost:4445?cwd={cwd}&cmd={command}`
- MutationObserver for theme sync
- ResizeObserver for fit
- oklch → hex color resolution

---

## Tasks Widget AI Terminal

The tasks widget also embeds a terminal session for "AI task execution":

### Flow

1. User clicks "Do with AI" on a task
2. Widget sets `aiTerminalTask = { taskId, taskTitle, cwd }` (cwd from folder settings)
3. `forceExpand` activates → widget expands to fullscreen
4. `sidePanel` renders an embedded terminal with:
   - `cwd` from the task's folder
   - Pre-filled command (AI-generated prompt or task description)

This uses the same PTY WebSocket server and xterm.js setup internally.

---

## Dev Launcher

**File:** `server/dev-launcher.mjs` (59 lines)

Concurrently launches both servers for development:

```javascript
// Spawns two child processes:
start("PTY", "node", ["server/pty-server.mjs"]);
start("NEXT", "npx", ["next", "dev", "--port", "4444"]);
```

**Behavior:**
- Sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for SAP corporate proxy
- If Next.js exits, kills PTY server and exits
- Handles `SIGINT`/`SIGTERM` for graceful shutdown of both

---

## Connection Parameters

### WebSocket URL Format

```
ws://localhost:4445[?cwd={path}][&cmd={command}]
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `cwd` | No | `$HOME` | Working directory for the shell |
| `cmd` | No | — | Command to execute after 300ms delay |

### Examples

```
# Default home directory shell
ws://localhost:4445

# Open in specific directory
ws://localhost:4445?cwd=/Users/d067576/projects/my-app

# Open and run a command
ws://localhost:4445?cwd=/tmp&cmd=ls%20-la

# AI task terminal
ws://localhost:4445?cwd=/Users/d067576/projects/my-app&cmd=npm%20test
```

---

## Error States

| State | Terminal Widget Display | Recovery |
|-------|----------------------|----------|
| WebSocket connect failed | Error message + retry button | Click retry |
| PTY process exited (code 0) | "Exited" badge on tab | Create new tab |
| PTY process exited (non-zero) | "Exited (code N)" badge | Create new tab |
| WebSocket closed unexpectedly | "Disconnected" indicator | Auto-reconnect not implemented; new tab |
| PTY server not running | Connection error | Start `npm run dev:pty` |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@xterm/xterm` | 6.0.0 | Terminal emulator in browser |
| `@xterm/addon-fit` | 0.11.0 | Auto-fit terminal to container |
| `@xterm/addon-web-links` | 0.12.0 | Clickable URLs in terminal |
| `node-pty` | 1.1.0 | Native PTY spawning |
| `ws` | 8.20.0 | WebSocket server |
