<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal Assistant Dashboard

A widget-based personal dashboard built with Next.js 16, React 19, and TypeScript (v0.11.0, ~46k lines of TS/TSX). It aggregates email, calendar, tasks, notes, GitHub PRs, Jira tickets, news, a file browser/editor, a live terminal, Claude Code sessions, system monitoring, weather, and bookmarks into a customizable drag-and-drop grid, and ships as a self-hosted app behind a password login.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server: Next.js (4444) + PTY server (4445) via `server/dev-launcher.mjs` |
| `npm run dev:next` | Next.js only (port 4444) |
| `npm run dev:pty` | PTY WebSocket server only (port 4445) |
| `npm run build` | Production build |
| `npm run start` | PTY server + `next start` on 4444 |
| `npm run lint` | ESLint check |
| `npm run build:binary` | Standalone bun binary for the current platform |
| `npm run build:binary:all` | Binaries for darwin-arm64, darwin-x64, linux-x64 |
| `npm run release` | Version patch bump + push tag (triggers the release workflow) |

Dev scripts set `NODE_TLS_REJECT_UNAUTHORIZED=0` because corporate endpoints (SAP GitHub, Jira) use internal CAs.

## Tech Stack

- **Framework:** Next.js 16.2.2 (App Router) + React 19.2.4
- **Language:** TypeScript 5 (strict mode)
- **Styling:** Tailwind CSS 4 + shadcn/ui (base-nova style) + oklch CSS custom properties
- **UI Components:** shadcn/ui from `@/components/ui/` (built on `@base-ui/react`), icons exclusively from `lucide-react`
- **Grid Layout:** react-grid-layout 2.x (drag-and-drop, resizable, responsive breakpoints)
- **Rich Text:** Tiptap 3 (notes editor)
- **Code Editing/Rendering:** `@monaco-editor/react` (VS Code mode in the files widget), `shiki` (syntax highlight), `react-markdown` + `remark-gfm` (markdown preview, Claude Code output)
- **Terminal:** xterm.js 6 + node-pty over WebSocket
- **Command Palette:** cmdk
- **Theming:** next-themes (light/dark/system) + 9 color accents + 5 font choices
- **State Management:** React Context (9 providers, no Redux/Zustand)
- **Database access:** `pg` — only for the user-configured Postgres connections in the database API, not for app storage
- **Utility:** `cn()` from `@/lib/utils` (clsx + tailwind-merge)

## Project Structure

