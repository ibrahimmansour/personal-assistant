# 08 — Data Persistence

> Complete specification of all data storage mechanisms, file formats, and persistence strategies.

## Overview

The application uses **no database**. All data is stored as local JSON files under `~/.personal-assistant/` on the host filesystem. The browser uses localStorage for immediate state and debounced server writes for durability.

## Storage Directory

```
~/.personal-assistant/
├── tasks.json                    # Work profile tasks + folders
├── tasks-private.json            # Private profile tasks + folders
├── notes.json                    # Work profile notes
├── notes-private.json            # Private profile notes
├── dashboard.json                # Work profile layout state
├── dashboard-private.json        # Private profile layout state
├── email-rules.json              # Work profile email categorization rules
├── email-rules-private.json      # Private profile email rules
├── bookmarks.json                # Work profile bookmarks
├── bookmarks-private.json        # Private profile bookmarks
├── browser-history.json          # Work profile browser history
├── browser-history-private.json  # Private profile browser history
├── outlook-emails-cache.json     # Outlook email cache (5min TTL)
├── gmail-emails-cache.json       # Gmail email cache (5min TTL)
├── google-tokens.json            # Google OAuth2 tokens
├── file-bookmarks.json           # File browser bookmarks
├── jira/
│   └── auth.json                 # Jira cookie auth
└── (created automatically on first write)
```

Additionally, Outlook tokens are stored at:
```
~/.sap-email-cli/token_cache.json
```

## File Name Convention

| Base Name | Work Profile | Private Profile |
|-----------|-------------|-----------------|
| `tasks.json` | `tasks.json` | `tasks-private.json` |
| `notes.json` | `notes.json` | `notes-private.json` |
| `dashboard.json` | `dashboard.json` | `dashboard-private.json` |
| `email-rules.json` | `email-rules.json` | `email-rules-private.json` |
| `bookmarks.json` | `bookmarks.json` | `bookmarks-private.json` |

Pattern: work profile uses the base name; other profiles append `-{profileId}`.

```typescript
const filename = profile === "work" ? "data.json" : `data-${profile}.json`;
const filePath = join(DATA_DIR, filename);
```

## Persistence Strategies

### Strategy 1: Server-Only (API routes)

Used by: tasks, notes, email-rules, bookmarks, weather cache, email cache

```
Widget fetch() → API Route → readFile(~/.personal-assistant/X.json) → Response.json()
Widget POST   → API Route → readFile → modify → writeFile → Response.json(updated)
```

The API route handles all file I/O. The widget has no local persistence.

### Strategy 2: Dual Persistence (localStorage + server)

Used by: dashboard state, workspace state

```
State mutation
  → Immediate: localStorage.setItem(key, JSON.stringify(data))
  → Debounced (500ms): POST /api/dashboard { data }
    → API route: writeFile(~/.personal-assistant/dashboard.json)
```

**Load priority:**
1. Server (GET /api/dashboard) — check version match
2. localStorage — check version match
3. Defaults from code

### Strategy 3: localStorage-Only

Used by: appearance, profile, layout lock, theme (via next-themes)

```
State mutation → localStorage.setItem(key, value)
Load → localStorage.getItem(key) on mount
```

### Strategy 4: File-Based Cache with TTL

Used by: Outlook emails, Gmail emails

```
API request
  → readFile(cache.json)
  → If cache exists AND (now - fetchedAt) < TTL: return cached
  → Else: fetch from external API
    → writeFile(cache.json, { data, fetchedAt })
    → On error: return stale cache if available
```

TTL: 5 minutes (300,000ms)

---

## Data Schemas

### Tasks (`tasks.json`)

```json
{
  "tasks": [
    {
      "id": "uuid-string",
      "title": "Implement feature X",
      "completed": false,
      "priority": "high",
      "dueDate": "2024-01-15",
      "folderId": "folder-uuid",
      "createdAt": "2024-01-10T08:00:00Z"
    }
  ],
  "folders": [
    {
      "id": "folder-uuid",
      "name": "Project Alpha",
      "cwd": "/Users/user/projects/alpha",
      "createdAt": "2024-01-10T08:00:00Z"
    }
  ]
}
```

### Notes (`notes.json`)

```json
{
  "notes": [
    {
      "id": "uuid-string",
      "title": "Meeting Notes",
      "content": "<p>Rich <strong>HTML</strong> content from Tiptap</p>",
      "folder": "Work",
      "pinned": true,
      "createdAt": "2024-01-10T08:00:00Z",
      "updatedAt": "2024-01-12T14:30:00Z"
    }
  ]
}
```

### Dashboard (`dashboard.json`)

