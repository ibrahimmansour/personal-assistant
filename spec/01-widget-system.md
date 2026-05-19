# 01 — Widget System

> Complete specification of the widget architecture, contract, and all 12 widgets.

## Widget Contract

Every widget MUST adhere to these rules:

1. Start with `"use client"` directive
2. Import and wrap content in `<WidgetWrapper>` from `@/components/widget-wrapper`
3. Use icons exclusively from `lucide-react`
4. Use shadcn/ui primitives from `@/components/ui/`
5. Use `cn()` from `@/lib/utils` for conditional classes
6. Consume `useWidgetNavFor(widgetType)` for cross-widget navigation support

## Widget Registration (3 files)

When adding a new widget, update these three files:

### 1. `src/types/widget.ts` — Add to `WidgetType` union

```typescript
export type WidgetType =
  | "tasks" | "email" | "reminders" | "calendar" | "weather"
  | "github-prs" | "clock" | "jira" | "notes" | "terminal"
  | "bookmarks" | "files"
  | "your-new-widget";  // ADD HERE
```

### 2. `src/lib/dashboard-config.ts` — Add `WidgetConfig` entry and layout

Add to both `workWidgets` and `privateWidgets` arrays:
```typescript
{ id: "your-new-widget", type: "your-new-widget", title: "Title", visible: true }
```

Add layout items to both `workLayouts` and `privateLayouts`:
```typescript
{ i: "your-new-widget", x: 0, y: 16, w: 4, h: 4, minW: 2, minH: 2 }
```

### 3. `src/components/layout/dashboard-grid.tsx` — Import and register

```typescript
import YourNewWidget from "@/components/widgets/your-new-widget";

const widgetComponents: Record<string, React.ComponentType> = {
  // ... existing widgets
  "your-new-widget": YourNewWidget,
};
```

## WidgetWrapper Component

**File:** `src/components/widget-wrapper.tsx` (246 lines)

The shared chrome wrapper providing consistent card styling, drag handle, expand/collapse, pin, and split-view.

### Props

```typescript
interface WidgetWrapperProps {
  title: string;              // Widget display title
  icon?: ReactNode;           // Lucide icon element
  children: ReactNode;        // Widget content
  className?: string;         // Additional classes
  headerAction?: ReactNode;   // Buttons/controls in header right area
  widgetType?: WidgetType;    // For navigation system integration
  onExpandChange?: (expanded: boolean) => void;
  expandRequested?: boolean;  // External expand request (from WidgetNav)
  onExpandHandled?: () => void; // Callback after handling expand
  sidePanel?: ReactNode;      // Content for split-view side panel
  forceExpand?: boolean;      // Force expanded state (e.g., files+terminal)
}
```

### Behavior

**Normal mode:**
- Card with border, rounded corners, drag handle (`.drag-handle` class on header)
- Pin button visible only in Dashboard workspace
- Expand button (maximize icon)
- Header action area for widget-specific controls

**Expanded mode:**
- Renders fullscreen overlay via `createPortal(document.body)`
- Leaves a placeholder card (opacity-40) in the grid to prevent layout collapse
- Backdrop click or Escape key closes (except inside `.xterm` terminal)
- `document.body.style.overflow = "hidden"` while expanded
- Reports expanded widget type to `CommandPaletteContext.setExpandedWidget()`

**Split-view mode (expanded + sidePanel):**
- Main card takes 55% width, side panel takes 45%
- Side panel renders custom content (e.g., terminal in files widget)

## Widget Inventory

### 1. Clock Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/clock-widget.tsx` |
| **Lines** | 174 |
| **WidgetWrapper title** | "Clock" |
| **Icon** | `Clock` from lucide-react |
| **widgetType** | "clock" |
| **API endpoints** | None |
| **Contexts** | None |

**Features:**
- Analog clock face drawn on HTML `<canvas>` with second hand
- Canvas redraws every 1 second via `requestAnimationFrame` loop
- Digital time display below: hours:minutes AM/PM
- Date line: "Day, Month Date, Year"
- Location label: "Berlin, DE" (hardcoded)
- Theme-aware: reads oklch CSS variables for clock colors
- Canvas uses refs; time state for digital display updates every second