```
personal-assistant/
├── bin/cli.js                     # npx/binary entry point
├── scripts/
│   ├── build-binary.mjs           # bun compile → dist/ (mac arm64/x64, linux x64)
│   ├── server-entry.ts            # Entry embedded in the standalone binary
│   └── install.sh                 # curl-able installer
├── server/
│   ├── dev-launcher.mjs           # Concurrent launcher: Next.js + PTY server
│   ├── pty-server.mjs             # WebSocket PTY server (port 4445)
│   └── tmux.conf                  # tmux config used by terminal sessions
├── spec/                          # 13-doc reverse-engineering spec (see "Specs" below)
├── src/
│   ├── middleware.ts              # Password auth gate for every route (nodejs runtime)
│   ├── app/
│   │   ├── layout.tsx             # ThemeProvider → AppearanceProvider → ProfileProvider, PWA metadata
│   │   ├── page.tsx               # Single-page app entry (all app providers)
│   │   ├── login/page.tsx         # Password login
│   │   ├── setup/page.tsx         # First-run password setup
│   │   ├── globals.css            # Theme definitions (light/dark + 9 color themes)
│   │   └── api/                   # ~42 route files
│   │       ├── auth/              # Password setup/login/logout, session cookie
│   │       ├── settings/          # Read/write ~/.personal-assistant/config.json
│   │       ├── dashboard/         # Persist/load layout state
│   │       ├── tasks/, notes/, notes/sync/
│   │       ├── outlook/           # Emails (get/reply/search), calendar, refresh-token
│   │       ├── google/            # OAuth, Gmail (get/reply/search), Calendar
│   │       ├── github/prs/, jira/, jira/[key]/, jira/auth/
│   │       ├── claude-sessions/   # list, messages, meta, run, schedules, upload
│   │       ├── ai/, ai/context/   # Chat assistant + dashboard context injection
│   │       ├── files/, files-ai/  # File browser + AI file ops
│   │       ├── database/          # Postgres connections + queries (pg)
│   │       ├── vps/               # Remote host management over ssh
│   │       ├── system/            # CPU/mem/disk/swap metrics
│   │       ├── news/, weather/, browser/, email-rules/
│   │       ├── update/            # Self-update check
│   │       └── proxy/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── header.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── mobile-bottom-nav.tsx
│   │   │   ├── dashboard-grid.tsx # Widget grid (react-grid-layout)
│   │   │   ├── widget-settings.tsx
│   │   │   └── appearance-picker.tsx
│   │   ├── views/                 # status-board, today, inbox, timeline
│   │   ├── widgets/               # 15 widget components
│   │   │   ├── clock-widget.tsx           ├── notes-widget.tsx
│   │   │   ├── weather-widget.tsx         ├── terminal-widget.tsx
│   │   │   ├── calendar-widget.tsx        ├── claude-code-widget.tsx
│   │   │   ├── tasks-widget.tsx           ├── bookmarks-widget.tsx
│   │   │   ├── email-widget.tsx           ├── files-widget.tsx
│   │   │   ├── reminders-widget.tsx       ├── system-monitor-widget.tsx
│   │   │   ├── github-prs-widget.tsx      └── news-widget.tsx
│   │   │   └── jira-widget.tsx
│   │   ├── widget-wrapper.tsx     # Shared widget chrome (expand, split view, search, drag)
│   │   ├── focus-mode.tsx         # Split-view with draggable divider
│   │   ├── command-palette.tsx    # Global search (Cmd+P)
│   │   ├── ai-chat-panel.tsx      # Slide-in AI assistant
│   │   ├── settings-panel.tsx     # Config UI (writes config.json)
│   │   ├── terminal-panel.tsx
│   │   ├── html-content.tsx       # Sanitized email/article HTML rendering
│   │   └── *-context.tsx          # 9 React context providers
│   ├── hooks/
│   │   ├── use-keep-alive.ts      # Keeps sessions/PTY warm
│   │   ├── use-refresh-on-visible.ts
│   │   └── use-swipe.ts           # Mobile gestures (workspace cycling, panels)
│   ├── lib/
│   │   ├── config.ts              # config.json read/write + getConfigEnv()
│   │   ├── auth.ts                # Password hashing, session signing
│   │   ├── dashboard-config.ts    # Widgets, sections, per-profile responsive layouts
│   │   ├── google-token.ts        # Google OAuth2 token management
│   │   ├── outlook-token.ts       # Outlook token (reads from Python CLI cache)
│   │   ├── jira-auth.ts, jira-client.ts
│   │   ├── ai-client.ts           # Ollama (local LLM)
│   │   ├── anthropic-client.ts    # Anthropic Messages API (fetch, no SDK)
│   │   ├── claude-scheduler.ts    # Cron-ish runner for Claude Code prompts
│   │   ├── claude-schedule-types.ts
│   │   ├── mock-data.ts           # Fallback mock data
│   │   └── utils.ts               # cn() utility
│   └── types/widget.ts            # WidgetType union, WidgetConfig, DashboardState, etc.
├── .opencode/                     # OpenCode skills + slash commands
├── .github/workflows/build-release.yml
├── opencode.json                  # OpenCode project config
├── components.json                # shadcn/ui config (base-nova style)
└── .env.local                     # Secrets fallback (NEVER commit)
```

## Critical Conventions

### Path Alias
All imports use `@/` which maps to `src/`. Never use relative paths like `../../`.

### Client Components
Every interactive component starts with `"use client"`. This project does NOT use React Server Components for UI — only API routes and `middleware.ts` run server-side.

### Widget Contract
Every widget MUST:
1. Start with `"use client"`
2. Wrap content in `<WidgetWrapper title="..." icon={<Icon />} widgetType="...">` from `@/components/widget-wrapper`
3. Use icons from `lucide-react` only
4. Use shadcn/ui primitives from `@/components/ui/`
5. Use `cn()` from `@/lib/utils` for conditional classes

`WidgetWrapper` also accepts: `headerAction`, `className`, `sidePanel` (split view when expanded), `onExpandChange`, `expandRequested` / `onExpandHandled` (external expand requests, e.g. from the command palette), and `forceExpand` (child-controlled expansion). Expanded widgets render as a full-viewport overlay, not the native Fullscreen API.

