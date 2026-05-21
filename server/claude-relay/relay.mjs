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
import {
  query,
  listSessions,
  getSessionMessages,
  renameSession,
} from "@anthropic-ai/claude-agent-sdk";

const PORT = parseInt(process.env.PORT || "4446", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const DEFAULT_CWD = process.env.DEFAULT_CWD || process.cwd();

const wss = new WebSocketServer({ port: PORT });

console.log(`Claude Code relay server listening on ws://0.0.0.0:${PORT}`);
if (AUTH_TOKEN) console.log("Authentication enabled");
console.log(`Default CWD: ${DEFAULT_CWD}`);

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

          const options = {
            cwd: msg.cwd || DEFAULT_CWD,
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

            for await (const message of q) {
              if (abortController.signal.aborted) break;

              // Capture session ID from first message
              if (!sessionId && message.session_id) {
                sessionId = message.session_id;
              }

              send({ type: "message", data: message });
            }

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
            limit: msg.limit || 100,
          });
          send({ type: "messages", messages, sessionId: msg.sessionId });
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