**State:** `time: Date` (updates every 1s)

---

### 2. Weather Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/weather-widget.tsx` |
| **Lines** | 175 |
| **WidgetWrapper title** | "Weather" |
| **Icon** | Dynamic (mapped from condition) |
| **widgetType** | "weather" |
| **API endpoints** | `GET /api/weather` |
| **Contexts** | None |

**Features:**
- Current temperature with condition icon (maps condition strings to lucide icons)
- Humidity, wind speed, location display
- 5-day forecast row with high/low temps
- Auto-refresh every 10 minutes
- Header action: manual refresh button
- Loading skeleton and error states

**State:** `weather: WeatherData | null`, `loading`, `error`

**Condition → Icon mapping:** `conditionIcons` maps strings like "Sunny", "Partly Cloudy", "Rain" etc. to `Sun`, `CloudSun`, `CloudRain`, etc. Default: `Cloud`.

---

### 3. Calendar Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/calendar-widget.tsx` |
| **Lines** | 376 |
| **WidgetWrapper title** | "Calendar" |
| **Icon** | `CalendarIcon` from lucide-react |
| **widgetType** | "calendar" |
| **API endpoints** | `GET /api/outlook/calendar` (work), `GET /api/google/calendar` (private) |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Shows today's and tomorrow's events sorted by time
- Each event: time range, title, location (if any)
- Event detail expansion on click: shows HTML body via `<HtmlContent>`
- "Now" indicator line at current time position
- Google auth URL link if authentication required
- Auto-refresh every 5 minutes
- Collapsed vs expanded views (collapsed shows mini event cards, expanded shows detail)
- Header action: "Today" label + date + refresh button

**State:** `events`, `loading`, `error`, `selectedId`, `authUrl`

---

### 4. Tasks Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/tasks-widget.tsx` |
| **Lines** | 1254 |
| **WidgetWrapper title** | "Tasks" |
| **Icon** | `CheckCircle2` from lucide-react |
| **widgetType** | "tasks" |
| **API endpoints** | `GET /api/tasks?profile=`, `POST /api/tasks` |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Full CRUD: add, edit, toggle complete, delete tasks
- Priority levels: high (red), medium (yellow), low (green) with badge colors
- Task folders with drag-and-drop between folders
- Folder CRUD: create, rename, delete folders
- Folder context menu (right-click): rename, set working directory, delete
- Working directory per folder (cwd) — used for AI terminal integration
- Filter/search within tasks
- AI terminal integration: "Do with AI" button on tasks opens a side panel terminal that runs a command to accomplish the task
- `forceExpand` when AI terminal is active
- `sidePanel` renders embedded terminal (PTY) for AI task execution
- Inline editing with auto-focus
- Completed tasks shown with strikethrough, sorted to bottom
- Count badges on folder tabs

**State (30+ variables):** `tasks`, `folders`, `loading`, `error`, `newTitle`, `newPriority`, `showAdd`, `editingId`, `editTitle`, `editPriority`, `activeFolder`, `addingFolder`, `newFolderName`, `editingFolderId`, `editFolderName`, `folderMenuId`, `dragTaskId`, `dropTargetFolder`, `filterQuery`, `showFilter`, `settingCwdFolderId`, `cwdInputValue`, `aiTerminalTask`, `folderMenuPos`

**POST actions:** `add`, `toggle`, `delete`, `update`, `reorder`, `addFolder`, `renameFolder`, `updateFolder`, `deleteFolder`

---

