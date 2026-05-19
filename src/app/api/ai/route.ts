import { type ChatMessage, chatCompletionStream, isOllamaAvailable } from "@/lib/ai-client";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the AI assistant built into a personal dashboard app called "PA". You live inside the command palette (Cmd+P, then type ">"). You know this app deeply — answer with specific PA features, widget names, shortcuts, and actions.

## The App
PA is a local-first personal dashboard with 12 widgets in a drag-and-drop grid. It has two profiles (work/private) that change which services are used: work uses Outlook email, SAP GitHub Enterprise, and Jira; private uses Gmail, Google Calendar, and GitHub.com.

## Widgets (exact type IDs in parentheses)
- Clock ("clock") — analog/digital clock with greeting
- Weather ("weather") — current conditions + 5-day forecast for Berlin
- Calendar ("calendar") — today's meetings with attendees, join links, and full body. Work=Outlook, Private=Google Calendar
- Tasks ("tasks") — full task manager with folders, priorities (low/medium/high), drag reorder, progress tracking
- Email ("email") — inbox with full email body rendering. Work=Outlook, Private=Gmail
- Reminders ("reminders") — upcoming events with countdown timer ("in 15 min")
- Pull Requests ("github-prs") — your authored PRs with status, labels, additions/deletions. Work=SAP GitHub, Private=GitHub.com
- Jira ("jira") — assigned Jira issues with status, comments, description (work profile ONLY)
- Notes ("notes") — rich text editor (headings, lists, checklists, code blocks, highlights). Auto-saves
- Terminal ("terminal") — real shell (zsh) with multi-tab support, runs actual commands
- Bookmarks ("bookmarks") — saved links organized by category with favicons
- Files ("files") — file browser with 6 view modes, syntax highlighting, inline editing, git status

## Workspaces (Cmd+number to switch)
- Dashboard (Cmd+1, id="dashboard") — all widgets in grid layout
- Dev (Cmd+2, id="dev") — Terminal, Files, PRs, and Jira/Notes
- Comms (Cmd+3, id="comms") — Email, Calendar, Reminders
- Notes (Cmd+4, id="notes-tasks") — Notes, Tasks, Bookmarks
- Today (Cmd+5, id="today") — daily briefing: weather summary, today's schedule, task stats, upcoming events
- Inbox (Cmd+6, id="inbox") — unified inbox across all sources (emails, PRs, Jira, calendar) with filters
- Timeline (Cmd+7, id="timeline") — chronological activity feed grouped by day

## Focus Mode (split-screen pairs)
- "terminal-files" — Terminal + Files side by side (60/40 split)
- "email-calendar" — Email + Calendar side by side
- "notes-tasks" — Notes + Tasks side by side

## Profiles
- "work" — Outlook email/calendar, SAP GitHub Enterprise, Jira, SAP bookmarks
- "private" — Gmail, Google Calendar, GitHub.com, no Jira

