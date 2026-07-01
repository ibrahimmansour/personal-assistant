import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * Headless ("background") prompt runner for the Claude Code widget.
 *
 * Runs a single prompt through `claude -p` (print mode) without an
 * interactive TUI. The CLI writes to the same `~/.claude/projects/.../*.jsonl`
 * session log that the chat view tails via SSE, so output appears in chat
 * without a live PTY.
 *
 * Multi-turn continuity: the first prompt of a session is launched with
 * `--session-id <uuid>` (the client pre-generates the UUID) so we know the id
 * up front; subsequent prompts use `--resume <uuid>` to continue the same
 * conversation. The `--model` override is only meaningful when creating the
 * session.
 *
 * Fire-and-forget: the process is spawned and detached; we respond
 * immediately. Progress/results surface through the JSONL tail.
 */
export async function POST(request: NextRequest) {
  let body: {
    cwd?: string;
    prompt?: string;
    sessionId?: string;
    isNew?: boolean;
    model?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { prompt, sessionId, isNew, model } = body;

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  // Resolve cwd. Expand a leading ~ like the scheduler does.
  let cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (cwd.startsWith("~")) cwd = join(homedir(), cwd.slice(1));

  const args: string[] = [];
  // Model only applies when creating a fresh session; resumes inherit it.
  if (isNew && model && model !== "default") args.push("--model", model);
  args.push("--dangerously-skip-permissions");
  if (isNew) args.push("--session-id", sessionId);
  else args.push("--resume", sessionId);
  args.push("-p", prompt);

  try {
    const child = spawn("claude", args, {
      cwd: cwd || homedir(),
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    // Hard cap so a stuck background run can't linger forever.
    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 20 * 60_000);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      console.error(`[claude-run] spawn error for ${sessionId}:`, err.message);
    });
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        console.error(`[claude-run] ${sessionId} exited ${code}: ${stderr.slice(0, 500)}`);
      }
    });

    // Detach from the request lifecycle — this outlives the HTTP response.
    child.unref();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "spawn failed" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, sessionId });
}
