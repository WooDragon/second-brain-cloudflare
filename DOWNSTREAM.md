# Downstream Fork Notes

This is a personal fork of [rahilp/second-brain-cloudflare](https://github.com/rahilp/second-brain-cloudflare).
It is **not** intended to be pushed upstream — this file is the single source of
truth for what has diverged and why.

## Branch layout

- `main` — pure mirror of upstream. Never receives local commits.
- `downstream` — the **frozen 2.x line**: `main`(014a99e) + the two original
  patches, kept only as history. Do not add to it or rebase it.
- `downstream-v4` — the current line. It branched from `upstream/main` 228cea49
  (release 4.0.1, 2026-10-13) and holds only what survived the review below.

Upstream baseline for this line: commit `228cea49` — "Merge pull request #392
from rahilp/fix/read-scope-membership-390".

## Why this file exists

Every surviving inline patch is tagged with a `DOWNSTREAM(...)` comment at the
point of change, so a rebase conflict resolver can find it without reading this
file first:

```
grep -rn "DOWNSTREAM(" src test public
```

This document is the narrative companion — it explains *why* each patch exists,
which the inline comments only summarize.

## Divergence log — what the v4 rebase kept and what it dropped

The 2.x line carried three independent requirements, spread over two commits.
Each requirement was re-checked against 4.0.1 before its patch was re-applied.

### 1. OAuth provider upgrade — KEPT

`@cloudflare/workers-oauth-provider` `^0.8.2` → `^0.10.2`
(`package.json`, `package-lock.json`; resolves to 0.10.4 today).

Upstream 4.0.1 still pins `^0.8.2` (`package.json`, dependency block), so this
is not something upstream fixed.

**Why**: 0.8.2's `WWW-Authenticate` header on an unauthenticated request carries
`error="invalid_token"`, which violates RFC 6750 §3.1 (that error code is
reserved for a *rejected* credential, not the total absence of one). Strict MCP
clients see the malformed header, silently abandon the flow after dynamic client
registration, and never show an authorization prompt.

0.9.0 fixed the bare-challenge case. That release also introduced strict
RFC 8707 `resource` parameter validation, which returns `invalid_target` and
breaks DCR for clients that do not send that parameter. 0.10.1 relaxed that
validation back to 0.8.2-compatible behavior while keeping the RFC 6750 fix.
`^0.10.2` is therefore the first range with both fixes.

Checked against the resolved 0.10.4 dist (the package ships no changelog):
`dist/oauth-provider.js:2660-2663` builds the challenge for a missing token with
**no** error code, while a rejected token still gets `invalid_token`, and
`invalid_target` survives only on the external-managed-auth and subject-token
paths — not on DCR or authorize.

Covered by `test/unit/oauth-provider-construction.test.ts`: 0.9+ validates the
provider config at construction time, and `src/index.ts:55` constructs it at
module scope, so a regression there would take every route down at load.

### 2. Embedding model swap — KEPT, re-expressed for 4.x

`@cf/baai/bge-small-en-v1.5` (384-dim, English-only) →
`@cf/qwen/qwen3-embedding-0.6b` (1024-dim).

Upstream 4.0.1 still ships bge-small (`src/constants.ts:62`,
`src/config.ts:105`) with `EMBEDDING_DIM: 384` (`src/config.ts:198`), so this is
still ours alone. The motivation is unchanged: this brain is used in Chinese as
much as English, and the dense arm is the half the keyword arm cannot cover.

Three ways this differs from the 2.x patch, because 4.x changed the ground:

- **4.x already has an `EMBEDDING_DIM` config key** (`src/config.ts`, validated
  in `RULES`). The 2.x patch's own `EMBEDDING_DIMS` constant would have been a
  third name for the same number, so it was dropped. The single literal now
  lives in `src/constants.ts` as `EMBEDDING_VECTOR_DIM`, `DEFAULTS.EMBEDDING_DIM`
  imports it, and `VECTORIZE_FIX_HINT` interpolates it.
  It cannot be called `EMBEDDING_DIM`: `test/unit/config-threading-complete.test.ts`
  forbids any src file outside `config.ts` from reading a config-key name at
  module scope, and the hint is module scope.
- **4.x batches every embedding** (`embedMany`). The mode parameter therefore
  lives on `embedMany`, and `embed` is a single-text wrapper that forwards it.
- **4.x has a migration subsystem** (`src/migration/embedding.ts`,
  `src/routes/migration.ts`), which is what makes a dimension change practical —
  see Migration below.

### 3. Asymmetric query/document embedding — KEPT

qwen3-embedding models produce different (and better-matching) vectors depending
on whether the input is a search query or a document being indexed. `embed` /
`embedMany` in `src/lib/ai.ts` gained `mode: "query" | "document"`,
**defaulting to `"document"`** so every write-side call site
(`src/capture/store.ts` x4, `src/capture/duplicate.ts`, `src/graph/pass.ts`,
the standing cache) needs no change. Only `src/recall/search.ts` passes
`"query"` — both of its embed calls, including the standing-cache one.

`src/recall/diagnostics.ts` counts embedding calls by inspecting the request
body; it now accepts all three body shapes, or an asymmetric model would report
`embeddingCalls: 0`.

### 4. CJK recall — DROPPED (upstream fixed it)

The 2.x patch changed `src/text/tokenize.ts`, `src/recall/distill.ts` and
`src/text/chunk.ts` to stop discarding Chinese text. Upstream 4.x implemented
its own answer in issue #326; the line numbers cited here are those of 4.0.1:

- `src/text/tokenize.ts:12-20` splits on `CJK_RUN` (Han/Hiragana/Katakana/
  Hangul/Bopomofo plus CJK punctuation) and segments each run with
  `Intl.Segmenter`, instead of the 2.x sliding-window bigrams.
- `src/text/tokenize.ts:72-74` drops `CJK_STOPWORDS`, and keeps a lone ideograph
  as a fallback rather than a produced token — the same problem the 2.x
  "stash singletons" branch solved, solved with a stopword list instead.
- `src/recall/distill.ts:426-434` no longer normalizes words with an ASCII-only
  `\w` regex at all: it judges each word with `tokenizeQuery`, which is where the
  2.x patch's `trimNonWord` fix lived. The root cause is gone by construction.
- Upstream's own acceptance: `test/integration/cjk-recall.test.ts` with
  `test/fixtures/cjk-recall.ts` (Japanese, mixed CJK/ASCII, full-width forms,
  identifier queries), plus the `CJK_STOPWORDS` handling above.

The 2.x `test/unit/cjk-recall.test.ts` was therefore dropped too: it asserted
bigram output from a tokenizer that no longer exists, and upstream's integration
test covers the same ground on real SQLite.

### 5. CJK chunk boundaries — KEPT (upstream does not cover this)

`src/text/chunk.ts:12-15` at 4.0.1 still breaks only on `.` and `\n`, so a
Chinese or Japanese note over `CHUNK_MAX_CHARS` has no candidate boundary and
degrades to a hard character cut mid-sentence. `lastBreak()` now also considers
`。！？；`. The half-budget rule is unchanged, so a mark before the halfway point
does not shrink a chunk.

This is the only surviving piece of the old CJK patch, and it is about
**chunking**, not tokenization: it affects what each embedding covers, not which
keywords are searched.

### 6. `public/utils.js` — index-repair command dimension — KEPT

The banner's self-service `wrangler vectorize create ... --dimensions=` literal
moved 384 → 1024. Left stale, it walks a user into recreating the index at the
wrong dimension, which Vectorize cannot fix afterwards.

This file is plain browser JS served outside the TS build, so it cannot import
`EMBEDDING_VECTOR_DIM`. The literal is pinned by `test/ui/utils.test.ts`,
which asserts the banner command against the real constant.

## Rebase checklist

Re-check these coupling points when rebasing onto a newer upstream commit — they
are not enforced by the type system, only by tests:

1. **`EMBEDDING_MODEL` has two write points.** `src/constants.ts` and
   `DEFAULTS.EMBEDDING_MODEL` in `src/config.ts` must change together;
   `test/unit/config-parity.test.ts` asserts they are equal.
2. **The dimension has one write point.** `src/constants.ts`
   `EMBEDDING_VECTOR_DIM`; `DEFAULTS.EMBEDDING_DIM` imports it. A Vectorize
   index fixes its dimension at creation, so a model swap means a **new** index
   and a full re-embed — never an edit in place.
3. **`public/utils.js`'s dimension is a literal, not an import** (plain browser
   JS). It is pinned only by `test/ui/utils.test.ts`; if that assertion is
   deleted or weakened, this file silently drifts.
