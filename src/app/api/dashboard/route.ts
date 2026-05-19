import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

function dashboardFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "dashboard.json");
  return join(DATA_DIR, `dashboard-${profile}.json`);
}

async function readDashboard(profile: string): Promise<any | null> {
  try {
    const raw = await readFile(dashboardFile(profile), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeDashboard(profile: string, data: any): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(dashboardFile(profile), JSON.stringify(data, null, 2));
}

// GET: load saved dashboard state
export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile") || "work";
    const data = await readDashboard(profile);
    if (!data) {
      return Response.json({ saved: false });
    }
    return Response.json({ saved: true, ...data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read dashboard", saved: false },
      { status: 500 }
    );
  }
}

// POST: save dashboard state
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = body.profile || "work";
    await writeDashboard(profile, {
      widgets: body.widgets,
      layouts: body.layouts,
      version: body.version,
      updatedAt: new Date().toISOString(),
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save dashboard" },
      { status: 500 }
    );
  }
}
