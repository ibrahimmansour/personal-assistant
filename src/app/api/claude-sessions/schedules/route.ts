import { NextRequest } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { ensureSchedulerStarted } from "@/lib/claude-scheduler";
import type { Schedule, RecurrenceKind } from "@/lib/claude-schedule-types";

export const dynamic = "force-dynamic";

const SCHEDULES_FILE = join(homedir(), ".personal-assistant", "claude-schedules.json");

interface SchedulesFile {
  version: 1;
  schedules: Schedule[];
}

async function loadSchedules(): Promise<Schedule[]> {
  try {
    const raw = await readFile(SCHEDULES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SchedulesFile;
    if (parsed && Array.isArray(parsed.schedules)) return parsed.schedules;
  } catch {}
  return [];
}

async function saveSchedules(schedules: Schedule[]): Promise<void> {
  await mkdir(dirname(SCHEDULES_FILE), { recursive: true });
  const payload: SchedulesFile = { version: 1, schedules };
  await writeFile(SCHEDULES_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

function validateRecurrence(input: unknown): RecurrenceKind | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (r.type === "once") return { type: "once" };
  if (r.type === "every" && typeof r.intervalMinutes === "number" && r.intervalMinutes >= 1) {
    return { type: "every", intervalMinutes: Math.floor(r.intervalMinutes) };
  }
  if (
    r.type === "daily" &&
    typeof r.hour === "number" &&
    typeof r.minute === "number" &&
    r.hour >= 0 && r.hour <= 23 &&
    r.minute >= 0 && r.minute <= 59
  ) {
    return { type: "daily", hour: Math.floor(r.hour), minute: Math.floor(r.minute) };
  }
  if (
    r.type === "weekly" &&
    Array.isArray(r.weekdays) &&
    typeof r.hour === "number" &&
    typeof r.minute === "number"
  ) {
    const wd = (r.weekdays as unknown[]).filter((d) => typeof d === "number" && d >= 0 && d <= 6).map(Number);
    if (wd.length === 0) return null;
    return { type: "weekly", weekdays: wd, hour: Math.floor(r.hour), minute: Math.floor(r.minute) };
  }
  return null;
}

export async function GET() {
  ensureSchedulerStarted();
  const schedules = await loadSchedules();
  // Sort: enabled+upcoming first by nextRunAt asc, then disabled.
  schedules.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.nextRunAt || "").localeCompare(b.nextRunAt || "");
  });
  return Response.json({ schedules });
}

export async function POST(request: NextRequest) {
  ensureSchedulerStarted();

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

  if (action === "create") {
    const b = body as {
      sessionId?: string;
      cwd?: string;
      model?: string;
      prompt?: string;
      nextRunAt?: string;
      recurrence?: unknown;
      label?: string;
    };
    if (!b.sessionId || !b.cwd || !b.prompt || !b.nextRunAt) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    const recurrence = validateRecurrence(b.recurrence) || { type: "once" };
    const schedule: Schedule = {
      id: randomUUID(),
      sessionId: b.sessionId,
      cwd: b.cwd,
      model: b.model && b.model !== "default" ? b.model : undefined,
      prompt: b.prompt,
      nextRunAt: b.nextRunAt,
      recurrence,
      enabled: true,
      createdAt: new Date().toISOString(),
      label: b.label,
    };
    const schedules = await loadSchedules();
    schedules.push(schedule);
    await saveSchedules(schedules);
    return Response.json({ schedule });
  }

  if (action === "update") {
    const b = body as { id?: string; patch?: Partial<Schedule> };
    if (!b.id || !b.patch) return Response.json({ error: "Missing id or patch" }, { status: 400 });
    const schedules = await loadSchedules();
    const idx = schedules.findIndex((s) => s.id === b.id);
    if (idx === -1) return Response.json({ error: "Not found" }, { status: 404 });
    const merged = { ...schedules[idx], ...b.patch };
    if (b.patch.recurrence !== undefined) {
      const r = validateRecurrence(b.patch.recurrence);
      if (!r) return Response.json({ error: "Invalid recurrence" }, { status: 400 });
      merged.recurrence = r;
    }
    schedules[idx] = merged;
    await saveSchedules(schedules);
    return Response.json({ schedule: merged });
  }

  if (action === "delete") {
    const b = body as { id?: string };
    if (!b.id) return Response.json({ error: "Missing id" }, { status: 400 });
    const schedules = await loadSchedules();
    const next = schedules.filter((s) => s.id !== b.id);
    await saveSchedules(next);
    return Response.json({ ok: true });
  }

  if (action === "run-now") {
    // Manually fire a schedule outside its normal cadence (does NOT advance
    // nextRunAt; that's the scheduler's job). Useful as a 'test' button.
    const b = body as { id?: string };
    if (!b.id) return Response.json({ error: "Missing id" }, { status: 400 });
    const { runScheduleById } = await import("@/lib/claude-scheduler");
    const res = await runScheduleById(b.id);
    return Response.json(res);
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
