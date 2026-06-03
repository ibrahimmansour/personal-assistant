import { NextRequest } from "next/server";
import { readdir, readFile, stat, unlink, mkdir, rename, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CONNECTIONS_FILE = join(DATA_DIR, "vps-connections.json");

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

interface ClaudeSession {
  sessionId: string;
  summary: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  projectDirName: string;
  /** Whether a .jsonl log file actually exists on disk for this session.
   *  Index entries can outlive their logs after CLI compaction. False means
   *  the chat view will be empty until the user resumes (which makes the CLI
   *  start writing a new log). */
  hasLog: boolean;
}

export async function GET(request: NextRequest) {
  const projectFilter = request.nextUrl.searchParams.get("project");

  try {
    const projects = await readdir(CLAUDE_PROJECTS_DIR);
    const allSessions: ClaudeSession[] = [];

    for (const projectDir of projects) {
      if (projectFilter && projectDir !== projectFilter) continue;

      const projectPath = join(CLAUDE_PROJECTS_DIR, projectDir);
      const projectStat = await stat(projectPath).catch(() => null);
      if (!projectStat?.isDirectory()) continue;

      // Try reading sessions-index.json first
      const indexPath = join(projectPath, "sessions-index.json");
      try {
        const indexData = JSON.parse(await readFile(indexPath, "utf-8"));
        if (indexData.entries) {
          // Surface every index entry — the CLI keeps useful metadata
          // (summary, firstPrompt, mtime) even after the underlying .jsonl
          // gets compacted/deleted, and `claude --resume <id>` is happy to
          // recreate a fresh log. The phantom flag lets the chat view
          // show a sensible empty state instead of waiting forever.
          for (const entry of indexData.entries) {
            const claimedPath: string | undefined = entry.fullPath;
            const candidatePath = claimedPath || join(projectPath, `${entry.sessionId}.jsonl`);
            let fileExists = false;
            try {
              await access(candidatePath, fsConstants.F_OK);
              fileExists = true;
            } catch {}

            const rawSummary = entry.summary || "";
            const usableSummary = isErrorSummary(rawSummary) ? "" : rawSummary;
            allSessions.push({
              sessionId: entry.sessionId,
              summary: cleanTitle(usableSummary),
              firstPrompt: cleanTitle(entry.firstPrompt || ""),
              messageCount: entry.messageCount || 0,
              created: entry.created || "",
              modified: entry.modified || "",
              gitBranch: entry.gitBranch || "",
              projectPath: entry.projectPath || indexData.originalPath || "",
              projectDirName: projectDir,
              hasLog: fileExists,
            });
          }
          continue;
        }
      } catch {
        // No index file, try reading .jsonl files directly
      }

      // Fallback: read .jsonl files and extract first user message
      const files = await readdir(projectPath);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.replace(".jsonl", "");
        const filePath = join(projectPath, file);
        try {
          const fileStat = await stat(filePath);
          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n").filter(Boolean);
          let firstPrompt = "";
          let messageCount = 0;
          let realCwd = "";

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "user" && parsed.message?.content && !firstPrompt) {
                firstPrompt = extractUserText(parsed.message.content).slice(0, 200);
              }
              // The JSONL records `cwd` on each user/assistant entry. Use the
              // first one we see — it's the canonical original path and avoids
              // the lossy "-" → "/" decoding of the project dir name.
              if (!realCwd && typeof parsed.cwd === "string" && parsed.cwd) {
                realCwd = parsed.cwd;
              }
              if (parsed.type === "user" || parsed.type === "assistant") {
                messageCount++;
              }
            } catch {}
          }

          allSessions.push({
            sessionId,
            summary: "",
            firstPrompt: cleanTitle(firstPrompt),
            messageCount,
            created: fileStat.birthtime.toISOString(),
            modified: fileStat.mtime.toISOString(),
            gitBranch: "",
            // Prefer the cwd recorded inside the JSONL itself (canonical and
            // exact). Fall back to the lossy decode of the project dir name
            // only when the JSONL has no usable cwd.
            projectPath: realCwd || decodeProjectDirName(projectDir),
            projectDirName: projectDir,
            hasLog: true,
          });
        } catch {}
      }
    }

    // Sort by modified date, newest first
    allSessions.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));

    // Get list of projects for filtering
    const projectList = [...new Set(allSessions.map((s) => s.projectDirName))].map((dir) => ({
      dirName: dir,
      path: allSessions.find((s) => s.projectDirName === dir)?.projectPath || decodeProjectDirName(dir),
    }));

    return Response.json({ sessions: allSessions, projects: projectList });
  } catch (err) {
    return Response.json({ sessions: [], projects: [], error: String(err) });
  }
}

function decodeProjectDirName(dirName: string): string {
  // Convert "-Users-d067576-projects-personal-assistant" → "/Users/d067576/projects/personal-assistant"
  if (dirName === "-") return "/";
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

// Extract user-facing text from a message.content field that may be a string,
// an array of typed blocks, or some other shape. Skips tool_result blocks and
// CLI / IDE meta-prompts.
function extractUserText(content: unknown): string {
  if (typeof content === "string") {
    return isMetaPrompt(content) ? "" : content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
    }
    const joined = parts.join("\n");
    return isMetaPrompt(joined) ? "" : joined;
  }
  return "";
}

