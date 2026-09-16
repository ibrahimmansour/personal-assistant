import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import {
  buildAgentPath,
  isOpenCodeSessionId,
  OPENCODE_MODEL_RE,
  OPENCODE_VARIANT_RE,
} from "@/lib/opencode-store";

export const dynamic = "force-dynamic";

const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * Headless ("background") prompt runner for the Claude Code widget.
 *
 * Runs a single prompt without an interactive TUI through whichever CLI the
 * session belongs to:
 *
 * - **Claude Code**: `claude -p`. The CLI writes to the same
 *   `~/.claude/projects/.../*.jsonl` session log that the chat view tails via
 *   SSE, so output appears in chat incrementally without a live PTY. The
 *   first prompt of a session is launched with `--session-id <uuid>` (the
 *   client pre-generates the UUID) so we know the id up front; subsequent
 *   prompts use `--resume <uuid>`. `--model` only applies when creating the
 *   session; `--effort` is honoured on every run.
 *
 * - **OpenCode**: `opencode run --format json`. OpenCode mints its own
 *   session id, so a brand-new session cannot be pre-named: we watch the JSON
 *   event stream for the first `sessionID`, answer the request with it right
 *   away (the widget attaches its SSE tail to the SQLite store from there),
 *   and let the run finish in the background. Follow-up prompts pass
 *   `--session <id>` and are awaited to completion like Claude's. `--model`
 *   and `--variant` are per-message in OpenCode, so both are sent every run.
 *
 * We await completion (where we can) so a failure — bad model, auth error,
 * the CLI exiting non-zero — is reported back to the client and surfaced in
 * chat; otherwise the chat would sit silently with no reply.
 */
export async function POST(request: NextRequest) {
  let body: {
    cwd?: string;
    prompt?: string;
    sessionId?: string | null;
    isNew?: boolean;
    model?: string | null;
    agent?: "claude" | "opencode";
    /** Claude: `--effort`. OpenCode: `--variant`. */
    effort?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { prompt, isNew, model } = body;
  const agent = body.agent === "opencode" ? "opencode" : "claude";
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  const effort = typeof body.effort === "string" && body.effort && body.effort !== "default" ? body.effort : null;

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }

  // Resolve cwd. Expand a leading ~ like the scheduler does.
  let cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (cwd.startsWith("~")) cwd = join(homedir(), cwd.slice(1));

  const env = { ...process.env, PATH: buildAgentPath(), NODE_TLS_REJECT_UNAUTHORIZED: "0" };

  if (agent === "opencode") {
    if (!isNew && !sessionId) {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }
    if (sessionId && !isOpenCodeSessionId(sessionId)) {
      return Response.json({ error: "invalid OpenCode session id" }, { status: 400 });
    }
    if (model && model !== "default" && !OPENCODE_MODEL_RE.test(model)) {
      return Response.json({ error: "invalid model id" }, { status: 400 });
    }
    if (effort && !OPENCODE_VARIANT_RE.test(effort)) {
      return Response.json({ error: "invalid variant" }, { status: 400 });
    }
    const args = ["run", "--format", "json", "--auto"];
    if (model && model !== "default") args.push("--model", model);
    if (effort) args.push("--variant", effort);
    if (!isNew && sessionId) args.push("--session", sessionId);
    args.push(prompt);
    return runOpenCode(args, cwd || homedir(), env, !!isNew, sessionId);
  }

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  if (effort && !CLAUDE_EFFORTS.has(effort)) {
    return Response.json({ error: "invalid effort" }, { status: 400 });
  }

  const args: string[] = [];
  // Model only applies when creating a fresh session; resumes inherit it.
  if (isNew && model && model !== "default") args.push("--model", model);
  if (effort) args.push("--effort", effort);
  args.push("--dangerously-skip-permissions");
  if (isNew) args.push("--session-id", sessionId);
  else args.push("--resume", sessionId);
  args.push("-p", prompt);

  const result = await runToCompletion("claude", args, cwd || homedir(), env, 20 * 60_000);
  if (!result.ok) {
    console.error(`[claude-run] ${sessionId} failed: ${result.error}`);
    return Response.json({ error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true, sessionId });
}

interface RunResult {
  ok: boolean;
  error?: string;
}

function runToCompletion(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : "spawn failed" });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    let settled = false;
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(r);
    };
    // Hard cap so a stuck run can't hold the request forever.
    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      done({ ok: false, error: `${bin} run timed out after ${Math.round(timeoutMs / 60_000)} minutes` });
    }, timeoutMs);

    child.on("error", (err) => {
      done({ ok: false, error: `Failed to launch ${bin}: ${err.message}` });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        done({ ok: true });
      } else {
        const detail = (stderr.trim() || stdout.trim() || `${bin} exited with code ${code}`).slice(0, 800);
        done({ ok: false, error: detail });
      }
    });
  });
}

/**
 * OpenCode runner. For a new session, resolves as soon as the JSON event
 * stream names the session (so the widget can start tailing it) and leaves
 * the process to finish on its own; for a resume, waits for exit.
 */
function runOpenCode(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  isNew: boolean,
  sessionId: string | null,
): Promise<Response> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("opencode", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve(Response.json({ error: err instanceof Error ? err.message : "spawn failed" }, { status: 500 }));
      return;
    }

    let settled = false;
    let resolvedId: string | null = sessionId;
    let stderr = "";
    let stdoutTail = "";
    let lineBuf = "";

    const finish = (res: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(res);
    };

    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(Response.json({ error: "opencode run timed out after 20 minutes" }, { status: 500 }));
    }, 20 * 60_000);

    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.stdout?.on("data", (d) => {
      const chunk = d.toString();
      stdoutTail = (stdoutTail + chunk).slice(-2000);
      if (resolvedId && (!isNew || settled)) return;
      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const ev = JSON.parse(t) as { sessionID?: string; part?: { sessionID?: string } };
          const id = ev.sessionID || ev.part?.sessionID;
          if (id && isOpenCodeSessionId(id)) {
            resolvedId = id;
            if (isNew) {
              // The session exists now — hand the id back so the tail can
              // attach. The run keeps going; its output lands in the store.
              finish(Response.json({ ok: true, sessionId: id, running: true }));
            }
            break;
          }
        } catch {}
      }
    });

    child.on("error", (err) => {
      finish(Response.json({ error: `Failed to launch opencode: ${err.message}` }, { status: 500 }));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        if (!resolvedId) {
          finish(Response.json({ error: "opencode finished without reporting a session id" }, { status: 500 }));
        } else {
          finish(Response.json({ ok: true, sessionId: resolvedId }));
        }
      } else {
        const detail = (stderr.trim() || stdoutTail.trim() || `opencode exited with code ${code}`).slice(0, 800);
        console.error(`[opencode-run] ${resolvedId || "new"} failed: ${detail}`);
        finish(Response.json({ error: detail }, { status: 500 }));
      }
    });
  });
}
