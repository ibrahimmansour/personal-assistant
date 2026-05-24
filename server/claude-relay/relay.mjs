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

  // Map of active queries by requestId — supports parallel sessions
  // Key: requestId (provisional UUID), value: { instance, abortController, sessionId }
  const activeQueries = new Map();

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
          // Each query gets its own requestId so we can route messages back
          // and abort independently. Multiple queries can run in parallel.
          const requestId = msg.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const abortController = new AbortController();

          const cwd = msg.cwd || DEFAULT_CWD;
          const isolated = msg.isolated === true;
          console.log(`[relay] Query [${requestId}] cwd: ${cwd}, model: ${msg.model || "default"}, sessionId: ${msg.sessionId || "new"}, isolated: ${isolated}`);

          // Build per-query env. By default inherit process.env.
          const queryEnv = { ...process.env };
          let isolatedHomeDir = null;

          // ── Isolated mode ─────────────────────────────────────────
          // When enabled, each query gets its own HOME directory so the bundled
          // CLI writes session state to a private ~/.claude/projects/ tree,
          // preventing two parallel sessions in the same cwd from corrupting
          // each other's session files.
          //
          // Strategy: create an isolated HOME with symlinks to EVERYTHING in
          // ~/.claude/ except `projects/`, plus ~/.claude.json and ~/.claude/.credentials.json.
          // This preserves auth, settings, history, MCP config, plugins etc.
          if (isolated) {
            const { mkdirSync, symlinkSync, existsSync, readdirSync, lstatSync } = await import("fs");
            const { join } = await import("path");
            const { homedir } = await import("os");
            const realHome = homedir();
            // Use sessionId when resuming so the same HOME is reused
            const isolationKey = msg.sessionId || requestId;
            isolatedHomeDir = join("/tmp", "claude-isolated-homes", isolationKey);

            mkdirSync(isolatedHomeDir, { recursive: true });
            mkdirSync(join(isolatedHomeDir, ".claude"), { recursive: true });
            // Create a private projects dir (this is the ONLY thing not shared)
            mkdirSync(join(isolatedHomeDir, ".claude", "projects"), { recursive: true });

            const linkIfMissing = (src, dest) => {
              if (existsSync(src) && !existsSync(dest)) {
                try { symlinkSync(src, dest); } catch (e) {
                  console.log(`[relay] symlink failed ${src} -> ${dest}: ${e.message}`);
                }
              }
            };

            // 1. Symlink top-level files in $HOME (auth, config)
            linkIfMissing(join(realHome, ".claude.json"), join(isolatedHomeDir, ".claude.json"));
            linkIfMissing(join(realHome, ".claude.json.backup"), join(isolatedHomeDir, ".claude.json.backup"));

            // 2. Symlink everything in ~/.claude/ EXCEPT projects/
            try {
              const claudeContents = readdirSync(join(realHome, ".claude"));
              for (const item of claudeContents) {
                if (item === "projects") continue; // skip — we want isolated projects
                const src = join(realHome, ".claude", item);
                const dest = join(isolatedHomeDir, ".claude", item);
                linkIfMissing(src, dest);
              }
            } catch (e) {
              console.log(`[relay] failed to scan ~/.claude: ${e.message}`);
            }

            queryEnv.HOME = isolatedHomeDir;
            console.log(`[relay] [${requestId}] Isolated HOME: ${isolatedHomeDir}`);
          }

          const options = {
            cwd,
            abortController,
            env: queryEnv,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            includePartialMessages: true,
          };

          if (msg.model) {
            options.model = msg.model;
            console.log(`[relay] [${requestId}] Setting model to: ${msg.model}`);
          }
          if (msg.sessionId) options.resume = msg.sessionId;

          let sessionId = msg.sessionId || null;

          // Register the query so it can be aborted independently
          activeQueries.set(requestId, { instance: null, abortController, sessionId, isolatedHomeDir });

          // Tell the client which requestId this query has so it can route messages
          send({ type: "query-started", requestId, sessionId });

          try {
            const q = query({ prompt: msg.prompt, options });
            const entry = activeQueries.get(requestId);
            if (entry) entry.instance = q;

            let lastSendTime = 0;
            let pendingMessage = null;
            let flushTimer = null;

            let msgCount = 0;
            for await (const message of q) {
              if (abortController.signal.aborted) break;

              // Debug: log first few message types
              if (msgCount < 5) {
                console.log(`[relay] [${requestId}] Stream msg #${msgCount}: type=${message.type}${message.type === "stream_event" ? ` event=${message.event?.type}` : ""}${message.model ? ` model=${message.model}` : ""}`);
              }
              msgCount++;

              // Capture session ID from first message
              if (!sessionId && message.session_id) {
                sessionId = message.session_id;
                const entry = activeQueries.get(requestId);
                if (entry) entry.sessionId = sessionId;

                // For isolated new sessions: create a symlink from
                // /tmp/claude-isolated-homes/<sessionId> to .../<requestId>
                // so future resumes can find this HOME via the stable sessionId.
                if (isolated && isolatedHomeDir) {
                  const { symlinkSync, existsSync } = await import("fs");
                  const { join, dirname, basename } = await import("path");
                  const sessionAlias = join(dirname(isolatedHomeDir), sessionId);
                  try {
                    if (!existsSync(sessionAlias) && basename(isolatedHomeDir) !== sessionId) {
                      symlinkSync(isolatedHomeDir, sessionAlias);
                      console.log(`[relay] [${requestId}] Created session alias: ${sessionAlias} -> ${isolatedHomeDir}`);
                    }
                  } catch (e) {
                    console.log(`[relay] session alias failed: ${e.message}`);
                  }
                }

                // Notify client of the resolved session ID
                send({ type: "session-resolved", requestId, sessionId, isolatedHome: isolatedHomeDir });
              }

              // Throttle: send at most every 50ms to avoid overwhelming the browser
              const now = Date.now();
              if (now - lastSendTime >= 50) {
                send({ type: "message", requestId, sessionId, data: message });
                lastSendTime = now;
                pendingMessage = null;
              } else {
                pendingMessage = message;
                if (!flushTimer) {
                  flushTimer = setTimeout(() => {
                    if (pendingMessage) {
                      send({ type: "message", requestId, sessionId, data: pendingMessage });
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
            if (pendingMessage) send({ type: "message", requestId, sessionId, data: pendingMessage });

            send({ type: "done", requestId, sessionId: sessionId || "" });
          } catch (err) {
            if (err.name !== "AbortError") {
              send({ type: "error", requestId, error: err.message || String(err) });
            }
          } finally {
            activeQueries.delete(requestId);
          }
          break;
        }

        case "abort": {
          // Abort a specific query by requestId, or all if not specified
          const targetReqId = msg.requestId;
          const targetSessId = msg.sessionId;

          if (targetReqId && activeQueries.has(targetReqId)) {
            const entry = activeQueries.get(targetReqId);
            try { entry.instance?.interrupt?.(); } catch {}
            entry.abortController.abort();
            activeQueries.delete(targetReqId);
            send({ type: "aborted", requestId: targetReqId });
          } else if (targetSessId) {
            // Abort by sessionId (find matching query)
            for (const [rid, entry] of activeQueries.entries()) {
              if (entry.sessionId === targetSessId) {
                try { entry.instance?.interrupt?.(); } catch {}
                entry.abortController.abort();
                activeQueries.delete(rid);
                send({ type: "aborted", requestId: rid, sessionId: targetSessId });
                break;
              }
            }
          } else {
            // No target specified — abort all (legacy behavior)
            for (const [rid, entry] of activeQueries.entries()) {
              try { entry.instance?.interrupt?.(); } catch {}
              entry.abortController.abort();
            }
            activeQueries.clear();
            send({ type: "aborted" });
          }
          break;
        }

        case "list-sessions": {
          const dir = msg.dir || DEFAULT_CWD;
          console.log(`[relay] list-sessions dir: ${dir}`);

          // 1. List sessions from main HOME
          const sessions = await listSessions({
            dir,
            limit: msg.limit || 50,
            includeWorktrees: false,
          });
          const filtered = sessions.filter(s => !s.cwd || s.cwd === dir);

          // 2. Also scan isolated HOMEs for sessions in this cwd
          const isolatedSessions = [];
          try {
            const { readdir, stat } = await import("fs/promises");
            const { join } = await import("path");
            const isolatedRoot = "/tmp/claude-isolated-homes";
            const entries = await readdir(isolatedRoot).catch(() => []);
            for (const entry of entries) {
              const isoHome = join(isolatedRoot, entry);
              try {
                // Temporarily set HOME so listSessions reads from this isolated dir
                const originalHome = process.env.HOME;
                process.env.HOME = isoHome;
                const isoSessions = await listSessions({
                  dir,
                  limit: msg.limit || 50,
                  includeWorktrees: false,
                });
                process.env.HOME = originalHome;
                for (const s of isoSessions) {
                  if (!s.cwd || s.cwd === dir) {
                    isolatedSessions.push({ ...s, isolated: true, isolatedHome: isoHome });
                  }
                }
              } catch {}
            }
          } catch {}

          // Merge and dedupe by sessionId
          const seen = new Set(filtered.map(s => s.sessionId));
          for (const s of isolatedSessions) {
            if (!seen.has(s.sessionId)) {
              filtered.push(s);
              seen.add(s.sessionId);
            }
          }

          // Sort by lastModified desc
          filtered.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));

          console.log(`[relay] Found ${sessions.length} main + ${isolatedSessions.length} isolated, ${filtered.length} total after dir filter`);
          send({ type: "sessions", sessions: filtered });
          break;
        }

        case "get-messages": {
          if (!msg.sessionId) {
            send({ type: "error", error: "Missing sessionId" });
            break;
          }
          // If isolatedHome is provided, temporarily set HOME to read from there
          const originalHome = process.env.HOME;
          if (msg.isolatedHome) {
            process.env.HOME = msg.isolatedHome;
          }
          let messages;
          try {
            messages = await getSessionMessages(msg.sessionId, {
              dir: msg.dir || DEFAULT_CWD,
              limit: msg.limit || 500,
            });
          } finally {
            if (msg.isolatedHome) process.env.HOME = originalHome;
          }
          // Filter out system messages and parent_tool_use sub-messages for cleaner display
          const filtered = messages.filter(m => 
            (m.type === "user" || m.type === "assistant") && !m.parent_tool_use_id
          );
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

        case "delete-sessions": {
          // Delete session JSON files
          const dir = msg.dir || DEFAULT_CWD;
          const sessionIds = msg.sessionIds || [];
          if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            send({ type: "error", error: "Missing sessionIds array" });
            break;
          }
          const { readdir, unlink, stat } = await import("fs/promises");
          const { join } = await import("path");
          const { homedir } = await import("os");

          // Claude stores sessions in ~/.claude/projects/<sanitized>/sessions/
          // The sanitization varies — try multiple patterns to find the right dir
          const home = homedir();
          const claudeProjectsDir = join(home, ".claude", "projects");
          let sessionsDir = null;

          try {
            const projectDirs = await readdir(claudeProjectsDir);
            // Find the project dir that matches our cwd
            // Claude uses various sanitization: replace / with -, or URL-encode, etc.
            const sanitizations = [
              dir.replace(/^\//, "").replace(/\//g, "-"),  // /home/user/foo -> home-user-foo
              dir.replace(/\//g, "-").replace(/^-/, ""),    // same
              encodeURIComponent(dir),                       // URL encoded
              dir.replaceAll("/", "%2F"),                   // percent-encoded slashes
            ];

            for (const projDir of projectDirs) {
              if (sanitizations.includes(projDir)) {
                // Check if it has a sessions subdirectory or session files directly
                const candidate = join(claudeProjectsDir, projDir);
                try {
                  const subItems = await readdir(candidate);
                  if (subItems.includes("sessions")) {
                    sessionsDir = join(candidate, "sessions");
                  } else if (subItems.some(f => f.endsWith(".jsonl") || f.endsWith(".json"))) {
                    sessionsDir = candidate;
                  }
                } catch {}
                if (sessionsDir) break;
              }
            }

            // Fallback: scan all project dirs for matching session IDs
            if (!sessionsDir) {
              for (const projDir of projectDirs) {
                const candidate = join(claudeProjectsDir, projDir);
                try {
                  // Check sessions/ subdir first
                  const sessSubDir = join(candidate, "sessions");
                  const sessFiles = await readdir(sessSubDir).catch(() => null);
                  if (sessFiles && sessFiles.some(f => sessionIds.some(id => f.includes(id)))) {
                    sessionsDir = sessSubDir;
                    break;
                  }
                  // Check top-level
                  const topFiles = await readdir(candidate);
                  if (topFiles.some(f => sessionIds.some(id => f.includes(id)))) {
                    sessionsDir = candidate;
                    break;
                  }
                } catch {}
              }
            }
          } catch (err) {
            console.log(`[relay] Could not read projects dir: ${err.message}`);
          }

          let deleted = 0;
          if (sessionsDir) {
            console.log(`[relay] Found sessions dir: ${sessionsDir}`);
            try {
              const files = await readdir(sessionsDir);
              for (const id of sessionIds) {
                const filename = files.find(f => f.includes(id));
                if (filename) {
                  await unlink(join(sessionsDir, filename));
                  deleted++;
                  console.log(`[relay] Deleted session file: ${filename}`);
                }
              }
            } catch (err) {
              console.log(`[relay] delete error: ${err.message}`);
            }
          } else {
            console.log(`[relay] Could not find sessions directory for cwd: ${dir}`);
          }

          console.log(`[relay] Deleted ${deleted}/${sessionIds.length} sessions`);
          // Return refreshed session list
          const sessions = await listSessions({ dir, limit: 50, includeWorktrees: false });
          const filtered = sessions.filter(s => !s.cwd || s.cwd === dir);
          send({ type: "sessions-deleted", deleted, sessions: filtered });
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
    console.log("Client disconnected, aborting all active queries");
    for (const [rid, entry] of activeQueries.entries()) {
      try { entry.instance?.interrupt?.(); } catch {}
      try { entry.abortController.abort(); } catch {}
    }
    activeQueries.clear();
  });
});