// Detect CLI / IDE meta-prompts that shouldn't be used as session titles.
// These are messages the host (Claude Code CLI, IDE bridge, etc.) injects
// into the conversation: <command-name>, <local-command-stdout>,
// <local-command-caveat>, <ide_opened_file>, <ide_selection>, …
function isMetaPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^<(command-[a-z-]+|local-command-[a-z-]+|ide_[a-z_-]+)>/i.test(trimmed)) return true;
  // Content composed only of wrapped meta blocks (in any combination).
  const stripped = trimmed.replace(/<\/?(command-[a-z-]+|local-command-[a-z-]+|ide_[a-z_-]+)>/gi, "").trim();
  if (!stripped) return true;
  return false;
}

// Detect summaries the CLI generated from a failed/errored session, e.g.
// "Invalid API key · Please run /login", "API Error: 400 …", "API Error: 404
// <!DOCTYPE html>…". These aren't real session titles — the CLI's /resume
// hides them and falls back to the first user prompt. We do the same.
function isErrorSummary(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  return (
    /^invalid api key\b/i.test(t) ||
    /^api error\b/i.test(t) ||
    /^error\s*:/i.test(t) ||
    /^http \d{3}/i.test(t) ||
    /<!DOCTYPE html/i.test(t) ||
    /^\d{3}\s+(bad request|not found|internal server error|forbidden|unauthorized)/i.test(t) ||
    /rate limit/i.test(t) ||
    /overloaded/i.test(t) ||
    /^connection error/i.test(t) ||
    /^model .* (not (found|available)|incompatibility)/i.test(t)
  );
}

// Clean a title string (summary or first-prompt) for display: strip leading
// meta-block wrappers, collapse whitespace, take the first non-empty line.
function cleanTitle(raw: string): string {
  if (!raw) return "";
  // Strip any leading meta blocks (entirely tagged content disappears).
  let s = raw.replace(/<(command-[a-z-]+|local-command-[a-z-]+|ide_[a-z_-]+)>[\s\S]*?<\/\1>/gi, " ");
  // Strip orphan tags
  s = s.replace(/<\/?(command-[a-z-]+|local-command-[a-z-]+|ide_[a-z_-]+)>/gi, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Take the first sentence-ish chunk (first 120 chars or to first period+space)
  if (s.length > 120) {
    const dot = s.indexOf(". ");
    if (dot > 20 && dot < 120) s = s.slice(0, dot + 1);
    else s = s.slice(0, 120).trimEnd() + "…";
  }
  return s;
}

// ─── POST: Fetch remote VPS sessions or tmux sessions ────────────────────────

interface VpsConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  keyPath: string;
  defaultPath: string;
}

