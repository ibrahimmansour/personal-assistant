# 00 — Architecture Overview

> Specification for rebuilding the Personal Assistant Dashboard from scratch.

## What This Is

A single-page, widget-based personal dashboard that aggregates email, calendar, tasks, notes, GitHub PRs, Jira tickets, a file browser, a live terminal, weather, bookmarks, and more into a customizable drag-and-drop grid layout. It runs locally on macOS and is designed for a single power user (SAP developer) with dual work/private profiles.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React 19 Client App ("use client" everywhere)           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │   │
│  │  │ Header   │ │ Sidebar  │ │Grid/Views│ │ AI Chat    │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  12 Widgets (each in WidgetWrapper)                 │ │   │
│  │  │  clock | weather | calendar | tasks | email |       │ │   │
│  │  │  reminders | github-prs | jira | notes |            │ │   │
│  │  │  terminal | bookmarks | files                       │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  9 Context Providers (nested)                       │ │   │
│  │  │  Theme → Appearance → Profile →                     │ │   │
│  │  │  Dashboard → Workspace → WidgetNav →                │ │   │
│  │  │  Terminal → CommandPalette → AIChat                  │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                    │
│             fetch() to localhost:4444/api/*                       │
│             WebSocket to localhost:4445                           │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js 16 Server                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  27 API Route Handlers (App Router)                      │   │
│  │  ┌─────────┐ ┌─────────────┐ ┌────────────────────────┐ │   │
│  │  │ CRUD    │ │ Proxy/Auth  │ │ External API Bridges   │ │   │
│  │  │ tasks   │ │ proxy       │ │ outlook (Graph API)    │ │   │
│  │  │ notes   │ │ google/auth │ │ google (Gmail/Cal API) │ │   │
│  │  │ dashboard│ │ jira/auth  │ │ github (REST API)      │ │   │
│  │  │ bookmarks│ │ refresh-tkn│ │ jira (REST API)        │ │   │
│  │  │ email-rules│            │ │ weather (Open-Meteo)   │ │   │
│  │  │ files   │ │             │ │ ai (Ollama local LLM)  │ │   │
│  │  └─────────┘ └─────────────┘ └────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                    │
│              File I/O to ~/.personal-assistant/                   │
│              Subprocess: git CLI, python3                         │
│              HTTP to external APIs                                │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    PTY WebSocket Server                          │
│  server/pty-server.mjs — port 4445                              │
│  Spawns zsh shells via node-pty per WebSocket connection        │
│  Protocol: JSON { type: "input"|"resize"|"output"|"exit" }     │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.2 |
| UI Library | React | 19.2.4 |
| Language | TypeScript (strict) | 5 |
| Styling | Tailwind CSS (CSS-first v4) | 4 |
| Component Library | shadcn/ui (base-nova style) | 4.1.2 |
| Color System | oklch CSS custom properties | — |
| Grid Layout | react-grid-layout | 2.2.3 |
| Rich Text Editor | Tiptap | 3.22.2 |
| Terminal Emulator | xterm.js + node-pty | 6.0.0 / 1.1.0 |
| Command Palette | cmdk | 1.1.1 |
| Theme Switching | next-themes | 0.4.6 |
| Icons | lucide-react | 1.7.0 |
| Date Utilities | date-fns | 4.1.0 |
| Markdown Rendering | react-markdown + shiki | 10.1.0 / 4.0.2 |
| WebSocket Server | ws | 8.20.0 |
| Class Utilities | clsx + tailwind-merge | 2.1.1 / 3.5.0 |
| Animations | tw-animate-css | 1.4.0 |

## Project Structure

```
personal-assistant/
├── server/
│   ├── dev-launcher.mjs           # Concurrent launcher: Next.js + PTY server
│   └── pty-server.mjs             # WebSocket PTY server (port 4445)
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root: ThemeProvider → AppearanceProvider → ProfileProvider
│   │   ├── page.tsx               # SPA entry: 6 more providers + MainContent
│   │   ├── globals.css            # 816 lines: theme defs, 9 color themes, animations
│   │   └── api/                   # 27 route handler files
│   │       ├── tasks/route.ts
│   │       ├── notes/route.ts
│   │       ├── dashboard/route.ts
│   │       ├── files/route.ts              # 1482 lines — file browser + git
│   │       ├── email-rules/route.ts
│   │       ├── browser/route.ts
│   │       ├── proxy/route.ts
│   │       ├── weather/route.ts
│   │       ├── ai/route.ts                 # Ollama AI chat
│   │       ├── ai/context/route.ts         # AI context aggregator
│   │       ├── outlook/emails/route.ts
│   │       ├── outlook/emails/[id]/route.ts
│   │       ├── outlook/emails/[id]/reply/route.ts
│   │       ├── outlook/emails/search/route.ts
│   │       ├── outlook/calendar/route.ts
│   │       ├── outlook/refresh-token/route.ts
│   │       ├── google/emails/route.ts
│   │       ├── google/emails/[id]/route.ts
│   │       ├── google/emails/[id]/reply/route.ts
│   │       ├── google/emails/search/route.ts
│   │       ├── google/calendar/route.ts
│   │       ├── google/auth/route.ts
│   │       ├── google/auth/callback/route.ts
│   │       ├── github/prs/route.ts
│   │       ├── jira/route.ts
│   │       ├── jira/[key]/route.ts
│   │       └── jira/auth/route.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── header.tsx          # Top nav: profile, search, AI, theme, settings
│   │   │   ├── sidebar.tsx         # 707 lines: workspace tabs, widget nav, focus combos
│   │   │   ├── dashboard-grid.tsx  # react-grid-layout with widget rendering
│   │   │   ├── widget-settings.tsx # Toggle widgets, lock layout, auto-arrange
│   │   │   └── appearance-picker.tsx # Color theme + font picker
│   │   ├── views/
│   │   │   ├── today-view.tsx      # Morning briefing: weather, stats, schedule
│   │   │   ├── inbox-view.tsx      # Unified inbox: emails, PRs, Jira, calendar
│   │   │   └── timeline-view.tsx   # Chronological activity feed
│   │   ├── widgets/                # 12 widget components
│   │   │   ├── clock-widget.tsx    # 174 lines — analog clock + digital time
│   │   │   ├── weather-widget.tsx  # 175 lines — current + 5-day forecast
│   │   │   ├── calendar-widget.tsx # 376 lines — today/tomorrow events
│   │   │   ├── tasks-widget.tsx    # 1254 lines — folders, priorities, AI terminal
│   │   │   ├── email-widget.tsx    # 1407 lines — categories, rules, reply, search
│   │   │   ├── reminders-widget.tsx # 222 lines — upcoming calendar events
│   │   │   ├── github-prs-widget.tsx # 359 lines — authored PRs with status
│   │   │   ├── jira-widget.tsx     # 751 lines — issues with detail panel
│   │   │   ├── notes-widget.tsx    # 825 lines — Tiptap rich text editor
│   │   │   ├── terminal-widget.tsx # 471 lines — multi-tab xterm.js terminal
│   │   │   ├── bookmarks-widget.tsx # 467 lines — categorized bookmark manager
│   │   │   └── files-widget.tsx    # 3515 lines — full file browser + git GUI
│   │   ├── widget-wrapper.tsx      # 246 lines — shared chrome, expand, pin, portal
│   │   ├── focus-mode.tsx          # 175 lines — split-view with draggable dividers
│   │   ├── command-palette.tsx     # 1547 lines — global search + AI mode
│   │   ├── html-content.tsx        # 184 lines — sandboxed HTML iframe renderer
│   │   ├── terminal-panel.tsx      # 277 lines — standalone terminal component
│   │   ├── ai-chat-panel.tsx       # 364 lines — slide-in AI chat UI
│   │   ├── theme-provider.tsx      # 11 lines — next-themes wrapper
│   │   ├── dashboard-context.tsx   # 431 lines — widget/layout state + persistence
│   │   ├── workspace-context.tsx   # 573 lines — workspaces + focus mode
│   │   ├── profile-context.tsx     # 66 lines — work/private profile
│   │   ├── appearance-context.tsx  # 120 lines — color theme + font
│   │   ├── widget-nav-context.tsx  # 103 lines — cross-widget navigation
│   │   ├── terminal-context.tsx    # 63 lines — terminal tab requests
│   │   ├── command-palette-context.tsx # 79 lines — palette open/filter state
│   │   ├── ai-chat-context.tsx     # 385 lines — AI chat + Ollama streaming
│   │   └── ui/                     # 16 shadcn/ui components
│   ├── lib/
│   │   ├── dashboard-config.ts     # Widget defaults per profile
│   │   ├── google-token.ts         # Google OAuth2 token management
│   │   ├── outlook-token.ts        # Outlook token from SAP email CLI
│   │   ├── jira-auth.ts            # Jira cookie auth + Chrome extraction
│   │   ├── jira-client.ts          # Jira REST API client
│   │   ├── ai-client.ts            # Ollama local LLM client
│   │   ├── mock-data.ts            # Fallback mock data for all widgets
│   │   └── utils.ts                # cn() utility (clsx + tailwind-merge)
│   └── types/
│       └── widget.ts               # All shared TypeScript interfaces
├── spec/                           # This specification
├── .opencode/                      # OpenCode agent config
├── components.json                 # shadcn/ui config (base-nova)
├── opencode.json                   # OpenCode project config
├── tsconfig.json                   # TypeScript config
├── postcss.config.mjs              # PostCSS with @tailwindcss/postcss
├── next.config.ts                  # Next.js config (empty/default)
└── package.json                    # Dependencies and scripts
```

## Core Architectural Decisions

### 1. Single-Page Application
The entire app is a single Next.js page (`page.tsx`). There is no multi-page routing. All navigation is handled by switching workspaces and expanding/collapsing widgets.

### 2. All Client Components
Every interactive component uses `"use client"`. React Server Components are NOT used for UI. Only API route handlers run server-side.

### 3. No Database
All persistence uses local JSON files under `~/.personal-assistant/`. Dual persistence strategy: localStorage (immediate) + server-side JSON (debounced POST to API routes).

### 4. No State Management Library
State is managed entirely through 9 nested React Context providers. No Redux, Zustand, or similar.

### 5. Profile-Scoped Everything
A dual profile system ("work" vs "private") scopes all data, API endpoints, and widget configurations. Work profile uses Outlook + SAP GitHub Enterprise + Jira. Private uses Gmail + github.com (no Jira).

### 6. API Routes as Backend
All external service calls go through Next.js API route handlers — never directly from client code. This keeps tokens/secrets server-side and allows caching.

### 7. Widget Contract
Every widget follows the same contract: wraps its content in `<WidgetWrapper>`, uses shadcn/ui components, lucide-react icons, and the `cn()` utility. Three files must be updated to register a new widget.

## Data Flow Patterns

### Widget Data Fetching
```
Widget Component
  → useEffect on mount / interval
    → fetch("/api/{resource}?profile={activeProfile}")
      → API route handler
        → External API (with token from lib/*-token.ts)
        → OR local file read from ~/.personal-assistant/
      → Response.json(data)
    → setState(data)
  → Render UI
```

### Cross-Widget Navigation
```
CommandPalette / AIChat / View
  → WidgetNavContext.navigateTo(widgetType, itemId?, searchQuery?)
    → Widget detects via useWidgetNavFor(widgetType)
      → expandRequested → WidgetWrapper opens fullscreen overlay
      → pendingItemId → Widget selects/scrolls to specific item
      → pendingSearchQuery → Widget pre-fills search box
```

### Dashboard Persistence
```
User action (drag/resize/toggle widget)
  → DashboardContext state update
    → Immediate: localStorage.setItem("dashboard-widgets-{profile}", ...)
    → Debounced (500ms): POST /api/dashboard { profile, widgets, layouts, version }
      → Write to ~/.personal-assistant/dashboard.json
```

### Terminal Communication
```
Terminal Widget / Files Widget / Tasks Widget
  → Creates WebSocket to ws://localhost:4445?cwd={path}&cmd={command}
    → PTY Server spawns zsh shell via node-pty
      → Bidirectional: { type: "input/output/resize/exit" }
    → xterm.js renders terminal output
```

## Provider Nesting Order

```
layout.tsx:
  ThemeProvider (next-themes: light/dark/system)
    → AppearanceProvider (9 color themes + 5 fonts)
      → ProfileProvider (work/private)

page.tsx:
  DashboardProvider (widget configs + grid layouts)
    → WorkspaceProvider (workspace tabs + focus mode + sidebar)
      → WidgetNavProvider (cross-widget navigation requests)
        → TerminalProvider (terminal tab dispatch)
          → CommandPaletteProvider (search/filter state)
            → AIChatProvider (AI chat panel + Ollama streaming)
              → MainContent + CommandPalette + AIChatPanel
```

## Environment Requirements

- **OS**: macOS (uses AppleScript for Outlook token extraction, Keychain for Jira cookie decryption)
- **Node.js**: 22+ (uses `node:sqlite` for Chrome cookie reading)
- **Python 3**: For Outlook token refresh via SAP email CLI
- **Git**: For file browser git operations
- **Chrome**: For Jira cookie extraction and Outlook token extraction
- **Ollama** (optional): For local AI chat (defaults to `gemma3:4b` model)

## Line Count Summary

| Category | Files | Total Lines |
|----------|-------|-------------|
| Widget components | 12 | ~9,996 |
| Layout/views/core components | 16 | ~5,555 |
| Context providers | 9 | ~2,336 |
| API routes | 27 | ~4,962 |
| Library modules | 8 | ~1,986 |
| Server scripts | 2 | ~169 |
| Types | 1 | ~86 |
| CSS | 1 | ~816 |
| **Total** | **76** | **~25,906** |
