# 11 — AI Assistant System

> Complete specification of the AI chat system: two interchangeable writers (Claude via the Claude Code CLI, or a local Ollama model), a Jev (TypeSafe) judgment layer that routes, triages and ranks alongside them, context injection, streaming, action parsing, and UI.

## Providers and the judgment layer (2026-09)

| Role | Engine | Where |
|---|---|---|
| Writes replies (chat panel, command palette) | **Claude** through `claude -p` on the user's Claude Code subscription — default — or **Ollama** | `src/lib/ai-provider.ts`, `src/lib/claude-cli-client.ts`, `src/lib/ai-client.ts` |
| One-shot prose (file summaries) and the fallback for search/cleanup | Claude (CLI, or the Messages API when `ANTHROPIC_API_KEY` is set) | `src/lib/anthropic-client.ts` |
| Typed judgments: intent + topics, inbox urgency, file relevance, cleanup buckets, news genres | **Jev** (TypeSafe System One) | `src/lib/jev-client.ts` + the routes below |

Selection lives in `config.json` → `ai: { provider, claudeModel, claudeEffort }` (Settings → AI Assistant, or the pickers in the chat panel header, which `PATCH /api/ai`). Jev is enabled by `typesafe.apiKey` (or `TYPESAFE_API_KEY`). Every Jev call degrades to `null` on failure, so each feature keeps a code-only or Claude fallback.

The Claude CLI is spawned with `--tools ""`, an empty `--mcp-config` under `--strict-mcp-config`, `--disable-slash-commands`, `--setting-sources ""`, `--no-session-persistence` and a `--system-prompt`, which keeps a chat turn at ~400 input tokens. `CLAUDECODE*` env vars are stripped so the child starts even when the app was launched from inside a Claude Code session. Multi-turn history is rendered into the single `-p` prompt as a quoted transcript.

### Jev routes

| Route | Judgment | Consumer |
|---|---|---|
| `POST /api/ai/intent` | 6 Nouls (which topics the reply needs) + Choices for action / widget / workspace / theme / profile / focus combo / priority, fanned out in one request | Chat panel + palette call it before `/api/ai`; topics drive the context fetch, a decision with confidence ≥ 0.6 and no text field is attached directly, otherwise it is passed as `routing` and becomes a hint in the system context |
| `POST /api/ai/triage` | Score 0–3 urgency per inbox item, 20 items per request, 6 h in-memory cache | Inbox view: "Urgent first" sort + Today/Critical badge (thresholds 1.75 / 2.5) |
| `POST /api/files-ai` `nl-search` | Code shortlists ≤60 candidates (token/year/recency), Jev scores relevance 0–3 per candidate; nothing ≥1.5 → Claude reads the full index | Files widget AI search (`engine` field says which answered) |
| `POST /api/files-ai` `cleanup-suggest` | Per item: Choice bucket + Noul "safe to remove"; low-risk buckets ≥0.7 pre-checked; important-name regex always wins | Files widget cleanup |
| `GET /api/news` | Choice genre for mixed-feed articles the regexes left in "general"; confidence ≥0.55 overrides; cached in `news-genre-cache.json` | News widget genre chips |


## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser                                     │
│  ┌──────────────────────────────────────┐    │
│  │ AIChatProvider (context)             │    │
│  │  • Message history (session)         │    │
│  │  • Topic detection                   │    │
│  │  • Streaming management              │    │
│  │  • Action parsing                    │    │
│  └───────────┬──────────────────────────┘    │
│              │                                │
│  ┌───────────┴──────────────────────────┐    │
│  │ AIChatPanel (UI)                     │    │
│  │  • Slide-in panel (420px right)      │    │
│  │  • Message bubbles + markdown        │    │
│  │  • Action buttons                    │    │
│  │  • Quick suggestions                 │    │
│  └──────────────────────────────────────┘    │
│              │                                │
│  ┌───────────┴──────────────────────────┐    │
│  │ CommandPalette (AI mode, `>` prefix) │    │
│  │  • Inline AI responses               │    │
│  │  • Action buttons                    │    │
│  └──────────────────────────────────────┘    │
└──────────────────┬──────────────────────────┘
                   │
          fetch() to localhost:4444
                   │
┌──────────────────┴──────────────────────────┐
│  Next.js API Routes                          │
│  ┌────────────────────────────────────────┐  │
│  │ /api/ai (POST)                         │  │
│  │  • System prompt construction          │  │
│  │  • Context injection                   │  │
│  │  • Stream relay from Ollama            │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ /api/ai/context (GET)                  │  │
│  │  • Live data aggregation               │  │
│  │  • Internal API route calls            │  │
│  │  • Human-readable summaries            │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ /api/ai (GET)                          │  │
│  │  • Health check                        │  │
│  └────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │
          HTTP to localhost:11434
                   │
