import { NextRequest } from "next/server";
import { readdir, readFile, stat, unlink, mkdir, rename } from "fs/promises";
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
          for (const entry of indexData.entries) {
            allSessions.push({
              sessionId: entry.sessionId,
              summary: entry.summary || "",
              firstPrompt: entry.firstPrompt || "",
              messageCount: entry.messageCount || 0,
              created: entry.created || "",
              modified: entry.modified || "",
              gitBranch: entry.gitBranch || "",
              projectPath: entry.projectPath || indexData.originalPath || "",
              projectDirName: projectDir,
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

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "user" && parsed.message?.content && !firstPrompt) {
                firstPrompt = typeof parsed.message.content === "string"
                  ? parsed.message.content.slice(0, 200)
                  : JSON.stringify(parsed.message.content).slice(0, 200);
              }
              if (parsed.type === "user" || parsed.type === "assistant") {
                messageCount++;
              }
            } catch {}
          }

          allSessions.push({
            sessionId,
            summary: "",
            firstPrompt,
            messageCount,
            created: fileStat.birthtime.toISOString(),
            modified: fileStat.mtime.toISOString(),
            gitBranch: "",
            projectPath: decodeProjectDirName(projectDir),
            projectDirName: projectDir,
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

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
