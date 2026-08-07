import { KEYWORD_MIN_TOKEN_LEN, KEYWORD_STOPWORDS } from "../constants";

// DOWNSTREAM(cjk): CJK character ranges (BMP only) so CJK text is recognized
// instead of being treated as non-word noise by ASCII-only \w. Covers CJK Ext-A,
// CJK Unified, CJK Compat, Hiragana, Katakana, Hangul syllables. Known limitation:
// supplementary-plane CJK (requires the /u flag) is not covered.
const CJK_RANGE = "㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ가-힯";
const CJK_TEST = new RegExp(`[${CJK_RANGE}]`);
const CJK_SEGMENT_SPLIT = new RegExp(`[${CJK_RANGE}]+|[^${CJK_RANGE}]+`, "g");

// DOWNSTREAM(cjk): shared edge-trim — the single source of truth for "what
// counts as a word character" between tokenize.ts and distill.ts. Same shape
// as the original `^[^\w#.]+|[^\w#.]+$` trim, with the CJK ranges added to the
// character class so CJK text is no longer stripped as non-word. Trim-only:
// no [%_] stripping, no toLowerCase — the two callers differ on both and each
// keeps its own behavior on top of this.
const EDGE_TRIM = new RegExp(`^[^\\w#.${CJK_RANGE}]+|[^\\w#.${CJK_RANGE}]+$`, "g");
export function trimNonWord(s: string): string {
  return s.replace(EDGE_TRIM, "");
}

// Split a query into lexical search tokens: lowercase, strip surrounding punctuation,
// drop stopwords / 1-char tokens, and remove SQL LIKE wildcards so each token is a literal
// substring. Identifier-shaped tokens (e.g. "v1.9", "#149") are preserved intact.
//
// DOWNSTREAM(cjk): CJK runs are handled separately from the ASCII path above,
// because \w-based trimming and English stopwords don't apply to CJK text.
// A CJK run of length >= 2 is expanded into sliding-window bigrams (Chinese/
// Japanese/Korean have no whitespace word boundaries, so bigrams are the
// cheapest usable substring unit); a lone CJK character is stashed rather than
// produced directly, because single characters like "的/了/是" are overwhelmingly
// grammatical noise that would make a keyword LIKE clause match almost every
// CJK document. If, after processing the whole query, no other token survived,
// the stashed singles are used as a fallback — this mirrors the existing
// `if (!candidates.length) candidates = uniq;` shape in distill.ts, so a query
// that really is just one meaningful character ("云", "网") still matches.
export function tokenizeQuery(query: string): string[] {
  const produced: string[] = [];
  const singletons: string[] = [];

  for (const rawToken of query.toLowerCase().split(/\s+/)) {
    if (!rawToken) continue;
    for (const seg of rawToken.match(CJK_SEGMENT_SPLIT) ?? []) {
      if (CJK_TEST.test(seg)) {
        if (seg.length >= 2) {
          for (let i = 0; i < seg.length - 1; i++) produced.push(seg.slice(i, i + 2));
        } else {
          singletons.push(seg);
        }
        continue;
      }
      const t = trimNonWord(seg).replace(/[%_]/g, "");
      if (t.length >= KEYWORD_MIN_TOKEN_LEN && !KEYWORD_STOPWORDS.has(t)) produced.push(t);
    }
  }

  return [...new Set(produced.length ? produced : singletons)];
}