┌──────────────────┴──────────────────────────┐
│  Ollama (Local LLM)                          │
│  Model: gemma3:4b (configurable)             │
│  Endpoint: /api/chat (streaming)             │
└──────────────────────────────────────────────┘
```

## Ollama Client

**File:** `src/lib/ai-client.ts` (152 lines)

### Configuration

```typescript
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";
```

### Exported Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `isOllamaAvailable()` | `→ Promise<boolean>` | Pings `/api/tags` with 2s timeout |
| `chatCompletion(messages, options?)` | `→ Promise<string>` | Non-streaming (temperature: 0.3, num_predict: 1024) |
| `chatCompletionStream(messages, options?)` | `→ ReadableStream<Uint8Array>` | Streaming NDJSON |

### Streaming Protocol

The stream emits newline-delimited JSON:

```
{"token": "Hello"}
{"token": " there"}
{"token": "!"}
{"done": true}
```

On error:
```
{"error": "Model not found"}
```

---

## API Routes

### `GET /api/ai` — Health Check

Returns:
```json
{ "available": true, "model": "gemma3:4b" }
```
Or:
```json
{ "available": false }
```

### `POST /api/ai` — Chat Completion (Streaming)

**Request body:**
```typescript
{
  query?: string;                    // User's message (legacy)
  messages?: ChatMessage[];          // Conversation history
  profile?: string;                  // "work" | "private"
  context?: {
    time: string;                    // Current time
    workspace: string;               // Active workspace name
    widgets: string[];               // Visible widget types
    taskSummary?: string;            // Live task data summary
    calendarSummary?: string;        // Live calendar summary
    prSummary?: string;              // Live PR summary
    emailSummary?: string;           // Live email summary
    jiraSummary?: string;            // Live Jira summary
    notesSummary?: string;           // Live notes summary
  }
}
```

**System prompt construction:**
1. Base personality: helpful dashboard assistant
2. Dashboard context: workspace, visible widgets, profile
3. Live data summaries injected as context blocks
4. Instruction to return JSON action blocks for executable commands

**Response:** `text/event-stream` with NDJSON chunks.

### `GET /api/ai/context` — Live Data Aggregation

**Query params:**
- `topics` — comma-separated: `calendar`, `tasks`, `prs`, `email`, `jira`, `notes`
- `profile` — `work` | `private`

**Behavior:**
1. For `tasks` and `notes`: reads directly from disk (`~/.personal-assistant/tasks.json`, `notes.json`)
2. For `calendar`, `email`, `prs`, `jira`: makes internal HTTP requests to sibling API routes with 8-second timeout
3. Generates human-readable text summaries for each topic

**Response:**
```json
{
  "summaries": {
    "calendar": "You have 3 events today: Sprint Planning at 10am, Design Review at 2pm, 1:1 with Manager at 4pm",
    "tasks": "5 pending tasks: 2 high priority (Deploy service, Fix auth bug), 2 medium, 1 low",
    "prs": "3 open PRs: #456 needs review (2 comments), #789 approved, #321 has CI failures"
  }
}
```

---

## AIChatProvider

**File:** `src/components/ai-chat-context.tsx` (385 lines)

### Context Shape

```typescript
interface AIChatContextType {
  messages: ChatMessage[];
  isOpen: boolean;
  isStreaming: boolean;
  aiAvailable: boolean | null;
  toggle: () => void;
  open: () => void;
  close: () => void;
  sendMessage: (text: string) => void;
  clearSession: () => void;
  abort: () => void;
}
```

### Message Shape

```typescript
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  action?: AIAction | null;
  streaming?: boolean;
  timestamp: number;
}
```

### AI Action Shape

```typescript
interface AIAction {
  action: string;         // "navigate", "search", "switch-workspace", "switch-profile",
                          // "change-theme", "enter-focus", "open-url", "add-task"
  widget?: string;        // Target widget type
  query?: string;         // Search query
  workspace?: string;     // Workspace ID
  profile?: string;       // "work" | "private"
  theme?: string;         // Theme name
  combo?: string;         // Focus combo name
  url?: string;           // URL to open
  title?: string;         // Task title
  priority?: string;      // Task priority
}
```

### Topic Detection Algorithm

When user sends a message, the provider scans the last 6 messages plus the current message for topic keywords:

| Topic | Keywords |
|-------|----------|
| `calendar` | calendar, meeting, event, schedule, today, tomorrow |
| `tasks` | task, todo, to-do, assignment, pending |
| `prs` | pr, pull request, github, review, merge |
| `email` | email, mail, message, inbox, outlook, gmail |
| `jira` | jira, ticket, issue, sprint, backlog |
| `notes` | note, notes, document, writing |

If it's the first message and no topics match, defaults to `calendar` + `tasks`.

### Send Message Flow

```
1. Add user message to state
2. Create empty assistant message (streaming=true)
3. Detect topics from conversation
4. Fetch context: GET /api/ai/context?topics={topics}&profile={profile}
5. Build context object with summaries
6. POST /api/ai with:
   - Last 20 messages from history
   - Profile
   - Context (time, workspace, widgets, summaries)
