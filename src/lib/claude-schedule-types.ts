/**
 * Shared types for Claude prompt scheduling.
 * Lives in src/lib so route handlers and scheduler library can both import
 * without cycles.
 */

export type RecurrenceKind =
  | { type: "once" }
  | { type: "every"; intervalMinutes: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; weekdays: number[]; hour: number; minute: number };

export type ScheduleAgent = "claude" | "opencode";

export interface Schedule {
  id: string;
  /** Which CLI runs the prompt. Missing means "claude" (pre-OpenCode entries). */
  agent?: ScheduleAgent;
  /** The session this prompt should resume (`claude --resume <sessionId>` or
   *  `opencode run --session <sessionId>`). */
  sessionId: string;
  /** The cwd to spawn the CLI in — typically the session's projectPath. */
  cwd: string;
  /** Optional model to pass via --model on each run (defaults to the user's default).
   *  A Claude alias (`opus`, `fable`…) or an OpenCode `provider/model` id. */
  model?: string;
  /** Optional reasoning effort: Claude `--effort` level or OpenCode `--variant`. */
  effort?: string;
  /** The prompt to deliver. */
  prompt: string;
  /** ISO timestamp of the next scheduled run. */
  nextRunAt: string;
  /** ISO timestamp of the last completed run, if any. */
  lastRunAt?: string;
  /** Last run's status: ok or error. */
  lastStatus?: "ok" | "error";
  /** Last run's stderr / error message, if any. */
  lastError?: string;
  /** Recurrence rule. */
  recurrence: RecurrenceKind;
  /** When false, the scheduler skips this entry without removing it. */
  enabled: boolean;
  /** ISO timestamp the schedule was created. */
  createdAt: string;
  /** Optional user-friendly label. */
  label?: string;
}
