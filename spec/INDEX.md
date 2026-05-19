# Personal Assistant Dashboard — Specification Index

> A complete, AI-agent-friendly specification for reverse-engineering and rebuilding this application from scratch.

## How to Use This Spec

These documents contain everything needed to recreate the Personal Assistant Dashboard. An AI agent should read them in order, starting with the architecture overview and then diving into specific subsystems as needed.

**Recommended reading order:**
1. Start with `00-architecture-overview.md` for the big picture
2. Read `10-build-and-dev-environment.md` to understand the tech stack and setup
3. Read `03-state-management.md` and `04-theming-and-styling.md` for the foundation
4. Read `01-widget-system.md` for the core UI contract
5. Read remaining docs as needed for specific subsystems

## Document Index

| # | Document | Description | Key Topics |
|---|----------|-------------|------------|
| 00 | [Architecture Overview](00-architecture-overview.md) | High-level architecture, tech stack, project structure, data flow patterns, design decisions | System diagram, provider nesting, directory tree, 26k LOC breakdown |
| 01 | [Widget System](01-widget-system.md) | Widget contract, registration process, WidgetWrapper component, all 12 widget specs | Props, state, APIs, features for every widget |
| 02 | [API Routes](02-api-routes.md) | All 27 route handlers with methods, parameters, response shapes, and storage | CRUD patterns, external API bridges, auth routes |
| 03 | [State Management](03-state-management.md) | All 9 context providers with shapes, persistence, and consumer relationships | Provider nesting, state flow diagram, persistence summary |
| 04 | [Theming & Styling](04-theming-and-styling.md) | CSS architecture, oklch color system, 9 themes, 5 fonts, shadcn/ui setup | Token registration, theme patterns, font loading, animations |
| 05 | [Service Integrations](05-service-integrations.md) | All external API integrations, OAuth flows, token management | Outlook, Gmail, GitHub, Jira, Weather, Ollama, Proxy |
| 06 | [Terminal System](06-terminal-system.md) | PTY server, WebSocket protocol, xterm.js, terminal components | Multi-tab, theme sync, resize, external tab requests |
| 07 | [Dashboard Grid & Layout](07-dashboard-grid-and-layout.md) | react-grid-layout, viewport-fitting algorithm, workspaces, focus mode | compactLayout algorithm, layout persistence, pinning |
| 08 | [Data Persistence](08-data-persistence.md) | All storage mechanisms, file formats, JSON schemas | ~/.personal-assistant/ files, localStorage keys, version gating |
| 09 | [Component Reference](09-component-reference.md) | All non-widget components: header, sidebar, views, palette, panels | Props, contexts, layouts, behaviors for 15+ components |
| 10 | [Build & Dev Environment](10-build-and-dev-environment.md) | Scripts, dependencies, config files, setup instructions | npm scripts, env vars, TypeScript, PostCSS, shadcn |
| 11 | [AI Assistant System](11-ai-assistant-system.md) | Ollama integration, context injection, streaming, action parsing | Topic detection, system prompt, action execution, chat UI |
| 12 | [File Browser System](12-file-browser-system.md) | The 3515-line files widget: browsing, editing, search, git, terminal | 25+ sub-components, view modes, git operations, drag-drop |

## Quick Reference

### Tech Stack
- **Framework:** Next.js 16.2.2 (App Router) + React 19.2.4
- **Language:** TypeScript 5 (strict)
- **Styling:** Tailwind CSS 4 + shadcn/ui (base-nova) + oklch
- **Grid:** react-grid-layout
- **Rich Text:** Tiptap 3.22.2
- **Terminal:** xterm.js 6.0.0 + node-pty + WebSocket
- **Command Palette:** cmdk
- **AI:** Ollama (local LLM)
- **No database** — JSON files in `~/.personal-assistant/`

### Ports
| Port | Service |
|------|---------|
| 4444 | Next.js |
| 4445 | PTY WebSocket |
| 11434 | Ollama (optional) |

### Key Numbers
| Metric | Count |
|--------|-------|
| Source files | ~76 |
| Total lines | ~25,906 |
| Widgets | 12 |
| API routes | 27 |
| Context providers | 9 |
| Color themes | 9 |
| Font choices | 5 |
| shadcn components | 16 |
| External services | 8 |

### Rebuild Order

To recreate from scratch, follow this order:

1. **Project scaffold:** Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui
2. **Theming:** globals.css with oklch variables, 9 themes, 5 fonts
3. **Providers:** ThemeProvider → AppearanceProvider → ProfileProvider
4. **Layout shell:** Header, Sidebar, page.tsx with MainContent
5. **Dashboard system:** DashboardProvider, dashboard-grid, react-grid-layout
6. **Widget wrapper:** WidgetWrapper with expand/pin/portal
7. **Simple widgets:** Clock, Weather (no external deps)
8. **Workspace system:** WorkspaceProvider, workspace tabs, focus mode
9. **Navigation:** WidgetNavProvider, CommandPaletteProvider, command-palette
10. **Service integrations:** Token management modules, API routes
11. **Data widgets:** Tasks, Notes (local CRUD)
12. **External widgets:** Email, Calendar, GitHub PRs, Jira
13. **Terminal system:** PTY server, terminal widget, terminal panel
14. **File browser:** Files widget + /api/files route
15. **AI system:** Ollama client, AI routes, AI chat provider + panel
16. **Views:** TodayView, InboxView, TimelineView
17. **Polish:** Bookmarks, Reminders, email rules, appearance picker
