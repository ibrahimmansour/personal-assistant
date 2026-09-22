/**
 * POST /api/ai/intent — Jev routing layer for the assistant.
 *
 * Runs before the chat model on every turn. Jev (TypeSafe) reads the user's
 * latest message and returns typed judgments:
 *   - which dashboard topics the answer needs (calendar, tasks, PRs, email,
 *     Jira, notes) → the client fetches only that live context;
 *   - which action the user wants (navigate, switch workspace, set theme…)
 *     and its target → attached deterministically when Jev is confident,
 *     and handed to the writer as a hint otherwise.
 *
 * The writer (Claude / Ollama) still composes the reply and fills any text
 * fields (search query, task title). When Jev is unconfigured or down the
 * route answers with `jev: false` and the client falls back to keyword
 * topic detection and the model's own action JSON.
 */

import { NextRequest } from "next/server";
import { jevAsk } from "@/lib/jev-client";
import type { AIAction } from "@/components/ai-chat-context";

export const dynamic = "force-dynamic";

export interface RoutingDecision {
  /** Whether Jev produced this decision (false = fallback, nothing else set). */
  jev: boolean;
  /** Topics whose live data the reply needs. */
  topics: string[];
  /** Per-topic probabilities, for debugging / tuning. */
  topicScores?: Record<string, number>;
  /** The action Jev selected, or null for a plain answer. */
  action: AIAction | null;
  /** True when the action still needs a text field the writer must supply. */
  needsText: boolean;
  /** Confidence of the action choice (0..1). */
  confidence: number;
  /** True when the client may attach `action` without waiting for the writer. */
  direct: boolean;
}

const NONE: RoutingDecision = { jev: false, topics: [], action: null, needsText: false, confidence: 0, direct: false };

/** Below this, the action is only a hint for the writer, not attached directly. */
const DIRECT_THRESHOLD = 0.6;
/** Below this, no action is suggested at all. */
const HINT_THRESHOLD = 0.4;
const TOPIC_THRESHOLD = 0.5;

const TOPIC_QUESTIONS = {
  calendar: "meetings, events, schedule, agenda, or what is happening today/tomorrow",
  tasks: "to-dos, tasks, priorities, what is pending or overdue",
  prs: "pull requests, code review, GitHub, CI status",
  email: "emails, inbox, messages from people, unread mail",
  jira: "Jira tickets, issues, sprint, backlog, stories, bugs",
  notes: "notes, documents, memos the user has written",
} as const;

