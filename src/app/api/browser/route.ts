import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(os.homedir(), ".personal-assistant");

function bookmarksFile(profile: string): string {
  return path.join(
    DATA_DIR,
    profile === "private" ? "bookmarks-private.json" : "bookmarks.json"
  );
}

function historyFile(profile: string): string {
  return path.join(
    DATA_DIR,
    profile === "private" ? "browser-history-private.json" : "browser-history.json"
  );
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file: string, fallback: unknown) {
  try {
    const data = await fs.readFile(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

/**
 * GET /api/browser?type=history|bookmarks&profile=work|private
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "history";
  const profile = request.nextUrl.searchParams.get("profile") || "work";

  if (type === "bookmarks") {
    const data = await readJson(bookmarksFile(profile), []);
    return Response.json(data);
  }

  const data = await readJson(historyFile(profile), []);
  return Response.json(data);
}

/**
 * POST /api/browser  { type: "history"|"bookmarks", profile: "work"|"private", data: ... }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, data, profile = "work" } = body;

  if (type === "bookmarks") {
    await writeJson(bookmarksFile(profile), data);
    return Response.json({ ok: true });
  }

  if (type === "history") {
    const history = (await readJson(historyFile(profile), [])) as Array<{
      url: string;
      title: string;
      timestamp: string;
    }>;
    history.unshift(data);
    const trimmed = history.slice(0, 100);
    await writeJson(historyFile(profile), trimmed);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid type" }, { status: 400 });
}
