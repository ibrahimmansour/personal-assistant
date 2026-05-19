import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");

function tasksFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "tasks.json");
  return join(DATA_DIR, `tasks-${profile}.json`);
}

function notesFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "notes.json");
  return join(DATA_DIR, `notes-${profile}.json`);
}

/**
 * Fetches live data summaries for specific topics.
 * Called by the AI chat panel before each turn to inject relevant context.
 *
 * GET /api/ai/context?topics=calendar,tasks,prs&profile=work
 *
 * Tasks and notes are read directly from disk (no self-referencing HTTP).
 * Calendar, email, PRs, and Jira make internal HTTP calls with a timeout.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const topicsParam = searchParams.get("topics") || "";
  const profile = searchParams.get("profile") || "work";
  const topics = topicsParam.split(",").map((t) => t.trim()).filter(Boolean);

  if (topics.length === 0) {
    return Response.json({ summaries: {} });
  }

  const baseUrl = request.nextUrl.origin;
  const summaries: Record<string, string> = {};

  /** Helper: fetch with a timeout to avoid deadlocks on self-referencing calls */
  async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const fetchers: Record<string, () => Promise<string | null>> = {
    // ─── Direct filesystem reads (no HTTP) ───────────────────────────────

    tasks: async () => {
      try {
        const raw = await readFile(tasksFile(profile), "utf-8");
        const data = JSON.parse(raw);
        const tasks = data.tasks as { title: string; completed: boolean; priority: string; folder?: string }[];
        if (!tasks || tasks.length === 0) return "Tasks: No tasks.";
        const pending = tasks.filter((t) => !t.completed);
        const completed = tasks.filter((t) => t.completed);
        const lines = pending.filter((t) => t.title).map((t) =>
          `- ${t.title} [${t.priority}]${t.folder ? ` (${t.folder})` : ""}`
        );
        return `Tasks (${pending.length} pending, ${completed.length} completed):\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    },

    notes: async () => {
      try {
        const raw = await readFile(notesFile(profile), "utf-8");
        const data = JSON.parse(raw);
        const notes = data.notes as { title: string; folder?: string }[];
        if (!notes || notes.length === 0) return "Notes: No notes.";
        const lines = notes.slice(0, 10).map((n) =>
          `- ${n.title || "Untitled"}${n.folder ? ` (${n.folder})` : ""}`
        );
        return `Notes (${notes.length}):\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    },

    // ─── HTTP fetches to internal API routes (external data) ─────────────

    calendar: async () => {
      try {
        const endpoint = profile === "work"
          ? `${baseUrl}/api/outlook/calendar`
          : `${baseUrl}/api/google/calendar`;
        const res = await fetchWithTimeout(endpoint);
        const data = await res.json();
        if (data.error || !data.events) return null;
        const events = data.events as {
          title: string; start: string; end: string;
          startRaw?: string; endRaw?: string;
          location: string; onlineMeetingUrl?: string;
          isAllDay?: boolean; attendees?: { name: string }[];
        }[];
        if (events.length === 0) return "Calendar: No events scheduled.";
        const lines = events.map((e) => {
          let timeStr: string;
          if (e.isAllDay) {
            timeStr = "all day";
          } else if (e.startRaw && e.endRaw) {
            const startDate = new Date(e.startRaw);
            const endDate = new Date(e.endRaw);
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
              const startFmt = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
              const endFmt = endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
              timeStr = `${startFmt}-${endFmt}`;
            } else {
              timeStr = `${e.start}-${e.end}`;
            }
          } else {
            timeStr = `${e.start}-${e.end}`;
          }
          const loc = e.location ? `, ${e.location}` : e.onlineMeetingUrl ? ", Teams" : "";
          let att = "";
          if (e.attendees?.length) {
            const names = e.attendees.map((a) => a.name);
            att = names.length <= 5
              ? ` [${names.join(", ")}]`
              : ` [${names.slice(0, 5).join(", ")} +${names.length - 5} more]`;
          }
          return `- ${e.title} (${timeStr}${loc})${att}`;
        });
        return `Calendar events today (${events.length}):\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    },

    prs: async () => {
      try {
        const res = await fetchWithTimeout(`${baseUrl}/api/github/prs?profile=${profile}`);
        const data = await res.json();
        const prs = data.prs as {
          title: string; repoShort: string; status: string; number: number;
          comments: number; additions: number; deletions: number;
          createdAt: string; labels: { name: string }[];
        }[];
        if (!prs || prs.length === 0) return "Pull Requests: No open PRs.";
        const lines = prs.map((p) => {
          const labels = p.labels.length ? ` {${p.labels.map((l) => l.name).join(", ")}}` : "";
          return `- ${p.title} [${p.repoShort}#${p.number}, ${p.status}] +${p.additions}/-${p.deletions}, ${p.comments} comments${labels}`;
        });
        return `Pull Requests (${prs.length}):\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    },

    email: async () => {
      try {
        const endpoint = profile === "work"
          ? `${baseUrl}/api/outlook/emails?limit=15`
          : `${baseUrl}/api/google/emails`;
        const res = await fetchWithTimeout(endpoint);
        const data = await res.json();
        if (data.error || !data.emails) return null;
        const emails = data.emails as { from: string; subject: string; time: string; read: boolean }[];
        if (emails.length === 0) return "Email: Inbox empty.";
        const unread = emails.filter((e) => !e.read).length;
        const lines = emails.slice(0, 10).map((e) => {
          const time = new Date(e.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
          const marker = e.read ? " " : "*";
          return `${marker} "${e.subject}" from ${e.from} (${time})`;
        });
        return `Email inbox (${emails.length} shown, ${unread} unread):\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    },

    jira: async () => {
      if (profile !== "work") return "Jira: Not available in private profile.";
      try {
        const res = await fetchWithTimeout(`${baseUrl}/api/jira`);
        const data = await res.json();
        if (data.error || !data.issues) return null;
        const issues = data.issues as { key: string; summary: string; status: string; priority: string }[];
        if (issues.length === 0) return "Jira: No assigned issues.";
        const lines = issues.map((i) => `- ${i.key}: ${i.summary} [${i.status}, ${i.priority}]`);
        return `Jira issues (${issues.length}):\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    },
  };

  // Fetch all requested topics in parallel
  const results = await Promise.all(
    topics.map(async (topic) => {
      const fetcher = fetchers[topic];
      if (!fetcher) return { topic, summary: null };
      const summary = await fetcher();
      return { topic, summary };
    })
  );

  for (const { topic, summary } of results) {
    if (summary) summaries[topic] = summary;
  }

  return Response.json({ summaries });
}
