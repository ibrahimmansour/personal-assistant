#!/usr/bin/env node

/**
 * Dev launcher: starts PTY server and Next.js concurrently.
 * Handles graceful shutdown of all child processes.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const env = {
  ...process.env,
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
};

const children = [];

function start(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });

  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  child.on("exit", (code, signal) => {
    console.log(`[${label}] exited (code=${code} signal=${signal})`);
  });

  children.push(child);
  return child;
}

// Start PTY server
start("pty", "node", [path.join(ROOT, "server", "pty-server.mjs")]);

// Start Claude Code relay server
start("claude-relay", "node", [path.join(ROOT, "server", "claude-relay", "relay.mjs")]);

// Start Next.js (this one is the "main" process — wait for it)
const next = start("next", "npx", ["next", "dev", "--port", "4444"]);

// If Next.js exits, shut everything down
next.on("exit", () => shutdown());

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
