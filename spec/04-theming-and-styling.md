# 04 — Theming and Styling

> Complete specification of the CSS architecture, oklch color system, 9 accent themes, 5 font choices, and shadcn/ui integration.

## CSS Architecture

### Pipeline

```
src/app/globals.css
  → @import "tailwindcss"          (Tailwind CSS 4 — CSS-first, no JS config)
  → @import "tw-animate-css"       (animation utilities for shadcn)
  → @import "shadcn/tailwind.css"  (shadcn base-nova preset)
  → @tailwindcss/postcss           (PostCSS plugin)
  → browser
```

### PostCSS Config

```javascript
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

### No Tailwind Config File

Tailwind CSS v4 uses CSS-first configuration. All theme tokens are registered via `@theme inline` directives in `globals.css`. There is no `tailwind.config.ts` or `tailwind.config.js`.

### Dark Mode

```css
@custom-variant dark (&:is(.dark *));
```

Class-based dark mode. `next-themes` adds/removes `.dark` on `<html>`.

---

## Token Registration (`@theme inline`)

Lines 7-49 of `globals.css` register CSS custom properties as Tailwind utility classes:

### Color Tokens

| Tailwind Class Prefix | CSS Variable |
|----------------------|-------------|
| `bg-background` / `text-background` | `var(--background)` |
| `bg-foreground` / `text-foreground` | `var(--foreground)` |
| `bg-card` / `text-card-foreground` | `var(--card)` / `var(--card-foreground)` |
| `bg-popover` / `text-popover-foreground` | `var(--popover)` / `var(--popover-foreground)` |
| `bg-primary` / `text-primary-foreground` | `var(--primary)` / `var(--primary-foreground)` |
| `bg-secondary` / `text-secondary-foreground` | `var(--secondary)` / `var(--secondary-foreground)` |
| `bg-muted` / `text-muted-foreground` | `var(--muted)` / `var(--muted-foreground)` |
| `bg-accent` / `text-accent-foreground` | `var(--accent)` / `var(--accent-foreground)` |
| `bg-destructive` | `var(--destructive)` |
| `border-border` | `var(--border)` |
| `bg-input` | `var(--input)` |
| `ring-ring` | `var(--ring)` |
| `bg-chart-1` through `bg-chart-5` | `var(--chart-1)` through `var(--chart-5)` |
| `bg-sidebar` (+ 7 variants) | `var(--sidebar)` through `var(--sidebar-ring)` |

### Font Tokens

| Tailwind Class | CSS Variable |
|---------------|-------------|
| `font-sans` | `var(--font-sans)` |
| `font-mono` | `var(--font-geist-mono)` |
| `font-heading` | `var(--font-sans)` |

### Radius Tokens

| Token | Formula | Value |
|-------|---------|-------|
| `--radius` | base | `0.625rem` (10px) |
| `rounded-sm` | `radius * 0.6` | 0.375rem |
| `rounded-md` | `radius * 0.8` | 0.5rem |
| `rounded-lg` | `radius` | 0.625rem |
| `rounded-xl` | `radius * 1.4` | 0.875rem |
| `rounded-2xl` | `radius * 1.8` | 1.125rem |
| `rounded-3xl` | `radius * 2.2` | 1.375rem |
| `rounded-4xl` | `radius * 2.6` | 1.625rem |

---

## Base Theme (Zinc — Default)

All values use the oklch color space: `oklch(lightness chroma hue)`.

### Light Mode (`:root`)

| Variable | oklch Value | Description |
|----------|------------|-------------|
| `--background` | `oklch(1 0 0)` | Pure white |
| `--foreground` | `oklch(0.145 0 0)` | Near-black |
| `--card` | `oklch(1 0 0)` | White |
| `--card-foreground` | `oklch(0.145 0 0)` | Near-black |
| `--popover` | `oklch(1 0 0)` | White |
| `--popover-foreground` | `oklch(0.145 0 0)` | Near-black |
| `--primary` | `oklch(0.205 0 0)` | Very dark gray |
| `--primary-foreground` | `oklch(0.985 0 0)` | Near-white |
| `--secondary` | `oklch(0.97 0 0)` | Very light gray |
| `--secondary-foreground` | `oklch(0.205 0 0)` | Dark gray |
| `--muted` | `oklch(0.97 0 0)` | Very light gray |
| `--muted-foreground` | `oklch(0.556 0 0)` | Mid gray |
| `--accent` | `oklch(0.97 0 0)` | Very light gray |
| `--accent-foreground` | `oklch(0.205 0 0)` | Dark gray |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Vivid red |
| `--border` | `oklch(0.922 0 0)` | Light gray |
| `--input` | `oklch(0.922 0 0)` | Light gray |
| `--ring` | `oklch(0.708 0 0)` | Medium gray |

### Dark Mode (`.dark`)

| Variable | oklch Value | Notes |
|----------|------------|-------|
| `--background` | `oklch(0.195 0 0)` | Very dark gray |
| `--foreground` | `oklch(0.985 0 0)` | Near-white |
| `--card` | `oklch(0.245 0 0)` | Slightly lighter |
| `--primary` | `oklch(0.922 0 0)` | Light (inverted) |
| `--primary-foreground` | `oklch(0.205 0 0)` | Dark (inverted) |
| `--muted` | `oklch(0.3 0 0)` | Dark gray |
| `--muted-foreground` | `oklch(0.708 0 0)` | Light gray |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Lighter red |
| `--border` | `oklch(1 0 0 / 12%)` | White 12% opacity |
| `--input` | `oklch(1 0 0 / 17%)` | White 17% opacity |

---

## 9 Color Accent Themes

Each theme overrides 13+ CSS variable pairs for both light and dark modes.

### Theme Registry

| # | Theme ID | CSS Class | Preview Hex | oklch Hue | Character |
|---|----------|-----------|-------------|-----------|-----------|
| 1 | `zinc` | *(none)* | `#71717a` | 0 (achromatic) | Neutral gray |
| 2 | `slate` | `.theme-slate` | `#64748b` | ~260 | Cool blue-gray |
| 3 | `blue` | `.theme-blue` | `#3b82f6` | ~250-260 | Vivid blue |
| 4 | `rose` | `.theme-rose` | `#f43f5e` | ~350 | Warm pink-red |
| 5 | `emerald` | `.theme-emerald` | `#10b981` | ~160 | Fresh green |
| 6 | `violet` | `.theme-violet` | `#8b5cf6` | ~290 | Purple |
| 7 | `amber` | `.theme-amber` | `#f59e0b` | ~75-80 | Warm gold |
| 8 | `cyan` | `.theme-cyan` | `#06b6d4` | ~200 | Teal/aqua |
| 9 | `orange` | `.theme-orange` | `#f97316` | ~45-50 | Warm orange |

