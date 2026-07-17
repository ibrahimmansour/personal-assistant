# Personal Assistant Dashboard

A widget-based personal dashboard built with Next.js 16, React 19, and TypeScript. Aggregates email, calendar, tasks, notes, GitHub PRs, Jira tickets, a file browser, a live terminal, weather, bookmarks, and more into a customizable drag-and-drop grid layout.

## Installation

### Binary (recommended for servers/VPS)

Pre-built standalone binaries are published with every release. No need to clone the repo or install Node.js dependencies yourself.

```bash
curl -fsSL https://raw.githubusercontent.com/ibrahimmansour/personal-assistant/main/scripts/install.sh | bash
```

This will:
1. Download the latest `linux-x64` binary from GitHub Releases
2. Install it to `~/.personal-assistant/bin/`
3. Install the PTY native dependencies (node-pty)

After install:

```bash
# Start (port 4444 for the UI, port 4445 for the terminal WebSocket)
~/.personal-assistant/bin/personal-assistant

# Run in background
nohup ~/.personal-assistant/bin/personal-assistant > ~/.personal-assistant/app.log 2>&1 &

# Stop
pkill -f personal-assistant
```

> **Requirements:** Node.js 20+ (for the PTY server), `build-essential` / `python3` (for compiling node-pty).

### npx (quick start)

Run directly without cloning:

```bash
npx personal-assistant-dashboard
```

This clones the repo to `~/.personal-assistant/app/`, installs dependencies, builds, and starts the server on port 4444.

### Development (from source)

```bash
git clone https://github.com/ibrahimmansour/personal-assistant.git
cd personal-assistant
npm ci
npm run dev
```

Open [http://localhost:4444](http://localhost:4444) in your browser.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (Next.js port 4444 + PTY server port 4445) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint check |
| `npm run dev:next` | Next.js only (port 4444) |
| `npm run dev:pty` | PTY WebSocket server only (port 4445) |
| `npm run build:binary` | Build standalone binary for current platform |
| `npm run build:binary:all` | Build binaries for mac-arm64, mac-x64, linux-x64 |

## Features

- **Drag-and-drop grid** - Resizable widget layout (react-grid-layout)
- **Email** - Outlook (SAP) and Gmail integration
- **Calendar** - Outlook and Google Calendar
- **Tasks** - Local task management with persistence
- **Notes** - Rich text editor (Tiptap)
- **GitHub PRs** - Pull request overview (GitHub Enterprise + github.com)
- **Jira** - Ticket tracking
- **Terminal** - Full xterm.js terminal with node-pty backend
- **Weather** - Current conditions widget
- **Bookmarks** - Chrome/Arc bookmark browser
- **File Browser** - Local filesystem navigation
- **Clock** - Customizable time/date display
- **Command Palette** - Global search (Cmd+P)
- **Theming** - Light/dark mode, 9 color accents, 5 font choices
- **Dual Profiles** - Work vs. Private with separate widget sets and service backends

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19
- **Language:** TypeScript 5 (strict mode)
- **Styling:** Tailwind CSS 4 + shadcn/ui (base-nova) + oklch CSS variables
- **Grid Layout:** react-grid-layout
- **Rich Text:** Tiptap
- **Terminal:** xterm.js + node-pty over WebSocket
- **Command Palette:** cmdk
- **Theming:** next-themes
- **State:** React Context (no external state libraries)

## Project Structure

```
personal-assistant/
├── scripts/
│   ├── build-binary.mjs       # Standalone binary builder (bun compile)
│   ├── install.sh             # One-line VPS install script
│   └── server-entry.ts       # Binary entry point
├── server/
│   ├── dev-launcher.mjs       # Concurrent dev launcher
│   └── pty-server.mjs        # WebSocket PTY server
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout + providers
│   │   ├── page.tsx           # Single-page app entry
│   │   ├── globals.css        # Theme definitions
│   │   └── api/               # ~21 API route files
│   ├── components/
│   │   ├── layout/            # Header, sidebar, grid, settings
│   │   ├── widgets/           # 12 widget components
│   │   └── ui/                # shadcn/ui primitives
│   ├── lib/                   # Utilities, configs, token helpers
│   └── types/                 # TypeScript types
├── bin/cli.js                 # npx entry point
├── .github/workflows/         # CI: build + release on version bump
└── .env.local                 # API keys (not committed)
```

## Configuration

Create a `.env.local` file (never commit this):

```env
# GitHub Enterprise (work profile)
GITHUB_TOKEN=...
GITHUB_USERNAME=...
GITHUB_API_URL=https://github.your-company.com/api/v3

# GitHub.com (private profile)
GITHUB_COM_USERNAME=...
GITHUB_COM_TOKEN=...

# Google OAuth2 (Gmail + Calendar)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4444/api/google/callback
```

Outlook tokens are read from `~/.sap-email-cli/token_cache.json` (managed by the SAP Email CLI).

## Building Binaries

Binaries are compiled using [Bun](https://bun.sh) and bundled with the Next.js standalone output:

```bash
# Current platform
npm run build:binary

# All platforms (darwin-arm64, darwin-x64, linux-x64)
npm run build:binary:all
```

Output goes to `dist/<platform>/personal-assistant`.

The CI pipeline (`.github/workflows/build-release.yml`) automatically builds and publishes a `linux-x64` binary to GitHub Releases on every version bump.

## License

Private project.
