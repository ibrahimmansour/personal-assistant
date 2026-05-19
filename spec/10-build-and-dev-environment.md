# 10 — Build and Dev Environment

> Complete specification of the build system, development workflow, scripts, and environment setup.

## Prerequisites

| Requirement | Version | Purpose |
|------------|---------|---------|
| Node.js | 22+ | Required for `node:sqlite` (Jira cookie extraction) |
| npm | 9+ | Package manager |
| macOS | Any recent | AppleScript for Outlook token, Keychain for Jira |
| Python 3 | 3.8+ | Outlook token refresh via SAP email CLI |
| Git | Any | File browser git operations |
| Chrome | Any | Jira cookie extraction, Outlook token extraction |
| Ollama | Latest (optional) | Local AI chat |

## npm Scripts

```json
{
  "dev": "NODE_TLS_REJECT_UNAUTHORIZED=0 node server/dev-launcher.mjs",
  "dev:next": "NODE_TLS_REJECT_UNAUTHORIZED=0 next dev --port 4444",
  "dev:pty": "node server/pty-server.mjs",
  "build": "next build",
  "start": "NODE_TLS_REJECT_UNAUTHORIZED=0 node server/pty-server.mjs & NODE_TLS_REJECT_UNAUTHORIZED=0 next start --port 4444",
  "postinstall": "chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true",
  "lint": "eslint"
}
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start both Next.js (4444) and PTY server (4445) concurrently |
| `npm run dev:next` | Start Next.js only (port 4444) |
| `npm run dev:pty` | Start PTY server only (port 4445) |
| `npm run build` | Production build |
| `npm run start` | Production: PTY in background + Next.js |
| `npm run lint` | ESLint check |

### `NODE_TLS_REJECT_UNAUTHORIZED=0`

Set in dev/start scripts to bypass TLS certificate validation. Required for SAP corporate proxy environments where internal certificates may not be trusted by Node.js.

### `postinstall`

Fixes `node-pty` binary permissions on macOS ARM64 (Apple Silicon). The `spawn-helper` binary needs execute permissions.

## Dev Launcher

**File:** `server/dev-launcher.mjs` (59 lines)

Concurrently spawns:
1. PTY server: `node server/pty-server.mjs`
2. Next.js: `npx next dev --port 4444`

Both child processes inherit the environment with `NODE_TLS_REJECT_UNAUTHORIZED=0`. If Next.js exits (e.g., compilation error), all children are killed and the process exits. Handles `SIGINT`/`SIGTERM` for graceful shutdown.

## Ports

| Port | Service | Protocol |
|------|---------|----------|
| 4444 | Next.js dev/production server | HTTP |
| 4445 | PTY WebSocket server | WebSocket |
| 11434 | Ollama (optional, external) | HTTP |

## Environment Variables

### Required for full functionality

Create `.env.local` in project root (NEVER commit):

```bash
# SAP GitHub Enterprise (work profile)
GITHUB_TOKEN=ghp_...
GITHUB_USERNAME=d067576
GITHUB_API_URL=https://github.wdf.sap.corp/api/v3

# GitHub.com (private profile)
GITHUB_COM_USERNAME=your-username
GITHUB_COM_TOKEN=ghp_...    # Optional: falls back to `gh auth token`

# Google OAuth2 (private profile)
GOOGLE_CLIENT_ID=123456.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:4444/api/google/auth/callback

# Ollama (optional)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b

# Jira (optional: falls back to Chrome cookie extraction)
JIRA_COOKIES=JSESSIONID=...
```

### Outlook Token

Not an env variable. Read from `~/.sap-email-cli/token_cache.json`. Requires the SAP email CLI tool to be installed and authenticated.

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Key points:
- **Strict mode** enabled
- **`moduleResolution: "bundler"`** — modern Next.js 16 approach
- **`jsx: "react-jsx"`** — React 19 automatic transform (not `preserve`)
- **Path alias:** `@/*` maps to `./src/*`

## Next.js Configuration

```typescript
// next.config.ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

Default/empty configuration. Relies entirely on Next.js 16 defaults.

## PostCSS Configuration

```javascript
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

Single plugin: Tailwind CSS 4's PostCSS integration.

## shadcn/ui Configuration

```json
{
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" }
}
```

To add a new shadcn component:
```bash
npx shadcn@latest add [component-name]
```

## Dependencies

### Production (36 packages)

| Category | Packages |
|----------|----------|
| Core | `next@16.2.2`, `react@19.2.4`, `react-dom@19.2.4` |
| UI Framework | `shadcn@4.1.2`, `@base-ui/react@1.3.0`, `class-variance-authority@0.7.1` |
| Styling | `clsx@2.1.1`, `tailwind-merge@3.5.0`, `tw-animate-css@1.4.0` |
| Icons | `lucide-react@1.7.0` |
| Grid | `react-grid-layout@2.2.3`, `@types/react-grid-layout@1.3.6` |
| Rich Text | `@tiptap/react@3.22.2`, `@tiptap/starter-kit@3.22.2`, `@tiptap/pm@3.22.2`, + 8 Tiptap extensions |
| Terminal | `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, `@xterm/addon-web-links@0.12.0`, `node-pty@1.1.0`, `ws@8.20.0` |
| Command Palette | `cmdk@1.1.1` |
| Theme | `next-themes@0.4.6` |
| Date | `date-fns@4.1.0`, `react-day-picker@9.14.0` |
| Markdown | `react-markdown@10.1.0`, `shiki@4.0.2` |

### Development (8 packages)

| Package | Purpose |
|---------|---------|
| `@tailwindcss/postcss@4` | Tailwind CSS 4 PostCSS plugin |
| `tailwindcss@4` | Tailwind CSS 4 |
| `typescript@5` | TypeScript compiler |
| `eslint@9` | Linting |
| `eslint-config-next@16.2.2` | Next.js ESLint rules |
| `@types/node@20` | Node.js types |
| `@types/react@19` | React types |
| `@types/react-dom@19` | ReactDOM types |
| `@types/ws@8.18.1` | WebSocket types |

## Build Output

`npm run build` produces a standard Next.js production build in `.next/`. The server scripts (`server/*.mjs`) are not bundled — they run as separate Node.js processes.

## Development Workflow

### First-time setup

```bash
git clone <repo>
cd personal-assistant
npm install
cp .env.local.example .env.local  # Configure API keys
npm run dev
```

### Adding a new shadcn component

```bash
npx shadcn@latest add button  # or any component
```

### Adding a new widget

1. Create `src/components/widgets/my-widget.tsx`
2. Add type to `src/types/widget.ts` WidgetType union
3. Add config to `src/lib/dashboard-config.ts` (both profiles)
4. Import and register in `src/components/layout/dashboard-grid.tsx`

### Running Ollama for AI

```bash
ollama pull gemma3:4b
ollama serve
```

## File Structure Conventions

| Convention | Rule |
|-----------|------|
| Imports | Always use `@/` path alias, never relative `../../` |
| Components | `"use client"` directive on every interactive component |
| API Routes | `Response.json()` NOT `NextResponse.json()` |
| Icons | lucide-react only |
| Styling | Tailwind classes via `cn()`, never inline styles |
| State | React Context only, no Redux/Zustand |
| Router | App Router only, no Pages Router |
