# 03 — State Management

> Complete specification of all 9 React Context providers, their state shapes, persistence strategies, and consumer relationships.

## Overview

The application uses **9 nested React Context providers** instead of a state management library. No Redux, Zustand, or similar. Each provider is a `"use client"` component.

## Provider Nesting Order

```
layout.tsx (outer shell):
  ThemeProvider                          ← next-themes (light/dark/system)
    → AppearanceProvider                 ← color theme + font family
      → ProfileProvider                  ← work/private profile

page.tsx (app content):
  DashboardProvider                      ← widget configs + grid layouts
    → WorkspaceProvider                  ← workspaces + focus mode + sidebar
      → WidgetNavProvider                ← cross-widget navigation requests
        → TerminalProvider               ← terminal tab dispatch
          → CommandPaletteProvider       ← search/command palette state
            → AIChatProvider             ← AI chat panel + Ollama streaming
              → MainContent
              → CommandPalette
              → AIChatPanel
```

Order matters: inner providers can consume outer ones. For example, `DashboardProvider` consumes `ProfileProvider`, and `AIChatProvider` consumes Profile, Workspace, and Dashboard.

---

## Provider 1: ThemeProvider

**File:** `src/components/theme-provider.tsx` (11 lines)

Thin `"use client"` wrapper around `next-themes`'s `NextThemesProvider`.