### 5. Email Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/email-widget.tsx` |
| **Lines** | 1407 |
| **WidgetWrapper title** | "Email" |
| **Icon** | `Mail` from lucide-react |
| **widgetType** | "email" |
| **API endpoints** | `GET /api/outlook/emails` or `GET /api/google/emails`, `GET /api/{provider}/emails/{id}`, `GET /api/{provider}/emails/search?q=`, `POST /api/{provider}/emails/{id}/reply`, `GET /api/email-rules`, `POST /api/email-rules`, `POST /api/outlook/refresh-token` |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Email list with unread indicators (blue dot, bold text)
- Click to expand email body (rendered via `<HtmlContent>` iframe)
- Server-side search with debounced input (400ms delay)
- Email categorization system:
  - Rule-based groups (Focused, GitHub, Jira, Automated, etc.)
  - Draggable tab reordering
  - "Focused" tab = emails not matching any other rule
  - Rules panel with add/edit/delete rules
  - Quick rule creation from email context (right-click "Add rule from this sender")
  - Rule fields: `from`, `fromAddress`, `subject` with `contains` operator
- Reply/Reply-All inline form with textarea
- Outlook token refresh flow (for work profile)
- Google OAuth re-auth prompt (for private profile)
- Auto-refresh every 3 minutes
- Collapsed view (mini email list) vs expanded view (full detail)

**Sub-components (internal):**
- `RulesPanel` — CRUD for email categorization rules
- `QuickRuleDialog` — create rule from email sender/subject

**State (35+ variables):** emails, loading, error, selectedId, fetchedEmail, fetchingEmail, authUrl, tokenExpired, refreshingToken, refreshStatus, searchQuery, searchResults, searching, groups, activeGroupTab, showRulesPanel, quickRuleEmail, draggedTabId, dragOverTabId, replyOpen, replyAll, replyText, sending, sendError, sendSuccess

---

### 6. Reminders Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/reminders-widget.tsx` |
| **Lines** | 222 |
| **WidgetWrapper title** | "Reminders" |
| **Icon** | `Bell` from lucide-react |
| **widgetType** | "reminders" |
| **API endpoints** | `GET /api/outlook/calendar` (work), `GET /api/google/calendar` (private) |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Shows upcoming events (next 48 hours) as reminder-style cards
- Events sorted by start time
- "Happening now" indicator with animated pulse dot
- Time display: relative ("in 30 min", "in 2 hours") or "Now"
- Event location shown if available
- Color-coded by event type (uses oklch accent colors)
- Auto-refresh every 5 minutes
- Header action: event count badge + refresh button

**State:** `reminders`, `loading`, `error`

---

### 7. GitHub PRs Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/github-prs-widget.tsx` |
| **Lines** | 359 |
| **WidgetWrapper title** | "Pull Requests" |
| **Icon** | `GitPullRequest` from lucide-react |
| **widgetType** | "github-prs" |
| **API endpoints** | `GET /api/github/prs?profile=` |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Lists authored PRs with status badges (open/merged/closed with color coding)
- Repository name, PR title, creation date
- Review status indicators (approved, changes requested, pending)
- Additions/deletions diff stats (+/- with green/red)
- Comment count
- Links open PR in browser
- Highlight and auto-scroll to specific PR (from navigation system)
- Filter/search by title or repo
- Auto-refresh every 5 minutes
- Header action: last fetched timestamp + filter toggle + refresh

**State:** `prs`, `loading`, `error`, `lastFetched`, `highlightedId`, `filterQuery`, `showFilter`

---

### 8. Jira Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/jira-widget.tsx` |
| **Lines** | 751 |
| **WidgetWrapper title** | "Jira" |
| **Icon** | Custom inline SVG (Jira logo) |
| **widgetType** | "jira" |
| **API endpoints** | `GET /api/jira`, `GET /api/jira/{key}`, `POST /api/jira/auth`, `GET /api/jira/auth` |
| **Contexts** | `useWidgetNavFor` |

**Features:**
- Lists open Jira issues assigned to current user
- Issue detail panel: description (rendered HTML), status, priority, type, project, assignee, reporter, labels, components, fix versions, comments
- Cookie-based authentication with three methods:
  1. Auto-extract from Chrome cookies (preferred)
  2. Manual cookie paste input
  3. Re-auth prompt on expiry
