import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { homedir } from "os";
import { join, delimiter } from "path";

export const dynamic = "force-dynamic";

/**
 * Build a PATH that includes the common locations where the `claude` CLI is
 * installed, so `spawn("claude")` resolves even when the Next.js dev server
 * was launched from an environment with a minimal PATH (e.g. a GUI launcher).
 * The CLI commonly lives in ~/.local/bin (native installer), or the Homebrew /
 * system bin dirs, or an npm global prefix.
 */
function buildPath(): string {
  const home = homedir();
  const extra = [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const current = process.env.PATH ? process.env.PATH.split(delimiter) : [];
  const merged = [...current, ...extra.filter((p) => !current.includes(p))];
  return merged.join(delimiter);
}

/**
 * Headless ("background") prompt runner for the Claude Code widget.
 *
 * Runs a single prompt through `claude -p` (print mode) without an
 * interactive TUI. The CLI writes to the same `~/.claude/projects/.../*.jsonl`
 * session log that the chat view tails via SSE, so output appears in chat
 * (incrementally) without a live PTY.
 *
 * Multi-turn continuity: the first prompt of a session is launched with
 * `--session-id <uuid>` (the client pre-generates the UUID) so we know the id
 * up front; subsequent prompts use `--resume <uuid>` to continue the same
 * conversation. The `--model` override is only meaningful when creating the
 * session.
 *
 * We await the run to completion so a failure (bad model, auth error, the CLI
 * exiting non-zero, etc.) is reported back to the client and surfaced in chat
 * — otherwise the chat would just sit silently with no reply. Incremental
 * output still streams via the JSONL tail while this request is in flight.
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

  let child;
  try {
    child = spawn("claude", args, {
      cwd: cwd || homedir(),
      env: { ...process.env, PATH: buildPath(), NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "spawn failed" },
      { status: 500 },
    );
  }

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => { stdout += d.toString(); });
  child.stderr?.on("data", (d) => { stderr += d.toString(); });

  const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(r);
    };
    // Hard cap so a stuck run can't hold the request forever.
    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      done({ ok: false, error: "claude run timed out after 20 minutes" });
    }, 20 * 60_000);

    child.on("error", (err) => {
      done({ ok: false, error: `Failed to launch claude: ${err.message}` });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        done({ ok: true });
      } else {
        const detail = (stderr.trim() || stdout.trim() || `claude exited with code ${code}`).slice(0, 800);
        done({ ok: false, error: detail });
      }
    });
  });

  if (!result.ok) {
    console.error(`[claude-run] ${sessionId} failed: ${result.error}`);
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true, sessionId });
}