**Configuration:**
```typescript
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

**Context shape (from next-themes):**
| Field | Type | Description |
|-------|------|-------------|
| `theme` | `string` | Current theme name |
| `setTheme` | `(theme: string) => void` | Set theme |
| `resolvedTheme` | `string` | Resolved after system preference |
| `themes` | `string[]` | Available themes |

**Persistence:** Managed by `next-themes` — localStorage + cookie.

**Consumers:** `header.tsx` (dark/light toggle), `command-palette.tsx`, any component using `useTheme()`.

---

## Provider 2: AppearanceProvider

**File:** `src/components/appearance-context.tsx` (120 lines)

**Context shape:**
```typescript
interface AppearanceContextType {
  appearance: {
    colorTheme: ColorTheme;   // "zinc"|"slate"|"blue"|"rose"|"emerald"|"violet"|"amber"|"cyan"|"orange"
    fontFamily: FontFamily;   // "geist"|"inter"|"mono"|"system"|"serif"
  };
  setColorTheme: (theme: ColorTheme) => void;
  setFontFamily: (font: FontFamily) => void;
}
```

**State:**
- `appearance: AppearanceConfig` — current settings
- `mounted: boolean` — hydration guard

**Effects:**
1. **Load** (on mount): Reads `localStorage.getItem("appearance")`, merges with defaults
2. **Apply** (on change): Manipulates `document.documentElement.classList`:
   - Removes old `theme-*` and `font-choice-*` classes
   - Adds current ones (zinc has no `theme-` class — it's the default)

**Persistence:** `localStorage` key `"appearance"` — JSON `{ colorTheme, fontFamily }`

**Consumers:** `appearance-picker.tsx`, `command-palette.tsx`

---

## Provider 3: ProfileProvider

**File:** `src/components/profile-context.tsx` (66 lines)

**Context shape:**
```typescript
interface ProfileContextType {
  activeProfile: "work" | "private";
  setActiveProfile: (id: ProfileId) => void;
  profile: {
    id: ProfileId;
    name: string;         // "Work" or "Private"
    icon: string;         // lucide icon name
    description: string;  // "SAP tools & Outlook" or "Gmail & GitHub.com"
  };
}
```

**Profiles defined:**
| ID | Name | Description |
|----|------|-------------|
| `work` | Work | SAP tools & Outlook |
| `private` | Private | Gmail & GitHub.com |

**State:**
- `activeProfile: ProfileId` — defaults to `"work"`
- `loaded: boolean` — renders `null` until loaded to prevent flash

**Persistence:** `localStorage` key `"assistant-profile"` — plain string

**Critical behavior:** Returns `null` children until localStorage is read. This prevents rendering the wrong profile's data on hydration.

**Consumers:** Almost everything — DashboardProvider, WorkspaceProvider, all widgets that call profile-scoped APIs, header (profile switcher), views, command palette.

---

## Provider 4: DashboardProvider

**File:** `src/components/dashboard-context.tsx` (431 lines)

**Context shape:**
```typescript
interface DashboardContextType {
  widgets: WidgetConfig[];                 // All widget configs with visibility
  layouts: Layout;                         // react-grid-layout layout items
  layoutLocked: boolean;                   // Drag/resize disabled
  toggleWidget: (id: string) => void;      // Toggle widget visibility
  ensureWidgetVisible: (id: string) => void; // Make widget visible
  updateLayouts: (layouts: Layout) => void;  // Update from grid events
  resetLayout: () => void;                 // Reset to defaults
  autoArrange: () => void;                 // Re-compact to fill viewport
  toggleLayoutLock: () => void;            // Toggle lock state
}
```

**State:**
- `widgets: WidgetConfig[]` — from `getDefaultWidgets(activeProfile)`
- `layouts: Layout` — from `getDefaultLayouts(activeProfile)`
- `layoutLocked: boolean`
- `loaded: boolean`

**Constants:**
```typescript
LAYOUT_VERSION = 15          // Bump to force-reset all users
COLS = 12                    // Grid columns
ROW_HEIGHT = 80              // Pixels per row unit
MARGIN_Y = 16                // Vertical margin between items
CHROME_PX = 89               // Header + padding overhead
TOP_ROW_WIDGET_IDS = ["clock", "weather", "calendar"]
```

**Core algorithm — `compactLayout()`:**
A custom viewport-fitting layout algorithm:
1. Compute available row units from `window.innerHeight`
2. Place clock/weather/calendar in a top row, evenly distributed
3. Pack remaining visible widgets into rows using greedy bin-packing (sorted by minW descending)
4. Distribute row heights to fill exactly the available vertical space
5. Extra rows distributed round-robin to reach total available height

**Load sequence:**
1. Try server: `GET /api/dashboard?profile={profile}` — check `version === LAYOUT_VERSION`
2. Fallback to localStorage: `dashboard-widgets-{profile}`, `dashboard-layout-{profile}`
3. Fallback to defaults from `dashboard-config.ts`

**Persistence — dual strategy:**
- **localStorage:** Immediate on every mutation
  - Keys: `dashboard-widgets-{profile}`, `dashboard-layout-{profile}`, `dashboard-version-{profile}`
- **Server:** Debounced (500ms) `POST /api/dashboard`
  - Body: `{ profile, widgets, layouts, version }`

**Keyboard shortcut:** `Cmd+Shift+A` → auto-arrange (disabled when locked or typing in input)

**Dependencies:** Consumes `ProfileProvider` (re-loads on profile change)

**Consumers:** `dashboard-grid.tsx`, `sidebar.tsx`, `widget-settings.tsx`, `command-palette.tsx`, `focus-mode.tsx`, `WorkspaceProvider`, `AIChatProvider`

---

## Provider 5: WorkspaceProvider

**File:** `src/components/workspace-context.tsx` (573 lines)

**Context shape:**
```typescript
interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string, icon: string, widgetIds: string[]) => void;
  updateWorkspaceWidgets: (id: string, widgetIds: string[]) => void;
  deleteWorkspace: (id: string) => void;
  focusCombos: FocusCombo[];
  activeFocusId: string | null;
  enterFocusMode: (comboId: string) => void;
  exitFocusMode: () => void;
  createFocusCombo: (combo: Omit<FocusCombo, "id">) => void;
  updateFocusRatios: (comboId: string, ratios: number[]) => void;
  deleteFocusCombo: (id: string) => void;
  collapsedSections: CollapsedSections;
  toggleSection: (category: WidgetCategory) => void;
  pinnedWidgetIds: string[];
  togglePinWidget: (widgetId: string) => void;
  sidebarExpanded: boolean;
  toggleSidebar: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
}
```

**Key types:**
```typescript
interface Workspace {
  id: string;
  name: string;
  icon: string;           // lucide icon name
  widgetIds: string[];
  layout?: Layout;
  builtIn?: boolean;
  shortcut?: string;      // "1"-"9" for Cmd+N
  viewType?: ViewType;    // "today" | "inbox" | "timeline"
}

interface FocusCombo {
  id: string;
  name: string;
  widgetIds: string[];    // 2-3 widget IDs
  direction: "horizontal" | "vertical";
  ratios: number[];       // e.g., [50, 50] or [33, 33, 34]
}

