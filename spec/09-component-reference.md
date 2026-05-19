# 09 — Component Reference

> Complete reference of all non-widget, non-context components with their props, behavior, and relationships.

## Component Inventory

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Header | `layout/header.tsx` | 132 | Top navigation bar |
| Sidebar | `layout/sidebar.tsx` | 707 | Left sidebar with workspaces and widget nav |
| DashboardGrid | `layout/dashboard-grid.tsx` | 308 | Widget grid (react-grid-layout) |
| WidgetSettings | `layout/widget-settings.tsx` | 111 | Widget toggle and layout controls |
| AppearancePicker | `layout/appearance-picker.tsx` | 94 | Color theme + font picker dropdown |
| TodayView | `views/today-view.tsx` | 498 | Morning briefing view |
| InboxView | `views/inbox-view.tsx` | 510 | Unified inbox view |
| TimelineView | `views/timeline-view.tsx` | 317 | Chronological activity feed |
| WidgetWrapper | `widget-wrapper.tsx` | 246 | Shared widget chrome |
| FocusMode | `focus-mode.tsx` | 175 | Split-view with dividers |
| CommandPalette | `command-palette.tsx` | 1547 | Global search + AI |
| HtmlContent | `html-content.tsx` | 184 | Sandboxed HTML iframe renderer |
| TerminalPanel | `terminal-panel.tsx` | 277 | Standalone terminal component |
| AIChatPanel | `ai-chat-panel.tsx` | 364 | Slide-in AI chat UI |
| ThemeProvider | `theme-provider.tsx` | 11 | next-themes wrapper |

---

## Header

**File:** `src/components/layout/header.tsx` (132 lines)

### Contexts Consumed
- `useTheme()` — light/dark toggle
- `useProfile()` — profile switcher tabs
- `useCommandPalette()` — opens search
- `useAIChat()` — toggles AI panel

### Layout Structure
```
┌──────────────────────────────────────────────────────────────┐
│ [Logo] Personal Assistant  [Profile Tabs]  [Search] [AI] [⚙] [🌙] │
└──────────────────────────────────────────────────────────────┘
```

### Key Behaviors
- Profile switcher: tabs mapped from `profiles` array with icons
- Search button: triggers `openSearch()` with `Cmd+P` hint
- AI button: toggles chat panel with `Cmd+I` shortcut (registered via useEffect)
- Appearance picker and widget settings embedded as dropdown popover triggers
- Dark/light toggle: hydration-safe (renders only after `mounted` state)

---

## Sidebar

**File:** `src/components/layout/sidebar.tsx` (707 lines)

### Contexts Consumed
- `useWorkspace()` — workspaces, active, focus combos, sidebar state
- `useDashboard()` — widget list for selection dialogs
- `useProfile()` — filters Jira for private profile

### Layout Structure
```
┌────────────────────┐
│ Workspaces         │  ← Tabs with context menus
│  Dashboard  Dev    │
│  Comms  Notes      │
│  Today  Inbox  ... │
├────────────────────┤
│ Focus Combos       │  ← Quick split-view launchers
│  Terminal+Files    │
│  Email+Calendar    │
├────────────────────┤
│ Widgets            │  ← Grouped by category
│ ▸ Glance           │
│   Clock  Weather   │
│ ▸ Productivity     │
│   Calendar Tasks   │
│ ▸ Development      │
│   PRs  Jira Notes  │
│ ▸ Tools            │
│   Terminal Files   │
├────────────────────┤
│ [+Workspace] [+Focus] │
│ [◀ Collapse]       │
└────────────────────┘
```

### Key Behaviors
- **Workspace tabs:** Click to switch, right-click for context menu (edit/delete custom)
- **Widget navigation:** Click widget name → `scrollToWidget()` scrolls grid and adds `.widget-highlight` flash animation
- **Categories:** Collapsible sections, filtered by profile (no Jira in private)
- **Dialogs:** Two Dialog components for workspace and focus combo creation/editing
- **Collapse:** Toggle between 200px expanded and 48px icon-only mode

### `scrollToWidget(id)`
1. Find widget element by `data-widget-type`
2. Scroll into view with `behavior: "smooth", block: "center"`
3. Add `widget-highlight` CSS class
4. Remove class after 1.5s (matching animation duration)

---

## Views

### TodayView

**File:** `src/components/views/today-view.tsx` (498 lines)

**Contexts:** `useProfile`, `useWorkspace`

**Fetches:** 6 API calls in parallel via `Promise.allSettled()`:
- Weather, Calendar (Outlook/Google), Tasks, Emails, GitHub PRs, Jira