export async function POST(request: NextRequest) {
  let body: {
    message?: string;
    history?: { role: string; content: string }[];
    profile?: string;
    widgets?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return Response.json({ error: "Missing message" }, { status: 400 });

  const profile = body.profile === "private" ? "private" : "work";
  const recent = (body.history || []).slice(-6).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    text: String(m.content).slice(0, 500),
  }));

  const state = {
    message,
    recent_conversation: recent,
    profile,
    visible_widgets: body.widgets || [],
    app: "Personal dashboard with widgets (calendar, tasks, email, PRs, Jira, notes, terminal, files, bookmarks, news, weather), workspaces, focus modes, work/private profiles and light/dark theme.",
  };

  const questions = {
    ...Object.fromEntries(
      Object.entries(TOPIC_QUESTIONS).map(([topic, what]) => [
        `needs_${topic}`,
        {
          type: "noul" as const,
          instructions: `To answer \`message\` well, does the assistant need the user's live data about ${what}?`,
          criteria: {
            true: "The message asks about, refers to, or acts on that data.",
            false: "The message is about something else, a general question, or a UI command.",
          },
        },
      ]),
    ),
    action: {
      type: "choice" as const,
      instructions: "Which single app action does `message` ask the assistant to perform? Prefer 'none' for questions that only need an answer.",
      criteria: {
        navigate: "Open or show a specific widget (e.g. 'show my calendar', 'open the terminal').",
        search: "Find specific items inside a widget by a term (e.g. 'emails from Tom', 'PRs about caching').",
        switch_workspace: "Switch to a named workspace: dashboard, dev, comms, notes, today, inbox, timeline.",
        switch_profile: "Switch between the work and private profiles.",
        set_theme: "Change the app theme to light, dark, or system.",
        focus_mode: "Enter a split-screen focus pair (terminal+files, email+calendar, notes+tasks), e.g. 'set me up for coding'.",
        create_task: "Create a new task / to-do with a title.",
        create_note: "Create a new note.",
        none: "No app action: a question, a request for a summary, small talk, or 'what can you do'.",
      },
    },
    widget: {
      type: "choice" as const,
      instructions: "If `message` refers to a widget, which one? Otherwise 'none'.",
      criteria: {
        calendar: "Meetings, events, schedule.",
        tasks: "Tasks, to-dos.",
        email: "Email, inbox, mail.",
        "github-prs": "Pull requests, code review, GitHub.",
        jira: "Jira tickets, issues, sprint.",
        notes: "Notes, documents.",
        terminal: "Shell, command line, terminal.",
        files: "File browser, files, folders.",
        bookmarks: "Bookmarks, saved links.",
        news: "News, headlines.",
        weather: "Weather, forecast.",
        reminders: "Reminders, countdowns, upcoming.",
        clock: "Clock, time.",
        none: "No specific widget.",
      },
    },
    workspace: {
      type: "choice" as const,
      instructions: "If `message` asks to switch workspace, which one? Otherwise 'none'.",
      criteria: {
        dashboard: "The main grid with all widgets.",
        dev: "Development: terminal, files, PRs.",
        comms: "Communications: email, calendar, reminders.",
        "notes-tasks": "Notes, tasks and bookmarks.",
        today: "Daily briefing / today view.",
        inbox: "Unified inbox across sources.",
        timeline: "Chronological activity feed.",
        none: "No workspace switch.",
      },
    },
    theme: {
      type: "choice" as const,
      instructions: "If `message` asks to change the theme, to which? Otherwise 'none'.",
      criteria: { light: null, dark: null, system: "Follow the OS setting.", none: "No theme change." },
    },
    profile: {
      type: "choice" as const,
      instructions: "If `message` asks to switch profile, to which? Otherwise 'none'.",
      criteria: { work: null, private: null, none: "No profile switch." },
    },
    combo: {
      type: "choice" as const,
      instructions: "If `message` asks for a split-screen focus pair, which one? Otherwise 'none'.",
      criteria: {
        "terminal-files": "Coding: terminal next to the file browser.",
        "email-calendar": "Communications: email next to the calendar.",
        "notes-tasks": "Writing/planning: notes next to tasks.",
        none: "No focus pair.",
      },
    },
    priority: {
      type: "choice" as const,
      instructions: "If `message` creates a task, how urgent does it sound?",
      criteria: { low: "Someday, no pressure.", medium: "Normal.", high: "Urgent, ASAP, important, deadline." },
    },
  } as const;

  const result = await jevAsk(state, questions);
  if (!result) return Response.json(NONE);

  const a = result.answers;
  const topicScores: Record<string, number> = {};
  const topics: string[] = [];
  for (const topic of Object.keys(TOPIC_QUESTIONS)) {
    const p = a[`needs_${topic}` as keyof typeof a] as unknown as { noul: number };
    topicScores[topic] = p.noul;
    if (p.noul >= TOPIC_THRESHOLD) topics.push(topic);
  }
  // Jira only exists in the work profile.
  if (profile === "private") {
    const i = topics.indexOf("jira");
    if (i >= 0) topics.splice(i, 1);
  }

  const confidence = a.action.confidence;
  let action: AIAction | null = null;
  let needsText = false;

  if (a.action.choice !== "none" && confidence >= HINT_THRESHOLD) {
    const widget = a.widget.choice === "none" ? null : a.widget.choice;
    switch (a.action.choice) {
      case "navigate":
        if (widget && !(widget === "jira" && profile === "private")) action = { action: "navigate", widget };
        break;
      case "search":
        if (widget) { action = { action: "search", widget }; needsText = true; }
        break;
      case "switch_workspace":
        if (a.workspace.choice !== "none") action = { action: "switch_workspace", workspace: a.workspace.choice };
        break;
      case "switch_profile":
        if (a.profile.choice !== "none") action = { action: "switch_profile", profile: a.profile.choice };
        break;
      case "set_theme":
        if (a.theme.choice !== "none") action = { action: "set_theme", theme: a.theme.choice };
        break;
      case "focus_mode":
        if (a.combo.choice !== "none") action = { action: "focus_mode", combo: a.combo.choice };
        break;
      case "create_task":
        action = { action: "create_task", priority: a.priority.choice };
        needsText = true;
        break;
      case "create_note":
        action = { action: "create_note" };
        needsText = true;
        break;
    }
  }

  const decision: RoutingDecision = {
    jev: true,
    topics,
    topicScores,
    action,
    needsText,
    confidence,
    direct: !!action && !needsText && confidence >= DIRECT_THRESHOLD,
  };
  return Response.json(decision);
}
