/**
 * WebSocket PTY server.
 * Spawns a real shell (zsh) per WebSocket connection with full PTY support.
 * Supports optional tmux wrapping: when a `tmux` query param is provided,
 * sessions run inside tmux so they survive disconnections.
 * Runs alongside Next.js on a separate port (4445).
 */
import { WebSocketServer } from "ws";
import pty from "node-pty";
import { homedir } from "os";
import { existsSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PTY_PORT || "4445", 10);
const TMUX_CONF = join(__dirname, "tmux.conf");
const TMUX_SESSION_PREFIX = "pa-"; // prefix for our managed sessions

const wss = new WebSocketServer({ port: PORT });

console.log(`[pty-server] WebSocket PTY server listening on ws://localhost:${PORT}`);

// ─── tmux helpers ────────────────────────────────────────────────────────────

/**
 * Check if a tmux session with the given name exists.
 */
function tmuxSessionExists(name) {
  try {
    execFileSync("tmux", ["-f", TMUX_CONF, "has-session", "-t", name], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all tmux sessions managed by us (prefixed with TMUX_SESSION_PREFIX).
 */
function listManagedTmuxSessions() {
  try {
    const output = execFileSync("tmux", ["-f", TMUX_CONF, "list-sessions", "-F", "#{session_name}"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .trim()
      .split("\n")
      .filter((s) => s.startsWith(TMUX_SESSION_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Kill a tmux session by name.
 */
function killTmuxSession(name) {
  try {
    execFileSync("tmux", ["-f", TMUX_CONF, "kill-session", "-t", name], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Periodic cleanup of dead tmux sessions ──────────────────────────────────

setInterval(() => {
  // tmux automatically removes sessions when all processes exit,
  // but we also clean up any sessions that might be lingering
  // (e.g. if a process is stuck). This is a safety net.
  const sessions = listManagedTmuxSessions();
  if (sessions.length > 20) {
    console.log(`[pty-server] ${sessions.length} managed tmux sessions active, consider cleanup`);
  }
}, 5 * 60 * 1000);

// ─── WebSocket connection handler ────────────────────────────────────────────

wss.on("connection", (ws, req) => {
  const shell = process.env.SHELL || "/bin/zsh";

  // Parse query params
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requestedCwd = url.searchParams.get("cwd") || "";
  const cwd = requestedCwd && existsSync(requestedCwd) ? requestedCwd : homedir();
  const initialCommand = url.searchParams.get("cmd") || null;
  const noExec = url.searchParams.get("noExec") === "1";
  const tmuxSession = url.searchParams.get("tmux") || null;

  if (requestedCwd && requestedCwd !== cwd) {
    console.log(`[pty-server] Warning: cwd "${requestedCwd}" does not exist, falling back to ${cwd}`);
  }

  // ─── Special message: list tmux sessions ────────────────────────────
  // If the connection sends a "list-tmux" message, respond and return.
  // This is a lightweight RPC over the same WebSocket port.
  if (url.searchParams.get("action") === "list-tmux") {
    const sessions = listManagedTmuxSessions();
    ws.send(JSON.stringify({ type: "tmux-sessions", sessions }));
    ws.close();
    return;
  }

  let ptyProcess;
  let isTmux = false;

  if (tmuxSession) {
    // ─── tmux mode ──────────────────────────────────────────────────────
    isTmux = true;
    const sessionName = `${TMUX_SESSION_PREFIX}${tmuxSession}`;
    const sessionExists = tmuxSessionExists(sessionName);

    try {
      if (sessionExists) {
        // Reattach to existing session
        console.log(`[pty-server] Reattaching to tmux session: ${sessionName}`);
        ptyProcess = pty.spawn("tmux", ["-f", TMUX_CONF, "attach-session", "-t", sessionName], {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: homedir(),
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });
      } else {
        // Create new tmux session with the command
        console.log(`[pty-server] Creating tmux session: ${sessionName}, cwd=${cwd}${initialCommand ? `, cmd=${initialCommand}` : ""}`);

        // Build the command to run inside tmux.
        // If there's an initial command, run it directly as the tmux shell command.
        // Otherwise just spawn the default shell.
        const tmuxArgs = ["-f", TMUX_CONF, "new-session", "-s", sessionName];

        // Set working directory
        tmuxArgs.push("-c", cwd);

        if (initialCommand) {
          // Run the command inside tmux via the shell so cd, &&, etc. work.
          tmuxArgs.push(shell, "-c", initialCommand);
        }

        ptyProcess = pty.spawn("tmux", tmuxArgs, {
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
      }
    } catch (err) {
      console.error(`[pty-server] Failed to spawn tmux PTY:`, err.message);
      ws.send(JSON.stringify({ type: "exit", exitCode: 1, signal: 0 }));
      ws.close();
      return;
    }

    console.log(`[pty-server] tmux session PID ${ptyProcess.pid}, session=${sessionName}`);
  } else {
    // ─── Normal mode (no tmux) ────────────────────────────────────────
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
    if (initialCommand) {
      setTimeout(() => {
        ptyProcess.write(noExec ? initialCommand : initialCommand + "\n");
      }, 300);
    }
  }

  // PTY -> WebSocket (shell output to browser)
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[pty-server] PTY exited: code=${exitCode} signal=${signal}${isTmux ? " (tmux client detached/exited)" : ""}`);
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
          if (msg.cols && msg.rows && msg.cols >= 2 && msg.rows >= 2) {
            ptyProcess.resize(msg.cols, msg.rows);
          }
          break;
        case "detach":
          // Gracefully detach from tmux (sends prefix + d)
          if (isTmux) {
            ptyProcess.kill();
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
    if (isTmux) {
      // For tmux sessions: kill only the attach/new-session PTY process,
      // NOT the tmux session itself. tmux detaches gracefully when its
      // client process is killed — the session keeps running.
      console.log(`[pty-server] Connection closed, detaching tmux (PID ${ptyProcess.pid})`);
      ptyProcess.kill();
    } else {
      // For normal sessions: kill the shell process
      console.log(`[pty-server] Connection closed, killing PID ${ptyProcess.pid}`);
      ptyProcess.kill();
    }
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
