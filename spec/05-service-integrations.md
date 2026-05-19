# 05 — Service Integrations

> Complete specification of all external service integrations, OAuth flows, token management, and API proxying patterns.

## Overview

All external API calls go through Next.js API route handlers — never from client code directly. This keeps tokens server-side. Each integration has a dedicated token management module in `src/lib/`.

## Integration Matrix

| Service | Profile | API Base URL | Auth Method | Token Module |
|---------|---------|-------------|-------------|--------------|
| Microsoft Outlook | work | `https://outlook.office.com/api/v2.0` | Bearer token (from Chrome/Python) | `src/lib/outlook-token.ts` |
| Microsoft Graph (Calendar) | work | `https://graph.microsoft.com/v1.0` | Bearer token | `src/lib/outlook-token.ts` |
| Gmail | private | `https://gmail.googleapis.com/gmail/v1` | OAuth2 Bearer token | `src/lib/google-token.ts` |
| Google Calendar | private | `https://www.googleapis.com/calendar/v3` | OAuth2 Bearer token | `src/lib/google-token.ts` |
| SAP GitHub Enterprise | work | `https://github.wdf.sap.corp/api/v3` | Personal Access Token | env `GITHUB_TOKEN` |
| GitHub.com | private | `https://api.github.com` | Personal Access Token / `gh` CLI | env `GITHUB_COM_TOKEN` |
| SAP Jira | work | `https://jira.tools.sap/rest/api/2` | Cookie auth (from Chrome) | `src/lib/jira-auth.ts` |
| Open-Meteo (Weather) | both | `https://api.open-meteo.com/v1/forecast` | None (free API) | — |
| Ollama (AI) | both | `http://localhost:11434` | None (local) | `src/lib/ai-client.ts` |

---

## Microsoft Outlook / Graph Integration

### Token Source

Outlook tokens are obtained from the SAP email CLI tool's cache, not through a direct OAuth flow.

**Token file:** `~/.sap-email-cli/token_cache.json`
```json
{
  "token": "eyJ0eXAiOiJK...",
  "expires_on": "2024-01-15T10:30:00Z"
}
```

### Token Module: `src/lib/outlook-token.ts` (227 lines)

**Exported functions:**

| Function | Purpose |
|----------|---------|
| `getTokenStatus()` | Check token validity (60s expiry buffer) |
| `writeTokenCache(token, expiresOn)` | Write new token to cache file |
| `getOutlookToken()` | Get valid token; auto-refreshes via Python if expired |
| `outlookFetch(path, params?)` | Authenticated GET to Outlook REST API |
| `outlookFetchUrl(fullUrl)` | GET full URL (for pagination `@odata.nextLink`) |
| `outlookPost(path, body)` | Authenticated POST to Outlook REST API |

**Token refresh chain:**
1. Read `~/.sap-email-cli/token_cache.json`
2. If expired: execute `python3 -c "from chrome_token import get_token; print(get_token())"` with 15s timeout
3. If Python fails: return error (user must manually refresh via `/api/outlook/refresh-token`)

**Manual refresh flow (POST `/api/outlook/refresh-token`):**
1. Uses AppleScript to control Chrome browser
2. Opens/finds Outlook tab at `https://outlook.office.com`
3. Executes JavaScript in Chrome to extract token from `localStorage`
4. Polls for up to ~90 seconds
5. Saves via `writeTokenCache()`

**Auto-retry:** `outlookFetch`/`outlookPost` retry once on 401, refreshing token between attempts.

### Routes Using Outlook

| Route | API Calls |
|-------|-----------|
| `/api/outlook/emails` | `GET /me/mailFolders/Inbox/messages` |
| `/api/outlook/emails/[id]` | `GET /me/messages/{id}` |
| `/api/outlook/emails/[id]/reply` | `POST /me/messages/{id}/reply` or `/replyall` |
| `/api/outlook/emails/search` | `GET /me/messages?$search=` |
| `/api/outlook/calendar` | `GET /me/calendarView?startDateTime=&endDateTime=` |

---

## Google (Gmail + Calendar) Integration

### OAuth2 Flow

Standard OAuth2 authorization code flow with refresh tokens.

**Environment variables:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (defaults to `http://localhost:4444/api/google/auth/callback`)

**Scopes:** `gmail.readonly`, `gmail.send`, `calendar.readonly`

**Token file:** `~/.personal-assistant/google-tokens.json`
```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//0d...",
  "expires_at": 1705312800,
  "token_type": "Bearer",
  "scope": "..."
}
```

### Token Module: `src/lib/google-token.ts` (176 lines)

