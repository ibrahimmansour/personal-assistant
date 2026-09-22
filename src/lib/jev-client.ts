/**
 * Jev (TypeSafe System One) client.
 *
 * Jev does not write text. It evaluates a `state` against typed questions —
 * Choice (one of a set), Score (position on an ordered rubric), Noul (yes/no
 * probability) — and returns calibrated answers code can branch on. It runs
 * alongside the chat model: Jev decides, Claude/Ollama writes.
 *
 * Every helper here degrades to `null` when Jev is unconfigured, offline, or
 * rate-limited, so callers keep a code-only or LLM fallback path and never
 * hard-fail on the judgment layer.
 *
 * Key: `typesafe.apiKey` in config.json, else the TYPESAFE_API_KEY env var.
 */

import { TypeSafeClient, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";
import { getConfig } from "@/lib/config";

export { choice, score, noul } from "@typesafe-ai/sdk";

const DEFAULT_TIMEOUT_MS = 8_000;

let clientCache: { key: string; client: TypeSafeClient } | null = null;

async function resolveKey(): Promise<string> {
  const config = await getConfig();
  return config.typesafe.apiKey || process.env.TYPESAFE_API_KEY || "";
}

export async function isJevConfigured(): Promise<boolean> {
  return !!(await resolveKey());
}

async function getClient(): Promise<TypeSafeClient | null> {
  const key = await resolveKey();
  if (!key) return null;
  if (clientCache?.key === key) return clientCache.client;
  const client = new TypeSafeClient({ apiKey: key, timeout: DEFAULT_TIMEOUT_MS, retry: { maxRetries: 1 } });
  clientCache = { key, client };
  return client;
}

export type JevState = Parameters<TypeSafeClient["systemOne"]>[0]["state"];

export interface JevOptions {
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Ask Jev a set of independent questions over one state. All questions run
 * in parallel server-side. Returns `null` (never throws) when Jev is
 * unavailable, so the caller falls back.
 */
export async function jevAsk<const Q extends Questions>(
  state: JevState,
  questions: Q,
  options: JevOptions = {},
): Promise<SystemOneResult<Q> | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    return await client.systemOne({ state, questions }, { signal: options.signal, timeout: options.timeout });
  } catch (err) {
    if (options.signal?.aborted) return null;
    console.warn("[jev] request failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Run a list of items through Jev in fixed-size chunks, one request per
 * chunk, with bounded concurrency. `build(chunk)` returns the state and
 * questions for that chunk; `collect(result, chunk)` folds answers into the
 * output. Any failed chunk is skipped (its items get no judgment).
 */
export async function jevBatched<T, Q extends Questions>(
  items: T[],
  chunkSize: number,
  build: (chunk: T[], offset: number) => { state: JevState; questions: Q },
  collect: (result: SystemOneResult<Q>, chunk: T[], offset: number) => void,
  options: JevOptions & { concurrency?: number } = {},
): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;
  const concurrency = options.concurrency ?? 4;
  const chunks: { chunk: T[]; offset: number }[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push({ chunk: items.slice(i, i + chunkSize), offset: i });
  }
  let next = 0;
  let anyOk = false;
  const worker = async () => {
    while (next < chunks.length) {
      const { chunk, offset } = chunks[next++];
      const { state, questions } = build(chunk, offset);
      try {
        const result = await client.systemOne({ state, questions }, { signal: options.signal, timeout: options.timeout });
        collect(result, chunk, offset);
        anyOk = true;
      } catch (err) {
        if (options.signal?.aborted) return;
        console.warn("[jev] chunk failed:", err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return anyOk;
}

/** Map a 0..(n-1) expected score onto a coarse label the UI can render. */
export function confidenceBand(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}
