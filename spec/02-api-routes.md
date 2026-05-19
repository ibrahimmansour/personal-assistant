# 02 — API Routes

> Complete specification of all 27 API route handlers.

## Overview

All API routes use the Next.js 16 App Router convention (`src/app/api/{path}/route.ts`). Key patterns:

- **Response format:** Always `Response.json(data)` — NOT `NextResponse.json()`
- **Profile awareness:** Most routes accept `?profile=work|private` to scope data
- **Action dispatch:** POST routes use `body.action` to switch between operations
- **Data directory:** `~/.personal-assistant/` for all file-based persistence
- **Dynamic routes:** `export const dynamic = "force-dynamic"` on routes calling external APIs
- **Error handling:** Try/catch with `Response.json({ error }, { status })` pattern

## Route Reference

---

### `/api/tasks`

**File:** `src/app/api/tasks/route.ts` (191 lines)
**Methods:** GET, POST
**Purpose:** Full CRUD for tasks and task folders

**GET** `?profile=work`
```typescript
// Response
{ tasks: Task[], folders: TaskFolder[] }
```

**POST** — Action dispatch:
| Action | Body Fields | Response |
|--------|-------------|----------|
| `add` | `title, priority?, folderId?` | `{ task, tasks, folders }` |
| `toggle` | `id` | `{ task, tasks, folders }` |
| `delete` | `id` | `{ tasks, folders }` |
| `update` | `id, title?, priority?, folderId?` | `{ task, tasks, folders }` |
| `reorder` | `taskIds: string[]` | `{ tasks, folders }` |
| `addFolder` | `name` | `{ folder, tasks, folders }` |
| `renameFolder` | `folderId, name` | `{ folder, tasks, folders }` |
| `updateFolder` | `folderId, name?, cwd?` | `{ folder, tasks, folders }` |
| `deleteFolder` | `folderId` | `{ tasks, folders }` |

**Storage:** `~/.personal-assistant/tasks.json` (work), `~/.personal-assistant/tasks-{profile}.json` (other)

**Data shapes:**
```typescript
interface Task {
  id: string;           // crypto.randomUUID()
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  dueDate?: string;
  folderId?: string;
  createdAt: string;    // ISO timestamp
}

interface TaskFolder {
  id: string;
  name: string;
  cwd?: string;         // Working directory for AI terminal
  createdAt: string;
}
```

---

### `/api/notes`

**File:** `src/app/api/notes/route.ts` (164 lines)
**Methods:** GET, POST
**Purpose:** CRUD for rich text notes with folders, pinning, search

**GET** `?profile=work&folder=&search=`
```typescript
{ notes: Note[], folders: string[] }
```

**POST** — Action dispatch:
| Action | Body Fields | Response |
|--------|-------------|----------|
| `create` | `profile?` | `{ note, notes }` |
| `update` | `id, title?, content?, folder?` | `{ note, notes }` |
| `delete` | `id` | `{ notes }` |
| `pin` | `id` | `{ note, notes }` |
| `duplicate` | `id` | `{ note, notes }` |

**Storage:** `~/.personal-assistant/notes.json` (work), `~/.personal-assistant/notes-{profile}.json`

```typescript
interface Note {
  id: string;
  title: string;
  content: string;      // Tiptap HTML
  folder?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

### `/api/dashboard`

**File:** `src/app/api/dashboard/route.ts` (62 lines)
**Methods:** GET, POST
**Purpose:** Persist/load dashboard layout state

**GET** `?profile=work`
```typescript
{ saved: boolean, widgets?, layouts?, version?, updatedAt?,
  workspaceState?, workspaceVersion? }
```

**POST**
```typescript
// Body
{ profile, widgets?, layouts?, version?,
  workspaceState?, workspaceVersion? }
