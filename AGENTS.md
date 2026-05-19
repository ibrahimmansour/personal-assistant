<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal Assistant Dashboard

A widget-based personal dashboard built with Next.js 16, React 19, and TypeScript. It aggregates email, calendar, tasks, notes, GitHub PRs, Jira tickets, a file browser, a live terminal, weather, bookmarks, and more into a customizable drag-and-drop grid layout.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (Next.js port 4444 + PTY server port 4445) |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run dev:next` | Next.js only (port 4444) |
| `npm run dev:pty` | PTY WebSocket server only (port 4445) |

## Tech Stack

- **Framework:** Next.js 16.2.2 (App Router) + React 19.2.4
- **Language:** TypeScript 5 (strict mode)
- **Styling:** Tailwind CSS 4 + shadcn/ui (base-nova style) + oklch CSS custom properties
- **UI Components:** shadcn/ui from `@/components/ui/`, icons exclusively from `lucide-react`
- **Grid Layout:** react-grid-layout (drag-and-drop, resizable)
- **Rich Text:** Tiptap (notes editor)
- **Terminal:** xterm.js + node-pty over WebSocket
- **Command Palette:** cmdk
- **Theming:** next-themes (light/dark/system) + 9 color accents + 5 font choices
- **State Management:** React Context (6 providers, no Redux/Zustand)
- **Utility:** `cn()` from `@/lib/utils` (clsx + tailwind-merge)

## Project Structure

```
personal-assistant/
├── server/
│   ├── dev-launcher.mjs          # Concurrent launcher: Next.js + PTY server
│   └── pty-server.mjs             # WebSocket PTY server (spawns zsh shells)
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout (ThemeProvider, AppearanceProvider, ProfileProvider)
│   │   ├── page.tsx               # Single-page app entry (all context providers)
│   │   ├── globals.css            # Full theme definitions (light/dark + 9 color themes)
│   │   └── api/                   # ~21 API route files
│   │       ├── tasks/route.ts
│   │       ├── notes/route.ts
│   │       ├── outlook/           # Outlook emails, calendar, search
│   │       ├── google/            # Google OAuth, Gmail, Calendar
│   │       ├── github/prs/route.ts
│   │       ├── jira/route.ts
│   │       ├── weather/route.ts
│   │       ├── files/route.ts
│   │       ├── browser/route.ts   # Chrome/Arc bookmark reading
│   │       ├── dashboard/route.ts # Persist/load layout state
│   │       └── proxy/route.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── header.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── dashboard-grid.tsx # Widget grid (react-grid-layout)
│   │   │   ├── widget-settings.tsx
│   │   │   └── appearance-picker.tsx
│   │   ├── views/
│   │   │   ├── today-view.tsx
│   │   │   ├── inbox-view.tsx
│   │   │   └── timeline-view.tsx
│   │   ├── widgets/               # 12 widget components
│   │   │   ├── clock-widget.tsx
│   │   │   ├── weather-widget.tsx
│   │   │   ├── calendar-widget.tsx
│   │   │   ├── tasks-widget.tsx
│   │   │   ├── email-widget.tsx
│   │   │   ├── reminders-widget.tsx
│   │   │   ├── github-prs-widget.tsx
│   │   │   ├── jira-widget.tsx
│   │   │   ├── notes-widget.tsx
│   │   │   ├── terminal-widget.tsx
│   │   │   ├── bookmarks-widget.tsx
│   │   │   └── files-widget.tsx
│   │   ├── widget-wrapper.tsx     # Shared widget chrome (expand, pin, search, drag)
│   │   ├── focus-mode.tsx         # Split-view with draggable divider
│   │   ├── command-palette.tsx    # Global search (Cmd+P)
│   │   └── *-context.tsx          # 6 React context providers
│   ├── lib/
│   │   ├── dashboard-config.ts    # Widget/layout configs per profile
│   │   ├── google-token.ts        # Google OAuth2 token management
│   │   ├── outlook-token.ts       # Outlook token (reads from Python CLI cache)
│   │   ├── mock-data.ts           # Fallback mock data
│   │   └── utils.ts               # cn() utility
│   └── types/
│       └── widget.ts              # WidgetType union, WidgetConfig, DashboardState, etc.
├── .opencode/                     # OpenCode configuration
│   ├── skills/                    # Agent skills
│   └── commands/                  # Custom slash commands
├── opencode.json                  # OpenCode project config
├── components.json                # shadcn/ui config (base-nova style)
└── .env.local                     # API keys (NEVER commit)
```

## Critical Conventions

### Path Alias
All imports use `@/` which maps to `src/`. Never use relative paths like `../../`.

### Client Components
Every interactive component starts with `"use client"` directive. This project does NOT use React Server Components for UI — only API routes run server-side.

### Widget Contract
Every widget MUST:
1. Start with `"use client"`
2. Import and wrap content in `<WidgetWrapper title="..." icon={<Icon />} widgetType="...">` from `@/components/widget-wrapper`
3. Use icons from `lucide-react` only
4. Use shadcn/ui primitives from `@/components/ui/`
5. Use `cn()` from `@/lib/utils` for conditional classes

### Widget Registration (3 files to update when adding a widget)
1. **`src/types/widget.ts`** — add to the `WidgetType` union
2. **`src/lib/dashboard-config.ts`** — add `WidgetConfig` entry and `LayoutItem` for both profiles
3. **`src/components/layout/dashboard-grid.tsx`** — import the component and add to `widgetComponents` map

### API Route Pattern
```typescript
// src/app/api/{resource}/route.ts
import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