- Filter/search by key or summary
- Status badges with color mapping (To Do=gray, In Progress=blue, Done=green, etc.)
- Priority icons (Highest/High=red, Medium=yellow, Low/Lowest=blue)
- Issue type icons (Bug, Story, Task, Epic, Sub-task)
- Auto-refresh every 5 minutes
- Collapsed view: issue list only. Expanded view: list + detail panel
- Header action: auth status + filter toggle + refresh
- Only visible in work profile

**State:** `issues`, `loading`, `error`, `authRequired`, `authLoading`, `authMessage`, `showCookieInput`, `cookieInput`, `lastFetched`, `selectedKey`, `detail`, `detailLoading`, `detailError`, `filterQuery`, `showFilter`

---

### 9. Notes Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/notes-widget.tsx` |
| **Lines** | 825 |
| **WidgetWrapper title** | "Notes" |
| **Icon** | `StickyNote` from lucide-react |
| **widgetType** | "notes" |
| **API endpoints** | `GET /api/notes?profile=&folder=&search=`, `POST /api/notes` |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Rich text editor powered by Tiptap with these extensions:
  - StarterKit (bold, italic, headings, lists, blockquote, code, horizontal rule)
  - Underline, TextAlign, Highlight, Color, TextStyle
  - Placeholder ("Start writing...")
  - TaskList + TaskItem (checkbox lists)
- Editor toolbar: bold, italic, underline, strikethrough, headings (H1-H3), bullet/ordered/task lists, blockquote, code, text align, highlight, text color
- Note list with title, preview text, last updated date
- Pin notes to top
- Duplicate notes
- Delete notes with confirmation
- Folder organization (sidebar folder list)
- Search across note titles and content
- Auto-save with 1-second debounce after editing
- Collapsed: note list. Expanded: note list + editor side-by-side
- Header action: new note button + search toggle

**Sub-components (internal):**
- `EditorToolbar` — Tiptap toolbar with all formatting buttons
- `NoteEditor` — individual note editor with title + Tiptap content

**POST actions:** `create`, `update`, `delete`, `pin`, `duplicate`

**State:** `notes`, `loading`, `error`, `selectedId`, `searchQuery`, `showSearch`

---

### 10. Terminal Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/terminal-widget.tsx` |
| **Lines** | 471 |
| **WidgetWrapper title** | "Terminal" |
| **Icon** | `TerminalSquare` from lucide-react |
| **widgetType** | "terminal" |
| **API endpoints** | None (WebSocket to `ws://localhost:4445`) |
| **Contexts** | `useTerminal`, `useWidgetNavFor` |

**Features:**
- Multi-tab terminal emulator with xterm.js
- Each tab is an independent PTY session via WebSocket
- New tab button with optional cwd/command parameters
- Tab close (X button), tab switching
- Dynamic import of xterm.js libraries (client-only)
- Terminal theme synced with app theme via MutationObserver on `<html>` class
- oklch CSS variable → hex conversion for xterm theme colors
- ResizeObserver for terminal fit on container resize
- WebSocket reconnection awareness (alive/dead indicators)
- Handles external tab requests from TerminalContext (dispatched by files widget, tasks widget, command palette)
- Header action: new tab button + paste text button
- Session map stored in module-level Map (survives re-renders)

**WebSocket protocol:**
- Client → Server: `{ type: "input", data }`, `{ type: "resize", cols, rows }`
- Server → Client: `{ type: "output", data }`, `{ type: "exit", exitCode, signal }`

**State:** `tabs` (string IDs), `activeTab`, `loading`, `error`

---

### 11. Bookmarks Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/bookmarks-widget.tsx` |
| **Lines** | 467 |
| **WidgetWrapper title** | "Bookmarks" |
| **Icon** | `Bookmark` from lucide-react |
| **widgetType** | "bookmarks" |
| **API endpoints** | `GET /api/browser?type=bookmarks&profile=`, `POST /api/browser` |
| **Contexts** | `useProfile`, `useWidgetNavFor` |