type WidgetCategory = "glance" | "productivity" | "development" | "tools";
type ViewType = "today" | "inbox" | "timeline";
```

**Default workspaces (7):**
| ID | Name | Shortcut | View/Widgets |
|----|------|----------|-------------|
| `dashboard` | Dashboard | `Cmd+1` | All widgets (grid) |
| `dev` | Dev | `Cmd+2` | github-prs, jira, terminal, files, notes |
| `comms` | Comms | `Cmd+3` | email, calendar, reminders |
| `notes` | Notes | `Cmd+4` | notes, tasks |
| `today` | Today | `Cmd+5` | `viewType: "today"` |
| `inbox` | Inbox | `Cmd+6` | `viewType: "inbox"` |
| `timeline` | Timeline | `Cmd+7` | `viewType: "timeline"` |

**Default focus combos (3):**
| Name | Widgets | Direction | Ratios |
|------|---------|-----------|--------|
| Terminal + Files | terminal, files | horizontal | [50, 50] |
| Email + Calendar | email, calendar | horizontal | [60, 40] |
| Notes + Tasks | notes, tasks | horizontal | [60, 40] |

**Widget category map:**
| Category | Widget IDs |
|----------|-----------|
| glance | clock, weather, reminders |
| productivity | calendar, tasks, email |
| development | github-prs, jira, notes |
| tools | terminal, bookmarks, files |

**State (7 pieces):**
- `workspaces`, `activeWorkspaceId`, `focusCombos`, `activeFocusId`, `collapsedSections`, `pinnedWidgetIds`, `sidebarExpanded`

**Keyboard shortcuts:**
- `Cmd+1` through `Cmd+9` → switch workspace (skips input/textarea/contentEditable)
- `Escape` → exit focus mode

**Persistence — dual:**
- **localStorage:** `workspace-state-{profile}` with version `WORKSPACE_VERSION = 3`
- **Server:** `POST /api/dashboard` with `{ workspaceState, workspaceVersion }`

**Repair logic:** On load, ensures Dashboard workspace always contains all widget IDs for the current profile.

**Dependencies:** Consumes `ProfileProvider`

**Consumers:** `page.tsx` (MainContent routing), `sidebar.tsx`, `header.tsx`, `dashboard-grid.tsx`, `focus-mode.tsx`, `command-palette.tsx`, `AIChatProvider`

---

## Provider 6: WidgetNavProvider

**File:** `src/components/widget-nav-context.tsx` (103 lines)

**Context shape:**
```typescript
interface WidgetNavContextType {
  request: WidgetNavRequest | null;
  navigateTo: (widgetType: WidgetType, itemId?: string, searchQuery?: string) => void;
  clearRequest: () => void;
}

interface WidgetNavRequest {
  widgetType: WidgetType;
  itemId?: string;
  searchQuery?: string;
  seq: number;            // Monotonic counter (module-level)
}
```

**Convenience hook:**
```typescript
function useWidgetNavFor(widgetType: WidgetType): {
  expandRequested: boolean;
  onExpandHandled: () => void;
  pendingItemId: string | undefined;
  clearPendingItem: () => void;
  pendingSearchQuery: string | undefined;
  clearPendingSearch: () => void;
}
```

**Flow:**
1. Source (command palette, AI, view) calls `navigateTo("email", "msg-123")`
2. Provider sets `request = { widgetType: "email", itemId: "msg-123", seq: 5 }`
3. Email widget's `useWidgetNavFor("email")` returns `expandRequested: true`
4. WidgetWrapper expands to fullscreen
5. Widget selects item by `pendingItemId`
6. Widget calls `onExpandHandled()` and `clearPendingItem()`

**Persistence:** None — ephemeral request/response pattern

**Consumers:** All 12 widgets (via `useWidgetNavFor`), `command-palette.tsx` (via `navigateTo`), `AIChatProvider`

---

## Provider 7: TerminalProvider

**File:** `src/components/terminal-context.tsx` (63 lines)

**Context shape:**
```typescript
interface TerminalContextType {
  request: TerminalTabRequest | null;
  openTerminalTab: (opts?: { cwd?: string; command?: string; label?: string }) => void;
  clearRequest: () => void;
}