**Sections:**
1. **Greeting** — "Good morning/afternoon/evening, {time}"
2. **Weather card** — temperature, condition, humidity, wind
3. **Quick stats grid** — 4 clickable cards:
   - Unread emails (count + clickable → Comms workspace)
   - Open PRs (count + clickable → Dev workspace)
   - In-progress Jira (count + clickable → Dev workspace, work only)
   - Pending tasks (count + clickable → Notes workspace)
4. **Next Up / Happening Now** — next event with animated pulse dot
5. **Schedule timeline** — all events with time-based color coding
6. **Tasks list** — incomplete tasks sorted by priority
7. **Latest email** — most recent unread email

**Auto-refresh:** Every 5 minutes

### InboxView

**File:** `src/components/views/inbox-view.tsx` (510 lines)

**Contexts:** `useProfile`

**Fetches:** 5 endpoints (emails, PRs, Jira, calendar, tasks), normalizes into unified `InboxItem[]`

**Layout:**
```
┌─────────────────────────────────────────────┐
│ Filter tabs: All | Email | PRs | Jira | Cal │
├───────────────┬─────────────────────────────┤
│ Item List     │ Detail Panel                │
│ (380px fixed) │ (remaining width)           │
│               │                             │
│ ● Email from  │ Full email body / PR detail │
│   John Doe    │ / Jira detail / Event info  │
│ ○ PR #123     │                             │
│ ○ JIRA-456    │                             │
└───────────────┴─────────────────────────────┘
```

**Key behaviors:**
- Filter tabs with count badges
- Unread emails have blue dot indicator
- Selecting email fetches full body via `/api/{provider}/emails/{id}`
- Detail renders differently per type (HtmlContent for email, status/labels for PR, etc.)
- Auto-refresh every 3 minutes

### TimelineView

**File:** `src/components/views/timeline-view.tsx` (317 lines)

**Contexts:** `useProfile`

**Fetches:** 5 endpoints (emails with limit=500 for history depth)

**Layout:**
```
┌────────────────────────────────────────┐
│ Filter: All | Email | PRs | Jira | Cal │
├────────────────────────────────────────┤
│ Today                                  │  ← Sticky day header
│ ● 2:30 PM  Email received from John   │
│ ● 1:00 PM  PR merged: feature/xyz     │
│ ● 11:00 AM Meeting: Sprint Planning   │
│                                        │
│ Yesterday                              │  ← Sticky day header
│ ● 5:00 PM  Task completed: Deploy     │
│ ● 3:30 PM  Jira updated: PROJ-123    │
└────────────────────────────────────────┘
```

**Key behaviors:**
- Vertical timeline with colored icon dots per type/action
- Groups entries by day using `groupByDay()` helper
- Color coding: unread email=blue, merged PR=purple, completed task=green, etc.
- Auto-refresh every 5 minutes

---

## WidgetWrapper

**File:** `src/components/widget-wrapper.tsx` (246 lines)

Documented in detail in `01-widget-system.md`. Key reference:

### Props
```typescript
interface WidgetWrapperProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  widgetType?: WidgetType;
  onExpandChange?: (expanded: boolean) => void;
  expandRequested?: boolean;
  onExpandHandled?: () => void;
  sidePanel?: ReactNode;
  forceExpand?: boolean;
}
```

### Rendering Modes
1. **Normal:** Card with drag handle, pin button, expand button
2. **Expanded:** Fullscreen overlay via `createPortal`, placeholder in grid
3. **Split-view:** Expanded with 55%/45% split for main + side panel

---

## CommandPalette

**File:** `src/components/command-palette.tsx` (1547 lines) — the largest component

### Contexts Consumed
`useDashboard`, `useProfile`, `useAppearance`, `useTheme`, `useWidgetNav`, `useCommandPalette`, `useWorkspace`

### Modes

**Normal mode (default):**
- Search across all widget data: emails, PRs, calendar, tasks, notes, bookmarks, Jira
- File system search (debounced 150ms) via `/api/files?search=`
- Server-side email search (debounced 400ms) via `/api/{provider}/emails/search`
- Command groups: Widgets, Workspaces, Focus Mode, Sidebar, Layout, Profile, Theme, Color Theme, Font
- Results filtered by `cmdk` built-in filtering + custom server-side results

**AI mode (prefix `>`):**
- Streams from `/api/ai` with conversation context
- Parses JSON action blocks from responses
- Displays executable action buttons (navigate, search, switch workspace, etc.)

**Filter mode (from expanded widget):**
- When opened while a widget is expanded, pre-filters to that widget's data group