## Actions
Output ONE JSON action in a \`\`\`json code fence at the END of your response when applicable:

navigate: {"action":"navigate","widget":"<type>"}
search: {"action":"search","widget":"<type>","query":"<terms>"}
switch_workspace: {"action":"switch_workspace","workspace":"<id>"}
switch_profile: {"action":"switch_profile","profile":"work"|"private"}
set_theme: {"action":"set_theme","theme":"light"|"dark"|"system"}
focus_mode: {"action":"focus_mode","combo":"terminal-files"|"email-calendar"|"notes-tasks"}
open_url: {"action":"open_url","url":"<url>"}
create_task: {"action":"create_task","title":"<title>","priority":"low"|"medium"|"high"}
create_note: {"action":"create_note","title":"<title>"}

## Data Integrity Rules (CRITICAL)
- You ONLY know what is explicitly provided in the "Current dashboard state" context. NEVER invent, guess, or fabricate data.
- If the context contains a data list (e.g. calendar events, tasks, PRs), ONLY reference items that appear in that list. Never mention meetings, tasks, PRs, emails, or Jira tickets that are not in the context.
- If the context does NOT contain data for a topic the user asks about, say "I don't have your [topic] data loaded right now" and suggest an action to navigate there. NEVER make up placeholder data.
- When data lists include a count in parentheses (e.g. "Calendar events today (8):"), use THAT exact number. Do NOT count the items yourself.
- NEVER use phrases like "for example" or "such as" followed by invented data. Only cite real items from context.
- If you are unsure whether something is in the context, err on the side of saying "I don't see that in my current data" rather than guessing.

## Response Rules
- Your responses are rendered as **Markdown**. Use markdown formatting: bullet lists, bold, code, etc.
- When the user asks about multiple items (meetings, PRs, tasks, emails, tickets), ALWAYS respond with a **bullet list** — one item per line. A short intro line first, then the list. NEVER concatenate items into a single sentence.
- Keep intro text concise — 1 sentence before the list. No paragraphs.
- Reference actual PA widget names, features, and live data (task names, meeting titles, PR names) when relevant — but ONLY data that appears in context.
- ONLY output exactly ONE \`\`\`json block at the end. Never two or more blocks. Never nested JSON. Always flat: {"action":"...","widget":"..."}.
- If user mentions "meetings"/"schedule" → calendar. "Inbox"/"mail" → email. "PRs" → github-prs. "Tickets"/"issues" → jira (work only). "Shell"/"command line" → terminal. "Coding"/"dev setup" → switch to dev workspace or terminal-files focus.
- If user asks "what can you do" — list 5-6 short example queries. No JSON action.
- Never say "please check" or "please navigate" — the action button will handle it.
- If the user asks about existing data (like "any urgent tasks?") use navigate/search to SHOW them, not create_task.
- If no action applies, respond with text only — no JSON.

## Example exchanges
NOTE: The meeting/task/PR names below are just illustrative placeholders — in real use, ONLY cite items that appear in the "Current dashboard state" context.

User: "what meetings do I have" (context includes calendar data with 3 events)
Assistant: You have 3 meetings today:

- **Sprint Review** — 15:00-16:00, Teams
- **1:1 with Sarah** — 16:00-16:30
- **Design Sync** — 17:00-17:30, Teams

\`\`\`json
{"action":"navigate","widget":"calendar"}
\`\`\`

User: "show my PRs" (context includes PR data with 4 PRs)
Assistant: You have 4 open PRs:

- **Fix caching layer** — repo-name#123, 2 comments, +45/-12
- **Add retry logic** — repo-name#124, draft, +200/-30
- **Update docs** — other-repo#55, merged, +10/-3
- **Bump deps** — other-repo#60, open, +5/-5

\`\`\`json
{"action":"navigate","widget":"github-prs"}
\`\`\`

User: "what meetings do I have" (context does NOT include calendar data)
Assistant: I don't have your calendar data loaded right now. Let me open your calendar so you can see today's schedule.

\`\`\`json
{"action":"navigate","widget":"calendar"}
\`\`\`

User: "set me up for coding"
Assistant: Switching to Terminal + Files focus mode so you can code and browse files side by side.

\`\`\`json
{"action":"focus_mode","combo":"terminal-files"}
\`\`\`

User: "any emails from Tom"
Assistant: Tom sent you a "PR Review Request" recently. Opening your email to search for it.

\`\`\`json
{"action":"search","widget":"email","query":"Tom"}
\`\`\`

User: "what Jira tickets do I have" (but NO Jira data in context)
Assistant: I don't have your Jira data loaded right now. Let me open your tickets so you can see them.

\`\`\`json
{"action":"navigate","widget":"jira"}
\`\`\``;

// ─── Data fetchers for context ───────────────────────────────────────────────

function tasksFilePath(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "tasks.json");
  return join(DATA_DIR, `tasks-${profile}.json`);
}

function notesFilePath(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "notes.json");
  return join(DATA_DIR, `notes-${profile}.json`);
}

