/**
 * Claude text completions for one-shot tasks (file summaries, extraction).
 *
 * Two transports, chosen automatically:
 *  - ANTHROPIC_API_KEY set → the Messages API directly via fetch.
 *  - otherwise → the Claude Code CLI on the user's subscription
 *    (claude-cli-client.ts), the same login the Claude Code widget uses.
 *
 * Default API model: claude-haiku-4-5 (fast + cheap, plenty for the file
 * explorer's small extraction/summarization tasks). The CLI path uses the
 * model chosen in Settings → AI.
 */

import { claudeCliStatus, completeClaudeCli, ClaudeCliError } from "@/lib/claude-cli-client";
import { getAiSelection } from "@/lib/ai-provider";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicModel =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-5"
  | "claude-opus-4-5";

export const DEFAULT_MODEL: AnthropicModel =
  (process.env.ANTHROPIC_MODEL as AnthropicModel) || "claude-haiku-4-5";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: { type: "text"; text: string }[];
  model: string;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
  }
}

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AnthropicError(
      "ANTHROPIC_API_KEY not set in .env.local",
      500
    );
  }
  return key;
}

/** True when either transport can serve a request. */
export async function isAnthropicConfigured(): Promise<boolean> {
  if (process.env.ANTHROPIC_API_KEY) return true;
  return (await claudeCliStatus()).available;
}

interface CompletionOptions {
  system?: string;
  model?: AnthropicModel;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Non-streaming completion. Returns the full assistant text.
 */
export async function complete(
  messages: AnthropicMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return completeViaCli(messages, options);
  const apiKey = getApiKey();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.2,
      system: options.system,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AnthropicError(
      `Anthropic API error ${res.status}: ${text.slice(0, 300)}`,
      res.status
    );
  }

  const data: AnthropicResponse = await res.json();
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Subscription path: render the turns into one prompt for `claude -p`.
 * Errors surface as AnthropicError so callers keep one catch.
 */
async function completeViaCli(
  messages: AnthropicMessage[],
  options: CompletionOptions
): Promise<string> {
  const prompt = messages.length === 1
    ? messages[0].content
    : messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  const selection = await getAiSelection();
  try {
    return await completeClaudeCli({
      system: options.system || "You are a helpful assistant.",
      prompt,
      model: selection.claudeModel,
      effort: selection.claudeEffort,
    });
  } catch (err) {
    if (err instanceof ClaudeCliError) throw new AnthropicError(err.message, err.status);
    throw err;
  }
}

/**
 * Convenience: send a single user prompt with a system prompt.
 */
export function completeSingle(
  prompt: string,
  options: CompletionOptions = {}
): Promise<string> {
  return complete([{ role: "user", content: prompt }], options);
}

/**
 * Try to extract JSON from a Claude response. Handles three common shapes:
 *  - Plain JSON object/array at the start
 *  - Wrapped in a ```json ... ``` fence
 *  - JSON embedded in prose (extracts the first balanced { ... } or [ ... ])
 */
export function extractJson<T = unknown>(text: string): T | null {
  const trimmed = text.trim();

  // Strip ```json fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Try direct parse
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // fall through
  }

  // Find first balanced object or array
  const startIdx = candidate.search(/[{[]/);
  if (startIdx === -1) return null;
  const opener = candidate[startIdx];
  const closer = opener === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(startIdx, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
