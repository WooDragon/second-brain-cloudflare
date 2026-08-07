/**
 * DOWNSTREAM(cjk): regression coverage for the CJK recall fix.
 *
 * Root cause this guards against: `distillToRareTerms` / `tokenizeQuery` used
 * ASCII-only `\w`-based edge trimming, which stripped every CJK character as
 * "non-word" before it ever reached the embedding model or the keyword arm.
 * A query like "我的 Cloudflare Worker 部署在哪个账号" silently lost all of its
 * Chinese content and the model only ever saw "Cloudflare Worker".
 */
import { describe, it, expect, vi } from "vitest";
import { tokenizeQuery } from "../../src/text/tokenize";
import { distillToRareTerms } from "../../src/recall/distill";
import { chunkText } from "../../src/text/chunk";
import { embed } from "../../src/lib/ai";
import { DEFAULTS } from "../../src/config";

describe("tokenizeQuery — CJK", () => {
  it("produces bigrams for a pure-CJK query", () => {
    expect(tokenizeQuery("部署在哪个账号")).toEqual([
      "部署", "署在", "在哪", "哪个", "个账", "账号",
    ]);
  });

  it("produces the full expected array for a mixed CJK/English query", () => {
    expect(tokenizeQuery("我的 Cloudflare Worker 部署在哪个账号")).toEqual([
      "我的", "cloudflare", "worker", "部署", "署在", "在哪", "哪个", "个账", "账号",
    ]);
  });

  it("keeps English tokens processed exactly as before alongside CJK bigrams", () => {
    const out = tokenizeQuery("release v1.9 版本发布");
    expect(out).toContain("release");
    expect(out).toContain("v1.9");
    expect(out).toContain("版本");
    expect(out).toContain("本发");
    expect(out).toContain("发布");
  });

  describe("single-character CJK fallback", () => {
    it("(a) does NOT surface a lone CJK char when other usable tokens exist", () => {
      const out = tokenizeQuery("云 Cloudflare");
      expect(out).toEqual(["cloudflare"]);
      expect(out).not.toContain("云");
    });

    it("(b) DOES surface a lone CJK char when nothing else survives", () => {
      expect(tokenizeQuery("云")).toEqual(["云"]);
    });
  });

  it("existing ASCII-only behavior is unaffected (no fallback for ASCII singles)", () => {
    expect(tokenizeQuery("what is the")).toEqual([]);
  });
});

describe("distillToRareTerms — preserves CJK", () => {
  it("keeps Chinese content in the distilled query string for a mixed query", async () => {
    // "我的" saturates the corpus (>30%) and is dropped like any saturating
    // English word would be; the remaining 3 terms all fit MAX_QUERY_TERMS.
    const order = ["我的", "cloudflare", "worker", "部署在哪个账号"];
    const df: Record<string, number> = { "我的": 50, "cloudflare": 5, "worker": 5, "部署在哪个账号": 2 };
    const row: Record<string, number> = { total: 100 };
    order.forEach((t, i) => { row[`d${i}`] = df[t]; });
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } } as any;

    const out = await distillToRareTerms("我的 Cloudflare Worker 部署在哪个账号", env);

    // Core regression guard: Chinese must survive into the string that gets
    // embedded, not be stripped to "".
    expect(out.query).toMatch(/[一-鿿]/);
    expect(out.query).toContain("部署在哪个账号");
  });

  it("drops a corpus-saturating Chinese stopword-shaped word like a saturating English one", async () => {
    const order = ["我的", "cloudflare", "worker", "部署在哪个账号"];
    // "我的" saturates (90/100), everything else is rare.
    const df: Record<string, number> = { "我的": 90, "cloudflare": 2, "worker": 2, "部署在哪个账号": 1 };
    const row: Record<string, number> = { total: 100 };
    order.forEach((t, i) => { row[`d${i}`] = df[t]; });
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } } as any;

    const out = await distillToRareTerms("我的 Cloudflare Worker 部署在哪个账号", env);
    expect(out.query).not.toContain("我的");
    expect(out.query).toContain("部署在哪个账号");
  });
});

describe("chunkText — CJK sentence punctuation", () => {
  it("breaks at a CJK full stop rather than hard-cutting mid-character-run", () => {
    const sentence = "这是一句用来测试中文分块逻辑的句子。";
    const text = sentence.repeat(120); // well over CHUNK_MAX_CHARS (1600)
    const [first] = chunkText(text, 1600, 200);
    expect(first.endsWith("。")).toBe(true);
  });
});

describe("embed — asymmetric query/document mode", () => {
  const QWEN_MODEL = "@cf/qwen/qwen3-embedding-0.6b";

  function makeEnv(model: string) {
    const run = vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
    return { env: { AI: { run } } as any, run };
  }

  it("passes { queries: [...] } to env.AI.run for qwen3 in query mode", async () => {
    const { env, run } = makeEnv(QWEN_MODEL);
    const cfg = { ...DEFAULTS, EMBEDDING_MODEL: QWEN_MODEL };

    await embed("hello", env, cfg, "query");

    expect(run).toHaveBeenCalledWith(QWEN_MODEL, { queries: ["hello"] });
  });

  it("passes { documents: [...] } to env.AI.run for qwen3 in document mode (and by default)", async () => {
    const { env, run } = makeEnv(QWEN_MODEL);
    const cfg = { ...DEFAULTS, EMBEDDING_MODEL: QWEN_MODEL };

    await embed("hello", env, cfg, "document");
    await embed("hello2", env, cfg); // default, no mode argument

    expect(run).toHaveBeenNthCalledWith(1, QWEN_MODEL, { documents: ["hello"] });
    expect(run).toHaveBeenNthCalledWith(2, QWEN_MODEL, { documents: ["hello2"] });
  });

  it("falls back to { text: [...] } for a non-qwen3 model regardless of mode", async () => {
    const OTHER_MODEL = "@cf/baai/bge-base-en-v1.5";
    const { env, run } = makeEnv(OTHER_MODEL);
    const cfg = { ...DEFAULTS, EMBEDDING_MODEL: OTHER_MODEL };

    await embed("hello", env, cfg, "query");
    await embed("hello2", env, cfg, "document");

    expect(run).toHaveBeenNthCalledWith(1, OTHER_MODEL, { text: ["hello"] });
    expect(run).toHaveBeenNthCalledWith(2, OTHER_MODEL, { text: ["hello2"] });
  });
});
