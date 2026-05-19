---
name: shadcn-theming
description: Work with shadcn/ui base-nova components, Tailwind CSS 4, oklch color theming, and the 9-accent + light/dark theme system
---

## When to Use

Use this skill when working on UI styling, theming, adding shadcn/ui components, or modifying the color/appearance system.

## shadcn/ui Setup

This project uses shadcn/ui with the **base-nova** style variant (not "default" or "new-york").

Config file: `components.json`
```json
{
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  }
}
```

## Adding a New shadcn/ui Component

```bash
npx shadcn@latest add <component-name>
```

This generates the component in `src/components/ui/`. Import it with:
```typescript
import { ComponentName } from "@/components/ui/component-name";
```

## Class Name Utility

Always use `cn()` from `@/lib/utils` for conditional/merged classes:

```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "base-class text-sm",
  isActive && "bg-accent text-accent-foreground",
  className
)} />
```

`cn()` wraps `clsx` + `tailwind-merge` to properly handle Tailwind class conflicts.

## Theme Architecture

### CSS Custom Properties (oklch color space)

Theme variables are defined in `src/app/globals.css` using oklch colors:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --accent: oklch(0.97 0 0);
  --border: oklch(0.922 0 0);
  /* ... etc */
}

:is(.dark *) {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  /* ... dark overrides */
}
```

### 9 Color Accent Themes

Defined as `.theme-{name}` classes in globals.css:
- `theme-neutral` (default)
- `theme-rose`
- `theme-blue`
- `theme-green`
- `theme-orange`
- `theme-violet`
- `theme-yellow`
- `theme-red`
- `theme-pink`

Each theme overrides `--primary`, `--accent`, `--ring`, `--sidebar-primary`, `--chart-*` etc. with its own oklch values for both light and dark modes.

### Dark Mode

Uses `next-themes` with class strategy:
```css
@custom-variant dark (:is(.dark *));
```

Toggle via the `AppearanceProvider` context. Never check for dark mode manually — use CSS variables that auto-adapt.

### 5 Font Choices

Font families are set via CSS variables `--font-sans` and `--font-heading`:
- System default
- Geist
- Inter
- Plus Jakarta Sans
- DM Sans
- Space Grotesk

## Tailwind CSS 4 Specifics

This project uses **Tailwind CSS v4**, which differs from v3:

1. **No `tailwind.config.js`** — configuration is done via CSS using `@theme` blocks
2. **CSS-first config** — all theme tokens defined in `globals.css`
3. **`@theme inline` block** — maps CSS custom properties to Tailwind tokens
4. **Import pattern:**
   ```css
   @import "tailwindcss";
   @import "tw-animate-css";
   @import "@/lib/shadcn/tailwind.css";
   ```

## Common Styling Patterns

### Semantic color tokens (use these, not raw colors)
```
bg-background text-foreground       — Main surface
bg-card text-card-foreground         — Card surfaces
bg-primary text-primary-foreground   — Primary actions
bg-secondary text-secondary-foreground — Secondary elements
bg-accent text-accent-foreground     — Highlighted/hover states
bg-muted text-muted-foreground       — Subdued text
bg-destructive text-destructive-foreground — Danger/error
border-border                        — Default borders
ring-ring                            — Focus rings
```

### Sidebar tokens
```
bg-sidebar text-sidebar-foreground
bg-sidebar-accent text-sidebar-accent-foreground
bg-sidebar-primary text-sidebar-primary-foreground
border-sidebar-border
```

### Spacing and layout
- Widgets use `space-y-*` for vertical spacing
- `p-2`, `p-3`, `p-4` for padding (prefer smaller values in widget content)
- `rounded-md`, `rounded-lg` for border radius
- `text-sm`, `text-xs` for widget body text sizes

### Opacity modifiers
```
bg-primary/10    — 10% opacity background
text-primary/80  — 80% opacity text
```

## Rules

1. **Never use inline styles** — always Tailwind classes
2. **Never use raw hex/rgb colors** — use semantic tokens (`bg-primary`, not `bg-blue-500`)
3. **Use `cn()`** for all conditional class logic
4. **Icons from `lucide-react` only** with `h-4 w-4` default size
5. **No additional CSS libraries** — no styled-components, emotion, etc.
6. **Test both light and dark modes** when making visual changes
7. When reading theme colors in JavaScript (e.g., for canvas), use `getComputedStyle(document.documentElement).getPropertyValue("--variable")`
