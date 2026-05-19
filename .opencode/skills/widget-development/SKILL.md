---
name: widget-development
description: Create new dashboard widgets or modify existing ones following the WidgetWrapper contract, registration in 3 files, and data fetching patterns
---

## When to Use

Use this skill when creating a new widget, modifying an existing widget, or debugging widget rendering/layout issues.

## Creating a New Widget — Checklist

### Step 1: Add to WidgetType union

File: `src/types/widget.ts`

```typescript
export type WidgetType =
  | "tasks"
  | "email"
  // ... existing types
  | "your-new-widget"; // Add here
```

### Step 2: Create the widget component

File: `src/components/widgets/your-new-widget.tsx`

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { YourIcon } from "lucide-react";
import { WidgetWrapper } from "@/components/widget-wrapper";
import { cn } from "@/lib/utils";
// Import shadcn/ui primitives as needed:
// import { Card } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import { Badge } from "@/components/ui/badge";
// import { ScrollArea } from "@/components/ui/scroll-area";

export function YourNewWidget() {
  const [data, setData] = useState<YourType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/your-resource?profile=work");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <WidgetWrapper
      title="Your Widget"
      icon={<YourIcon className="h-4 w-4" />}
      widgetType="your-new-widget"
    >
      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data.map((item) => (
          <div key={item.id} className="p-2 rounded-md border">
            {item.title}
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
```

### Step 3: Register in dashboard-config.ts

File: `src/lib/dashboard-config.ts`

Add to the `workWidgets` array (and `privateWidgets` if applicable):

```typescript
{ id: "your-new-widget", type: "your-new-widget", title: "Your Widget", visible: true },
```

Add to the `workLayouts` array (12-column grid):

```typescript
{ i: "your-new-widget", x: 0, y: 8, w: 4, h: 3, minW: 3, minH: 2 },
```

Grid math: 12 columns total. Typical widgets are `w: 4` (1/3 width). Rows are relative; `y` determines vertical order.

### Step 4: Register in dashboard-grid.tsx

File: `src/components/layout/dashboard-grid.tsx`

Add import:
```typescript
import { YourNewWidget } from "@/components/widgets/your-new-widget";
```

Add to `widgetComponents` map:
```typescript
const widgetComponents: Record<WidgetType, React.ComponentType> = {
  // ... existing entries
  "your-new-widget": YourNewWidget,
};
```

## WidgetWrapper Props Reference

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `string` | Yes | Card header text |
| `icon` | `ReactNode` | No | Header icon (lucide-react) |
| `children` | `ReactNode` | Yes | Widget body |
| `widgetType` | `WidgetType` | No | Enables expand/pin/search features |
| `className` | `string` | No | Extra classes on wrapper |
| `headerAction` | `ReactNode` | No | Slot for buttons in the header |
| `sidePanel` | `ReactNode` | No | Content shown in split-view when expanded |
| `onExpandChange` | `(expanded: boolean) => void` | No | Callback for expand state |
| `forceExpand` | `boolean` | No | Programmatically expand the widget |

## Critical Rules

1. **Always start with `"use client"`**
2. **Always wrap in `<WidgetWrapper>`** — never render a bare card
3. **Icons from `lucide-react` only** — no other icon libraries
4. **Use `@/` imports** — never relative paths
5. **Use `cn()` from `@/lib/utils`** for conditional classes
6. **Use shadcn/ui primitives** from `@/components/ui/`
7. **Fetch from internal API routes** — never call external APIs directly from widgets
8. **Profile-aware** — pass profile when fetching from API routes

## Common Patterns

### List + Detail (expandable)
Most widgets show a list view by default and a detail view when expanded. Use `sidePanel` prop for split-view detail, or conditional rendering based on expand state via `onExpandChange`.

### Auto-refresh
```typescript
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 60000); // Refresh every minute
  return () => clearInterval(interval);
}, [fetchData]);
```

### Theme-aware canvas rendering
Read CSS custom properties for drawing on canvas:
```typescript
const style = getComputedStyle(document.documentElement);
const fg = style.getPropertyValue("--foreground").trim();
```

### Context integration
Widgets can use contexts for inter-widget communication:
- `useWorkspace()` — active workspace, pinned widgets
- `useDashboard()` — widget configs, layout state
- `useTerminal()` — open terminal tabs from other widgets
- `useWidgetNav()` — navigate to specific items within widgets
- `useCommandPalette()` — report expanded widget state
