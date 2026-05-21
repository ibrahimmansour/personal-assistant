import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CONFIG_FILE = join(DATA_DIR, "claude-relay-config.json");

// ─── Types ───────────────────────────────────────────────────────────────────

interface RelayConfig {
  /** WebSocket URL of the relay server (e.g. ws://your-vps:4446) */
  url: string;
  /** Auth token for the relay server */
  token?: string;
  /** Default working directory on the VPS */
  defaultCwd?: string;
  /** Label for display */
  label: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadConfig(): Promise<RelayConfig[]> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveConfig(configs: RelayConfig[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(configs, null, 2));
}

// ─── GET: Return relay configs ───────────────────────────────────────────────

export async function GET() {
  const configs = await loadConfig();
  return Response.json({ configs });
}

// ─── POST: Manage relay configs ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  switch (action) {
    case "add": {
      const configs = await loadConfig();
      const config: RelayConfig = {
        url: body.url,
        token: body.token || undefined,
        defaultCwd: body.defaultCwd || undefined,
        label: body.label || "VPS",
      };
      configs.push(config);
      await saveConfig(configs);
      return Response.json({ configs });
    }

    case "update": {
      const configs = await loadConfig();
      const idx = body.index;
      if (idx >= 0 && idx < configs.length) {
        configs[idx] = { ...configs[idx], ...body.config };
        await saveConfig(configs);
      }
      return Response.json({ configs });
    }

    case "delete": {
      const configs = await loadConfig();
      configs.splice(body.index, 1);
      await saveConfig(configs);
      return Response.json({ configs });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
