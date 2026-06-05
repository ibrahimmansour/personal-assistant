/**
 * Claude prompt scheduler.
 *
 * On first import (lazily, once across the Next.js process), starts a
 * one-minute ticker that scans schedules.json for due entries and runs them
 * via `claude --resume <sid> --dangerously-skip-permissions -p <prompt>`.
 *
 * Each completed run advances the schedule's nextRunAt (or, for once-only
 * schedules, disables it) and records last-run status.
 */

import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { readFile, mkdir, writeFile } from "fs/promises";
import type { Schedule, RecurrenceKind } from "@/lib/claude-schedule-types";

const SCHEDULES_FILE = join(homedir(), ".personal-assistant", "claude-schedules.json");

// We can't import the route helpers cleanly because Next.js bundles route
// modules separately. Reimplement load/save here against the same file.
async function load(): Promise<Schedule[]> {
  try {
    const raw = await readFile(SCHEDULES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { schedules?: Schedule[] };
    return Array.isArray(parsed?.schedules) ? parsed.schedules : [];
  } catch {
    return [];
  }
}

async function save(schedules: Schedule[]): Promise<void> {
  await mkdir(join(homedir(), ".personal-assistant"), { recursive: true });
  await writeFile(SCHEDULES_FILE, JSON.stringify({ version: 1, schedules }, null, 2), "utf-8");
}

// ─── nextRunAt computation ───────────────────────────────────────────────────

export function computeNextRunAt(rule: RecurrenceKind, from: Date = new Date()): Date | null {
  switch (rule.type) {
    case "once":
      return null;
    case "every":
      return new Date(from.getTime() + rule.intervalMinutes * 60_000);
    case "daily": {
      const next = new Date(from);
      next.setSeconds(0, 0);
      next.setHours(rule.hour, rule.minute, 0, 0);
      if (next.getTime() <= from.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case "weekly": {
      const next = new Date(from);
      next.setSeconds(0, 0);
      // Try every day for up to 7 days.
      for (let i = 0; i < 8; i++) {
        const cand = new Date(next);
        cand.setDate(next.getDate() + i);
        cand.setHours(rule.hour, rule.minute, 0, 0);
        if (rule.weekdays.includes(cand.getDay()) && cand.getTime() > from.getTime()) {
          return cand;
        }
      }
      return null;
    }
  }
}

// ─── Run one schedule ────────────────────────────────────────────────────────

interface RunResult {
  ok: boolean;
  error?: string;
  stdout?: string;
}

async function runSchedule(s: Schedule): Promise<RunResult> {
  return new Promise((resolve) => {
    const args = ["--dangerously-skip-permissions", "--resume", s.sessionId, "-p"];
    if (s.model) args.unshift("--model", s.model);
    args.push(s.prompt);

    let cwd = s.cwd;
    if (cwd && cwd.startsWith("~")) cwd = join(homedir(), cwd.slice(1));

    const child = spawn("claude", args, {
      cwd,
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 10 * 60_000); // 10-minute hard cap per scheduled run

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({ ok: false, error: err.message });
    });
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve({ ok: true, stdout });
      else resolve({ ok: false, error: stderr || `exit ${code}` });
    });
  });
}

export async function runScheduleById(id: string): Promise<RunResult & { id: string }> {
  const schedules = await load();
  const s = schedules.find((x) => x.id === id);
  if (!s) return { ok: false, error: "not found", id };
  const res = await runSchedule(s);
  // Update last-run fields without advancing the cadence.
  s.lastRunAt = new Date().toISOString();
  s.lastStatus = res.ok ? "ok" : "error";
  s.lastError = res.ok ? undefined : (res.error || "").slice(0, 1000);
  await save(schedules);
  return { ...res, id };
}

// ─── Tick: scan for due schedules ────────────────────────────────────────────

let tickInFlight = false;

async function tick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const schedules = await load();
    const now = Date.now();
    let mutated = false;

    for (const s of schedules) {
      if (!s.enabled) continue;
      if (!s.nextRunAt) continue;
      const dueAt = Date.parse(s.nextRunAt);
      if (!Number.isFinite(dueAt) || dueAt > now) continue;

      // Run it. Don't await all of them serially in lock-step — but a single
      // sequential pass is fine for a one-minute tick.
      try {
        const res = await runSchedule(s);
        s.lastRunAt = new Date().toISOString();
        s.lastStatus = res.ok ? "ok" : "error";
        s.lastError = res.ok ? undefined : (res.error || "").slice(0, 1000);
      } catch (err) {
        s.lastRunAt = new Date().toISOString();
        s.lastStatus = "error";
        s.lastError = err instanceof Error ? err.message : String(err);
      }

      // Advance the schedule. Once-only → disable. Recurring → compute next.
      if (s.recurrence.type === "once") {
        s.enabled = false;
      } else {
        const next = computeNextRunAt(s.recurrence, new Date());
        if (next) s.nextRunAt = next.toISOString();
        else s.enabled = false;
      }
      mutated = true;
    }

    if (mutated) await save(schedules);
  } finally {
    tickInFlight = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;
  // Don't start in build/edge environments.
  if (typeof process === "undefined" || !process.env) return;
  // First fire shortly after start so any overdue schedules don't have to
  // wait a full minute.
  setTimeout(() => { tick().catch(() => {}); }, 5_000);
  timer = setInterval(() => { tick().catch(() => {}); }, 60_000);
  // Best effort cleanup on process exit.
  if (process.on) {
    const stop = () => { if (timer) clearInterval(timer); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }
  // eslint-disable-next-line no-console
  console.log("[claude-scheduler] started");
}
