import { NextRequest } from "next/server";
import {
  getServices,
  loadPrefs,
  savePrefs,
  controlService,
  getServiceLogs,
  probeHealthCheck,
  type ControlAction,
  type HealthCheck,
} from "@/lib/service-monitor";

export const dynamic = "force-dynamic";

/** systemd user units can be controlled without privileges; system units cannot. */
function scopeOf(source: unknown): "user" | "system" {
  return source === "systemd-user" ? "user" : "system";
}

export async function GET(request: NextRequest) {
  const probe = request.nextUrl.searchParams.get("probe") !== "0";
  try {
    const snapshot = await getServices({ probe });
    return Response.json(snapshot);
  } catch (error) {
    console.error("Services API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list services" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "control": {
        const { id, operation, source } = body as {
          id?: string;
          operation?: ControlAction;
          source?: string;
        };
        if (!id || !operation || !["start", "stop", "restart"].includes(operation)) {
          return Response.json({ error: "id and a valid operation are required" }, { status: 400 });
        }
        const result = await controlService(id, operation, scopeOf(source));
        return Response.json(result, { status: result.success ? 200 : 403 });
      }

      case "logs": {
        const { id, source, lines } = body as { id?: string; source?: string; lines?: number };
        if (!id) return Response.json({ error: "id is required" }, { status: 400 });
        const result = await getServiceLogs(id, scopeOf(source), lines ?? 100);
        return Response.json(result);
      }

      case "probe": {
        const { check } = body as { check?: HealthCheck };
        if (!check?.url) return Response.json({ error: "check.url is required" }, { status: 400 });
        return Response.json(await probeHealthCheck(check));
      }

      // ─── Preferences: pins, aliases, hidden entries, health checks ─────────

      case "pin":
      case "unpin": {
        const { id } = body as { id?: string };
        if (!id) return Response.json({ error: "id is required" }, { status: 400 });
        const prefs = await loadPrefs();
        prefs.pinned = action === "pin"
          ? Array.from(new Set([...prefs.pinned, id]))
          : prefs.pinned.filter((p) => p !== id);
        await savePrefs(prefs);
        return Response.json({ success: true, prefs });
      }

      case "hide":
      case "unhide": {
        const { id } = body as { id?: string };
        if (!id) return Response.json({ error: "id is required" }, { status: 400 });
        const prefs = await loadPrefs();
        prefs.hidden = action === "hide"
          ? Array.from(new Set([...prefs.hidden, id]))
          : prefs.hidden.filter((p) => p !== id);
        await savePrefs(prefs);
        return Response.json({ success: true, prefs });
      }

      case "alias": {
        const { id, name } = body as { id?: string; name?: string };
        if (!id) return Response.json({ error: "id is required" }, { status: 400 });
        const prefs = await loadPrefs();
        const trimmed = (name ?? "").trim();
        if (trimmed) prefs.aliases[id] = trimmed.slice(0, 60);
        else delete prefs.aliases[id];
        await savePrefs(prefs);
        return Response.json({ success: true, prefs });
      }

      case "set-check": {
        const { id, check } = body as { id?: string; check?: HealthCheck | null };
        if (!id) return Response.json({ error: "id is required" }, { status: 400 });
        const prefs = await loadPrefs();
        if (check?.url) {
          let url: URL;
          try {
            url = new URL(check.url);
          } catch {
            return Response.json({ error: "check.url must be an absolute URL" }, { status: 400 });
          }
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            return Response.json({ error: "check.url must be http(s)" }, { status: 400 });
          }
          prefs.checks[id] = {
            url: url.toString(),
            expectStatus: check.expectStatus,
            timeoutMs: Math.min(Math.max(check.timeoutMs ?? 4000, 500), 15000),
          };
        } else {
          delete prefs.checks[id];
        }
        await savePrefs(prefs);
        return Response.json({ success: true, prefs });
      }

      case "set-show-system": {
        const { value } = body as { value?: boolean };
        const prefs = await loadPrefs();
        prefs.showSystem = Boolean(value);
        await savePrefs(prefs);
        return Response.json({ success: true, prefs });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