export async function GET(request: NextRequest) {
  // Profile-aware: request.nextUrl.searchParams.get("profile") || "work"
  // Return: Response.json(data) — NOT NextResponse.json()
}

export async function POST(request: NextRequest) {
  // Action-dispatch: body.action switches on "add", "update", "delete", etc.
  // Return full updated state after mutation
}
```

### External Service Integration Pattern
- All external API calls go through Next.js API routes (never from the client directly)
- Token management in dedicated `src/lib/*-token.ts` helpers with auto-refresh
- File-based caching in `~/.personal-assistant/` with TTL
- Force-dynamic: `export const dynamic = "force-dynamic"` on API routes that call external services
- Response mapping functions normalize external shapes to internal interfaces

### Persistence
- Dashboard state: dual persistence (localStorage + server JSON file via `/api/dashboard`)
- Notes/Tasks: JSON files under `~/.personal-assistant/`, profile-namespaced
- No database — everything is local JSON files

### Context Provider Architecture
Providers nest in this order in `page.tsx`:
```
DashboardProvider → WorkspaceProvider → WidgetNavProvider → TerminalProvider → CommandPaletteProvider
```
The root `layout.tsx` wraps: `ThemeProvider → AppearanceProvider → ProfileProvider`.

### Styling
- Tailwind CSS 4 with oklch color space for CSS custom properties
- Theme variables defined in `src/app/globals.css` (749 lines)
- The `cn()` utility merges Tailwind classes: `cn("base-class", condition && "conditional-class")`
- shadcn/ui components use the `base-nova` style variant
- Never use inline styles — use Tailwind classes

### Dual Profile System
Everything is profile-scoped ("work" vs "private"):
- Storage keys include profile prefix
- API routes accept `profile` parameter
- Widget sets differ (work has Jira, private doesn't)
- Service backends differ (Outlook vs Gmail, SAP GitHub vs github.com)

## Environment Variables

Required in `.env.local` (NEVER commit):
- `GITHUB_TOKEN`, `GITHUB_USERNAME`, `GITHUB_API_URL` — SAP GitHub Enterprise
- `GITHUB_COM_USERNAME`, `GITHUB_COM_TOKEN` — GitHub.com
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — Google OAuth2

Outlook tokens are read dynamically from `~/.sap-email-cli/token_cache.json`.

## Do NOT

- Do NOT use `NextResponse.json()` — use `Response.json()` instead
- Do NOT use relative imports — always use `@/` alias
- Do NOT add icons from libraries other than `lucide-react`
- Do NOT add state management libraries (Redux, Zustand, etc.) — use React Context
- Do NOT commit `.env.local` or any file containing tokens/secrets
- Do NOT use the Pages Router — this project uses App Router exclusively
- Do NOT create server components for interactive UI — everything is `"use client"`
- Do NOT bypass the WidgetWrapper for widget components
