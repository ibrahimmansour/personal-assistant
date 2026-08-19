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
Installable PWA (`public/manifest.webmanifest`, icons, `appleWebApp` metadata, `viewportFit: "cover"`). Mobile surface: `MobileBottomNav`, swipe gestures via `use-swipe` (80px threshold, 40px edge exclusion reserved for sidebar/AI-panel edge swipes), and safe-area utilities in `globals.css`. Pinch-zoom is deliberately left enabled for accessibility — do not re-lock `maximumScale`.

Below 768px (`useIsMobile` from `@/hooks/use-swipe`) `DashboardGrid` **does not render react-grid-layout at all** — it returns a single-column flex stack, one `<div>` per visible widget, sized from the `MOBILE_HEIGHT_CLASS` map in `dashboard-grid.tsx`. Widgets whose children measure their parent (terminal, files/Monaco, Claude Code) need a definite height, so a new widget must be added to that map (and its `MOBILE_HEIGHT_PX` twin, used for the narrow-container `xs` grid fallback) or it falls back to 340px. Stack order follows the `widgets` array, which is what `moveWidget()` reorders — that is what the long-press reorder mode drives.

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
- Do NOT bypass the WidgetWrapper for widget components
- Do NOT register a widget without layouts for both profiles at all three breakpoints
