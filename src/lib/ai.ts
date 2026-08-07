import type { Env } from "../env";
import { DEFAULTS, type Config } from "../config";
import { EMBEDDING_MODEL } from "../constants";

export function graceMs(env: Env): number {
  return parseInt(env.VECTORIZE_GRACE_MS ?? "300000", 10) || 300000;
}

export async function readStreamText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.decode(value).split("\n").forEach(line => {
      if (line.startsWith("data: ") && !line.includes("[DONE]")) {
        try { const d = JSON.parse(line.slice(6)); if (d.response) text += d.response; } catch { }
      }
    });
  }
  reader.releaseLock();
  return text;
}

// DOWNSTREAM(model): qwen3-embedding models are asymmetric — they produce
// different (and better-matching) vectors when told whether the input is a
// search query or a document to be indexed. Narrow prefix match so any other
// model keeps the old `{ text: [text] }` shape untouched.
const QUERY_DOCUMENT_MODEL_PREFIX = "@cf/qwen/qwen3-embedding";

export async function embed(
  text: string,
  env: Env,
  config: Readonly<Config> = DEFAULTS,
  // DOWNSTREAM(model): default is "document" on purpose — every write-side call
  // site (storeEntry x3, duplicate.ts, graph/pass.ts) needs zero changes and
  // silently keeps embedding as a document. Only the recall query path passes
  // "query" explicitly. duplicate.ts in particular compares document against
  // document (new entry vs. indexed entries), so both sides of that comparison
  // must stay in the same mode or the asymmetric model skews similarity and
  // DUPLICATE_BLOCK_THRESHOLD stops meaning what it says.
  mode: "query" | "document" = "document",
): Promise<number[]> {
  const input = config.EMBEDDING_MODEL.startsWith(QUERY_DOCUMENT_MODEL_PREFIX)
    ? (mode === "query" ? { queries: [text] } : { documents: [text] })
    : { text: [text] };
  // Workers AI requires `as any` here — the SDK types don't cover all models
  const result = (await env.AI.run(config.EMBEDDING_MODEL as any, input as any)) as any;
  return result.data[0] as number[];
}