4. **`src/capture/duplicate.ts` must keep embedding in `"document"` mode.**
   It compares a new entry against already-indexed entries — document to
   document. If either side were embedded as `"query"`, the asymmetric model
   would skew similarity and `DUPLICATE_BLOCK_THRESHOLD` would stop meaning
   what its name says.
5. **The eval harness is pinned to the model its committed assets were recorded
   under.** `test/eval/corpora.ts` exports `CORE_CORPUS_EMBEDDING_MODEL`
   (`bge-small-en-v1.5`), and the baseline/lock/calibration/smoke tests use it
   instead of `DEFAULTS.EMBEDDING_MODEL`. Those baselines are immutable history:
   a run that reads them must ask for the model they were recorded with, and the
   eval replay never records qwen vectors.
6. **Test doubles must not dispatch on a hardcoded model string.** Use
   `test/helpers/embedding.ts`: `isEmbeddingCall(model)`, `embeddedTexts(input)`
   (reads `text` / `queries` / `documents`), and `embeddingVector()`. A
   `model === "@cf/baai/bge-small-en-v1.5"` check or a bare `input.text` read
   misclassifies the shipped model as a chat completion and returns no vector.
   `embedBatchSize(model)` (exported from `src/lib/ai.ts`) is the batch size a
   subrequest budget test must divide by: 100 for bge-en, 25 otherwise.