7. Read NDJSON stream
8. For each { token } chunk: append to assistant message
9. On { done: true }: finalize message
10. Parse action from final text
11. Update message with action
```

### Action Parsing

The AI can include JSON action blocks in its responses:

````
I'll navigate you to your pull requests.

```json
{ "action": "navigate", "widget": "github-prs" }
```
````

Or as a trailing JSON object:
```
Let me switch to your dev workspace. { "action": "switch-workspace", "workspace": "dev" }
```

Parsing logic (`parseAIAction`):
1. Try to find ` ```json ... ``` ` fence
2. Try to find trailing `{ "action": "..." }` object
3. Parse JSON and validate `action` field exists
4. Return `AIAction` or `null`

### Exported Helpers

```typescript
function stripActionJson(text: string): string;    // Remove JSON block from display text
function actionLabel(action: AIAction): string;     // Human-readable label
```

---

## AI Chat Panel

**File:** `src/components/ai-chat-panel.tsx` (364 lines)

### Visual Layout

- **Position:** Fixed right panel, 420px wide, full height below header
- **Entrance:** Slides in from right
- **Z-index:** Above main content, below command palette

### Message Rendering

- **User messages:** Primary background color, right-aligned, plain text
- **Assistant messages:** Muted background, left-aligned, rendered with `ReactMarkdown`
- **Streaming indicator:** Pulsing cursor at end of streaming message
- **Action buttons:** Appear below assistant message when action is detected

### Action Button Execution

When user clicks an action button:

| Action | Execution |
|--------|-----------|
| `navigate` | `navigateTo(widget)` via WidgetNavContext |
| `search` | `navigateTo(widget, undefined, query)` with search pre-fill |
| `switch-workspace` | `setActiveWorkspace(workspace)` |
| `switch-profile` | `setActiveProfile(profile)` |
| `change-theme` | `setTheme(theme)` |
| `enter-focus` | `enterFocusMode(combo)` |
| `open-url` | `window.open(url, "_blank")` |
| `add-task` | Navigate to tasks widget |

### Quick Suggestions

Default suggestion chips shown when no messages:
1. "what's on my plate today"
2. "any urgent tasks"
3. "set me up for coding"
4. "show my PRs"

### Controls

- **Send button** — submit message
- **Stop button** — abort streaming (visible during streaming)
- **Clear button** — clear all messages
- **Close button** — close panel (Escape key)
- **Auto-resize textarea** — grows with content, `Shift+Enter` for newlines

---

## Command Palette AI Mode

**File:** `src/components/command-palette.tsx` (AI mode section)

The command palette also has an AI mode triggered by typing `>` as the first character:

### Behavior

1. User types `> what's on my calendar`
2. Palette switches to AI mode
3. Streams response from `/api/ai`
4. Displays response inline with action buttons
5. Action buttons execute same way as chat panel

### Differences from Chat Panel

- Single-turn (no conversation history)
- Inline in command palette (no separate panel)
- Lighter context (uses command palette's cached widget data)

---

## Ollama Setup

### Installation

```bash
# Install Ollama
brew install ollama

# Pull default model
ollama pull gemma3:4b

# Start server (or it runs automatically)
ollama serve
```

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `gemma3:4b` | Model to use for chat |

### Availability

The AI features gracefully degrade when Ollama is not available:
- `isOllamaAvailable()` returns `false`
- AI chat panel shows "AI unavailable" message
- Command palette AI mode shows error
- No crashes or broken UI

---

## System Prompt Template

The system prompt sent to Ollama includes:

```
You are a helpful personal dashboard assistant. You help the user manage their work
and personal tasks, navigate the dashboard, and find information.

Current context:
- Time: {current_time}
- Profile: {work/private}
- Active workspace: {workspace_name}
- Visible widgets: {widget_list}

{Live data summaries from /api/ai/context}

You can suggest actions by including a JSON block in your response:
```json
{ "action": "navigate", "widget": "email" }
```

Available actions:
- navigate: Open a widget (widget: "email"|"tasks"|"calendar"|...)
- search: Search within a widget (widget, query)
- switch-workspace: Change workspace (workspace: "dashboard"|"dev"|...)
- switch-profile: Change profile (profile: "work"|"private")
- change-theme: Change color theme (theme: "blue"|"rose"|...)
- enter-focus: Enter focus mode (combo: "Terminal + Files"|...)
- open-url: Open a URL (url)
- add-task: Add a task (title, priority)
```
