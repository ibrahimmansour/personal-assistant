# 12 — File Browser System

> Complete specification of the files widget (3515 lines) — the largest component in the application.

## Overview

The files widget is a full-featured file browser with directory navigation, file viewing/editing, search, git integration, and an embedded terminal. It accounts for ~14% of the entire application code.

## Component Structure

The files widget is composed of 25+ internal sub-components:

```
FilesWidget (main, 3515 lines)
├── PathBar — Breadcrumb navigation + editable path with autocomplete
├── ContextMenu — Right-click menu for file/folder operations
├── InlineRename — Inline file/folder rename input
├── ImageDiffViewer — Swipe/side-by-side git image diff
├── GitActionsPanel — Stage, unstage, commit, stash, branches
├── MarkdownPreview — ReactMarkdown + shiki syntax highlighting
├── TextPreview — Text file with line numbers
├── ColumnView — macOS Finder-style column browser
├── ListView — File list with keyboard navigation
├── TreeView — Recursive tree browser
├── RecentFilesView — Recently modified files
└── (various inline sub-components)
```

## View Modes

| Mode | Description | Implementation |
|------|-------------|----------------|
| `list` | Standard file list with icons | `ListView` component |
| `grid` | Grid of file/folder cards | Inline grid layout |
| `column` | macOS Finder-style columns | `ColumnView` component |
| `tree` | Recursive tree view | `TreeView` component |

## Features

### Directory Browsing

- **Breadcrumb navigation:** Click any path segment to navigate. Last segment is current directory.
- **Path bar editing:** Click path bar to switch to editable input with directory autocomplete
- **Directory autocomplete:** As user types, fetches directory listing and suggests completions
- **Back navigation:** Parent directory button
- **Hidden files:** Toggle to show/hide dotfiles
- **Sorting:** By name (directories first) or by modification date
- **Auto-refresh:** Toggle button for periodic refresh

### File Preview

| File Type | Preview Method |
|-----------|---------------|
| Text files | Line-numbered text view with monospace font |
| Markdown (`.md`) | Rendered markdown via ReactMarkdown + shiki code blocks |
| Images (`.png`, `.jpg`, `.gif`, `.svg`, `.webp`, `.ico`) | Raw image display via `/api/files?raw=1` |
| Code files | Text view (planned: syntax highlighting) |
| Binary files | Hex dump view |
| Large files (>1MB) | Truncated with size warning |

### File Editing

- **Edit mode:** Toggle edit button on text file preview
- **Textarea editor:** Full file content in monospace textarea
- **Save:** POST to `/api/files` with `action: "save"`
- **Save status:** Shows "Saved" or "Error" indicator

### File CRUD

| Operation | Trigger | API Call |
|-----------|---------|----------|
| Create file | Context menu → "New File" | `POST /api/files { action: "touch", path }` |
| Create folder | Context menu → "New Folder" | `POST /api/files { action: "mkdir", path }` |
| Rename | Context menu → "Rename" or F2 | `POST /api/files { action: "rename", path, newName }` |
| Delete | Context menu → "Delete" | `POST /api/files { action: "delete", path }` |

### Context Menu

Right-click on file or folder shows:
- Open
- Open in New Tab
- Rename
- Copy Path
- Open in Terminal (directories only)
- Open in VS Code (planned)
- Delete
- New File (directories only)
- New Folder (directories only)
- Bookmark / Unbookmark

### File Search

**Two modes:**
- **Name search:** Searches file/folder names (fast, index-based)
- **Content search:** Searches inside file contents (slower, grep-like)

**Scope:**
- Current directory (default)
- Global (toggle for broader search)

**Implementation:**
- Debounced input (150ms)
- `GET /api/files?search={query}&root={path}&mode=name|content`
- Results show file path, match preview (for content search), and file size

### Tabbed File Viewing

When expanded, the widget supports multiple open files:

```
┌─────────────────────────────────────────────────┐
│ [Tab: index.ts] [Tab: config.json] [Tab: +]    │
├─────────────────────────────────────────────────┤
│ File content for active tab                      │
└─────────────────────────────────────────────────┘
```

- Click file to open in new tab (or activate existing tab)
- Close tabs with X button
- Active tab highlighted
- Tab content persists while switching

---

## Git Integration

### Git Status Panel

Shows when current directory is a git repository:

```
┌────────────────────────────────┐
│ branch: main ↑2 ↓0            │
│ Last commit: abc1234 "msg"     │
├────────────────────────────────┤
│ Modified files:                │
│ ● M  src/index.ts             │
│ ● A  src/new-file.ts          │
│ ● D  old-file.ts              │
│ ● ?  untracked.txt            │
└────────────────────────────────┘
```

**File status indicators:**
| Status | Color | Meaning |
|--------|-------|---------|
| `M` | Yellow | Modified |
| `A` | Green | Added/Staged |
| `D` | Red | Deleted |
| `R` | Blue | Renamed |
| `?` | Gray | Untracked |

### Git Diff Viewer

- View diff for any modified file
- Supports staged and unstaged diffs
- Unified diff format with syntax highlighting
- Additions in green, deletions in red

### Git Blame

- Line-by-line blame view
- Shows commit hash, author, date per line
- Truncated commit messages

### Image Diff Viewer

For modified image files, provides two comparison modes:

**Swipe mode:**
```
┌──────────────────────────────────┐
│  OLD IMAGE  |  NEW IMAGE         │
│         ←─ slider ─→            │
└──────────────────────────────────┘
```
- Draggable slider divides old/new images
- Real-time comparison

**Side-by-side mode:**
```
┌───────────────┬──────────────────┐
│  OLD IMAGE    │   NEW IMAGE      │
└───────────────┴──────────────────┘
```

