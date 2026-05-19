/**
 * Entry point for the compiled binary.
 * Starts the Next.js standalone server and the PTY WebSocket server.
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { WebSocketServer } from "ws";

const BINARY_DIR = dirname(process.execPath);
const SERVER_DIR = join(BINARY_DIR, "server");
const PORT = parseInt(process.env.PORT || "4444", 10);
const PTY_PORT = parseInt(process.env.PTY_PORT || "4445", 10);

// Start Next.js standalone server
function startNext() {
  const serverJs = join(SERVER_DIR, "server.js");
  if (!existsSync(serverJs)) {
    console.error(`Next.js server not found at ${serverJs}`);
    process.exit(1);
  }

  const child = spawn("node", [serverJs], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: "0.0.0.0",
    },
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    console.log(`Next.js server exited with code ${code}`);
    process.exit(code || 0);
  });

  return child;
}

// Start PTY WebSocket server (inline, simplified)
function startPtyServer() {
  try {
    // node-pty may not be available in all environments
    const pty = require("node-pty");
    const wss = new WebSocketServer({ port: PTY_PORT });

    wss.on("connection", (ws) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || "/",
        env: process.env,
      });

      ptyProcess.onData((data: string) => ws.send(data));
      ws.on("message", (msg: Buffer) => {
        const str = msg.toString();
        try {
          const parsed = JSON.parse(str);
          if (parsed.type === "resize") {
            ptyProcess.resize(parsed.cols, parsed.rows);
            return;
          }
        } catch {}
        ptyProcess.write(str);
      });
      ws.on("close", () => ptyProcess.kill());
    });

    console.log(`PTY server listening on port ${PTY_PORT}`);
  } catch (e) {
    console.warn("PTY server not available (node-pty missing):", (e as Error).message);
  }
}

console.log(`Starting Personal Assistant on port ${PORT}...`);
startPtyServer();
startNext();
