/**
 * Ollama AI client for local LLM inference.
 *
 * Connects to Ollama running on localhost:11434.
 * Supports both streaming and non-streaming chat completions.
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/**
 * Non-streaming chat completion. Returns the full response at once.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; num_predict?: number }
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.3,
        num_predict: options?.num_predict ?? 1024,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data: OllamaChatResponse = await res.json();
  return data.message.content;
}

/**
 * Streaming chat completion. Returns a ReadableStream of text chunks.
 */
export function chatCompletionStream(
  messages: ChatMessage[],
  options?: { temperature?: number; num_predict?: number }
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages,
            stream: true,
            options: {
              temperature: options?.temperature ?? 0.3,
              num_predict: options?.num_predict ?? 1024,
            },
          }),
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ error: `Ollama error ${res.status}: ${text}` }) + "\n"
            )
          );
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed: OllamaChatResponse = JSON.parse(line);
              if (parsed.message?.content) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ token: parsed.message.content }) + "\n"
                  )
                );
              }
              if (parsed.done) {
                controller.enqueue(
                  encoder.encode(JSON.stringify({ done: true }) + "\n")
                );
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }

        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Unknown error",
            }) + "\n"
          )
        );
        controller.close();
      }
    },
  });
}

/**
 * Check if Ollama is reachable.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
