/**
 * Anthropic API client for Claude.
 *
 * Reads ANTHROPIC_API_KEY from .env.local. Uses Messages API directly via
 * fetch (no SDK dependency). Supports both buffered and streaming responses.
 *
 * Default model: claude-haiku-4-5 (fast + cheap, plenty for the file
 * explorer's small extraction/summarization tasks).
 */

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

export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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