### Theme Pattern (Light Mode)

For each color theme, the variables follow this pattern:
- **Backgrounds:** Very high lightness (0.98-0.99), very low chroma (0.003-0.006), at theme hue
- **Foregrounds:** Very low lightness (0.15-0.18), low chroma (0.014-0.03), at theme hue
- **Primary:** Mid lightness (0.35-0.7), HIGH chroma (0.15-0.22) — the main accent color
- **Secondary/muted/accent:** High lightness (0.93-0.96), low chroma — subtle tints

### Theme Pattern (Dark Mode)

- **Backgrounds:** Low lightness (0.18-0.19), low chroma, at theme hue
- **Foregrounds:** High lightness (0.97)
- **Primary:** Boosted lightness (0.65-0.78) to stay visible on dark backgrounds
- **Border:** All dark themes share `oklch(1 0 0 / 12%)`
- **Input:** All dark themes share `oklch(1 0 0 / 17%)`

### CSS Selector Pattern

```css
/* Light mode */
.theme-blue { --primary: oklch(0.546 0.245 262.881); /* ... */ }

/* Dark mode — dual specificity for class order independence */
.theme-blue.dark,
.dark .theme-blue { --primary: oklch(0.646 0.222 264.052); /* ... */ }
```

### Application Mechanism

`AppearanceProvider` applies `theme-{name}` to `document.documentElement.classList`. Zinc is the default — no class is added.

---

## 5 Font Choices

### Font Loading

In `layout.tsx`, three Google fonts are loaded via `next/font/google`:

```typescript
import { Geist, Geist_Mono, Inter } from "next/font/google";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
```

All three CSS variables are set on `<html>` via `className`.

### Font Registry