## Migration — what a model change costs here

Vectors cannot be migrated in place. The order that works, and the parts this
repo can and cannot do:

1. Create the new index with the new dimension
   (`npx wrangler vectorize create <name> --dimensions=1024 --metric=cosine`).
2. Point the `VECTORIZE` binding in the deployment config at it and redeploy.
3. Re-embed every entry: `POST /migration/reembed` one bounded batch at a time
   (`src/migration/embedding.ts`), looping until `remaining` reaches 0, with
   `GET /migration/status` as the resume ledger.
4. Verify, then drop the old index — or keep it as the rollback target.

`entries.content` is the source of truth throughout; migration only reads it, so
the worst case is a rebuild that has to be re-run.

## D1 schema upgrade — the 2.x brain (116 entries) to 4.0.1

The live brain runs the frozen 2.x line. Its schema is what 2.x `src/db/init.ts`
creates: `entries` plus six ALTERed columns, `edges`, and five indexes. It has
no FTS table, no tenancy tables, and no history tables.

`applySchema` (`src/db/init.ts:637`) converges it in one pass on the first
request after deploy. It reads the catalog once (`probeSchema`,
`src/db/init.ts:522`) and then issues only what is missing. The steps below are
in execution order; the counts are for this brain.

| # | Step | Against this brain |
|---|---|---|
| 1 | `SCHEMA_OBJECTS` loop (`init.ts:640`) | 13 new tables, 16 new indexes, 1 virtual table (`entries_fts_vocab`). The 2 existing tables and 5 existing indexes are skipped by the probe. |
| 2 | `versions:since` marker (`init.ts:650`) | 1 KV write, because `entry_versions` did not exist before this pass. |
| 3 | FTS batch (`init.ts:683`) | `entries_fts` plus its 3 sync triggers. Preceded by a delete of `fts:ready` and a reset of `fts:backfill-cursor` to `0`. |
| 4 | `ENTRIES_COLUMNS` loop (`init.ts:715`) | 8 `ALTER TABLE entries ADD COLUMN`. |
| 5 | entry_counts batch (`init.ts:735`) | Table, 3 triggers, and the one-time `INSERT ... SELECT ... GROUP BY workspace_id` seed over all 116 rows. |
| 6 | `EDGES_COLUMNS` (`init.ts:753`) | 1 `ALTER TABLE edges ADD COLUMN workspace_id`. |
| 7 | `USERS_COLUMNS` (`init.ts:761`) | 3 `ALTER TABLE users ADD COLUMN`, on the empty table created in step 1. |
| 8 | `ADMIN_EVENTS_COLUMNS`, `ENTRY_VERSIONS_COLUMNS`, `ENTRIES_TRASH_COLUMNS` (`init.ts:769-792`) | 4 ALTERs declared, 0 issued: step 1 creates those tables with the columns already in the CREATE. |
| 9 | `idx_users_email` (`init.ts:796`) | 1 unique index on an empty table, so the duplicate-repair branch never runs. |
| 10 | `POST_COLUMN_OBJECTS` (`init.ts:808`) | 10 partial indexes on `entries` plus 4 prompt-capsule triggers. |

