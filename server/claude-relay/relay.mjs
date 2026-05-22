/**
 * Claude Code WebSocket Relay Server
 *
 * Runs on the VPS alongside the claude CLI (authenticated with your subscription).
 * Exposes a WebSocket server that the dashboard widget connects to.
 *
 * Protocol:
 *   Client → Server (JSON):
 *     { type: "query", sessionId?: string, prompt: string, cwd?: string, model?: string }
 *     { type: "abort" }
 *     { type: "list-sessions", dir?: string, limit?: number }
 *     { type: "get-messages", sessionId: string, dir?: string, limit?: number }
 *     { type: "rename-session", sessionId: string, title: string }
 *
 *   Server → Client (JSON):
 *     { type: "message", data: SDKMessage }
 *     { type: "done", sessionId: string }
 *     { type: "error", error: string }
 *     { type: "sessions", sessions: SDKSessionInfo[] }
 *     { type: "messages", messages: SessionMessage[] }
 *
 * Environment:
 *   PORT           — WebSocket port (default: 4446)
 *   AUTH_TOKEN     — Optional bearer token for authentication
 *   DEFAULT_CWD   — Default working directory for new sessions
 */

import { WebSocketServer } from "ws";
import { execSync } from "child_process";
import {
  query,
  listSessions,
  getSessionMessages,
  renameSession,
} from "@anthropic-ai/claude-agent-sdk";

const PORT = parseInt(process.env.PORT || "4446", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const DEFAULT_CWD = process.env.DEFAULT_CWD || process.env.HOME || process.cwd();

// Prevent unhandled errors from crashing the process
process.on("uncaughtException", (err) => {
  console.error("[claude-relay] uncaughtException:", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("[claude-relay] unhandledRejection:", err);
});

const wss = new WebSocketServer({ port: PORT });

console.log(`Claude Code relay server listening on ws://0.0.0.0:${PORT}`);
if (AUTH_TOKEN) console.log("Authentication enabled");
console.log(`Default CWD: ${DEFAULT_CWD}`);

function parseWorktrees(output) {
  const worktrees = [];
  let current = {};
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "") {
      if (current.path) worktrees.push(current);
      current = {};
    }
  }
  if (current.path) worktrees.push(current);
  return worktrees;
}

