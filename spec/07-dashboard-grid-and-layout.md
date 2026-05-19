# 07 — Dashboard Grid and Layout

> Complete specification of the react-grid-layout system, viewport-fitting algorithm, workspace-based filtering, and layout persistence.

## Overview

The dashboard uses `react-grid-layout`'s `ResponsiveGridLayout` to arrange widgets in a drag-and-drop, resizable grid. The layout is profile-scoped, workspace-aware, and persisted via dual strategy (localStorage + server JSON).

## Grid Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Columns | 12 | Grid column count |
| Row height | 80px | Pixels per grid row unit |
| Vertical margin | 16px | Gap between rows |
| Horizontal margin | 16px | Gap between columns |
| Breakpoints | `{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }` | Responsive breakpoints |
| Drag handle | `.drag-handle` | CSS class for drag-only area |
| Resize handle | SE corner | Default resize handle position |

## Component: `dashboard-grid.tsx` (308 lines)

**File:** `src/components/layout/dashboard-grid.tsx`

### Context Dependencies

- `useDashboard()` → `widgets`, `layouts`, `layoutLocked`, `updateLayouts()`
- `useWidgetNav()` → `navigateTo()` (for split-view auto-focus)
- `useWorkspace()` → `activeWorkspace`, `pinnedWidgetIds`

### Widget Component Map

```typescript
const widgetComponents: Record<string, React.ComponentType> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  calendar: CalendarWidget,
  tasks: TasksWidget,
  email: EmailWidget,
  reminders: RemindersWidget,
  "github-prs": GitHubPRsWidget,
  jira: JiraWidget,
  notes: NotesWidget,
  terminal: TerminalWidget,
  bookmarks: BookmarksWidget,
  files: FilesWidget,
};
```

### Layout Computation

The grid computes `effectiveLayouts` based on the active workspace:

**Dashboard workspace (all widgets):**
1. Filter layout items to only visible widgets
2. If layout is locked: adjust pinned widgets to y=0 (top)
3. Return filtered layouts

**Other workspaces (subset of widgets):**
1. Get workspace's `widgetIds` list
2. Auto-generate compact layout:
   - Each widget gets full row width (w=12) or partial
   - Heights assigned based on widget type defaults
   - Vertically stacked in order

### Layout Change Handler

```typescript
function handleLayoutChange(allLayouts: Layout) {
  // Only persist at "lg" breakpoint
  if (currentBreakpointRef.current !== "lg") return;
  
  // When locked: compare items to detect actual changes
  // (react-grid-layout can fire spurious events from compact())
  if (layoutLockedRef.current) {
    const hasRealChange = items.some((item, i) => 
      item.x !== prev[i]?.x || item.y !== prev[i]?.y || 
      item.w !== prev[i]?.w || item.h !== prev[i]?.h
    );
    if (!hasRealChange) return; // Skip to prevent infinite loop
  }
  
  updateLayouts(allLayouts);
}
```

### Compactor Configuration

Two compactor modes:
- **Normal:** `verticalCompactor` — widgets compact upward to fill gaps
- **Locked:** `noCompactor` — widgets stay exactly where placed (no compaction)

The `activeCompactor` switches based on `layoutLocked`.

### Split-View Auto-Focus

