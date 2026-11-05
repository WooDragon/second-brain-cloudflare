import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS } from "../constants";

/**
 * Sentence-ending punctuation that can end a chunk. "." and "\n" cover Latin
 * text; the CJK marks are their own full-width equivalents (plus the full stop
 * 。 and the semicolon ；), and without them a Chinese or Japanese note has no
 * candidate boundary at all and degrades to a hard character cut mid-sentence.
 *
 * DOWNSTREAM(cjk): upstream 4.0.1 still breaks on "." and "\n" only. This is
 * the one surviving piece of the 2.x CJK patch — it affects what each embedding
 * covers, not which keywords are searched.
 */
function lastBreak(text: string, end: number): number {
  return Math.max(
    text.lastIndexOf(".", end),
    text.lastIndexOf("\n", end),
    text.lastIndexOf("。", end),
    text.lastIndexOf("！", end),
    text.lastIndexOf("？", end),
    text.lastIndexOf("；", end),
  );
}

export function chunkText(text: string, maxChars = CHUNK_MAX_CHARS, overlapChars = CHUNK_OVERLAP_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;
    if (end < text.length) {
      const breakPoint = lastBreak(text, end);
      if (breakPoint > start + maxChars / 2) end = breakPoint + 1;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)).trim());
    start = end - overlapChars;
  }

  return chunks.filter((c) => c.length > 0);
}
