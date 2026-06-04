import { NextRequest } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const META_FILE = join(homedir(), ".personal-assistant", "claude-session-meta.json");

interface SessionMeta {
  customName?: string;
  starred?: boolean;
}

type MetaMap = Record<string, SessionMeta>;

async function loadMeta(): Promise<MetaMap> {
  try {
    const raw = await readFile(META_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveMeta(map: MetaMap): Promise<void> {
  await mkdir(dirname(META_FILE), { recursive: true });
  await writeFile(META_FILE, JSON.stringify(map, null, 2), "utf-8");
}

function sanitiseMeta(input: unknown): SessionMeta {
  const out: SessionMeta = {};
  if (input && typeof input === "object") {
    const i = input as Record<string, unknown>;
    if (typeof i.customName === "string") {
      const trimmed = i.customName.trim();
      if (trimmed) out.customName = trimmed.slice(0, 200);
    }
    if (typeof i.starred === "boolean") {
      out.starred = i.starred;
    }
  }
  return out;
}

export async function GET() {
  const map = await loadMeta();
  return Response.json({ meta: map });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const { action } = body as { action?: string };

  // ── Replace one session's meta entirely (a single rename/star toggle).
  if (action === "set") {
    const { sessionId, meta } = body as { sessionId?: string; meta?: unknown };
    if (!sessionId || typeof sessionId !== "string") {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }
    const map = await loadMeta();
    const cleaned = sanitiseMeta(meta);
    if (Object.keys(cleaned).length === 0) {
      delete map[sessionId];
    } else {
      map[sessionId] = cleaned;
    }
    await saveMeta(map);
    return Response.json({ meta: map });
  }

  // ── Drop one session's meta (called when a session is deleted from disk).
  if (action === "delete") {
    const { sessionId } = body as { sessionId?: string };
    if (!sessionId || typeof sessionId !== "string") {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }
    const map = await loadMeta();
    delete map[sessionId];
    await saveMeta(map);
    return Response.json({ meta: map });
  }

  // ── Replace the whole map (e.g. import/migration). Validates each entry.
  if (action === "replace") {
    const { meta } = body as { meta?: unknown };
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      return Response.json({ error: "meta must be an object" }, { status: 400 });
    }
    const out: MetaMap = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      const cleaned = sanitiseMeta(v);
      if (Object.keys(cleaned).length > 0) out[k] = cleaned;
    }
    await saveMeta(out);
    return Response.json({ meta: out });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