### Widget Registration (3 files, 4 layout maps)
1. **`src/types/widget.ts`** — add to the `WidgetType` union
2. **`src/lib/dashboard-config.ts`** — add a `WidgetConfig` entry, a `widgetSections` entry (`glance` | `productivity` | `devtools` | `more`), and layout items for **both profiles × all three breakpoints** (`lg` = 12 cols, `md` = 8, `sm` = 4)
3. **`src/components/layout/dashboard-grid.tsx`** — import the component and add it to the `widgetComponents` map

Missing a breakpoint layout means the widget lands wherever react-grid-layout drops it on that screen size — always fill in all three.

### Workspaces and Views
`workspace-context.tsx` owns workspaces (persisted per profile). A workspace either renders the widget grid (default) or a dedicated view via `viewType`: `status-board`, `today`, `inbox`, `timeline`. Built-in workspaces are marked `builtIn: true` and drive the mobile bottom-nav order; horizontal swipe on `<main>` cycles them. `status-board` is the default active workspace, and the provider repairs saved state that predates it.

### API Route Pattern
```typescript
// src/app/api/{resource}/route.ts
import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

export const dynamic = "force-dynamic"; // any route hitting an external service or the FS

export async function GET(request: NextRequest) {
  // Profile-aware: request.nextUrl.searchParams.get("profile") || "work"
  // Return: Response.json(data) — NOT NextResponse.json()
}

export async function POST(request: NextRequest) {
  // Action-dispatch: body.action switches on "add", "update", "delete", etc.
  // Return full updated state after mutation
}
```
`NextResponse` is used **only** in `src/middleware.ts` (redirects/rewrites); route handlers use `Response.json()`.

### Configuration Resolution
`src/lib/config.ts` is the source of truth. `getConfig()` reads `~/.personal-assistant/config.json` deep-merged over defaults; `getConfigEnv("GITHUB_TOKEN")` checks config.json **first**, then `process.env`. New routes should call `getConfigEnv()` rather than `process.env` directly so the in-app settings panel keeps working. Keys mapped today: `GITHUB_TOKEN`, `GITHUB_USERNAME`, `GITHUB_API_URL`, `GITHUB_COM_TOKEN`, `GITHUB_COM_USERNAME`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `JIRA_COOKIES`, `OLLAMA_URL`, `OLLAMA_MODEL`. Add a new setting to `AppConfig`, `DEFAULT_CONFIG`, the `getConfigEnv` map, and the settings panel together.

### Authentication
`src/middleware.ts` (matcher: everything except `_next/static` and `_next/image`) gates the whole app:
- No `~/.personal-assistant/auth.json` → everything redirects to `/setup`
- Password configured → `/login` and `/api/auth` and `/api/google/auth*` stay open; everything else needs a valid `pa_session` cookie (HMAC-SHA256 signed with the stored password hash, compared with `timingSafeEqual`)
- Unauthenticated `/api/*` returns 401 JSON; unauthenticated pages redirect to `/login`

Any new public route (OAuth callbacks, webhooks, health checks) must be allow-listed in the middleware or it will 401/redirect.

### AI Integrations (two separate clients)
- **`src/lib/ai-client.ts`** — Ollama at `OLLAMA_URL` (default `http://localhost:11434`), model `OLLAMA_MODEL` (default `gemma3:4b`). Powers the AI chat panel (`/api/ai`, `/api/ai/context`). Optional; absent Ollama degrades gracefully.
- **`src/lib/anthropic-client.ts`** — Anthropic Messages API called directly via `fetch` (no SDK), `ANTHROPIC_API_KEY` from `.env.local`, default model `claude-haiku-4-5`, override with `ANTHROPIC_MODEL`. Used for the files widget's extraction/summarization (`/api/files-ai`).

### Claude Code Sessions
The `claude-code` widget drives the local `claude` CLI through `/api/claude-sessions/*` (`route` list, `messages`, `meta`, `run`, `schedules`, `upload`). Sessions run in **interactive** (PTY-backed, reaped after ~10 idle minutes) or **background** mode. `src/lib/claude-scheduler.ts` starts a one-minute ticker on first import and runs due entries from `~/.personal-assistant/claude-schedules.json` via `claude --resume <sid> --dangerously-skip-permissions -p <prompt>`, then advances `nextRunAt` or disables once-only schedules.

