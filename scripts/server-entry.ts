/**
 * Entry point for the compiled binary.
 * Starts the Next.js standalone server and the PTY WebSocket server.
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { existsSync } from "fs";

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

// Start PTY server as a separate Node.js process (node-pty requires native bindings)
function startPtyServer() {
  const ptyScript = join(BINARY_DIR, "pty-server.mjs");
  if (!existsSync(ptyScript)) {
    console.warn("PTY server script not found at", ptyScript);
    return;
  }

  const child = spawn("node", [ptyScript], {
    env: {
      ...process.env,
      PTY_PORT: String(PTY_PORT),
    },
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.warn(`PTY server failed to start: ${err.message}`);
    console.warn("Install node-pty: cd ~/.personal-assistant/bin && npm init -y && npm install node-pty ws");
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.warn(`PTY server exited with code ${code}`);
    }
  });
}

// Start Claude Code relay server
function startClaudeRelay() {
  const relayScript = join(BINARY_DIR, "server/claude-relay/relay.mjs");
  if (!existsSync(relayScript)) {
    console.warn("Claude relay server not found at", relayScript);
    return;
  }

  const RELAY_PORT = parseInt(process.env.CLAUDE_RELAY_PORT || "4446", 10);
  const child = spawn("node", [relayScript], {
    env: {
      ...process.env,
      PORT: String(RELAY_PORT),
    },
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.warn(`Claude relay failed to start: ${err.message}`);
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.warn(`Claude relay exited with code ${code}`);
    }
  });
}

console.log(`Starting Personal Assistant on port ${PORT}...`);
startClaudeRelay();
startPtyServer();
startNext();