### Git Actions Panel

```
┌────────────────────────────────┐
│ Stage / Unstage files          │
│ [Stage All] [Unstage All]      │
│                                │
│ Commit message: [___________]  │
│ [Commit]                       │
│                                │
│ Stash:                         │
│ [Stash Push] [Stash Pop]       │
│ [Show Stash List]              │
│                                │
│ Branches: [main ▼]             │
│ [Checkout]                     │
└────────────────────────────────┘
```

**Supported git operations:**
| Operation | API Call |
|-----------|----------|
| Stage files | `POST { action: "git-stage", files, path }` |
| Unstage files | `POST { action: "git-unstage", files, path }` |
| Commit | `POST { action: "git-commit", message, path }` |
| Stash push | `POST { action: "git-stash", subAction: "push", message?, path }` |
| Stash pop | `POST { action: "git-stash", subAction: "pop", path }` |
| Stash list | `POST { action: "git-stash", subAction: "list", path }` |
| List branches | `GET /api/files?branches=1&path=` |
| Checkout branch | `POST { action: "git-checkout", branch, path }` |

### Symbol Extraction

For code files, extracts functions, classes, interfaces:
```
GET /api/files?symbols=1&file={path}
```
Displays in a sidebar panel with type icons (function, class, interface, etc.)

### Language Statistics

```
GET /api/files?langstats=1&path={repoRoot}
```
Shows breakdown of languages in the repository with percentage bars.

### Project Detection

```
GET /api/files?project=1&path={dir}
```
Detects project type by presence of:
- `package.json` → Node.js
- `Cargo.toml` → Rust
- `requirements.txt` / `pyproject.toml` → Python
- `go.mod` → Go
- etc.

---

## Split Terminal

The files widget can show an embedded terminal alongside the file browser:

```
┌─────────────────────────────────┬──────────────────────┐
│  File Browser (55%)             │  Terminal (45%)       │
│  ┌─────────────────────────┐   │  ┌──────────────────┐│
│  │ Directory listing       │   │  │ $ ls             ││
│  │ or file preview         │   │  │ README.md        ││
│  │                         │   │  │ src/             ││
│  └─────────────────────────┘   │  └──────────────────┘│
└─────────────────────────────────┴──────────────────────┘
```

**Trigger:**
- Click "Open Terminal" in toolbar
- Context menu → "Open in Terminal" on a directory
- Drag file to terminal area (pastes file path)

**Implementation:**
- Uses `TerminalPanel` component as `sidePanel` prop of WidgetWrapper
- `forceExpand` activates when terminal is open (widget goes fullscreen)
- `pasteRef` allows drag-and-drop of file paths into terminal
- Terminal opens with `cwd` set to current directory

### Drag-and-Drop to Terminal

Files and folders can be dragged onto the terminal pane:
1. Drag starts on file/folder in browser
2. Terminal area shows drop zone indicator
3. On drop: `pasteRef.current(filePath)` writes the path to the terminal's PTY
4. User can then use the path in their command

---

## File Bookmarks

Users can bookmark files for quick access:

```
POST /api/files { action: "bookmark", subAction: "add", filePath }
POST /api/files { action: "bookmark", subAction: "remove", filePath }
POST /api/files { action: "bookmark", subAction: "list" }
```

Bookmarks stored in `~/.personal-assistant/file-bookmarks.json`.

Shown in a sidebar panel when expanded.

---

## Gitignore Filtering

Toggle to hide gitignored files:
```
GET /api/files?gitignore=1&path={dir}
```
Returns list of ignored file/folder names. The widget filters these from the directory listing.

---

## Recent Files View

Shows recently modified files across the filesystem:
```
GET /api/files?recent=1&root=~&limit=60
```

Displayed as a list sorted by modification time.

---

## API Route: `/api/files`

**File:** `src/app/api/files/route.ts` (1482 lines)

This is the backend for the entire file browser. See `02-api-routes.md` for the complete parameter reference.

### Key Implementation Details

**In-memory caching:**
- Tree index cache for file search (per-directory)
- LRU query cache for recent searches
- Both invalidated on reindex

**Git operations:**
- All git operations use `child_process.execFile` or `execSync` for the `git` CLI
- Error handling returns human-readable messages
- Diff and blame parse git's output format

**File type detection:**
- MIME type inference from file extension
- Binary detection for raw file serving
- Text/binary heuristic for preview mode

**Path resolution:**
- `~` expanded to `homedir()`
- All paths resolved to absolute
- Parent directory always provided for navigation

---

## State Variables (60+)

The files widget has the most state of any component:

### Core navigation
- `currentPath`, `entries`, `parentPath`, `resolvedPath`, `loading`, `error`
- `showHidden`, `viewMode` (list/grid/column/tree)

### File preview
- `preview` (path, content, extension, size, truncated), `previewLoading`
- `editing`, `editContent`, `saving`, `saveStatus`

### Search
- `searchOpen`, `searchQuery`, `searchMode`, `searchGlobal`
- `searchResults`, `searchLoading`, `searchTotal`

### Git
- `gitStatus`, `gitOpen`, `gitLoading`
- `diffContent`, `diffFile`, `blameLines`
- `showGitActions`, `showBranches`

### Tabs
- `openTabs`, `activeTabIdx`

### Terminal
- `splitTerminal`, `dragOverTerminal`, `terminalPasteRef`

### Extras
- `symbols`, `showSymbols`, `projectInfo`, `showProject`
- `langStats`, `showLangStats`, `bookmarks`, `showBookmarks`
- `hideGitignored`, `gitIgnoredNames`, `autoRefresh`
- `ctxMenu`, `newEntry`, `renamingEntry`, `renameValue`
- `listFocusedIdx`