// Response
{ ok: true }
```

**Storage:** `~/.personal-assistant/dashboard.json` (work), `~/.personal-assistant/dashboard-{profile}.json`

---

### `/api/email-rules`

**File:** `src/app/api/email-rules/route.ts` (170 lines)
**Methods:** GET, POST
**Purpose:** Email categorization rules management

**GET** `?profile=work`
```typescript
{ groups: EmailGroup[] }
```

Seeds default groups on first load: GitHub, Jira, Automated.

**POST** — Action dispatch:
| Action | Body Fields |
|--------|-------------|
| `add-group` | `name, color, profile` |
| `update-group` | `groupId, name?, color?, profile` |
| `delete-group` | `groupId, profile` |
| `add-rule` | `groupId, rule: { field, operator, value }, profile` |
| `remove-rule` | `groupId, ruleIndex, profile` |
| `reorder-groups` | `groupIds: string[], profile` |
| `save-all` | `groups, profile` |

**Storage:** `~/.personal-assistant/email-rules.json`

```typescript
interface EmailRule {
  field: "from" | "fromAddress" | "subject";
  operator: "contains";
  value: string;
}

interface EmailGroup {
  id: string;
  name: string;
  color: string;       // Tailwind color name
  rules: EmailRule[];
}
```

---

### `/api/browser`

**File:** `src/app/api/browser/route.ts` (83 lines)
**Methods:** GET, POST
**Purpose:** Bookmark persistence

**GET** `?type=bookmarks|history&profile=work`
```typescript
// bookmarks
BookmarkItem[]
// history
HistoryEntry[]
```

**POST** `{ type, profile, data }`
```typescript
{ ok: true }
```

**Storage:** `~/.personal-assistant/bookmarks.json` (work), `~/.personal-assistant/bookmarks-private.json` (private), plus `browser-history*.json`

---

### `/api/files`

**File:** `src/app/api/files/route.ts` (1482 lines) — the largest route
**Methods:** GET, POST
**Purpose:** Full file browser, file editor, search, and git operations

This is extensively documented in `12-file-browser-system.md`.

**GET query parameters:**
| Param | Purpose |
|-------|---------|
| `path` | Directory/file path |
| `read=1` | Read file content |
| `raw=1` | Serve raw binary file |
| `search` | Search query string |
| `root` | Search root directory |
| `mode=name\|content` | Search mode |
| `git=1` | Git status |
| `diff=1` | Git diff |
| `file` | Specific file for diff/blame |
| `staged=1` | Staged diff flag |
| `blame=1` | Git blame |
| `branches=1` | List branches |
| `symbols=1` | Extract symbols |
| `langstats=1` | Language statistics |
| `gitignore=1` | Gitignore check |
| `project=1` | Project detection |
| `recent=1` | Recent files |
| `limit` | Result limit |
| `reindex=1` | Force reindex |

**POST actions:** `save`, `touch`, `mkdir`, `delete`, `rename`, `git-stage`, `git-unstage`, `git-commit`, `git-stash` (subActions: push/pop/list), `git-checkout`, `bookmark` (subActions: add/remove/list)

---

### `/api/weather`

**File:** `src/app/api/weather/route.ts` (88 lines)
**Methods:** GET
**Purpose:** Current weather + 5-day forecast for Berlin

**External API:** Open-Meteo (`api.open-meteo.com/v1/forecast`) — free, no API key

**Response:**
```typescript
{
  location: "Berlin, DE",
  temperature: number,
  condition: string,        // "Sunny", "Partly Cloudy", etc.
  description: string,
  humidity: number,
  wind: number,
  forecast: { day: string, high: number, low: number, condition: string }[],
  fetchedAt: string
}
```

**Caching:** `next: { revalidate: 600 }` (10-minute ISR)

---

### `/api/proxy`

**File:** `src/app/api/proxy/route.ts` (348 lines)
**Methods:** GET
**Purpose:** Web proxy that fetches URLs, strips iframe-blocking headers, injects navigation interceptor

**GET** `?url=https://example.com`