```json
{
  "widgets": [
    { "id": "clock", "type": "clock", "title": "Clock", "visible": true },
    { "id": "weather", "type": "weather", "title": "Weather", "visible": true }
  ],
  "layouts": {
    "lg": [
      { "i": "clock", "x": 0, "y": 0, "w": 4, "h": 2, "minW": 2, "minH": 2 },
      { "i": "weather", "x": 4, "y": 0, "w": 4, "h": 2, "minW": 2, "minH": 2 }
    ]
  },
  "version": 15,
  "workspaceState": {
    "workspaces": [],
    "activeWorkspaceId": "dashboard",
    "focusCombos": [],
    "pinnedWidgetIds": [],
    "collapsedSections": {},
    "sidebarExpanded": true
  },
  "workspaceVersion": 3,
  "updatedAt": "2024-01-12T14:30:00Z"
}
```

### Email Rules (`email-rules.json`)

```json
{
  "groups": [
    {
      "id": "uuid-string",
      "name": "GitHub",
      "color": "gray",
      "rules": [
        { "field": "fromAddress", "operator": "contains", "value": "github.com" }
      ]
    }
  ]
}
```

### Bookmarks (`bookmarks.json`)

```json
[
  {
    "id": "uuid-string",
    "title": "GitHub",
    "url": "https://github.com",
    "category": "Development"
  }
]
```

### Email Cache (`outlook-emails-cache.json` / `gmail-emails-cache.json`)

```json
{
  "emails": [
    {
      "id": "message-id",
      "from": "John Doe",
      "fromAddress": "john@example.com",
      "subject": "Hello",
      "preview": "Just wanted to...",
      "bodyHtml": "<html>...</html>",
      "time": "2024-01-12T10:00:00Z",
      "read": true,
      "hasAttachments": false,
      "webLink": "https://outlook.office.com/...",
      "categories": [],
      "to": ["me@example.com"],
      "cc": []
    }
  ],
  "total": 42,
  "fetchedAt": "2024-01-12T14:30:00Z"
}
```

### Google Tokens (`google-tokens.json`)

```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//0d...",
  "expires_at": 1705312800,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly"
}
```

### Jira Auth (`jira/auth.json`)

```json
{
  "cookies": "JSESSIONID=abc123; atlassian.xsrf.token=xyz789; ...",
  "timestamp": 1705312800000,
  "user": "d067576"
}
```

### File Bookmarks (`file-bookmarks.json`)

```json
[
  {
    "path": "/Users/user/projects/my-app/src/index.ts",
    "name": "index.ts",
    "addedAt": "2024-01-12T14:30:00Z"
  }
]
```

---

## localStorage Keys

| Key | Provider | Content |
|-----|----------|---------|
| `assistant-profile` | ProfileProvider | `"work"` or `"private"` |
| `appearance` | AppearanceProvider | `{ colorTheme, fontFamily }` |
| `dashboard-widgets-{profile}` | DashboardProvider | `WidgetConfig[]` JSON |
| `dashboard-layout-{profile}` | DashboardProvider | `Layout` JSON |
| `dashboard-version-{profile}` | DashboardProvider | `"15"` (version number) |
| `dashboard-layout-locked-{profile}` | DashboardProvider | `"true"` or `"false"` |
| `workspace-state-{profile}` | WorkspaceProvider | Full workspace state JSON |
| `theme` | next-themes | `"light"`, `"dark"`, or `"system"` |

---

## Directory Initialization

All API routes that write to `~/.personal-assistant/` first ensure the directory exists:

```typescript
import { mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}
```

The Jira module also ensures its subdirectory:
```typescript
const JIRA_DIR = join(DATA_DIR, "jira");
await mkdir(JIRA_DIR, { recursive: true });
```

---

## Version-Gated Resets

Both dashboard and workspace states use version numbers to force resets when the data schema changes:

```typescript
// Dashboard
const LAYOUT_VERSION = 15;  // Bump to force layout reset

// Workspace
const WORKSPACE_VERSION = 3; // Bump to force workspace reset
```

On load:
```typescript
if (storedVersion !== LAYOUT_VERSION) {
  // Discard stored data, use defaults
  return getDefaultDashboard(profile);
}
```

---

## Data Migration

### Jira Legacy Migration

The Jira auth module checks for a legacy auth file from a previous tool:
```
~/.config/prompt-kit/jira-query/auth.json → ~/.personal-assistant/jira/auth.json
```

If found, it automatically migrates the cookies to the new location.

---

## Concurrent Write Safety

Since this is a single-user local application, there are no concurrent write concerns from multiple processes. However, the dual persistence strategy means:

1. localStorage writes are synchronous and immediate
2. Server writes are debounced — only the latest state is written
3. If the browser crashes between localStorage write and server write, server data may be stale
4. On next load, server is tried first; if version matches, server data wins

This is acceptable for a local single-user tool.

---

## Backup / Reset

To reset all data:
```bash
rm -rf ~/.personal-assistant/
```

To reset only layout:
```bash
rm ~/.personal-assistant/dashboard*.json
```

The application will recreate all files with defaults on next access.