**Features:**
- Categorized bookmark list (SAP Tools, Development, etc.)
- Add new bookmarks with title, URL, category
- Edit existing bookmarks
- Delete bookmarks
- Filter/search across bookmarks
- Category tabs for filtering
- Link click opens in new browser tab
- Form validation (URL required)
- Auto-load on profile change
- Header action: add button + filter toggle

**State:** `bookmarks`, `loading`, `activeCategory`, `adding`, `editing`, `formTitle`, `formUrl`, `formCategory`, `filterQuery`, `showFilter`

---

### 12. Files Widget

| Property | Value |
|----------|-------|
| **File** | `src/components/widgets/files-widget.tsx` |
| **Lines** | 3515 |
| **WidgetWrapper title** | "Files" |
| **Icon** | `FolderOpen` from lucide-react |
| **widgetType** | "files" |
| **API endpoints** | `GET /api/files?path=&read=1&raw=1&search=&git=1&diff=1&blame=1&branches=1&symbols=1&langstats=1&gitignore=1&project=1&recent=1`, `POST /api/files` |
| **Contexts** | `useWidgetNavFor` |

**Features:** (see `12-file-browser-system.md` for full spec)
- Directory browsing with breadcrumb navigation
- Multiple view modes: list, grid, column (Finder-style), tree
- File preview: text files with syntax highlighting (via shiki), images (raw URL), markdown rendered, binary hex view
- File editing with save
- File CRUD: create file/folder, rename, delete
- Context menu (right-click) on files/folders
- File search: name or content search with debounced input
- Git integration: status, diff viewer, blame, branches, stage/unstage, commit, stash, checkout
- Tabbed file viewing (multiple open files)
- Image diff viewer (swipe and side-by-side modes for git diffs)
- Symbol extraction (functions, classes, etc.)
- Language statistics
- Project detection (Node, Python, Rust, etc.)
- File bookmarks
- Gitignore-aware filtering
- Auto-refresh toggle
- Split terminal panel (forceExpand + sidePanel)
- Drag-and-drop files to terminal (pastes path)
- Recent files view
- Inline path editing with directory autocomplete

**Sub-components (25+ internal):**
- `PathBar` — breadcrumb + editable path with autocomplete
- `ContextMenu` — right-click menu for file operations
- `InlineRename` — inline file/folder rename
- `ImageDiffViewer` — swipe/side-by-side git image diff
- `GitActionsPanel` — stage, unstage, commit, stash, branches
- `MarkdownPreview` — rendered markdown with ReactMarkdown + shiki
- `TextPreview` — text file content with line numbers
- `ColumnView` — macOS Finder-style column browser
- `ListView` — file list with selection and keyboard navigation
- `TreeView` — recursive tree browser
- `RecentFilesView` — recently modified files

**State (60+ variables):** See `12-file-browser-system.md`

## Widget Category Map

Widgets are grouped into categories for sidebar navigation:

| Category | Widget IDs |
|----------|-----------|
| **Glance** | clock, weather, reminders |
| **Productivity** | calendar, tasks, email |
| **Development** | github-prs, jira, notes |
| **Tools** | terminal, bookmarks, files |

## Widget Sizing Constraints

From `dashboard-config.ts` layout definitions:

| Widget | Default W | Default H | Min W | Min H |
|--------|-----------|-----------|-------|-------|
| clock | 4 | 2 | 2 | 2 |
| weather | 4 | 2 | 2 | 2 |
| calendar | 4 | 4 | 2 | 2 |
| reminders | 4 | 2 | 2 | 2 |
| tasks | 4 | 4 | 2 | 2 |
| email | 4 | 4 | 2 | 2 |
| jira | 4 | 4 | 2 | 2 |
| github-prs | 4 | 4 | 2 | 2 |
| terminal | 4 | 4 | 2 | 2 |
| notes | 4 | 4 | 2 | 2 |
| bookmarks | 4 | 4 | 2 | 2 |
| files | 12 (work) / 4 (private) | 4 | 2 | 2 |

Grid uses 12 columns, so `w: 4` = 1/3 width, `w: 12` = full width.