**Behavior:**
- Fetches the target URL
- For HTML: rewrites `<base href>`, injects script to intercept link clicks and form submissions, rewrites relative URLs
- For CSS: rewrites `url()` paths to go through proxy
- For other content: passes through with correct MIME type
- Strips `x-frame-options`, `content-security-policy` headers
- Detects Cisco Umbrella network blocks
- Returns friendly HTML error pages on failure

---

### `/api/outlook/emails`

**File:** `src/app/api/outlook/emails/route.ts` (171 lines)
**Methods:** GET
**Purpose:** Fetch Outlook inbox with caching

**GET** `?limit=15` (max 500)

**External API:** Microsoft Graph API `/me/mailFolders/Inbox/messages`

**Response:**
```typescript
{
  emails: Email[],
  total: number,
  fetchedAt: string,
  cached?: boolean,
  stale?: boolean,
  tokenExpired?: boolean
}
```

**Cache:** `~/.personal-assistant/outlook-emails-cache.json` — 5-minute TTL, falls back to stale on error

**Email shape:**
```typescript
interface Email {
  id: string;
  from: string;           // Display name
  fromAddress: string;    // Email address
  subject: string;
  preview: string;
  bodyHtml?: string;      // Full HTML (when limit <= 15)
  bodyText?: string;
  time: string;           // ISO timestamp
  read: boolean;
  hasAttachments: boolean;
  webLink: string;
  categories: string[];
  to?: string[];
  cc?: string[];
}
```

---

### `/api/outlook/emails/[id]`

**File:** `src/app/api/outlook/emails/[id]/route.ts` (68 lines)
**Methods:** GET
**Purpose:** Fetch single Outlook email with full body

**Response:** `{ email: Email }` (same shape as above, always with bodyHtml/bodyText)

---

### `/api/outlook/emails/[id]/reply`

**File:** `src/app/api/outlook/emails/[id]/reply/route.ts` (51 lines)
**Methods:** POST
**Purpose:** Reply to Outlook email

**Body:** `{ comment: string, replyAll?: boolean }`
**Response:** `{ success: true }`

---

### `/api/outlook/emails/search`

**File:** `src/app/api/outlook/emails/search/route.ts` (92 lines)
**Methods:** GET
**Purpose:** Server-side Outlook email search

**GET** `?q=search+terms`

Paginates via `@odata.nextLink` up to 500 results.

**Response:** `{ emails: Email[], total: number }`

---

### `/api/outlook/calendar`

**File:** `src/app/api/outlook/calendar/route.ts` (94 lines)
**Methods:** GET
**Purpose:** Today + tomorrow calendar events from Outlook

**External API:** Microsoft Graph API `/me/calendarView`

**Response:**
```typescript
{
  events: CalendarEvent[],
  fetchedAt: string
}
```

```typescript
interface CalendarEvent {
  id: string;
  title: string;
  start: string;         // ISO timestamp
  end: string;
  location?: string;
  isAllDay: boolean;
  organizer?: string;
  bodyHtml?: string;
  bodyText?: string;
  webLink?: string;
  responseStatus?: string;
}
```

---

### `/api/outlook/refresh-token`

**File:** `src/app/api/outlook/refresh-token/route.ts` (228 lines)
**Methods:** GET, POST
**Purpose:** Outlook token status check and Chrome-based extraction

**GET:** Returns token status `{ valid, expiresOn?, expiresIn?, error? }`

**POST:** Extracts fresh token from Chrome's localStorage via AppleScript:
1. Opens/finds Outlook tab in Chrome
2. Runs JavaScript in Chrome to extract token from `localStorage`
3. Polls for up to ~90 seconds
4. Saves token via `writeTokenCache()`

**Response:** `{ success: true, expiresOn, expiresIn }` or `{ success: false, needsLogin?, error? }`

---

### `/api/google/emails`