async function loadConnections(): Promise<VpsConnection[]> {
  try {
    const raw = await readFile(CONNECTIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function sshArgs(conn: VpsConnection): string[] {
  const keyPath = conn.keyPath.startsWith("~")
    ? join(homedir(), conn.keyPath.slice(1))
    : conn.keyPath;
  return [
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-p", String(conn.port || 22),
    "-i", keyPath,
    `${conn.username}@${conn.host}`,
  ];
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === "remote-sessions") {
    // Fetch claude sessions from a VPS via SSH
    const { connectionId } = body;
    const connections = await loadConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return Response.json({ error: "Connection not found", sessions: [] });

    try {
      // Try to read sessions-index.json files from remote ~/.claude/projects/
      const cmd = `find ~/.claude/projects -name "sessions-index.json" -exec cat {} \\; 2>/dev/null || echo "[]"`;
      const { stdout } = await execFileAsync("ssh", [...sshArgs(conn), cmd], { timeout: 15000 });

      const sessions: ClaudeSession[] = [];
      // The output may contain multiple JSON objects concatenated
      const jsonBlocks = stdout.split(/(?<=\})\s*(?=\{)/);
      for (const block of jsonBlocks) {
        try {
          const data = JSON.parse(block.trim());
          if (data.entries) {
            for (const entry of data.entries) {
              sessions.push({
                sessionId: entry.sessionId,
                summary: entry.summary || "",
                firstPrompt: entry.firstPrompt || "",
                messageCount: entry.messageCount || 0,
                created: entry.created || "",
                modified: entry.modified || "",
                gitBranch: entry.gitBranch || "",
                projectPath: entry.projectPath || data.originalPath || "",
                projectDirName: "",
                // Remote sessions: we don't stat the file, assume present.
                hasLog: true,
              });
            }
          }
        } catch {}
      }

      sessions.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
      return Response.json({ sessions });
    } catch (err) {
      return Response.json({ sessions: [], error: String(err) });
    }
  }

  if (action === "remote-tmux-sessions") {
    // List tmux sessions on a VPS
    const { connectionId } = body;
    const connections = await loadConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return Response.json({ error: "Connection not found", sessions: [] });

    try {
      const { stdout } = await execFileAsync("ssh", [
        ...sshArgs(conn),
        "tmux list-sessions -F '#{session_name}|#{session_created}|#{session_windows}|#{session_attached}' 2>/dev/null || echo ''",
      ], { timeout: 10000 });

      const tmuxSessions = stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [name, created, windows, attached] = line.split("|");
        return {
          name,
          created: created ? new Date(parseInt(created) * 1000).toISOString() : "",
          windows: parseInt(windows) || 1,
          attached: attached === "1",
        };
      });

      return Response.json({ sessions: tmuxSessions });
    } catch (err) {
      return Response.json({ sessions: [], error: String(err) });
    }
  }

  if (action === "local-tmux-sessions") {
    // List local tmux sessions
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-sessions", "-F", "#{session_name}|#{session_created}|#{session_windows}|#{session_attached}",
      ], { timeout: 5000 });

      const tmuxSessions = stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [name, created, windows, attached] = line.split("|");
        return {
          name,
          created: created ? new Date(parseInt(created) * 1000).toISOString() : "",
          windows: parseInt(windows) || 1,
          attached: attached === "1",
        };
      });

      return Response.json({ sessions: tmuxSessions });
    } catch {
      return Response.json({ sessions: [] });
    }
  }

  if (action === "delete-session") {
    // Delete a local Claude session JSONL file
    const { sessionId, projectDir } = body as { sessionId?: string; projectDir?: string };
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

    try {
      // Search across all project dirs (or just the hinted one)
      const dirs = projectDir ? [projectDir] : await readdir(CLAUDE_PROJECTS_DIR);
      let deleted = false;
      for (const dir of dirs) {
        const jsonl = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
        try {
          await unlink(jsonl);
          deleted = true;
        } catch {}
      }
      return Response.json({ success: deleted });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  }

  if (action === "archive-session") {
    // Move session JSONL into a sibling .archive/ folder
    const { sessionId, projectDir } = body as { sessionId?: string; projectDir?: string };
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

    try {
      const dirs = projectDir ? [projectDir] : await readdir(CLAUDE_PROJECTS_DIR);
      let archived = false;
      for (const dir of dirs) {
        const src = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
        try {
          await stat(src);
          const archiveDir = join(CLAUDE_PROJECTS_DIR, dir, ".archive");
          await mkdir(archiveDir, { recursive: true });
          await rename(src, join(archiveDir, `${sessionId}.jsonl`));
          archived = true;
        } catch {}
      }
      return Response.json({ success: archived });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  }

  if (action === "list-worktrees") {
    const { dir } = body as { dir?: string };
    if (!dir) return Response.json({ worktrees: [], branches: [] });
    const cwd = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
    try {
      const { stdout } = await execFileAsync("git", ["-C", cwd, "worktree", "list", "--porcelain"], { timeout: 5000 });
      const worktrees: { path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean }[] = [];
      let current: { path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean } | null = null;
      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current) worktrees.push(current);
          current = { path: line.slice("worktree ".length).trim() };
        } else if (line.startsWith("HEAD ")) {
          if (current) current.head = line.slice("HEAD ".length).trim();
        } else if (line.startsWith("branch ")) {
          if (current) current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
        } else if (line === "bare") {
          if (current) current.bare = true;
        } else if (line === "detached") {
          if (current) current.detached = true;
        }
      }
      if (current) worktrees.push(current);

      // Also fetch branches (local + remote)
      let branches: string[] = [];
      try {
        const { stdout: bOut } = await execFileAsync("git", ["-C", cwd, "branch", "-a", "--format=%(refname:short)"], { timeout: 5000 });
        branches = bOut.split("\n").map((s) => s.trim()).filter(Boolean);
      } catch {}

      return Response.json({ worktrees, branches });
    } catch (err) {
      return Response.json({ worktrees: [], branches: [], error: String(err) });
    }
  }

  if (action === "add-worktree") {
    const { dir, path: wtPath, branch, newBranch } = body as { dir?: string; path?: string; branch?: string; newBranch?: string };
    if (!dir || !wtPath) return Response.json({ error: "dir and path required" }, { status: 400 });
    const cwd = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
    const wt = wtPath.startsWith("~") ? join(homedir(), wtPath.slice(1)) : wtPath;
    try {
      const args = ["-C", cwd, "worktree", "add"];
      if (newBranch) {
        args.push("-b", newBranch, wt);
      } else if (branch) {
        args.push(wt, branch);
      } else {
        args.push(wt);
      }
      await execFileAsync("git", args, { timeout: 15000 });
      return Response.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "remove-worktree") {
    const { dir, path: wtPath, force } = body as { dir?: string; path?: string; force?: boolean };
    if (!dir || !wtPath) return Response.json({ error: "dir and path required" }, { status: 400 });
    const cwd = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
    try {
      const args = ["-C", cwd, "worktree", "remove"];
      if (force) args.push("--force");
      args.push(wtPath);
      await execFileAsync("git", args, { timeout: 10000 });
      return Response.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