### External Service Integration Pattern
- All external API calls go through Next.js API routes — never from the client
- Token management in dedicated `src/lib/*-token.ts` / `*-auth.ts` helpers with auto-refresh
- File-based caching in `~/.personal-assistant/` with TTL
- `export const dynamic = "force-dynamic"` on any route touching an external service or the filesystem
- Response mapping functions normalize external shapes to the internal interfaces in `src/types/widget.ts`

### Persistence
Everything lives in `~/.personal-assistant/` as JSON — no app database:
- `auth.json` (password hash + salt), `config.json` (settings)
- Dashboard state: dual persistence (localStorage + `/api/dashboard`)
- Workspaces: localStorage, per profile
- `claude-schedules.json`, `db-connections.json`, `vps-connections.json`, notes/tasks/email-rules — all profile-namespaced where profile-scoped
- Outlook tokens are read from `~/.sap-email-cli/token_cache.json`
- `pg` connects only to user-configured Postgres servers via the database API; it is not app storage

### Context Provider Architecture
`layout.tsx`: `ThemeProvider → AppearanceProvider → ProfileProvider`

`page.tsx`:
```
DashboardProvider → WorkspaceProvider → WidgetNavProvider → TerminalProvider → CommandPaletteProvider → AIChatProvider
```
`CommandPalette` and `AIChatPanel` render as siblings of `MainContent` inside `AIChatProvider`.

### Styling
- Tailwind CSS 4 with oklch color space for CSS custom properties
- Theme variables defined in `src/app/globals.css`
- `cn()` merges Tailwind classes: `cn("base-class", condition && "conditional-class")`
- shadcn/ui components use the `base-nova` style variant
- Never use inline styles — use Tailwind classes

### Mobile / PWA
Installable PWA (`public/manifest.webmanifest`, icons, `appleWebApp` metadata, `viewportFit: "cover"`). Mobile surface: `MobileBottomNav`, swipe gestures via `use-swipe` (80px threshold, 40px edge exclusion reserved for sidebar/AI-panel edge swipes), and safe-area utilities in `globals.css`. **Page zoom is disabled** — `layout.tsx` ships `userScalable: false, maximumScale: 1`. The dashboard is a fixed-chrome app shell and an optical page zoom shrinks the layout viewport our media queries read, so zooming in used to walk a phone toward the desktop grid and clip the panel edges. The accessibility need it served is covered by the text-size setting instead (see below), which grows type inside a layout that holds still. Mobile Safari ignores both viewport flags by design; the 16px input floor below covers the one thing that lets through. Full-viewport touch surfaces (expanded-widget overlay, sidebar drawer, AI panel, inbox detail pane) restrict `touch-action` to `pan-y` so a custom swipe-to-dismiss gesture doesn't fight the browser's native scroll — a new full-viewport swipeable surface takes the same `touch-pan-y` (the `touch-pinch-zoom` that used to be paired with it is gone along with the zoom). The gesture hooks in `use-swipe.ts` share a window-wide capture-phase pointer tracker and every one of them (`useEdgeSwipe`, `useSwipe`, `useLongPress`) aborts the in-flight gesture the moment a second pointer goes down, and each ignores pointer events whose `pointerId` isn't the one that started the gesture. That guard predates the zoom removal and stays: without it the stray second finger of a two-handed grip reads as a one-finger swipe and drags an expanded widget away. Any new pointer-driven gesture must take the same guard.

**Text size is the app's only zoom.** Five steps (`xs` 0.85× → `xl` 1.25×) live in `appearance-context.tsx` as `fontSizes`, applied as an `html.font-size-*` class that sets the **root font-size**, so every rem-sized font-size follows. It scales text *only*: `--spacing` (Tailwind's `p-*`/`h-*`/`w-*`/`gap-*` base) and `--radius` are pinned to px in `globals.css`, so padding, control heights, icons and touch targets hold still — as do `.pb-mobile-nav` and `--app-top-inset`, which must stay in lockstep with the nav's px height. Media queries are unaffected, since `rem` inside a media query resolves against the initial 16px rather than the root's declared size, so no step can flip a phone into the desktop layout. Two consequences for new code: **write arbitrary sizes as `text-[0.625rem]`, never `text-[10px]`** — a px literal opts that string out of the setting — and don't reintroduce rem spacing for a fixed-height chrome element. The email body is the exception that needs code: `HtmlContent`'s iframe is its own document and inherits nothing, so it reads `fontSizes[...].scale` and multiplies its px sizes. Reach it from the header's `TextSizePicker` (visible at every breakpoint — the appearance picker beside it is `hidden md:inline-flex`), the appearance picker, or the command palette's Font Size group; all three write the one `fontSize` value.