**File:** `src/app/api/google/emails/route.ts` (276 lines)
**Methods:** GET
**Purpose:** Gmail inbox with caching

**GET** `?limit=15` (max 500)

**External API:** Gmail API (`gmail.googleapis.com/gmail/v1`)

**Cache:** `~/.personal-assistant/gmail-emails-cache.json` — 5-minute TTL

**Response:** Same shape as Outlook emails

---

### `/api/google/emails/[id]`

**File:** `src/app/api/google/emails/[id]/route.ts` (142 lines)
**Methods:** GET
**Purpose:** Single Gmail message with full body

Parses multipart MIME to extract HTML and text parts.

---

### `/api/google/emails/[id]/reply`

**File:** `src/app/api/google/emails/[id]/reply/route.ts` (144 lines)
**Methods:** POST
**Purpose:** Reply to Gmail email with proper threading

Fetches original message headers (Message-ID, References, In-Reply-To), user profile, constructs RFC 2822 message with threading headers.

---

### `/api/google/emails/search`

**File:** `src/app/api/google/emails/search/route.ts` (169 lines)
**Methods:** GET
**Purpose:** Server-side Gmail search (paginates up to 500 with batch metadata fetches in groups of 25)

---

### `/api/google/calendar`

**File:** `src/app/api/google/calendar/route.ts` (115 lines)
**Methods:** GET
**Purpose:** Today + tomorrow Google Calendar events

On 401: returns `{ authRequired: true, authUrl }` for re-auth

---

### `/api/google/auth`

**File:** `src/app/api/google/auth/route.ts` (18 lines)
**Methods:** GET
**Purpose:** Redirects to Google OAuth consent screen

Scopes: `gmail.readonly`, `gmail.send`, `calendar.readonly`

---

### `/api/google/auth/callback`

**File:** `src/app/api/google/auth/callback/route.ts` (64 lines)
**Methods:** GET
**Purpose:** OAuth callback — exchanges code for tokens

Returns HTML page with auto-close script on success.

---

### `/api/github/prs`

**File:** `src/app/api/github/prs/route.ts` (171 lines)
**Methods:** GET
**Purpose:** Authored PRs from GitHub

**GET** `?profile=work`

**Work profile:** SAP GitHub Enterprise (`github.wdf.sap.corp/api/v3`) using `GITHUB_TOKEN`
**Private profile:** github.com (`api.github.com`) using `GITHUB_COM_TOKEN` or `gh auth token` fallback

**Response:**
```typescript
{
  prs: EnrichedPR[],
  username: string,
  fetchedAt: string
}
```

```typescript
interface EnrichedPR {
  id: number;
  title: string;
  repo: string;
  repoUrl: string;
  url: string;
  state: "open" | "merged" | "closed";
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  additions: number;
  deletions: number;
  comments: number;
  reviewDecision?: string;
  labels: { name: string; color: string }[];
  mergeable?: boolean;
  checksStatus?: string;
}
```

---

### `/api/jira`

**File:** `src/app/api/jira/route.ts` (40 lines)
**Methods:** GET
**Purpose:** Open Jira issues assigned to current user

**JQL:** `assignee=currentUser() AND statusCategory != Done ORDER BY updated DESC`

**Response:** `{ issues: JiraIssue[], total, fetchedAt }` or `{ error, authRequired, issues: [] }`

---

### `/api/jira/[key]`

**File:** `src/app/api/jira/[key]/route.ts` (36 lines)
**Methods:** GET
**Purpose:** Full Jira issue detail

**Response:** `{ issue: JiraIssueDetail }` with rendered HTML fields

---

### `/api/jira/auth`

**File:** `src/app/api/jira/auth/route.ts` (111 lines)
**Methods:** GET, POST, DELETE
**Purpose:** Jira authentication management

**GET:** `{ authenticated, user?, cookieAge? }`
**POST:** `{ cookies }` or `{ action: "extract" }` — validate/extract cookies
**DELETE:** `{ cleared: true }` — clear saved auth

