import { NextRequest } from "next/server";
import { watch as fsWatch } from "fs";
import { promises as fsp } from "fs";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

// Structured chat message shape sent to the client
export interface ChatMessage {
  id: string;                // uuid from the JSONL line
  role: "user" | "assistant";
  text: string;              // already-flattened text content (assistant text blocks joined; user content as-is)
  toolUses?: { name: string; id?: string; input?: unknown }[]; // optional, for "tool calls happened in this turn" indicator
  /** Tool results from the user turn that follows a tool_use assistant turn.
   *  Keyed by tool_use_id so the client can match them to the preceding tool_use. */
  toolResults?: { toolUseId: string; content: string; isError?: boolean }[];
  /** Token usage for this assistant turn (from Claude API response). */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  /** Assistant `stop_reason`: end_turn | tool_use | max_tokens | stop_sequence | null. Used by the
   *  client to decide whether the session is still working ("thinking" indicator). */
  stopReason?: string | null;
  timestamp: string;
}

// Parse one JSONL line into a ChatMessage (or null to skip).
//
// The CLI logs many entry types (permission-mode, file-history-snapshot,
// system, last-prompt, attachment, summary, etc). We only surface user and
// assistant turns that have human-visible text, and we accept several shapes
// for `message.content` (string, array of typed blocks, or even a stringified
// JSON array — older versions of the CLI emitted that).

interface ParsedJsonlLine {
  type?: string;
  message?: {
    content?: unknown;
    usage?: Record<string, number>;
    id?: string;
    stop_reason?: string;
  };
  uuid?: string;
  timestamp?: string;
}

function parseLine(raw: string): ChatMessage | null {
  let parsed: ParsedJsonlLine;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed?.type === "user") {
    const msg = parsed.message;
    if (!msg) return null;
    const text = extractTextFromContent(msg.content, /*forUser*/ true);
    const toolResults = extractToolResults(msg.content);
    // If this turn is entirely tool_results with no user text, still emit it
    // so the client can pair results with the preceding tool_use.
    if (!text && toolResults.length === 0) return null;
    // Skip CLI meta-messages. Claude wraps internal command bookkeeping in
    // tags like <command-name>, <local-command-stdout>, <local-command-caveat>,
    // etc. None of these are user-typed and they shouldn't appear in chat.
    if (text && isCliMetaText(text) && toolResults.length === 0) return null;
    return {
      id: parsed.uuid || `u-${parsed.timestamp || ""}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      text: text && !isCliMetaText(text) ? text : "",
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      timestamp: parsed.timestamp || "",
    };
  }

  if (parsed?.type === "assistant") {
    const msg = parsed.message;
    if (!msg) return null;
    const text = extractTextFromContent(msg.content, /*forUser*/ false);
    const toolUses = extractToolUses(msg.content);
    if (!text && toolUses.length === 0) return null;

    // Extract usage data from the API response.
    let usage: ChatMessage["usage"] | undefined;
    const rawUsage = msg.usage;
    if (rawUsage && typeof rawUsage === "object") {
      usage = {
        inputTokens: rawUsage.input_tokens || 0,
        outputTokens: rawUsage.output_tokens || 0,
        cacheReadInputTokens: rawUsage.cache_read_input_tokens || 0,
        cacheCreationInputTokens: rawUsage.cache_creation_input_tokens || 0,
      };
    }

    return {
      id: parsed.uuid || msg.id || `a-${parsed.timestamp || ""}-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      text,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      usage,
      stopReason: typeof msg.stop_reason === "string" ? msg.stop_reason : null,
      timestamp: parsed.timestamp || "",
    };
  }

  return null;
}

// Detect Claude CLI meta-messages that shouldn't appear in the chat UI.
// The CLI wraps internal command bookkeeping in tags like
//   <command-name>, <command-message>, <command-args>,
//   <local-command-stdout>, <local-command-stderr>, <local-command-caveat>,
// and the message often begins with one of those tags. We also catch
// messages that consist *entirely* of one or more wrapped blocks of those
// tag families with nothing else.
function isCliMetaText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^<(command-[a-z-]+|local-command-[a-z-]+)>/i.test(trimmed)) return true;
  // Also treat content that's only meta blocks (e.g. wrapped twice) as meta.
  const stripped = trimmed.replace(/<\/?(command-[a-z-]+|local-command-[a-z-]+)>/gi, "").trim();
  if (!stripped) return true;
  return false;
}

// Pull human-visible text out of a `message.content` field with various shapes.
function extractTextFromContent(content: unknown, forUser: boolean): string {
  if (typeof content === "string") {
    // Some older CLI versions wrap content in a JSON-stringified array.
    if (content.startsWith("[") && content.includes('"type"')) {
      try {
        const arr = JSON.parse(content);
        if (Array.isArray(arr)) return extractTextFromContent(arr, forUser);
      } catch {}
    }
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
    }
    // For user turns, a turn made entirely of tool_results contributes no
    // user-visible text and should be skipped (parseLine returns null when
    // text is empty AND there are no tool_uses for assistants; user turns
    // with only tool_results return "" here, which parseLine treats as skip).
    return parts.join("\n").trim();
  }
  // Defensive: object with `.text` field
  if (content && typeof content === "object" && "text" in content) {
    const t = (content as { text?: unknown }).text;
    if (typeof t === "string") return t.trim();
  }
  return "";
}