| Function | Purpose |
|----------|---------|
| `isConfigured()` | Check if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set |
| `getAuthUrl()` | Build Google OAuth consent URL |
| `exchangeCode(code)` | Exchange auth code for tokens, save to disk |
| `getGoogleToken()` | Get valid access token; auto-refreshes if expiring within 60s |
| `googleFetch(url, options?)` | Authenticated fetch; retries once on 401 with refresh |

### OAuth Flow Steps

1. User clicks "Connect Google" in email/calendar widget
2. Widget redirects to `GET /api/google/auth`
3. Route generates consent URL via `getAuthUrl()` and sends 302 redirect
4. User grants permissions on Google consent screen
5. Google redirects to `GET /api/google/auth/callback?code=...`
6. Route calls `exchangeCode(code)` → saves tokens to disk
7. Returns HTML page with auto-close script
8. Widget re-fetches data (now authenticated)

### Routes Using Google

| Route | API Calls |
|-------|-----------|
| `/api/google/emails` | Gmail messages.list + messages.get (batch) |
| `/api/google/emails/[id]` | Gmail messages.get (format=full) |
| `/api/google/emails/[id]/reply` | Gmail messages.get (headers) + users.getProfile + messages.send |
| `/api/google/emails/search` | Gmail messages.list (q=) + messages.get (batch, groups of 25) |
| `/api/google/calendar` | Calendar events.list (calendarId=primary) |

---

## GitHub Integration

### Dual-Source Configuration

| Profile | API Base | Token Source |
|---------|----------|-------------|
| work | `https://github.wdf.sap.corp/api/v3` | `GITHUB_TOKEN` env var |
| private | `https://api.github.com` | `GITHUB_COM_TOKEN` env → fallback: `gh auth token` CLI |

### Token Resolution (Private)

```
1. Check env GITHUB_COM_TOKEN
2. If missing: execute `gh auth token` via child_process.execFile
3. If both fail: return error
```

### API Calls

**Route:** `/api/github/prs?profile=work|private`

```
GET /search/issues?q=type:pr+author:{username}+is:open&sort=updated&per_page=30
```

Then for each PR, enriches with:
```
GET /repos/{owner}/{repo}/pulls/{number}  → additions, deletions, labels, draft, mergeable
```

**Response normalization:**
```typescript
interface EnrichedPR {
  id: number;
  title: string;
  repo: string;          // "owner/repo"
  repoUrl: string;
  url: string;           // HTML URL
  state: "open" | "merged" | "closed";
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  additions: number;
  deletions: number;
  comments: number;
  reviewDecision?: string;
  labels: { name: string; color: string }[];
  mergeable?: boolean;
  checksStatus?: string;
}
```

---

## Jira Integration

### Cookie-Based Authentication

Jira uses session cookies (not OAuth). Three methods to obtain cookies:

**Method 1: Auto-extract from Chrome (preferred)**
- Uses `node:sqlite` (Node 22+) to read Chrome's Cookies SQLite database
- Decrypts cookies using platform-specific key:
  - macOS: Keychain (`security find-generic-password -s "Chrome Safe Storage"`)
  - Linux: DPAPI fallback or `secret-tool`
  - Windows: DPAPI via `crypto.createDecipheriv`
- Extracts `JSESSIONID`, `atlassian.xsrf.token`, and other cookies for `jira.tools.sap`

**Method 2: Manual cookie paste**
- User copies cookie string from Chrome DevTools
- Pastes into Jira widget's auth input
- Validated via `GET /rest/api/2/myself`

**Method 3: Environment variable**
- `JIRA_COOKIES` env var

### Auth Module: `src/lib/jira-auth.ts` (546 lines)

| Function | Purpose |
|----------|---------|
| `loadCookies()` | Try env → auth file → legacy file (auto-migrate) |
| `saveCookies(cookies, user?)` | Save to `~/.personal-assistant/jira/auth.json` |
| `clearCookies()` | Delete auth file |
| `validateCookies(cookies)` | GET `/rest/api/2/myself` → returns `JiraUser` or null |
| `extractChromeCookies()` | Read + decrypt Chrome cookie DB (cross-platform) |
| `ensureCookies()` | Main auth flow: saved → validate → Chrome extract |
| `authenticateWithCookies(cookies)` | Manual paste flow: validate + save |
| `getAuthStatus()` | For UI display: `{ authenticated, user?, cookieAge? }` |

### Client Module: `src/lib/jira-client.ts` (286 lines)

| Function | Purpose |
|----------|---------|
| `searchIssues(jql, maxResults?)` | Search with JQL, returns `JiraIssue[]` |
| `getIssueDetail(key)` | Full issue with rendered HTML fields and comments |

### Auth File

`~/.personal-assistant/jira/auth.json`:
```json
{
  "cookies": "JSESSIONID=...; atlassian.xsrf.token=...",
  "timestamp": 1705312800000,
  "user": "d067576"
}
```