wss.on("connection", (ws, req) => {
  // Auth check
  if (AUTH_TOKEN) {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const token = url.searchParams.get("token") ||
      req.headers.authorization?.replace("Bearer ", "");
    if (token !== AUTH_TOKEN) {
      ws.close(4001, "Unauthorized");
      return;
    }
  }

  console.log("Client connected");

  let activeAbortController = null;
  let activeQuery = null;

  function send(msg) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: "error", error: "Invalid JSON" });
      return;
    }

    try {
      switch (msg.type) {
        case "query": {
          // Abort any previous active query
          if (activeAbortController) {
            activeAbortController.abort();
          }

          const abortController = new AbortController();
          activeAbortController = abortController;

          const cwd = msg.cwd || DEFAULT_CWD;
          console.log(`[relay] Query cwd: ${cwd}, model: ${msg.model || "default"}, sessionId: ${msg.sessionId || "new"}`);

          const options = {
            cwd,
            abortController,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
          };

          if (msg.model) options.model = msg.model;
          if (msg.sessionId) options.resume = msg.sessionId;

          let sessionId = msg.sessionId || null;

          try {
            const q = query({ prompt: msg.prompt, options });
            activeQuery = q;

            let lastSendTime = 0;
            let pendingMessage = null;
            let flushTimer = null;

            for await (const message of q) {
              if (abortController.signal.aborted) break;

              // Capture session ID from first message
              if (!sessionId && message.session_id) {
                sessionId = message.session_id;
              }

              // Throttle: send at most every 50ms to avoid overwhelming the browser
              const now = Date.now();
              if (now - lastSendTime >= 50) {
                send({ type: "message", data: message });
                lastSendTime = now;
                pendingMessage = null;
              } else {
                pendingMessage = message;
                if (!flushTimer) {
                  flushTimer = setTimeout(() => {
                    if (pendingMessage) {
                      send({ type: "message", data: pendingMessage });
                      lastSendTime = Date.now();
                      pendingMessage = null;
                    }
                    flushTimer = null;
                  }, 50);
                }
              }
            }

            // Flush any remaining message
            if (flushTimer) clearTimeout(flushTimer);
            if (pendingMessage) send({ type: "message", data: pendingMessage });

            send({ type: "done", sessionId: sessionId || "" });
          } catch (err) {
            if (err.name !== "AbortError") {
              send({ type: "error", error: err.message || String(err) });
            }
          } finally {
            activeQuery = null;
            activeAbortController = null;
          }
          break;
        }

        case "abort": {
          if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
          }
          if (activeQuery && activeQuery.interrupt) {
            activeQuery.interrupt();
          }
          send({ type: "aborted" });
          break;
        }

        case "list-sessions": {
          const sessions = await listSessions({
            dir: msg.dir || DEFAULT_CWD,
            limit: msg.limit || 50,
          });
          send({ type: "sessions", sessions });
          break;
        }

        case "get-messages": {
          if (!msg.sessionId) {
            send({ type: "error", error: "Missing sessionId" });
            break;
          }
          const messages = await getSessionMessages(msg.sessionId, {
            dir: msg.dir || DEFAULT_CWD,
            limit: msg.limit || 500,
          });
          // Filter out system messages and parent_tool_use sub-messages for cleaner display
          const filtered = messages.filter(m => 
            (m.type === "user" || m.type === "assistant") && !m.parent_tool_use_id
          );
          // Debug: log first user message structure
          const firstUser = filtered.find(m => m.type === "user");
          if (firstUser) console.log("[relay] Sample user message structure:", JSON.stringify(firstUser, null, 2).slice(0, 500));
          send({ type: "messages", messages: filtered, sessionId: msg.sessionId });
          break;
        }

        case "rename-session": {
          if (!msg.sessionId || !msg.title) {
            send({ type: "error", error: "Missing sessionId or title" });
            break;
          }
          await renameSession(msg.sessionId, msg.title, {
            dir: msg.dir || DEFAULT_CWD,
          });
          send({ type: "renamed", sessionId: msg.sessionId, title: msg.title });
          break;
        }

        case "list-worktrees": {
          const dir = msg.dir || DEFAULT_CWD;
          try {
            const output = execSync("git worktree list --porcelain", { cwd: dir, encoding: "utf-8" });
            const worktrees = parseWorktrees(output);
            send({ type: "worktrees", worktrees, dir });
          } catch (err) {
            send({ type: "error", error: `Not a git repo or git not available: ${err.message}` });
          }
          break;
        }

        case "add-worktree": {
          const dir = msg.dir || DEFAULT_CWD;
          const { branch, path: wtPath, newBranch } = msg;
          if (!wtPath) {
            send({ type: "error", error: "Missing path for worktree" });
            break;
          }
          try {
            let cmd = `git worktree add "${wtPath}"`;
            if (newBranch) {
              cmd += ` -b "${newBranch}"`;
            } else if (branch) {
              cmd += ` "${branch}"`;
            }
            execSync(cmd, { cwd: dir, encoding: "utf-8", stdio: "pipe" });
            // Return updated list
            const output = execSync("git worktree list --porcelain", { cwd: dir, encoding: "utf-8" });
            const worktrees = parseWorktrees(output);
            send({ type: "worktree-added", worktrees, path: wtPath });
          } catch (err) {
            send({ type: "error", error: `Failed to add worktree: ${err.message}` });
          }
          break;
        }

        case "remove-worktree": {
          const dir = msg.dir || DEFAULT_CWD;
          const { path: wtPath, force } = msg;
          if (!wtPath) {
            send({ type: "error", error: "Missing path for worktree removal" });
            break;
          }
          try {
            const cmd = force ? `git worktree remove --force "${wtPath}"` : `git worktree remove "${wtPath}"`;
            execSync(cmd, { cwd: dir, encoding: "utf-8", stdio: "pipe" });
            const output = execSync("git worktree list --porcelain", { cwd: dir, encoding: "utf-8" });
            const worktrees = parseWorktrees(output);
            send({ type: "worktree-removed", worktrees });
          } catch (err) {
            send({ type: "error", error: `Failed to remove worktree: ${err.message}` });
          }
          break;
        }

        case "list-branches": {
          const dir = msg.dir || DEFAULT_CWD;
          try {
            const output = execSync("git branch -a --format='%(refname:short)'", { cwd: dir, encoding: "utf-8" });
            const branches = output.trim().split("\n").filter(Boolean);
            send({ type: "branches", branches });
          } catch (err) {
            send({ type: "error", error: `Failed to list branches: ${err.message}` });
          }
          break;
        }

        default:
          send({ type: "error", error: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      send({ type: "error", error: err.message || String(err) });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (activeAbortController) {
      activeAbortController.abort();
    }
  });
});
