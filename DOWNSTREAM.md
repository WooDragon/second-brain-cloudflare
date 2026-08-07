# Downstream Fork Notes

This is a personal fork of [rahilp/second-brain-cloudflare](https://github.com/rahilp/second-brain-cloudflare).
It is **not** intended to be pushed upstream — this file is the single source
of truth for what has diverged and why.

## Branch layout

- `main` — pure mirror of upstream. Never receives local commits.
- `downstream` — all local patches live here. **Never merged back into `main`.**

Upstream baseline: commit `014a99e` ("Sign Windows builds through SignPath").

## Why this file exists

Every inline patch below is tagged with a `DOWNSTREAM(...)` comment at the
point of change, so a rebase conflict resolver can find it without reading
this file first. Run:

```
grep -rn "DOWNSTREAM(" src test public
```

to enumerate every inline marker. This document is the narrative companion —
it explains *why* each patch exists, which the inline comments only summarize.

## Divergence log

### 1. OAuth provider upgrade — `package.json`, `package-lock.json`

`@cloudflare/workers-oauth-provider` `^0.8.2` → `^0.10.2`.

**Why**: 0.8.2's `WWW-Authenticate` header on an unauthenticated request
carries `error="invalid_token"`, which violates RFC 6750 §3.1 (that error
code is reserved for a *rejected* credential, not the total absence of one).
Strict MCP clients see the malformed header, silently abandon the flow after
dynamic client registration, and never show an authorization prompt.

0.9.0 fixed the bare-challenge case (upstream PR 252), but 0.9.x's PR 256
also introduced strict RFC 8707 `resource` parameter validation, which
returns `invalid_target` and breaks DCR for clients that don't send that
parameter. 0.10.1 (PR 288) relaxed that back to 0.8.2-compatible behavior
while keeping the RFC 6750 fix. `^0.10.2` is therefore the first version
range that has both fixes without the regression.

Verified live: unauthenticated request now gets a bare challenge, and an
invalid token is still correctly flagged `invalid_token`.

Covered by `test/unit/oauth-provider-construction.test.ts` (new).

### 2. Embedding model swap — `src/constants.ts`, `src/config.ts`

`@cf/baai/bge-small-en-v1.5` (384-dim) → `@cf/qwen/qwen3-embedding-0.6b`
(1024-dim). New `EMBEDDING_DIMS` constant added alongside `EMBEDDING_MODEL`.

**Why**: the previous model has weak multilingual/CJK embedding quality.
qwen3-embedding-0.6b was confirmed via a direct Workers AI API call to
return `shape=[1,1024]`.

### 3. CJK recall — four source files

The embedding model swap alone does not fix CJK recall; the query-processing
pipeline was ASCII-only and threw Chinese text away before it ever reached
the model. Four files needed changes:

- **`src/text/tokenize.ts`** — CJK-aware tokenization: CJK runs are split
  into sliding-window bigrams (CJK has no whitespace word boundaries), with
  single-character fallback when no other token survives.
- **`src/recall/distill.ts`** — reuses the shared `trimNonWord` edge-trim
  from `tokenize.ts` instead of its own ASCII-only `\w`-based regex.
  **Root cause this fixes**: `distillToRareTerms` rewrites the query string
  *before* it is handed to `embed()`. Its old normalization regex was
  ASCII-only, so any CJK word was stripped down to an empty string before
  the embedding call ever saw it — Chinese queries were losing their content
  at the distillation step, not at the model.
- **`src/text/chunk.ts`** — recognizes CJK sentence punctuation (`。！？；`)
  as chunk soft-boundaries, alongside the existing `.` and `\n`.
- **`src/lib/ai.ts`** — see item 4 below (asymmetric embedding mode); needed
  because qwen3 requires a query/document mode signal.

### 4. Asymmetric query/document embedding — `src/lib/ai.ts`

qwen3-embedding models produce different (and better-matching) vectors
depending on whether the input is a search query or a document being
indexed. `embed()` gained a `mode: "query" | "document"` parameter,
**defaulting to `"document"`** so all 5 existing write-side call sites
(`storeEntry` x3, `duplicate.ts`, `graph/pass.ts`) need zero changes. Only
`src/recall/search.ts` passes `"query"` explicitly, since it's the sole
read-side/search call site.

### 5. `public/utils.js` — index-repair command dimension

The self-service "fix your Vectorize index" command shown to users in the
health banner had the dimension hardcoded to `384`. Left unchanged, it would
walk a user into recreating an index with the wrong dimension for the new
model. Updated to `1024`, pinned to `EMBEDDING_DIMS` by
`test/ui/utils.test.ts` (see rebase note below — this file can't import the
TS constant directly).

### 6. Tests

- New: `test/unit/cjk-recall.test.ts`, `test/unit/oauth-provider-construction.test.ts`.
- 12 existing test files had hardcoded model names / dimension literals
  updated to reference the shared constants instead (the model swap broke
  89 test cases in one pass before this change; hardcoding the value in
  multiple places is exactly the failure mode this file exists to prevent).

## Rebase checklist

When rebasing `downstream` onto a newer upstream commit, re-check these
coupling points — they are not enforced by the type system, only by tests:

1. **`EMBEDDING_MODEL` has two write points.** `src/constants.ts` and
   `src/config.ts`'s `DEFAULTS.EMBEDDING_MODEL` must be changed together.
   `test/unit/config-parity.test.ts` asserts they are equal and will fail
   loudly if they drift.
2. **`EMBEDDING_DIMS` must change in lockstep with `EMBEDDING_MODEL`.** A
   Vectorize index's dimension is fixed at creation time and cannot be
   altered — swapping models means creating a *new* index, not editing the
   existing one in place.
3. **`public/utils.js`'s dimension is a literal, not an import.** It's
   plain browser JS served outside the TS build, so it can't share
   `EMBEDDING_DIMS` across that boundary. It is pinned only by the assertion
   in `test/ui/utils.test.ts` — if that test is deleted or weakened, this
   file silently drifts.
4. **`wrangler.personal.jsonc` is a full config copy, not a patch.**
   `wrangler -c` replaces the entire config wholesale; it does not merge
   with `wrangler.jsonc`. If upstream changes `wrangler.jsonc`, the
   corresponding fields in `wrangler.personal.jsonc` must be updated by
   hand — there is no diff/merge tooling for this.
5. **`src/capture/duplicate.ts` must keep calling `embed()` in `"document"`
   mode** (i.e. don't pass `"query"`). It compares a new entry's embedding
   against already-indexed entries — a document-to-document comparison. If
   either side is embedded in `"query"` mode, the asymmetric model produces
   systematically skewed similarity scores and `DUPLICATE_BLOCK_THRESHOLD`
   stops meaning what its name says.

## Local-only files (gitignored, not in this repo)

Two files exist on disk locally but are covered by `.gitignore`
(`wrangler.*.jsonc`, `deploy-personal.sh`) and are never committed. This
section records what they hold and where to find them — **not** their
contents, since real resource IDs must never land in this public repo:

- **`wrangler.personal.jsonc`** — the real per-environment Wrangler config:
  actual D1 `database_id`, KV namespace id, the 1024-dim Vectorize index
  name, `workers_dev: false`.
- **`deploy-personal.sh`** — the actual deploy entrypoint. Wraps
  `wrangler deploy -c wrangler.personal.jsonc`, and records a D1
  time-travel bookmark plus the current Worker version as a rollback anchor
  before deploying.

## Deployment

Do **not** run the bare `npm run deploy` (`wrangler deploy`) — it deploys
against `wrangler.jsonc`, the ID-free shared config, and
`scripts/predeploy-guard.mjs` will refuse to run once it detects a
`wrangler.*.jsonc` override file present on disk. Deploy via:

```
sh deploy-personal.sh
```
