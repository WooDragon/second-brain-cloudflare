import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS } from "../constants";

export function chunkText(text: string, maxChars = CHUNK_MAX_CHARS, overlapChars = CHUNK_OVERLAP_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      // DOWNSTREAM(cjk): CJK sentence-ending punctuation as additional break
      // candidates — "." and "\n" alone give CJK text no soft boundary and it
      // degrades to a hard character cut.
      const lastCjkStop = Math.max(
        text.lastIndexOf("。", end),
        text.lastIndexOf("！", end),
        text.lastIndexOf("？", end),
        text.lastIndexOf("；", end),
      );
      const breakPoint = Math.max(lastPeriod, lastNewline, lastCjkStop);
      if (breakPoint > start + maxChars / 2) end = breakPoint + 1;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)).trim());
    start = end - overlapChars;
  }

  return chunks.filter((c) => c.length > 0);
}
