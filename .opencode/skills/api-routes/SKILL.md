---
name: api-routes
description: Create and modify Next.js 16 App Router API routes with file-based persistence, profile awareness, and action-dispatch POST handlers
---

## When to Use

Use this skill when creating or modifying API routes under `src/app/api/`.

## Route File Location

```
src/app/api/{resource}/route.ts          # Simple resource
src/app/api/{resource}/[param]/route.ts  # Dynamic segment
```

## Boilerplate Template

```typescript
import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

// For routes calling external APIs:
// export const dynamic = "force-dynamic";

interface YourDataType {
  id: string;
  // ... fields
}

interface StoredData {
  items: YourDataType[];
}

async function loadData(profile: string): Promise<StoredData> {
  const filePath = join(DATA_DIR, `${profile}-yourresource.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}

async function saveData(profile: string, data: StoredData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const filePath = join(DATA_DIR, `${profile}-yourresource.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile") || "work";
    const data = await loadData(profile);
    return Response.json(data);
  } catch (error) {
    console.error("GET /api/yourresource error:", error);
    return Response.json({ error: "Failed to load data" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = body.profile || "work";
    const data = await loadData(profile);

    switch (body.action) {
      case "add": {
        const newItem: YourDataType = {
          id: crypto.randomUUID(),
          ...body.item,
        };
        data.items.push(newItem);
        break;
      }
      case "update": {
        const idx = data.items.findIndex((i) => i.id === body.id);
        if (idx !== -1) data.items[idx] = { ...data.items[idx], ...body.updates };
        break;
      }
      case "delete": {
        data.items = data.items.filter((i) => i.id !== body.id);
        break;
      }
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    await saveData(profile, data);
    return Response.json(data); // Always return full updated state
  } catch (error) {
    console.error("POST /api/yourresource error:", error);
    return Response.json({ error: "Failed to process request" }, { status: 500 });
  }
}
```

## Critical Rules

1. **Use `Response.json()`** — NEVER `NextResponse.json()`
2. **Profile-aware** — accept `profile` from query params (GET) or body (POST), default `"work"`
3. **Action-dispatch** — POST uses `body.action` switch, not separate endpoints
4. **Return full state** — every POST mutation returns the complete updated data, not just the changed item
5. **File persistence** — JSON files in `~/.personal-assistant/`, profile-namespaced filenames
6. **Error handling** — wrap in try/catch, return `{ error }` with appropriate status
7. **Force-dynamic** — add `export const dynamic = "force-dynamic"` for routes that call external APIs
8. **No auth middleware** — this is a local-only app

## External API Route Pattern (with caching)

For routes that proxy external services (Outlook, GitHub, Jira, etc.):

```typescript
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedData {
  data: any;
  timestamp: number;
}

async function readCache(profile: string): Promise<any | null> {
  try {
    const raw = await readFile(join(DATA_DIR, `${profile}-resource-cache.json`), "utf-8");
    const cached: CachedData = JSON.parse(raw);
    if (Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(profile: string, data: any): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    join(DATA_DIR, `${profile}-resource-cache.json`),
    JSON.stringify({ data, timestamp: Date.now() }, null, 2)
  );
}
```

## Response Mapping

Always normalize external API responses to internal interfaces:

```typescript
function mapExternalItem(raw: any): InternalType {
  return {
    id: raw.id || raw.key,
    title: raw.title || raw.subject || "",
    // ... normalize nulls, dates, nested fields
  };
}
```