When a user right-clicks a link inside a widget (triggering Chrome's split-view), the grid detects the resize and automatically expands the relevant widget:

```typescript
useEffect(() => {
  const handleContextMenu = (e: MouseEvent) => {
    // Find which widget contains the right-clicked link
    const widget = (e.target as Element).closest("[data-widget-type]");
    if (widget) contextMenuWidgetRef.current = widget.getAttribute("data-widget-type");
  };
  
  const handleResize = () => {
    // If window resized shortly after context menu on a widget link
    // → navigate to that widget (expand it)
    if (contextMenuWidgetRef.current) {
      navigateTo(contextMenuWidgetRef.current);
    }
  };
  
  document.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("resize", handleResize);
}, []);
```

---

## Viewport-Fitting Algorithm (`compactLayout`)

**Location:** `src/components/dashboard-context.tsx` (lines 58-214)

A custom algorithm that packs visible widgets to perfectly fill the viewport with zero gaps.

### Algorithm Steps

```
Input: widgets[], layouts (with minW/minH constraints)

1. COMPUTE AVAILABLE SPACE
   availableRows = floor((windowHeight - CHROME_PX) / (ROW_HEIGHT + MARGIN_Y))
   // CHROME_PX = 89 (header + padding overhead)

2. SEPARATE TOP ROW WIDGETS
   topRowIds = ["clock", "weather", "calendar"]
   topRowH = 2 (fixed)
   Distribute top row widgets evenly across 12 columns

3. PACK REMAINING WIDGETS INTO ROWS
   Sort remaining by minW descending
   For each widget:
     - Try to fit in current row (remaining width >= minW)
     - If fits: add to current row
     - If not: start new row
   Each row is a list of widgets that sum to ≤ 12 columns

4. DISTRIBUTE WIDTHS WITHIN ROWS
   For each row:
     - Each widget gets proportional width based on its ideal w
     - Adjust so total = 12 (distribute remainder to widest)

5. DISTRIBUTE HEIGHTS ACROSS ROWS
   remainingHeight = availableRows - topRowH
   Each row gets minH initially
   Extra = remainingHeight - sum(minH)
   Distribute extra round-robin to rows (1 unit at a time)

6. PLACE WIDGETS
   y = topRowH (start below top row)
   For each row:
     x = 0
     For each widget in row:
       Set { x, y, w: computedW, h: rowH }
       x += computedW
     y += rowH

Return: placed LayoutItem[] (visible) + hidden LayoutItem[] (invisible, at y=999)
```

### Constants Used

```typescript
const COLS = 12;
const ROW_HEIGHT = 80;
const MARGIN_Y = 16;
const CHROME_PX = 89;
const TOP_ROW_WIDGET_IDS = ["clock", "weather", "calendar"];
```

### Trigger Points

The `compactLayout()` function is called when:
1. `autoArrange()` is invoked (Cmd+Shift+A or button)
2. A widget is toggled visible (and layout is not locked)
3. `ensureWidgetVisible()` adds a hidden widget
4. Profile changes trigger layout reset

---

## Workspaces and Layout

### Dashboard Workspace

The default "Dashboard" workspace shows all visible widgets in the persisted grid layout. This is the only workspace where drag/resize, pinning, and layout lock are meaningful.

### Subset Workspaces (Dev, Comms, Notes)

These workspaces show a subset of widgets. Instead of using the persisted layout, they auto-generate a compact layout:

```typescript
// Each workspace widget gets auto-arranged
workspace.widgetIds.forEach((id, i) => {
  layout.push({ i: id, x: 0, y: i * defaultH, w: 12, h: defaultH });
});
```

### View Workspaces (Today, Inbox, Timeline)

Workspaces with a `viewType` property don't render the grid at all. Instead, `page.tsx`'s `MainContent` component renders the corresponding view:

```typescript
if (activeWorkspace.viewType === "today") return <TodayView />;
if (activeWorkspace.viewType === "inbox") return <InboxView />;
if (activeWorkspace.viewType === "timeline") return <TimelineView />;
```

### Focus Mode

Focus mode (2-3 widgets side-by-side) completely replaces the grid with `<FocusMode>`:

```typescript
if (activeFocusId) return <FocusMode />;
```

---

## Focus Mode Component

**File:** `src/components/focus-mode.tsx` (175 lines)

### Layout

Renders 2-3 widgets side-by-side with draggable dividers:

```
┌──────────────────┬──────────────────┐
│                  │                  │
│  Widget A (50%)  │  Widget B (50%)  │
│                  │                  │
└──────────────────┴──────────────────┘
```

Or with 3 widgets:
```
┌────────────┬────────────┬────────────┐
│            │            │            │
│  A (33%)   │  B (33%)   │  C (34%)   │
│            │            │            │
└────────────┴────────────┴────────────┘
```

### Draggable Dividers

- Mouse drag on divider adjusts adjacent panel ratios
- Ratios clamped to 15-85% range
- Updated via `WorkspaceContext.updateFocusRatios()`
- Persisted with workspace state

### Default Focus Combos

| Name | Widgets | Direction | Ratios |
|------|---------|-----------|--------|
| Terminal + Files | terminal, files | horizontal | [50, 50] |
| Email + Calendar | email, calendar | horizontal | [60, 40] |
| Notes + Tasks | notes, tasks | horizontal | [60, 40] |

---

## Layout Persistence

### Dual Strategy

| Storage | Timing | Key Pattern |
|---------|--------|-------------|
| localStorage | Immediate (every mutation) | `dashboard-widgets-{profile}`, `dashboard-layout-{profile}`, `dashboard-version-{profile}` |
| Server JSON | Debounced (500ms) | `POST /api/dashboard { profile, widgets, layouts, version }` |

### Version Gating

```typescript
const LAYOUT_VERSION = 15;
```

On load, if the stored version doesn't match `LAYOUT_VERSION`, the layout resets to defaults. This allows developers to force a layout reset by bumping the version.

### Load Priority

```
1. Server: GET /api/dashboard?profile={profile}
   → Check version === LAYOUT_VERSION
   → If valid: use server data

2. localStorage: Read dashboard-version-{profile}
   → Check version === LAYOUT_VERSION
   → If valid: use localStorage data

3. Defaults: getDefaultDashboard(profile)
   → From src/lib/dashboard-config.ts
```

### Layout Lock

Stored separately in localStorage only: `dashboard-layout-locked-{profile}`

When locked:
- Drag handles are disabled
- Resize handles are hidden
- `noCompactor` prevents auto-compaction
- Auto-arrange button is disabled
- Widget toggle still works but doesn't trigger re-compact

---

## Widget Pinning

Pinned widgets are placed at the top of the grid (y=0) and remain visible across all workspaces.

- Pin state stored in `WorkspaceContext.pinnedWidgetIds[]`
- Pin button visible only in Dashboard workspace
- When computing `effectiveLayouts`, pinned widgets get `y: 0` adjustment
- Persisted with workspace state

---

## Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `Cmd+Shift+A` | Auto-arrange layout | Dashboard workspace, not locked |
| `Cmd+1` through `Cmd+9` | Switch workspace | Global (skips input fields) |
| `Escape` | Exit focus mode | Focus mode active |

---

## Grid Item Structure

Each grid item is a `<div>` wrapper containing the widget component:

```tsx
{visibleWidgets.map(widget => (
  <div key={widget.id} data-widget-type={widget.type}>
    <WidgetComponent />
  </div>
))}
```

The `data-widget-type` attribute is used for the split-view auto-focus feature.

---

## Default Layouts

### Work Profile

```
Row 0: clock(4w,2h) | weather(4w,2h) | calendar(4w,4h)
Row 2: reminders(4w,2h) | tasks(4w,4h)
Row 4: email(4w,4h) | jira(4w,4h)
Row 6: github-prs(4w,4h)
Row 8: terminal(4w,4h) | notes(4w,4h) | bookmarks(4w,4h)
Row 12: files(12w,4h)
```

### Private Profile

Same as work but:
- No Jira widget
- Files widget is 4w instead of 12w
- Tighter packing due to fewer widgets
