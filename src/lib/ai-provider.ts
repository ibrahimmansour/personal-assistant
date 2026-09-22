/**
 * Chat provider resolution for the AI assistant.
 *
 * Two engines can write the assistant's replies:
 *  - "claude": the Claude Code CLI on the user's subscription (see
 *    claude-cli-client.ts) — the default.
 *  - "ollama": a local model over HTTP (see ai-client.ts).
 *
 * The chosen provider and Claude model/effort live in config.json under `ai`.
 * A request may override them per call (the chat panel's pickers do).
 */

import { getConfig, saveConfig } from "@/lib/config";
import {
  claudeCliStatus,
  streamClaudeCli,
  isClaudeModel,
  isClaudeEffort,
  CLAUDE_MODELS,
  CLAUDE_EFFORTS,
} from "@/lib/claude-cli-client";
import { chatCompletionStream, isOllamaAvailable, type ChatMessage } from "@/lib/ai-client";
import { isJevConfigured } from "@/lib/jev-client";

export type AiProvider = "claude" | "ollama";

export interface AiSelection {
  provider: AiProvider;
  claudeModel: string;
  claudeEffort: string;
}

export interface AiStatus extends AiSelection {
  /** Whether the *selected* provider can answer right now. */
  available: boolean;
  /** Short label for the header, e.g. "Claude · sonnet" or "gemma3:4b · local". */
  label: string;
  /** Why the selected provider is unavailable. */
  reason?: string;
  providers: {
    claude: { available: boolean; reason?: string; models: typeof CLAUDE_MODELS; efforts: typeof CLAUDE_EFFORTS };
    ollama: { available: boolean; model: string; url: string };
  };
  /** Whether Jev (TypeSafe) is configured — drives routing/triage features. */
  jev: boolean;
}

function isProvider(v: unknown): v is AiProvider {
  return v === "claude" || v === "ollama";
}

export async function getAiSelection(): Promise<AiSelection> {
  const config = await getConfig();
  return {
    provider: isProvider(config.ai.provider) ? config.ai.provider : "claude",
    claudeModel: isClaudeModel(config.ai.claudeModel) ? config.ai.claudeModel : "default",
    claudeEffort: isClaudeEffort(config.ai.claudeEffort) ? config.ai.claudeEffort : "low",
  };
}

/** Merge per-request overrides (validated) onto the saved selection. */
export function applyOverrides(base: AiSelection, overrides: Partial<Record<keyof AiSelection, unknown>>): AiSelection {
  return {
    provider: isProvider(overrides.provider) ? overrides.provider : base.provider,
    claudeModel: isClaudeModel(overrides.claudeModel) ? overrides.claudeModel : base.claudeModel,
    claudeEffort: isClaudeEffort(overrides.claudeEffort) ? overrides.claudeEffort : base.claudeEffort,
  };
}

export async function saveAiSelection(patch: Partial<Record<keyof AiSelection, unknown>>): Promise<AiSelection> {
  const config = await getConfig();
  const next = applyOverrides(await getAiSelection(), patch);
  config.ai = { ...config.ai, ...next };
  await saveConfig(config);
  return next;
}

export async function getAiStatus(): Promise<AiStatus> {
  const [selection, config, claude, ollamaUp, jev] = await Promise.all([
    getAiSelection(),
    getConfig(),
    claudeCliStatus(),
    isOllamaAvailable(),
    isJevConfigured(),
  ]);
  const ollamaModel = process.env.OLLAMA_MODEL || config.ollama.model || "gemma3:4b";
  const providers: AiStatus["providers"] = {
    claude: { available: claude.available, reason: claude.reason, models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS },
    ollama: { available: ollamaUp, model: ollamaModel, url: process.env.OLLAMA_URL || config.ollama.url },
  };
  const available = selection.provider === "claude" ? claude.available : ollamaUp;
  const label = selection.provider === "claude"
    ? `Claude · ${selection.claudeModel === "default" ? "default" : selection.claudeModel}`
    : `${ollamaModel} · local`;
  const reason = available
    ? undefined
    : selection.provider === "claude"
      ? claude.reason
      : "Ollama is not running. Start it with: ollama serve";
  return { ...selection, available, label, reason, providers, jev };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Render a multi-turn history into one prompt for `claude -p`, which takes a
 * single user message. The history is quoted verbatim so the model can refer
 * back to it; only the last user message is the live question.
 */
function renderTranscript(history: ChatTurn[]): string {
  if (history.length === 1) return history[0].content;
  const prior = history.slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  const last = history[history.length - 1];
  return `Earlier in this conversation:\n\n${prior}\n\n---\n\nUser: ${last.content}`;
}

/**
 * Stream a reply from the selected provider. Both providers emit the same
 * NDJSON `{token}` / `{done}` / `{error}` lines.
 */
export function streamChat(
  selection: AiSelection,
  system: string,
  history: ChatTurn[],
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  if (selection.provider === "claude") {
    return streamClaudeCli({
      system,
      prompt: renderTranscript(history),
      model: selection.claudeModel,
      effort: selection.claudeEffort,
      signal,
    });
  }
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  return chatCompletionStream(messages, { temperature: 0.3, num_predict: 800 });
}