Scaling text inside containers that no longer scale with it makes the same overflow failure easier to hit: content that can only be laid out at its min-content width pushes past the screen edge and reading costs a sideways scroll. Two global defaults in `globals.css` hold the line — `body { overflow-wrap: anywhere }` and `body * { min-width: 0 }`. `anywhere` rather than Tailwind's `break-words` (`overflow-wrap: break-word`) because only `anywhere` shrinks the element's min-content contribution, and `min-width: 0` overrides the `auto` (= min-content) automatic minimum size of flex/grid children, the other half of the same blowout — most visibly under a `truncate`d label. Explicit `min-w-*` utilities outrank the universal selector and `shrink-0` children keep their natural width, so deliberate horizontal strips (mobile Recent row, files-widget column browser) still work. On top of that, `WidgetWrapper`'s `CardContent` and the status-board grid scroll `overflow-y-auto overflow-x-hidden`, so overflowing widget content wraps instead of offering a sideways scroll; a widget that genuinely needs one (tables, code, terminal) owns an inner `overflow-x-auto` scroller. The email iframe carries the same `overflow-wrap: anywhere` in its `srcdoc` styles. When adding a surface, don't reintroduce plain `overflow-auto` at the widget-frame level.

The `claude-code` widget is **background-only below 768px**: mode is pinned to `"background"` regardless of the persisted `claude-code-mode`, and the mode toggle (header + folder picker) and the Chat/Terminal switch are hidden. Its session sidebar is a full-width `absolute inset-0` overlay on mobile (a 240px pane would squeeze the main pane's toggle out of reach) with its own close button, and it collapses itself after New Session or picking a session.

Below 768px (`useIsMobile` from `@/hooks/use-swipe`) `DashboardGrid` **does not render react-grid-layout at all** — it renders `MobileHome` (`src/components/layout/mobile-home.tsx`), a section-grouped icon launcher (Recent strip + At a Glance/Productivity/Dev Tools/More, per `widgetSections`/`sectionMeta` in `dashboard-config.ts`) instead of stacking every widget inline. Tapping a tile mounts *only* that widget and opens it through the normal `navigateTo()` → `useWidgetNavFor()` → `WidgetWrapper` expand path (the same mechanism the command palette uses); `MobileHome` watches `expandedWidget` from `command-palette-context` to know when the user has collapsed it again and unmounts it. Every other tile stays icon-only until tapped, so a phone never pays the mount cost of the terminal/Monaco/Claude Code widgets it isn't viewing. Long-press a tile to enter reorder mode (same `widget-reorder-mode` window event WidgetWrapper's desktop long-press used); reordering calls `moveWidget()` on the underlying `widgets` array. `MOBILE_HEIGHT_PX` still exists for the rare desktop-narrow-container `xs` grid fallback, but the old `MOBILE_HEIGHT_CLASS` stack-height map is gone — the expanded overlay is always full-height, so mobile widgets no longer need a fixed height at all.

Mobile UX baseline (audited against the Vercel Web Interface Guidelines; the skill lives at `.claude/skills/web-design-guidelines/` and fetches its rules fresh on each run). Six global rules in `globals.css` back it, and new surfaces inherit them rather than restating them:

- `color-scheme` is set on `:root`/`.dark` so the UA renders its own widgets — scrollbars, `<select>` popups, spinners, the overscroll gutter — in the right palette. It sits on the theme *classes*, not in a `prefers-color-scheme` block, because next-themes drives the theme by class and the OS preference says nothing about what's on screen. `<meta name="theme-color">` is a single tag kept on the resolved `body` background by `ThemeColorSync` (`src/components/theme-color-sync.tsx`, a `MutationObserver` on `<html class>`), for the same reason plus the nine accents that rewrite `--background`.
- Mobile `input`/`textarea`/`select` render at `max(16px, 1rem)`. Under 16px iOS Safari auto-zooms the viewport on focus and leaves it zoomed on blur — `user-scalable=no` does not stop it, Safari has ignored that flag since iOS 10 — and the text-size setting (`xs` = 13.6px root) drops every rem-sized control under that line. The selector's `:not()` clauses deliberately outrank a single Tailwind `text-*` utility.
- The same three selectors also take `min-height: 44px` on mobile. That first rule sets a *text* size, not a box size, and the widget forms are laid out at desktop density (`h-6` = 24px, `h-7` = 28px) — 16px text in a 24px box clips, and the box is half the touch minimum. `min-height` beats a utility's `height`, so this needs no per-input edit; desktop density is untouched because the rule sits inside the `max-width: 767px` query. A dense row of such controls has to be told to wrap (`flex-wrap md:flex-nowrap`) — three 44px controls do not fit a phone on one line.
- `button, a, [role="button"], label, summary` get `touch-action: manipulation` (drops the double-tap-zoom wait; page zoom is off anyway, so this only removes a delay) and `-webkit-tap-highlight-color: transparent`. Because that kills the UA's grey flash, a control with no `active:` state reads as dead on tap; a `@media (hover: none)` rule in `@layer base` therefore gives every `button`/`a`/`[role="button"]`/`summary` an `opacity: 0.6` on `:active` as the floor. It is in `@layer base` on purpose — unlayered CSS outranks every layer, so base is what lets an explicit `active:*` utility still win. **Prefer a real `active:` state on a new control**; the fallback only keeps the untouched ones from feeling broken.
- `prefers-reduced-motion: reduce` collapses all durations app-wide. Durations rather than `animation: none`, so `transitionend`/`animationend` listeners still fire.

Touch targets are `h-11`/`min-h-11` (44px) on mobile and shrink at `md:` — the expanded-widget header controls, the AI panel's composer and header buttons, sidebar rows, the launcher tiles and every widget's icon buttons and list rows follow that pattern. The widget idiom is `inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1` for an icon button and `min-h-11 md:min-h-0 md:py-*` for a list row, so the phone gets a 44px box and the desktop keeps its original padding. The bottom nav's buttons are `h-full` inside an `items-stretch` row so the whole 56px strip is tappable, not just the icon.

