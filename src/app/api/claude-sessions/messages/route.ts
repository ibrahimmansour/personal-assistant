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
  toolUses?: { name: string; input?: unknown }[]; // optional, for "tool calls happened in this turn" indicator
  timestamp: string;
}

// Parse one JSONL line into a ChatMessage (or null to skip)
function parseLine(raw: string): ChatMessage | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed?.type === "user") {
    const msg = parsed.message;
    if (!msg) return null;
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Filter out tool_result blocks - they are not user-facing
      const textBlocks = msg.content.filter((b: any) => b?.type === "text");
      if (textBlocks.length === 0) return null; // pure tool_result turn → skip in chat view
      text = textBlocks.map((b: any) => b.text || "").join("\n");
    }
    if (!text.trim()) return null;
    // Skip slash-command meta strings like "<command-name>..." that the CLI emits
    if (text.startsWith("<command-name>") || text.startsWith("<local-command-stdout>")) return null;
    return {
      id: parsed.uuid || `u-${parsed.timestamp || Date.now()}`,
      role: "user",
      text,
      timestamp: parsed.timestamp || "",
    };
  }

  if (parsed?.type === "assistant") {
    const msg = parsed.message;
    if (!msg || !Array.isArray(msg.content)) return null;
    const textParts: string[] = [];
    const toolUses: { name: string; input?: unknown }[] = [];
    for (const block of msg.content) {
      if (block?.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block?.type === "tool_use") {
        toolUses.push({ name: block.name || "tool", input: block.input });
      }
    }
    const text = textParts.join("\n").trim();
    if (!text && toolUses.length === 0) return null;
    return {
      id: parsed.uuid || msg.id || `a-${parsed.timestamp || Date.now()}`,
      role: "assistant",
      text,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      timestamp: parsed.timestamp || "",
    };
  }

  return null;
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
            if (st.size === offset) return;

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
