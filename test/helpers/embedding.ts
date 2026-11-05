/**
 * Shared shape of an embedding call, for test doubles.
 *
 * Workers AI takes two different request bodies for embedding: the symmetric
 * bge models read a plain `text` array, and the asymmetric ones (qwen3-
 * embedding) name the retrieval role with `queries` / `documents`. A test
 * double that dispatches on the model string alone, or that only reads
 * `input.text`, silently classifies the shipped model as a chat completion and
 * hands the caller `undefined` instead of a vector.
 *
 * Keep this next to make-env.ts rather than in each test: the two helpers below
 * are the only places that need to know either detail.
 */
import { EMBEDDING_VECTOR_DIM } from "../../src/constants";

/** Model families whose AI.run call is an embedding rather than a chat completion. */
export function isEmbeddingCall(model: string): boolean {
  return model.startsWith("@cf/baai/bge") || model.startsWith("@cf/qwen/qwen3-embedding");
}

/** The texts an embedding call carries, whichever body shape the model uses. */
export function embeddedTexts(
  input?: { text?: string | string[]; queries?: string[]; documents?: string[] },
): string[] {
  const texts = input?.queries ?? input?.documents ?? input?.text;
  return Array.isArray(texts) ? texts : texts === undefined ? [] : [texts];
}

/** One placeholder vector at the shipped model's dimension. */
export function embeddingVector(): number[] {
  return new Array(EMBEDDING_VECTOR_DIM).fill(0.1);
}