Cookies are re-validated if older than 1 hour.

---

## Weather Integration (Open-Meteo)

No authentication required. Free API with no API key.

**Route:** `GET /api/weather`

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=52.52
  &longitude=13.41
  &current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code
  &daily=temperature_2m_max,temperature_2m_min,weather_code
  &timezone=Europe/Berlin
  &forecast_days=5
```

**Caching:** `next: { revalidate: 600 }` (10-minute ISR)

**Weather code mapping:** WMO weather codes (0-99) mapped to condition strings: "Sunny", "Partly Cloudy", "Cloudy", "Foggy", "Drizzle", "Rain", "Snow", "Thunderstorm".

---

## Ollama AI Integration

Local LLM inference — no cloud dependency.

### Client Module: `src/lib/ai-client.ts` (152 lines)

**Configuration:**
- `OLLAMA_BASE`: env `OLLAMA_URL` or `http://localhost:11434`
- `MODEL`: env `OLLAMA_MODEL` or `gemma3:4b`

| Function | Purpose |
|----------|---------|
| `isOllamaAvailable()` | Ping `/api/tags` with 2s timeout |
| `chatCompletion(messages, options?)` | Non-streaming completion |
| `chatCompletionStream(messages, options?)` | Streaming via `ReadableStream<Uint8Array>` |

**Streaming protocol (NDJSON):**
```
{ "token": "Hello" }
{ "token": " world" }
{ "token": "!" }
{ "done": true }
```

On error: `{ "error": "message" }`

**Default options:** `temperature: 0.3`, `num_predict: 1024`

---

## Web Proxy

**Route:** `GET /api/proxy?url=https://example.com`

General-purpose web proxy for the bookmarks/browser widget. Fetches URLs server-side and strips iframe-blocking headers.

**HTML processing:**
1. Sets `<base href>` to the proxy URL
2. Injects navigation interceptor script:
   - Intercepts link clicks → rewrites to go through proxy
   - Intercepts form submissions → rewrites action URL
   - Overrides `history.pushState` → updates through proxy
3. Rewrites relative URLs in HTML

**CSS processing:**
- Rewrites `url()` paths to go through proxy

**Header stripping:**
- Removes `x-frame-options`, `content-security-policy`

**Error handling:**
- Detects Cisco Umbrella network blocks
- Returns friendly HTML error pages

---

## Service Integration Pattern

For adding a new external service, follow this pattern:

### 1. Token management (`src/lib/{service}-token.ts`)

```typescript
// Read/write token from ~/.personal-assistant/{service}-tokens.json
// Auto-refresh when expired
// Export authenticated fetch wrapper
export async function serviceFetch(url: string): Promise<any> {
  const token = await getServiceToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const newToken = await refreshToken();
    // retry
  }
  return res.json();
}
```

### 2. API route (`src/app/api/{service}/route.ts`)

```typescript
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = request.nextUrl.searchParams.get("profile") || "work";
  try {
    const data = await serviceFetch("/api/endpoint");
    return Response.json(mapToInternalShape(data));
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

### 3. Response normalization

Map external API shapes to internal TypeScript interfaces defined in `src/types/widget.ts`.

### 4. Caching (optional)

File-based cache in `~/.personal-assistant/` with TTL:
```typescript
const CACHE_FILE = join(DATA_DIR, "service-cache.json");
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedOrFetch() {
  const cache = await readCache();
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache;
  const fresh = await fetchFromService();
  await writeCache(fresh);
  return fresh;
}
```

---

## Environment Variables Summary

| Variable | Service | Required |
|----------|---------|----------|
| `GITHUB_TOKEN` | SAP GitHub Enterprise | For work profile |
| `GITHUB_USERNAME` | SAP GitHub Enterprise | For work profile |
| `GITHUB_API_URL` | SAP GitHub Enterprise | For work profile |
| `GITHUB_COM_USERNAME` | GitHub.com | For private profile |
| `GITHUB_COM_TOKEN` | GitHub.com | Optional (falls back to `gh auth token`) |
| `GOOGLE_CLIENT_ID` | Google OAuth2 | For private profile |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 | For private profile |
| `GOOGLE_REDIRECT_URI` | Google OAuth2 | Optional (defaults to localhost:4444) |
| `JIRA_COOKIES` | Jira | Optional (falls back to Chrome extraction) |
| `OLLAMA_URL` | Ollama | Optional (defaults to localhost:11434) |
| `OLLAMA_MODEL` | Ollama | Optional (defaults to gemma3:4b) |

Outlook tokens are read from `~/.sap-email-cli/token_cache.json` — no env var needed.