interface TerminalTabRequest {
  cwd?: string;
  command?: string;
  label?: string;
  seq: number;
}
```

**Same pattern as WidgetNav:** Module-level seq counter, ephemeral request/response.

**Consumers:** `terminal-widget.tsx` (handles requests), `files-widget.tsx` ("Open terminal here"), `command-palette.tsx`, `tasks-widget.tsx` (AI terminal)

---

## Provider 8: CommandPaletteProvider

**File:** `src/components/command-palette-context.tsx` (79 lines)

**Context shape:**
```typescript
interface CommandPaletteState {
  open: boolean;
  filterWidget: WidgetType | null;        // Pre-filter to widget type
  expandedWidget: WidgetType | null;      // Currently expanded widget
  openSearch: (widgetType?: WidgetType) => void;
  closeSearch: () => void;
  setOpen: (open: boolean) => void;
  clearFilter: () => void;
  setExpandedWidget: (type: WidgetType | null) => void;
}
```

**Behavior:**
- When opening while a widget is expanded, auto-filters to that widget type
- Clears filter with 200ms delay on close (prevents flash during animation)

**Persistence:** None — transient UI state

**Consumers:** `command-palette.tsx`, `widget-wrapper.tsx`, `header.tsx`

---

## Provider 9: AIChatProvider

**File:** `src/components/ai-chat-context.tsx` (385 lines)

**Context shape:**
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

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  action?: AIAction | null;
  streaming?: boolean;
  timestamp: number;
}

interface AIAction {
  action: string;         // "navigate", "search", "switch-workspace", etc.
  widget?: string;
  query?: string;
  workspace?: string;
  profile?: string;
  theme?: string;
  combo?: string;
  url?: string;
  title?: string;
  priority?: string;
}
```

**Key logic:**
1. **Topic detection:** Scans last 6 messages + current for keywords → maps to API topics (calendar, tasks, prs, email, jira, notes)
2. **Context fetch:** `GET /api/ai/context?topics={topics}&profile={profile}`
3. **Streaming:** `POST /api/ai` with NDJSON response stream
4. **Action parsing:** Extracts JSON blocks from AI responses for executable actions

**Dependencies:** Consumes `ProfileProvider`, `WorkspaceProvider`, `DashboardProvider`

**Persistence:** None — session-only (cleared on reload or `clearSession()`)

**Consumers:** `ai-chat-panel.tsx`, `header.tsx`

---

## State Flow Diagram

```
User Action
  │
  ├─ Drag/resize widget → DashboardProvider.updateLayouts()
  │   → localStorage (immediate)
  │   → POST /api/dashboard (debounced 500ms)
  │
  ├─ Switch workspace → WorkspaceProvider.setActiveWorkspace()
  │   → localStorage (immediate)
  │   → POST /api/dashboard (debounced)
  │   → DashboardGrid re-filters visible widgets
  │
  ├─ Toggle dark mode → ThemeProvider.setTheme()
  │   → next-themes updates <html class="dark">
  │   → CSS variables switch automatically
  │
  ├─ Change color theme → AppearanceProvider.setColorTheme()
  │   → <html class="theme-blue"> updated
  │   → localStorage "appearance" updated
  │
  ├─ Switch profile → ProfileProvider.setActiveProfile()
  │   → localStorage "assistant-profile" updated
  │   → DashboardProvider reloads widgets/layouts for new profile
  │   → WorkspaceProvider reloads workspace state
  │   → All widgets re-fetch data with new profile param
  │
  ├─ Search/navigate → CommandPalette → WidgetNavContext.navigateTo()
  │   → Target widget detects via useWidgetNavFor()
  │   → WidgetWrapper expands, widget selects item
  │
  └─ AI chat → AIChatProvider.sendMessage()
      → Topic detection → Context fetch
      → Stream response → Parse actions
      → Execute action (navigate, search, switch workspace, etc.)
```

## Persistence Summary

| Provider | localStorage Key | Server Endpoint | Strategy |
|----------|-----------------|-----------------|----------|
| ThemeProvider | Managed by next-themes | — | Auto |
| AppearanceProvider | `"appearance"` | — | Immediate |
| ProfileProvider | `"assistant-profile"` | — | Immediate |
| DashboardProvider | `dashboard-widgets-{profile}`, `dashboard-layout-{profile}`, `dashboard-version-{profile}`, `dashboard-layout-locked-{profile}` | `POST /api/dashboard` | Dual: immediate local + debounced server |
| WorkspaceProvider | `workspace-state-{profile}` | `POST /api/dashboard` | Dual: immediate local + debounced server |
| WidgetNavProvider | — | — | None (ephemeral) |
| TerminalProvider | — | — | None (ephemeral) |
| CommandPaletteProvider | — | — | None (transient) |
| AIChatProvider | — | — | None (session-only) |