That is 12 ALTERs issued and 66 DDL statements in total, none of them
destructive. The only build over real rows is the 10 indexes on `entries`:
under about 1,200 row writes for 116 entries, well inside the 100k/day cap.

### Does the FTS backfill have to come first?

No, and it cannot. `entries_fts` does not exist until step 3 of that same pass,
so nothing outside `applySchema` may run before it.

The backfill is required *after* it, and it is automatic. Step 3 deletes
`fts:ready` and resets the cursor whenever `entries` already existed
(`init.ts:690-698`), so the fresh index is never served half-populated.
`ftsReady` (`src/recall/fts.ts:119`) then returns false and recall's keyword arm
stays on LIKE until the nightly job latches the flag. `FTS_BACKFILL_BATCH` is
2000 (`src/constants.ts:215`), so 116 rows is a single batch: the first
`runFtsMaintenance` after deploy (`src/index.ts:262`, cron `0 1 * * *`) covers
the whole corpus and latches ready in one night.

Three ordering dependencies inside the pass are deliberate. `entries_fts_vocab`
is created in step 1, before `entries_fts` exists; that works because `fts5vocab`
resolves its target at query time, verified on node:sqlite 24.4 where creating
the vocab table first succeeds and a later query returns normally. The FTS sync
triggers never read `workspace_id`, so step 3 may precede the ALTERs in step 4.
The entry_counts triggers do read `NEW.workspace_id`, which is why step 5 follows
step 4.

### Before flipping the version

- **`initializeDatabase` is not awaited on the request path.** `ensureDbReady`
  (`src/runtime/state.ts:14`) fires it under `ctx.waitUntil`, so the first
  request after deploy can query a table that does not exist yet. Send one
  authenticated request, expect it to fail, then confirm with the probe below.
- **`db/schema.sql` is not an upgrade path.** It carries the end-state columns
  inline, so `db:migrate:remote` against the 2.x database creates the new tables
  but leaves `entries`, `edges` and `users` narrow, because `CREATE TABLE IF NOT
  EXISTS` is a no-op on an existing table. Runtime init still owes the 12 ALTERs.
- **Replaying the DDL by hand needs one statement per call.** `wrangler d1
  execute --command` splits on semicolons, which breaks the body of every
  trigger. The Worker avoids this by sending triggers through
  `prepare().run()` (`init.ts:846-849`).

Read-only confirmation of what the live database holds:

```
npx wrangler d1 execute second-brain-db --remote -c wrangler.personal.jsonc \
  --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type, name"
```

## Local-only files (gitignored, not in this repo)

Files that exist on disk locally but are covered by `.gitignore` and never
committed. This section records what they hold and where to find them — **not**
their contents, since real resource IDs must never land in this public repo:

- **`wrangler.personal.jsonc`** — the real per-environment Wrangler config:
  actual D1 `database_id`, KV namespace id, `workers_dev: false`, and the
  `VECTORIZE` binding pointing at the 1024-dim index
  (`second-brain-vectors-1024`). Commented in-file as paired with
  `@cf/qwen/qwen3-embedding-0.6b`; the old 384-dim `second-brain-vectors` index
  is left untouched as the rollback target.
- **`deploy-personal.sh`** — the actual deploy entrypoint. Wraps
  `wrangler deploy -c wrangler.personal.jsonc`, and records a D1 time-travel
  bookmark plus the current Worker version as a rollback anchor before
  deploying.
- **`verify.sh`** — an untracked local script. Not part of this fork's history
  and deliberately untouched.

## Deployment

Do **not** run the bare `npm run deploy` (`wrangler deploy`) — it deploys
against `wrangler.jsonc`, the ID-free shared config, and
`scripts/predeploy-guard.mjs` will refuse to run once it detects a
`wrangler.*.jsonc` override file present on disk. Deploy via:

```
sh deploy-personal.sh
```