function extractToolUses(content: unknown): { name: string; id?: string; input?: unknown }[] {
  const result: { name: string; id?: string; input?: unknown }[] = [];
  if (!Array.isArray(content)) return result;
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") {
      const b = block as { name?: string; id?: string; input?: unknown };
      result.push({ name: b.name || "tool", id: b.id, input: b.input });
    }
  }
  return result;
}

/** Extract tool_result blocks from a user turn (the turn that follows a tool_use). */
function extractToolResults(content: unknown): { toolUseId: string; content: string; isError?: boolean }[] {
  const result: { toolUseId: string; content: string; isError?: boolean }[] = [];
  if (!Array.isArray(content)) return result;
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "tool_result") {
      const b = block as { tool_use_id?: string; content?: unknown; is_error?: boolean };
      let text = "";
      if (typeof b.content === "string") {
        text = b.content;
      } else if (Array.isArray(b.content)) {
        text = b.content
          .filter((c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "text")
          .map((c: unknown) => (c as { text?: string }).text || "")
          .join("\n");
      }
      // Truncate very large outputs to keep the SSE payload reasonable.
      if (text.length > 3000) {
        text = text.slice(0, 3000) + "\n… (truncated)";
      }
      if (b.tool_use_id) {
        result.push({ toolUseId: b.tool_use_id, content: text, isError: b.is_error || undefined });
      }
    }
  }
  return result;
}

// Find the JSONL path for a sessionId. The sessionId may live in any project dir
// (the user might switch projects), so search.
async function locateSessionFile(sessionId: string, hintProjectDir?: string): Promise<string | null> {
  // Quick path: check the hinted project dir first
  if (hintProjectDir) {
    const direct = join(CLAUDE_PROJECTS_DIR, hintProjectDir, `${sessionId}.jsonl`);
    try {
      await fsp.access(direct);
      return direct;
    } catch {}
  }

  try {
    const projects = await fsp.readdir(CLAUDE_PROJECTS_DIR);
    for (const dir of projects) {
      const candidate = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      try {
        await fsp.access(candidate);
        return candidate;
      } catch {}
    }
  } catch {}

  return null;
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const projectDir = request.nextUrl.searchParams.get("projectDir") || undefined;

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const filePath = await locateSessionFile(sessionId, projectDir);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // If the file doesn't exist yet (brand-new session before the CLI writes anything),
      // poll for its appearance.
      let resolvedPath = filePath;
      let tries = 0;
      while (!resolvedPath && !closed && tries < 60) {
        await new Promise((r) => setTimeout(r, 500));
        resolvedPath = await locateSessionFile(sessionId, projectDir);
        tries++;
      }

      if (!resolvedPath) {
        send("messages", { messages: [], note: "no session file yet" });
        // Keep stream open and continue searching periodically
        const searchInterval = setInterval(async () => {
          if (closed) {
            clearInterval(searchInterval);
            return;
          }
          const found = await locateSessionFile(sessionId, projectDir);
          if (found) {
            clearInterval(searchInterval);
            resolvedPath = found;
            await streamFile(found);
          }
        }, 1000);
        return;
      }

      await streamFile(resolvedPath);

      async function streamFile(path: string) {
        let offset = 0;
        let buffer = "";
        const accumulated: ChatMessage[] = [];

        const readNew = async (initial: boolean) => {
          if (closed) return;
          try {
            const st = await fsp.stat(path);
            if (st.size < offset) {
              // File was truncated/replaced — reset
              offset = 0;
              buffer = "";
              accumulated.length = 0;
            }
            if (st.size === offset) {
              // No new bytes since last read. On the *initial* call we still
              // need to send an empty replace so the client knows we connected
              // (otherwise the chat sits on "Waiting for first message…").
              if (initial) {
                send("messages", { messages: accumulated, replace: true });
              }
              return;
            }

            const fd = await fsp.open(path, "r");
            try {
              const len = st.size - offset;
              const buf = Buffer.alloc(len);
              await fd.read(buf, 0, len, offset);
              buffer += buf.toString("utf-8");
              offset = st.size;
            } finally {
              await fd.close();
            }

            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // keep partial last line for next round
            const newMessages: ChatMessage[] = [];
            for (const line of lines) {
              if (!line.trim()) continue;
              const m = parseLine(line);
              if (m) {
                newMessages.push(m);
                accumulated.push(m);
              }
            }

            if (initial) {
              send("messages", { messages: accumulated, replace: true });
            } else if (newMessages.length > 0) {
              send("messages", { messages: newMessages, replace: false });
            }
          } catch {}
        };

        await readNew(true);

        // Watch for changes via fs.watch + a polling fallback (fs.watch is unreliable on macOS)
        let watcher: ReturnType<typeof fsWatch> | null = null;
        try {
          watcher = fsWatch(path, { persistent: false }, () => {
            readNew(false);
          });
        } catch {}

        const pollInterval = setInterval(() => {
          if (closed) {
            clearInterval(pollInterval);
            return;
          }
          readNew(false);
        }, 750);

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
          if (closed) {
            clearInterval(heartbeat);
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            closed = true;
            clearInterval(heartbeat);
          }
        }, 15000);

        // Cleanup when client disconnects
        const onAbort = () => {
          closed = true;
          clearInterval(pollInterval);
          clearInterval(heartbeat);
          try { watcher?.close(); } catch {}
          try { controller.close(); } catch {}
        };
        request.signal.addEventListener("abort", onAbort);
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