Every full-viewport overlay declares `role="dialog" aria-modal="true"` with a label (expanded widget, AI panel, and the sidebar *only while it is the mobile drawer* — on desktop it's a plain region), closes on Escape, and marks its backdrop `aria-hidden` since the backdrop is a decorative click target, not a control. Icon-only buttons carry `aria-label`: `title` is a desktop-hover affordance that touch never surfaces, and several header controls hide their text label below `sm`/`xs`, so they *become* icon-only on a phone. Nav and list selection state uses `aria-current`; toggles use `aria-pressed`.

Two widget-level corollaries of that, swept across all fifteen widgets and easy to reintroduce. **A control revealed only on hover is unreachable on touch** — a phone fires no `mouseenter`, so `opacity-0 group-hover:opacity-100` (and `text-muted-foreground/0 group-hover:text-*`, and a `hoveredPath === x &&` render guard) hides the control outright. Write those as `opacity-100 md:opacity-0 md:group-hover:opacity-100` so the control is simply visible on a phone and stays hover-revealed on the desktop; genuinely decorative affordances (the calendar row's chevron, the drag grip) may stay hover-only. And **an icon-only button needs `aria-label`, not just `title`** — `title` is a hover tooltip that touch never surfaces. Where a label already renders as text inside the button, do not add `aria-label` on top of it; it would override the visible name.

Widgets whose desktop layout is a side-by-side split collapse below `md`: the tasks widget's 110px folder rail becomes an in-widget overlay toggled from the header (and closes as soon as a folder is picked, like the Claude Code session sidebar), and the files widget's list+preview and column+preview panes stack vertically rather than splitting a phone's width in half.

Two structural rules came out of the same audit and are easy to regress. Tap targets are real `<button>`s, not `div role="button"` — where a row previously nested a second control (the launcher tile's reorder arrows, the sidebar's per-workspace overflow menu) the inner control moved out to be a *sibling*, since a nested `<button>` is invalid and is what forced the div in the first place. And a pointer gesture is never the only path to a feature: long-press-to-reorder is mirrored by a "Reorder Widgets" button in `MobileHome`, and the sidebar's overflow menu is always visible on touch (it was `hidden group-hover/ws:block`, so a phone could not rename or delete a custom workspace at all). The widget sweep applied the same rule where it was clean: the calendar and Jira list rows, the files widget's grid tiles and list rows and the email list row are now real `<button>`s (the inert `<a>` they wrapped — `preventDefault`, `tabIndex={-1}` — became a `<span>`), and the tasks widget's folder row split into a folder `<button>` plus a sibling overflow `<button>`. Still outstanding: a handful of rows that genuinely nest their own controls (the Claude Code session item, the terminal tab, the task row, the files widget's tab strip) remain clickable `<div>`s with no keyboard path — converting them needs the nested control lifted out to a sibling first.

The app shell is `h-[100dvh]` (not `h-screen`) so a collapsing mobile URL bar doesn't push the bottom nav off-screen, and `<main>` reserves nav space with `.pb-mobile-nav` (`3.5rem + env(safe-area-inset-bottom)`) rather than a flat `pb-14`, which under-reserved on notched devices. Interactive header controls are `h-10` on mobile and `md:h-8` on desktop to clear the ~44px touch-target minimum.

At the top, every surface that starts at the window edge — `Header`, the mobile sidebar drawer, the AI panel, the card inside the expanded-widget overlay — carries `.pt-app-top`, which pads by `--app-top-inset` (`env(safe-area-inset-top)`, plus a 0.5rem gutter below 768px because Android standalone reports a 0 inset yet still renders flush against the system bar). Installed PWAs draw edge-to-edge (`viewport-fit=cover` + a black-translucent iOS status bar), so a new top-anchored fixed/sticky surface needs that class or its first control row lands under the status bar. Put the inset on the *content* element, never on a full-viewport overlay: the expanded-widget overlay stays `fixed inset-0` with no padding and its inner `Card` carries `pt-app-top safe-area-bottom safe-area-x`, otherwise an expanded widget reads as a padded box rather than full screen.

### Dual Profile System
Everything is profile-scoped ("work" vs "private"):
- Storage keys include a profile prefix
- API routes accept a `profile` parameter
- Widget sets differ (work has Jira; private has Gmail/Google Calendar/github.com)
- Service backends differ (Outlook vs Gmail, SAP GitHub vs github.com)

## Environment Variables

Settings written through the app land in `~/.personal-assistant/config.json` and take precedence. `.env.local` (NEVER commit) is the fallback and the only home for keys not yet in `AppConfig`:
- `GITHUB_TOKEN`, `GITHUB_USERNAME`, `GITHUB_API_URL` — SAP GitHub Enterprise
- `GITHUB_COM_USERNAME`, `GITHUB_COM_TOKEN` — GitHub.com
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — Google OAuth2
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` — files-AI features
- `OLLAMA_URL`, `OLLAMA_MODEL` — local chat assistant

## Distribution

`scripts/build-binary.mjs` builds the Next.js standalone output and compiles it with `bun` into `dist/` for `darwin-arm64`, `darwin-x64`, `linux-x64`; `bin/cli.js` is the npm entry point and `scripts/install.sh` the curl installer. `.github/workflows/build-release.yml` publishes on tags — `npm run release` bumps the patch version and pushes the tag.

## Specs

`spec/` holds a 13-document reverse-engineering specification (`INDEX.md` first). It is deep and accurate on subsystem mechanics (grid compaction algorithm, PTY protocol, theming tokens, the files widget's internals), but its counts are from an earlier snapshot — it says 12 widgets / 27 routes / ~26k lines where the code now has 15 / ~42 / ~46k. Trust the code for inventory, the spec for behavior. When a change alters spec-documented behavior, update the relevant `spec/` doc and this file in the same commit.

## Do NOT

- Do NOT use `NextResponse.json()` in route handlers — use `Response.json()` (`NextResponse` belongs to `middleware.ts` only)
- Do NOT use relative imports — always use `@/` alias
- Do NOT add icons from libraries other than `lucide-react`
- Do NOT add state management libraries (Redux, Zustand, etc.) — use React Context
- Do NOT read secrets straight from `process.env` in new routes — go through `getConfigEnv()`
- Do NOT add a route that bypasses the auth middleware unless it genuinely must be public
- Do NOT commit `.env.local`, `auth.json`, `config.json`, or any file containing tokens/secrets
- Do NOT use the Pages Router — this project uses App Router exclusively
- Do NOT create server components for interactive UI — everything is `"use client"`
- Do NOT size text with a px arbitrary value (`text-[10px]`) — use rem (`text-[0.625rem]`), or the text-size setting can't scale it
- Do NOT re-enable page/pinch zoom (`userScalable`, `maximumScale`) or put rem back into `--spacing`/`--radius` — text scaling is the zoom
- Do NOT bypass the WidgetWrapper for widget components
- Do NOT register a widget without layouts for both profiles at all three breakpoints