### Data Caching
- Widget data cached for 60 seconds (module-level `cacheRef`)
- Fetches: emails, PRs, calendar, tasks, notes, bookmarks, Jira — all in parallel

### Keyboard Shortcuts
- `Cmd+P` — toggle palette
- Type text — search
- `>` prefix — AI mode
- Arrow keys + Enter — navigate results
- Escape — close

---

## HtmlContent

**File:** `src/components/html-content.tsx` (184 lines)

Sandboxed HTML renderer for email and event body content.

### Props
```typescript
interface HtmlContentProps {
  html: string;
  fallbackText?: string;
  className?: string;
}
```

### Implementation
- Uses an `<iframe>` with `srcdoc` attribute
- Sandbox: `allow-same-origin allow-scripts`
- Injects theme-aware CSS (resolves oklch variables to computed colors)
- Auto-sizes height via `postMessage` from iframe content
- MutationObserver + image load listeners for dynamic height updates
- Links intercepted via `postMessage` and opened in parent window
- Handles Outlook-specific CSS (`.MsoNormal`)
- Height clamped to 40-2000px range

---

## AIChatPanel

**File:** `src/components/ai-chat-panel.tsx` (364 lines)

Slide-in panel on the right side (420px wide).

### Layout
```
┌──────────────────┐
│ AI Assistant  [X] │
├──────────────────┤
│ ┌──────────────┐ │
│ │ User: Hello  │ │
│ │              │ │
│ │ AI: Hi! I    │ │
│ │ can help...  │ │
│ │              │ │
│ │ [Action btn] │ │
│ └──────────────┘ │
├──────────────────┤
│ Quick suggestions │
│ [what's on plate] │
│ [urgent tasks]    │
├──────────────────┤
│ [Message input  ] │
│ [Send] [Stop]     │
└──────────────────┘
```

### Key Behaviors
- User bubbles: primary color background
- Assistant bubbles: muted background with ReactMarkdown rendering
- Action buttons extracted from AI responses (navigate widget, search, switch workspace)
- Auto-resize textarea with `Shift+Enter` for newlines
- Auto-scroll to bottom on new messages
- Focus input on panel open
- Escape to close
- Quick suggestion chips for common queries
- Stop button during streaming
- Clear session button

---

## MainContent (page.tsx)

The `MainContent` component in `page.tsx` handles routing between views:

```typescript
function MainContent() {
  const { activeWorkspace, activeFocusId } = useWorkspace();
  
  if (activeFocusId) return <FocusMode />;
  if (activeWorkspace.viewType === "today") return <TodayView />;
  if (activeWorkspace.viewType === "inbox") return <InboxView />;
  if (activeWorkspace.viewType === "timeline") return <TimelineView />;
  return <DashboardGrid />;
}
```

Page structure:
```
┌─────────────────────────────────────────────┐
│ Header                                       │
├───────────┬─────────────────────────────────┤
│ Sidebar   │ MainContent                     │
│           │ (Grid / View / FocusMode)       │
│           │                                  │
│           │                                  │
│           │                                  │
└───────────┴─────────────────────────────────┤
│                          CommandPalette (overlay) │
│                          AIChatPanel (slide-in)   │
└──────────────────────────────────────────────────┘
```

---

## shadcn/ui Components (16)

All in `src/components/ui/`. These are standard shadcn/ui components with the `base-nova` style variant:

| Component | Usage |
|-----------|-------|
| `avatar.tsx` | User avatars in AI chat |
| `badge.tsx` | Status badges, priority labels, count badges |
| `button.tsx` | All buttons (variants: default, destructive, outline, secondary, ghost, link) |
| `calendar.tsx` | Date picker (used by react-day-picker) |
| `card.tsx` | Widget card containers |
| `checkbox.tsx` | Task completion toggles |
| `command.tsx` | cmdk command palette wrapper |
| `dialog.tsx` | Modal dialogs (workspace/focus combo creation) |
| `dropdown-menu.tsx` | Header dropdowns, context menus |
| `input-group.tsx` | Input with prefix/suffix icons |
| `input.tsx` | Text input fields |
| `popover.tsx` | Floating content panels |
| `scroll-area.tsx` | Custom scrollbar containers |
| `separator.tsx` | Visual dividers |
| `switch.tsx` | Toggle switches (widget visibility) |
| `textarea.tsx` | Multi-line text input (AI chat, email reply) |

All use `@base-ui/react` primitives (not Radix), `class-variance-authority` for variants, and `data-slot` attributes for CSS targeting.