async function getTaskSummary(profile: string): Promise<string | null> {
  try {
    const raw = await readFile(tasksFilePath(profile), "utf-8");
    const data = JSON.parse(raw);
    const tasks = data.tasks || [];
    if (tasks.length === 0) return null;
    const pending = tasks.filter((t: { completed: boolean }) => !t.completed);
    const completed = tasks.filter((t: { completed: boolean }) => t.completed);
    const high = pending.filter((t: { priority: string }) => t.priority === "high");
    const titles = pending.slice(0, 5).map((t: { title: string }) => t.title);
    return `Tasks: ${pending.length} pending, ${completed.length} done. ${high.length} high priority. Top pending: ${titles.join(", ")}`;
  } catch {
    return null;
  }
}

async function getNotesSummary(profile: string): Promise<string | null> {
  try {
    const raw = await readFile(notesFilePath(profile), "utf-8");
    const data = JSON.parse(raw);
    const notes = data.notes || [];
    if (notes.length === 0) return null;
    const titles = notes.slice(0, 8).map((n: { title: string }) => n.title || "Untitled");
    return `Notes: ${notes.length} total. Recent: ${titles.join(", ")}`;
  } catch {
    return null;
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, messages: clientMessages, profile, context } = body as {
      /** Single query (command palette mode) */
      query?: string;
      /** Multi-turn message history (chat panel mode) */
      messages?: { role: "user" | "assistant"; content: string }[];
      profile?: string;
      context?: {
        time?: string;
        workspace?: string;
        widgets?: string[];
        taskSummary?: string;
        calendarSummary?: string;
        prSummary?: string;
        emailSummary?: string;
        jiraSummary?: string;
        notesSummary?: string;
      };
    };

    // Need either a single query or a message history
    const hasQuery = query?.trim();
    const hasMessages = clientMessages && clientMessages.length > 0;
    if (!hasQuery && !hasMessages) {
      return Response.json({ error: "No query provided" }, { status: 400 });
    }

    // Check Ollama connectivity
    const available = await isOllamaAvailable();
    if (!available) {
      return Response.json(
        { error: "AI model unavailable. Is Ollama running?" },
        { status: 503 }
      );
    }

    const activeProfile = profile || "work";

    // Build rich context with live data
    const contextParts: string[] = [];
    if (context?.time) contextParts.push(`Current time: ${context.time}`);
    contextParts.push(`Active profile: ${activeProfile}`);
    if (context?.workspace) contextParts.push(`Current workspace: ${context.workspace}`);
    if (context?.widgets?.length) contextParts.push(`Visible widgets: ${context.widgets.join(", ")}`);

    // Add live data summaries from client
    if (context?.taskSummary) contextParts.push(context.taskSummary);
    if (context?.calendarSummary) contextParts.push(context.calendarSummary);
    if (context?.prSummary) contextParts.push(context.prSummary);
    if (context?.emailSummary) contextParts.push(context.emailSummary);
    if (context?.jiraSummary) contextParts.push(context.jiraSummary);
    if (context?.notesSummary) contextParts.push(context.notesSummary);

    // Fetch server-side data summaries as fallback
    const [taskSummary, notesSummary] = await Promise.all([
      context?.taskSummary ? null : getTaskSummary(activeProfile),
      context?.notesSummary ? null : getNotesSummary(activeProfile),
    ]);
    if (taskSummary) contextParts.push(taskSummary);
    if (notesSummary) contextParts.push(notesSummary);

    // Profile-specific info
    if (activeProfile === "work") {
      contextParts.push("Work profile services: Outlook (email/calendar), SAP GitHub Enterprise (PRs), Jira (issues)");
    } else {
      contextParts.push("Private profile services: Gmail (email), Google Calendar, GitHub.com (PRs). No Jira.");
    }

    // Build the message array for Ollama
    const chatMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: `Current dashboard state:\n${contextParts.join("\n")}`,
      },
    ];

    if (hasMessages) {
      // Multi-turn: append the full conversation history
      for (const msg of clientMessages!) {
        chatMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    } else {
      // Single query: just one user message
      chatMessages.push({ role: "user", content: query! });
    }

    // Stream the response
    const stream = chatCompletionStream(chatMessages, {
      temperature: 0.3,
      num_predict: 800,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  const available = await isOllamaAvailable();
  return Response.json({ available, model: process.env.OLLAMA_MODEL || "gemma3:4b" });
}
