/**
 * WebSocket PTY server.
 * Spawns a real shell (zsh) per WebSocket connection with full PTY support.
 * Runs alongside Next.js on a separate port (4445).
 */
import { WebSocketServer } from "ws";
import pty from "node-pty";
import { homedir } from "os";
import { existsSync } from "fs";

const PORT = parseInt(process.env.PTY_PORT || "4445", 10);

const wss = new WebSocketServer({ port: PORT });

console.log(`[pty-server] WebSocket PTY server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws, req) => {
  const shell = process.env.SHELL || "/bin/zsh";

  // Parse optional cwd and initialCommand from query params
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requestedCwd = url.searchParams.get("cwd") || "";
  const cwd = requestedCwd && existsSync(requestedCwd) ? requestedCwd : homedir();
  const initialCommand = url.searchParams.get("cmd") || null;
  const noExec = url.searchParams.get("noExec") === "1";

  if (requestedCwd && requestedCwd !== cwd) {
    console.log(`[pty-server] Warning: cwd "${requestedCwd}" does not exist, falling back to ${cwd}`);
  }

  // Spawn PTY process
  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
  } catch (err) {
    console.error(`[pty-server] Failed to spawn PTY:`, err.message);
    ws.send(JSON.stringify({ type: "exit", exitCode: 1, signal: 0 }));
    ws.close();
    return;
  }

  console.log(`[pty-server] New session: PID ${ptyProcess.pid}, shell=${shell}, cwd=${cwd}${initialCommand ? `, cmd=${initialCommand}` : ""}`);

  // If an initial command was requested, write it to PTY after a short delay
  // so the shell has time to initialize.
  // noExec: write command text without trailing newline (user presses Enter)
  if (initialCommand) {
    setTimeout(() => {
      ptyProcess.write(noExec ? initialCommand : initialCommand + "\n");
    }, 300);
  }

  // PTY -> WebSocket (shell output to browser)
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[pty-server] PTY exited: code=${exitCode} signal=${signal}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });

  // WebSocket -> PTY (browser input to shell)
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case "input":
          ptyProcess.write(msg.data);
          break;
        case "resize":
          if (msg.cols && msg.rows) {
            ptyProcess.resize(msg.cols, msg.rows);
          }
          break;
        default:
          break;
      }
    } catch {
      // If it's not JSON, treat as raw input
      ptyProcess.write(raw.toString());
    }
  });

  ws.on("close", () => {
    console.log(`[pty-server] Connection closed, killing PID ${ptyProcess.pid}`);
    ptyProcess.kill();
  });

  ws.on("error", (err) => {
    console.error(`[pty-server] WebSocket error:`, err.message);
    ptyProcess.kill();
  });
});

wss.on("error", (err) => {
  console.error(`[pty-server] Server error:`, err.message);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[pty-server] Shutting down...");
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[pty-server] Shutting down...");
  wss.close();
  process.exit(0);
});
