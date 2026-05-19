---
name: service-integration
description: Add new external service integrations with OAuth token management, API proxying through Next.js routes, file-based caching, and response normalization
---

## When to Use

Use this skill when adding a new external service integration (e.g., Slack, Notion, Linear, Spotify) or modifying existing ones (Outlook, Gmail, GitHub, Jira, Weather).

## Architecture Overview

```
Widget (client) → /api/{service}/route.ts (server) → External API
                         ↓
                  Token helper (src/lib/{service}-token.ts)
                         ↓
                  Cache file (~/.personal-assistant/{profile}-{service}-cache.json)
```

All external API calls are proxied through Next.js API routes. Widgets NEVER call external services directly.

## Step-by-Step: Adding a New Service

### 1. Create token management helper

File: `src/lib/{service}-token.ts`

```typescript
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const TOKEN_DIR = join(homedir(), ".personal-assistant");

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function loadTokens(): Promise<TokenData | null> {
  try {
    const raw = await readFile(join(TOKEN_DIR, "service-tokens.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTokens(tokens: TokenData): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true });
  await writeFile(
    join(TOKEN_DIR, "service-tokens.json"),
    JSON.stringify(tokens, null, 2)
  );
}

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const res = await fetch("https://api.service.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.SERVICE_CLIENT_ID,
      client_secret: process.env.SERVICE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed");
  const data = await res.json();
  const tokens: TokenData = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveTokens(tokens);
  return tokens;
}

export async function serviceFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let tokens = await loadTokens();
  if (!tokens) throw new Error("Not authenticated with service");

  // Auto-refresh if expired
  if (Date.now() >= tokens.expiresAt - 60000) {
    tokens = await refreshAccessToken(tokens.refreshToken);
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${tokens.accessToken}`,
    },
  });

  // Retry once on 401
  if (res.status === 401) {
    tokens = await refreshAccessToken(tokens.refreshToken);
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
  }

  return res;
}
```

### 2. Create API route with caching

File: `src/app/api/{service}/route.ts`

```typescript
import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { serviceFetch } from "@/lib/{service}-token";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Response mapping — normalize external shape to internal
interface InternalItem {
  id: string;
  title: string;
  // ... your normalized fields
}

function mapItem(raw: any): InternalItem {
  return {
    id: String(raw.id),
    title: raw.name || raw.title || "",
    // Handle nulls, dates, nested objects
  };
}

// Cache helpers
async function readCache(profile: string): Promise<InternalItem[] | null> {
  try {
    const raw = await readFile(join(DATA_DIR, `${profile}-service-cache.json`), "utf-8");
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(profile: string, data: InternalItem[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    join(DATA_DIR, `${profile}-service-cache.json`),
    JSON.stringify({ data, timestamp: Date.now() }, null, 2)
  );
}

export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile") || "work";
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    if (!forceRefresh) {
      const cached = await readCache(profile);
      if (cached) return Response.json({ items: cached });
    }

    const res = await serviceFetch("https://api.service.com/items");
    if (!res.ok) throw new Error(`Service API error: ${res.status}`);

    const raw = await res.json();
    const items = raw.items.map(mapItem);
    await writeCache(profile, items);

    return Response.json({ items });
  } catch (error) {
    console.error("Service API error:", error);
    return Response.json({ error: "Failed to fetch from service" }, { status: 500 });
  }
}
```

### 3. Create widget (see `widget-development` skill)

### 4. Add env vars to `.env.local`

```
SERVICE_CLIENT_ID=...
SERVICE_CLIENT_SECRET=...
```

## Existing Service Patterns

| Service | Token Helper | API Route | External API |
|---------|-------------|-----------|--------------|
| Outlook | `src/lib/outlook-token.ts` | `src/app/api/outlook/` | Microsoft Graph |
| Google | `src/lib/google-token.ts` | `src/app/api/google/` | Google APIs |
| GitHub | env vars (PAT) | `src/app/api/github/prs/` | GitHub REST API |
| Jira | env vars | `src/app/api/jira/` | Jira REST API |
| Weather | none (public API) | `src/app/api/weather/` | Open-Meteo |

## Profile Awareness

Services differ between profiles:
- **Work profile**: Outlook, SAP GitHub Enterprise (`GITHUB_API_URL`), Jira
- **Private profile**: Gmail/Google Calendar, GitHub.com, no Jira

The API route should check the profile parameter and use the appropriate credentials/endpoints.

## Rules

1. **Never call external APIs from client components** — always proxy through API routes
2. **Always implement caching** with configurable TTL
3. **Always map responses** to internal interfaces (normalize field names, handle nulls)
4. **Use `export const dynamic = "force-dynamic"`** on all external service routes
5. **Implement auto-refresh** for OAuth tokens with retry-on-401
6. **Store tokens/cache in `~/.personal-assistant/`** — never in the project directory
7. **Add env vars to `.env.local`** — never hardcode credentials
8. **Profile-namespace cache files** (e.g., `work-service-cache.json`, `private-service-cache.json`)