---

### `/api/ai`

**File:** `src/app/api/ai/route.ts` (296 lines)
**Methods:** GET, POST
**Purpose:** AI chat powered by Ollama

**GET:** `{ available: boolean, model: string }` — health check

**POST — Streaming SSE:**
```typescript
// Request body
{
  query?: string,
  messages?: ChatMessage[],
  profile?: string,
  context?: {
    time: string,
    workspace: string,
    widgets: string[],
    taskSummary?: string,
    calendarSummary?: string,
    prSummary?: string,
    emailSummary?: string,
    jiraSummary?: string,
    notesSummary?: string
  }
}

// Response: text/event-stream
// Each line: JSON { token: "..." } or { done: true } or { error: "..." }
```

System prompt includes dashboard context, visible widgets, and live data summaries. The AI can return JSON action blocks to navigate widgets, switch workspaces, etc.

---

### `/api/ai/context`

**File:** `src/app/api/ai/context/route.ts` (211 lines)
**Methods:** GET
**Purpose:** Fetch live data summaries for AI context injection

**GET** `?topics=calendar,tasks,prs&profile=work`

Topics: `calendar`, `tasks`, `prs`, `email`, `jira`, `notes`

Reads tasks/notes from disk; fetches calendar/email/PRs/Jira from sibling API routes with 8s timeout.

**Response:** `{ summaries: Record<string, string> }` — human-readable text summaries per topic

---

## Summary Table

| Route | Methods | Type | External Service | Storage File |
|-------|---------|------|-----------------|-------------|
| `/api/tasks` | GET, POST | CRUD | — | `tasks.json` |
| `/api/notes` | GET, POST | CRUD | — | `notes.json` |
| `/api/dashboard` | GET, POST | CRUD | — | `dashboard.json` |
| `/api/email-rules` | GET, POST | CRUD | — | `email-rules.json` |
| `/api/browser` | GET, POST | CRUD | — | `bookmarks.json` |
| `/api/files` | GET, POST | FS + Git | Local FS/Git CLI | `file-bookmarks.json` |
| `/api/weather` | GET | Fetch | Open-Meteo | — |
| `/api/proxy` | GET | Proxy | Any URL | — |
| `/api/outlook/emails` | GET | Fetch | MS Graph | `outlook-emails-cache.json` |
| `/api/outlook/emails/[id]` | GET | Fetch | MS Graph | — |
| `/api/outlook/emails/[id]/reply` | POST | Action | MS Graph | — |
| `/api/outlook/emails/search` | GET | Search | MS Graph | — |
| `/api/outlook/calendar` | GET | Fetch | MS Graph | — |
| `/api/outlook/refresh-token` | GET, POST | Auth | Chrome/AppleScript | Token cache |
| `/api/google/emails` | GET | Fetch | Gmail API | `gmail-emails-cache.json` |
| `/api/google/emails/[id]` | GET | Fetch | Gmail API | — |
| `/api/google/emails/[id]/reply` | POST | Action | Gmail API | — |
| `/api/google/emails/search` | GET | Search | Gmail API | — |
| `/api/google/calendar` | GET | Fetch | Google Cal API | — |
| `/api/google/auth` | GET | OAuth | Google OAuth2 | — |
| `/api/google/auth/callback` | GET | OAuth | Google OAuth2 | `google-tokens.json` |
| `/api/github/prs` | GET | Fetch | GitHub API | — |
| `/api/jira` | GET | Fetch | Jira REST | — |
| `/api/jira/[key]` | GET | Fetch | Jira REST | — |
| `/api/jira/auth` | GET, POST, DEL | Auth | Jira REST | `jira/auth.json` |
| `/api/ai` | GET, POST | AI Chat | Ollama (local) | — |
| `/api/ai/context` | GET | Aggregator | Internal routes | — |
