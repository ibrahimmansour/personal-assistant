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

          // 1. List sessions from main HOME via SDK
          const sessions = await listSessions({
            dir,
            limit: msg.limit || 50,
            includeWorktrees: false,
          });
          const filtered = sessions.filter(s => !s.cwd || s.cwd === dir);

          // 2. Scan isolated HOMEs by reading their session JSONL files directly.
          // Don't use listSessions() here because it uses os.homedir() (cached
          // at process start) and ignores process.env.HOME mutations.
          const isolatedSessions = [];
          try {
            const { readdir, readFile, stat } = await import("fs/promises");
            const { join } = await import("path");
            const isolatedRoot = "/tmp/claude-isolated-homes";
            // Sanitize cwd the same way Claude Code does:
            // /home/user/foo -> -home-user-foo (replace / with -)
            const sanitizedCwd = dir.replace(/\//g, "-");
            const entries = await readdir(isolatedRoot).catch(() => []);
            console.log(`[relay] Scanning ${entries.length} isolated HOMEs for cwd ${dir} (sanitized: ${sanitizedCwd})`);

            for (const entry of entries) {
              const isoHome = join(isolatedRoot, entry);
              const projectsDir = join(isoHome, ".claude", "projects", sanitizedCwd);
              try {
                const projectStat = await stat(projectsDir).catch(() => null);
                if (!projectStat || !projectStat.isDirectory()) continue;
                const sessionFiles = await readdir(projectsDir).catch(() => []);
                for (const f of sessionFiles) {
                  if (!f.endsWith(".jsonl") && !f.endsWith(".json")) continue;
                  const sessionId = f.replace(/\.(jsonl|json)$/, "");
                  const filePath = join(projectsDir, f);
                  try {
                    const fStat = await stat(filePath);
                    // Read first line to extract first prompt as summary
                    const content = await readFile(filePath, "utf-8");
                    const lines = content.split("\n").filter(Boolean);
                    let firstPrompt = "";
                    let summary = "";
                    for (const line of lines) {
                      try {
                        const parsed = JSON.parse(line);
                        if (parsed.type === "user" && !firstPrompt) {
                          // Extract first text prompt
                          const m = parsed.message;
                          if (typeof m === "string") firstPrompt = m;
                          else if (typeof m?.content === "string") firstPrompt = m.content;
                          else if (Array.isArray(m?.content)) {
                            const t = m.content.find(b => b.type === "text");
                            if (t?.text) firstPrompt = t.text;
                          } else if (typeof parsed.prompt === "string") {
                            firstPrompt = parsed.prompt;
                          }
                          if (firstPrompt) firstPrompt = firstPrompt.slice(0, 100);
                        }
                        if (parsed.type === "summary" || parsed.customTitle) {
                          summary = parsed.summary || parsed.customTitle || summary;
                        }
                      } catch {}
                      if (firstPrompt && summary) break;
                    }
                    isolatedSessions.push({
                      sessionId,
                      summary: summary || firstPrompt.slice(0, 60) || "Untitled",
                      firstPrompt,
                      lastModified: fStat.mtimeMs,
                      cwd: dir,
                      isolated: true,
                      isolatedHome: isoHome,
                    });
                  } catch (e) {
                    console.log(`[relay] error reading ${filePath}: ${e.message}`);
                  }
                }
              } catch {}
            }
          } catch (e) {
            console.log(`[relay] isolated scan error: ${e.message}`);
          }

          // Merge and dedupe by sessionId (prefer isolated entry since it has the home path)
          const seen = new Set();
          const merged = [];
          for (const s of isolatedSessions) {
            if (!seen.has(s.sessionId)) {
              merged.push(s);
              seen.add(s.sessionId);
            }
          }
          for (const s of filtered) {
            if (!seen.has(s.sessionId)) {
              merged.push(s);
              seen.add(s.sessionId);
            }
          }

          // Sort by lastModified desc
          merged.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));

          console.log(`[relay] Found ${sessions.length} main + ${isolatedSessions.length} isolated, ${merged.length} total after dedupe`);
          send({ type: "sessions", sessions: merged });
          break;
        }

        case "get-messages": {
          if (!msg.sessionId) {
            send({ type: "error", error: "Missing sessionId" });
            break;
          }
          let messages;
          if (msg.isolatedHome) {
            // Read directly from the isolated HOME's session file
            // (don't trust process.env.HOME mutation — SDK caches os.homedir())
            const { readFile, readdir } = await import("fs/promises");
            const { join } = await import("path");
            const dir = msg.dir || DEFAULT_CWD;
            const sanitizedCwd = dir.replace(/\//g, "-");
            const projectsDir = join(msg.isolatedHome, ".claude", "projects", sanitizedCwd);
            console.log(`[relay] get-messages from isolated: ${projectsDir} session=${msg.sessionId}`);
            messages = [];
            try {
              const files = await readdir(projectsDir).catch(() => []);
              const sessionFile = files.find(f => f.startsWith(msg.sessionId));
              if (sessionFile) {
                const content = await readFile(join(projectsDir, sessionFile), "utf-8");
                const lines = content.split("\n").filter(Boolean);
                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === "user" || parsed.type === "assistant") {
                      messages.push(parsed);
                    }
                  } catch {}
                }
                console.log(`[relay] read ${messages.length} messages from isolated session`);
              } else {
                console.log(`[relay] isolated session file not found in ${projectsDir}`);
              }
            } catch (e) {
              console.log(`[relay] isolated read error: ${e.message}`);
            }
          } else {
            messages = await getSessionMessages(msg.sessionId, {
              dir: msg.dir || DEFAULT_CWD,
              limit: msg.limit || 500,
            });
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