| Font ID | Display Name | CSS Class | Font Stack |
|---------|-------------|-----------|-----------|
| `geist` | Geist | `font-choice-geist` | `var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif` |
| `inter` | Inter | `font-choice-inter` | `var(--font-inter), ui-sans-serif, system-ui, sans-serif` |
| `mono` | Monospace | `font-choice-mono` | `var(--font-geist-mono), ui-monospace, monospace` |
| `system` | System | `font-choice-system` | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif` |
| `serif` | Serif | `font-choice-serif` | `Georgia, Cambria, "Times New Roman", Times, serif` |

### CSS Implementation

```css
@layer base {
  html { font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif; }
  html.font-choice-geist  { --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif; }
  html.font-choice-inter  { --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif; }
  html.font-choice-mono   { --font-sans: var(--font-geist-mono), ui-monospace, monospace; }
  html.font-choice-system { --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
  html.font-choice-serif  { --font-sans: Georgia, Cambria, "Times New Roman", Times, serif; }
}
```

### Application Mechanism

`AppearanceProvider` applies `font-choice-{name}` to `document.documentElement.classList`.

---

## `<html>` Class Composition

At runtime, the `<html>` element can have classes like:

```html
<html class="dark theme-blue font-choice-inter" style="--font-geist-sans: ...; --font-geist-mono: ...; --font-inter: ...;">
```

- `dark` — managed by `next-themes`
- `theme-blue` — managed by `AppearanceProvider`
- `font-choice-inter` — managed by `AppearanceProvider`
- Font CSS variables — managed by `next/font/google`

---

## shadcn/ui Configuration

### `components.json`

```json
{
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" },
  "menuColor": "default",
  "menuAccent": "subtle"
}
```

### base-nova Style Characteristics

- Uses `@base-ui/react` primitives (not Radix) — e.g., `Button as ButtonPrimitive from "@base-ui/react/button"`
- Uses `class-variance-authority` (`cva`) for variant definitions
- Uses `data-slot` attributes on elements for CSS targeting
- Uses `data-open`/`data-closed` for animation states
- Rounded corners: `rounded-lg` (buttons), `rounded-xl` (cards, dialogs)
- Ring borders: `ring-1 ring-foreground/10`
- Backdrop: `bg-black/10 backdrop-blur-xs`
- Footer pattern: `bg-muted/50` with top border

### 16 shadcn/ui Components

```
src/components/ui/
├── avatar.tsx
├── badge.tsx
├── button.tsx
├── calendar.tsx
├── card.tsx
├── checkbox.tsx
├── command.tsx          (cmdk wrapper)
├── dialog.tsx
├── dropdown-menu.tsx
├── input-group.tsx
├── input.tsx
├── popover.tsx
├── scroll-area.tsx
├── separator.tsx
├── switch.tsx
└── textarea.tsx
```

### `cn()` Utility

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Combines `clsx` (conditional class joining) with `tailwind-merge` (deduplicates conflicting Tailwind classes).

---

## CSS Animations and Keyframes

### Custom Keyframe: Widget Flash

```css
@keyframes widget-flash {
  0%   { box-shadow: 0 0 0 2px oklch(var(--primary)); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.widget-highlight {
  animation: widget-flash 1.5s ease-out;
  border-radius: var(--radius);
}
```

Used when scrolling to a widget from sidebar navigation — the widget briefly glows with the primary color.

### tw-animate-css Animations (shadcn dialogs)

- `animate-in` / `animate-out`
- `fade-in-0` / `fade-out-0`
- `zoom-in-95` / `zoom-out-95`

### react-grid-layout Transitions

```css
.react-grid-layout { transition: height 200ms ease; }
.react-grid-item { transition: left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease; }
.react-grid-item.react-draggable-dragging { z-index: 100; opacity: 0.9; }
.react-resizable-handle { opacity: 0; transition: opacity 200ms ease; }
.react-grid-item:hover .react-resizable-handle { opacity: 0.5; }
.react-grid-placeholder { transition-duration: 100ms; opacity: 0.1; }
```

---

## Domain-Specific CSS

### Tiptap Rich Text Editor (lines 527-722)

Extensive custom styles for the notes editor:
- Headings: h1 (1.4em bold), h2 (1.2em bold), h3 (1.1em semibold)
- Inline code: `bg-muted rounded px-1.5 py-0.5 font-mono text-sm`
- Code blocks: `bg-muted rounded-lg p-4 font-mono text-sm`
- Blockquotes: `border-l-2 border-border pl-4 italic`
- Task lists: custom checkbox styling with oklch colors
- Dark mode overrides for `mark`, `code`, `pre` backgrounds

### xterm.js Terminal (lines 726-737)

```css
.xterm { height: 100% !important; width: 100% !important; }
.xterm-viewport { scrollbar-width: auto !important; }
```

### AI Chat Markdown (lines 751-816)

Compact styles for AI responses: small paragraphs, tight lists, `bg-muted` code blocks, small headings.

---

## Theme Resolution Flow

```
1. next-themes resolves system preference → adds/removes .dark on <html>
2. AppearanceProvider reads localStorage → adds .theme-{color} and .font-choice-{font} on <html>
3. CSS cascade resolves:
   :root               → light zinc defaults
   .dark               → dark zinc overrides
   .theme-blue         → light blue overrides
   .dark.theme-blue    → dark blue overrides
   .font-choice-inter  → Inter font stack
4. @theme inline registers all variables as Tailwind tokens
5. Components use Tailwind classes: bg-background, text-primary, border-border, etc.
6. cn() merges conditional classes without conflicts
```
