<!-- plan-review-required -->

# Solana Ecosystem News and Regulatory Risk Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect allowlisted, source-linked Solana ecosystem news and regulatory-risk records; retain only compliant bounded extracts; normalize immutable article versions; deterministically cluster duplicates; and persist auditable contextual evidence without making directional or policy claims.

**Architecture:** Add two contextual taxonomy kinds and a strict shared news-evidence contract, then build a pure domain pipeline for validation, normalization, clustering, corroboration, confidence, freshness, and provenance. A single source port and bounded HTTP adapter serve both allowlisted provider classes; application use cases ingest each article version raw-first through the existing repositories, consult recent normalized history for clustering, and append corrections rather than updating prior rows. A job and CLI compose the configured providers and expose source-level degraded outcomes without treating missing coverage as evidence of no risk.

**Tech Stack:** TypeScript, Zod, Vitest, the existing `HttpClient`/`RetryControl` ports, existing raw and normalized observation repositories, Drizzle-backed runtime composition, pnpm, and OpenClaw cron configuration.

---

**Goal details**

- Support `ecosystem_news` and `regulatory_risk` as distinct contextual observation kinds and evidence families.
- Retain stable article/version identities, bounded factual claims, timestamps, publisher quality, affected scope, source references, compliance metadata, warnings, correction links, cluster identity, and corroboration state.
- Make exact article-version replays idempotent while preserving changed versions and corrections as new raw and normalized rows.
- Group provider-declared syndication and deterministic near-duplicates without treating syndicated copies as independent corroboration.
- Keep conflicting claims visible and lower confidence for unconfirmed, partial, paywalled, stale, or conflicting evidence.
- Provide an operator command and scheduled routine that fail closed when source configuration or retention permissions are invalid.

**Non-goals**

- Scraping HTML, bypassing paywalls, or retaining full article bodies.
- Scheduled events or active protocol incidents already handled by `collect:context-events`.
- Support/resistance, on-chain flow, perp, liquidation, or deterministic CLMM feature collection.
- LLM summarization, sentiment analysis, headline-to-price inference, directional recommendations, or final policy synthesis.
- Adding news records to the canonical Regime Engine evidence-bundle wire contract in this issue. This slice ends at persisted normalized observations because the generated cross-repo contract does not yet admit these kinds.
- New database tables, migrations, or changes to `RawObservationRepo` or `NormalizedObservationRepo`; their JSON payloads and current query methods are sufficient.
- Retroactively rewriting older normalized rows when later corroboration or corrections arrive.
- Heavy NLP, embeddings, or model-based clustering.

**Assumptions and deterministic rules**

- `crypto-news-api` and `regulatory-monitor-api` are logical provider classes, configured by URL and optional API key. The adapter accepts only a documented bounded JSON projection; it never persists arbitrary provider fields.
- `NEWS_SOURCE_ALLOWLIST` is required and may contain only those two exact source names. Missing, empty, duplicated, or unknown entries abort before HTTP or database work.
- Every source record has a stable `articleId` and `sourceVersionId`. A correction has a new `sourceVersionId` plus `correctsSourceVersionId`; it never overwrites the corrected row.
- Raw identity is the canonical hash of `{source, providerId, articleId, sourceVersionId, boundedPayloadHash}`. The same version and content replays identically; changed content under a reused version is a conflict and aborts that source outcome.
- `asOfUnixMs` is `publishedAtUnixMs` when present and otherwise `retrievedAtUnixMs`. `sourceUpdatedAtUnixMs` remains a separate optional field and cannot precede publication.
- Ecosystem news expires no later than 24 hours after `asOfUnixMs`; regulatory evidence expires no later than 72 hours after `asOfUnixMs`. A provider expiry may shorten but never extend those caps.
- Bounded retention permits at most a 1,000-character factual summary, 10 extracted claims of at most 500 characters each, 20 topic tags, 50 source references, and 100 total affected assets/protocols/jurisdictions. Unknown fields and any `body`, `content`, `html`, or equivalent long-form field are discarded by the adapter and rejected if they reach domain validation.
- A retained record requires at least one absolute `https:` source reference, a non-empty license/rights declaration, `retention: "bounded_factual_extract"`, `robotsAllowed: true`, and `termsAllowRetention: true`.
- Provider `syndicationId` is the strongest cluster key. Without it, records are near-duplicates only when they share evidence family, overlap on an affected asset/protocol, are published within 72 hours, and have Jaccard similarity of at least `0.80` over normalized title-plus-topic tokens.
- Similarity groups choose the earliest `(publishedAtUnixMs, source, articleId, sourceVersionId)` record as representative; `clusterId` is the canonical hash of that representative identity. Sorting inputs before grouping makes the result independent of provider response order.
- Independence is based on `originatingReportId`, not publisher count. Records with the same originating report are syndicated copies. Distinct originating reports from distinct publisher IDs are independent corroboration.
- Corroboration states are `unconfirmed`, `single_source`, `independently_corroborated`, or `conflicting`. An explicit conflict always wins over corroboration and adds `source_disagreement`; both claim sets and all source references remain present.
- Contextual confidence is capped below the taxonomy's `high` threshold and records the `contextual_source_quality_cap_applied` reason. Syndicated copies do not increase confidence. Partial/paywalled, unconfirmed, stale, and conflicting records receive deterministic degradation factors.
- Missing or unavailable feeds yield operational diagnostics only; no “no risk” normalized observation is created.

**Affected files**

Create:

- `src/contracts/news-events.ts`
- `src/ports/news-source.ts`
- `src/adapters/node/http-news-source.ts`
- `src/domain/news-events/validate.ts`
- `src/domain/news-events/normalize.ts`
- `src/domain/news-events/enrich.ts`
- `src/domain/news-events/identity.ts`
- `src/domain/news-events/cluster.ts`
- `src/domain/news-events/index.ts`
- `src/application/collect-news-evidence.ts`
- `src/jobs/news-evidence-job.ts`
- `scripts/collectors/news-evidence.ts`
- `cron/routines/news-evidence.md`
- `tests/fixtures/news-events.ts`
- `tests/fakes/fake-news-source.ts`
- `tests/contracts/news-events.test.ts`
- `tests/domain/news-events/validate.test.ts`
- `tests/domain/news-events/normalize.test.ts`
- `tests/domain/news-events/enrich.test.ts`
- `tests/domain/news-events/identity.test.ts`
- `tests/domain/news-events/cluster.test.ts`
- `tests/adapters/node/http-news-source.test.ts`
- `tests/application/collect-news-evidence.test.ts`
- `tests/jobs/news-evidence-job.test.ts`
- `tests/scripts/news-evidence.test.ts`

Modify:

- `src/contracts/taxonomy.ts`
- `src/contracts/index.ts`
- `src/ports/index.ts`
- `src/domain/taxonomy/registry.ts`
- `src/domain/taxonomy/validation.ts`
- `src/jobs/index.ts`
- `tests/domain/taxonomy/registry.test.ts`
- `tests/domain/taxonomy/validation.test.ts`
- `tests/fakes/index.ts`
- `package.json`
- `.env.example`
- `cron/jobs.yaml`
- `README.md`
- `docs/architecture.md`
- `docs/operator-runbook.md`

**Behavioral invariants**

The implementer writes these exact named tests before implementation:

1. `accepts a source-linked bounded ecosystem news record`: a compliant record with at least one HTTPS reference becomes an `ecosystem_news` payload and contains no directional field.
2. `rejects content that cannot be traced to an https source reference`: an empty, relative, or non-HTTPS reference set produces no retained or normalized record.
3. `rejects retention when robots or terms disallow bounded extracts`: either compliance flag being false fails validation before persistence.
4. `uses publication time as asOf and retrieval time only as fallback`: publication time wins when present; otherwise retrieval time is used without inventing a publication time.
5. `caps ecosystem news expiry at 24 hours and regulatory risk at 72 hours`: provider expiry can shorten but cannot extend the family cap.
6. `caps contextual confidence below high`: even complete official material remains at most medium and records the contextual cap reason.
7. `exact article version replay writes no duplicate rows`: the same source, article/version identity, and bounded hash returns `identical_replay` with zero new normalized rows.
8. `reused article version with changed content is a conflict`: the same raw identity with a different bounded hash fails the source outcome and does not normalize the changed payload.
9. `correction appends a linked version without overwriting history`: a new version that names `correctsSourceVersionId` creates another raw and normalized row and preserves both versions.
10. `provider syndication id groups copies without corroboration`: copies sharing a syndication/originating-report identity receive one cluster and remain `single_source`.
11. `near duplicate clustering is deterministic across input order`: shuffled inputs produce identical membership, representative, and cluster IDs.
12. `independent publishers with distinct originating reports corroborate`: matching records from distinct publisher and originating-report IDs retain every source reference and become `independently_corroborated`.
13. `conflicting reports remain visible as conflicting evidence`: disagreement produces `conflicting`, retains both claim sets and references, and never compresses them into a consensus claim.
14. `stale partial and paywalled material remains explicit and degraded`: each condition adds its warning, lowers confidence, and never becomes directional evidence.
15. `unavailable sources create no no-risk observation`: all timeout/network/rate-limit/unavailable outcomes leave normalized counts at zero and return diagnostics.
16. `successful articles remain committed when a later article fails`: the per-article loop reports `PARTIAL`, preserves prior append-only writes, and identifies the failed article without retrying successful writes.

## Task 1: Define news evidence contracts and taxonomy

**Files:**

- Create: `src/contracts/news-events.ts`
- Create: `tests/contracts/news-events.test.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `src/jobs/index.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Modify: `tests/domain/evidence-bundle/assemble.test.ts`
- Modify: `tests/domain/evidence-bundle/context-events-assemble.test.ts`
- Modify: `tests/fakes/index.ts`

- [ ] **Step 1: Write failing contract and taxonomy tests**

Add the named contract cases `accepts a source-linked bounded ecosystem news record` and `rejects content that cannot be traced to an https source reference`. Assert that strict payloads expose no `direction`, `recommendation`, `sentiment`, or free-form article body. In the existing taxonomy tests, add focused describe blocks proving both new observation kinds/families/sources parse and that registry entries are contextual, active, schema version 1, `allow_context_only`, and restricted to their matching direct source.

- [ ] **Step 2: Confirm the selected tests fail**

Run: `pnpm exec vitest run tests/contracts/news-events.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts`

Expected: FAIL because the new contract, taxonomy values, and registry entries are absent.

- [ ] **Step 3: Add the exported contracts and taxonomy entries**

Add `"ecosystem_news"` and `"regulatory_risk"` to `EvidenceFamily` and `ObservationKind`, and `"crypto-news-api"` and `"regulatory-monitor-api"` to `Source`. Define and export these stable discriminants and shapes from `src/contracts/news-events.ts` and `src/contracts/index.ts`:

```ts
export type NewsEvidenceKind = "ecosystem_news" | "regulatory_risk";
export type NewsCorroborationState =
  | "unconfirmed"
  | "single_source"
  | "independently_corroborated"
  | "conflicting";
export type NewsEvidenceWarning =
  | "unconfirmed_claim"
  | "correction"
  | "partial_material"
  | "paywalled_material"
  | "source_disagreement"
  | "stale_observation";

export interface NewsPayloadV1 {
  readonly evidenceKind: "ecosystem_news";
  readonly articleId: string;
  readonly sourceVersionId: string;
  readonly correctsSourceVersionId: string | null;
  readonly clusterId: string;
  readonly title: string;
  readonly factualSummary: string;
  readonly extractedClaims: readonly string[];
  readonly topicTags: readonly string[];
  readonly publishedAtUnixMs: number | null;
  readonly sourceUpdatedAtUnixMs: number | null;
  readonly retrievedAtUnixMs: number;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly publisher: NewsPublisher;
  readonly sourceQuality: NewsSourceQuality;
  readonly corroborationState: NewsCorroborationState;
  readonly originatingReportId: string;
  readonly syndicationId: string | null;
  readonly affectedAssets: readonly string[];
  readonly affectedProtocols: readonly string[];
  readonly affectedJurisdictions: readonly string[];
  readonly sourceReferences: readonly string[];
  readonly rawProvenance: NewsRawProvenance;
  readonly warnings: readonly NewsEvidenceWarning[];
}

export interface RegulatoryPayloadV1 extends Omit<NewsPayloadV1, "evidenceKind"> {
  readonly evidenceKind: "regulatory_risk";
}

export type NewsEvidencePayload = NewsPayloadV1 | RegulatoryPayloadV1;
```

Define `NewsPublisher`, `NewsSourceQuality`, and `NewsRawProvenance` explicitly: publisher has stable ID, display name, and `official | primary | secondary | aggregator`; source quality has provider ID, reliability `[0,1]`, `complete | partial`, `confirmed | unconfirmed`, and paywall boolean; provenance has retrieval, license/rights, bounded retention, robots, and terms flags.

Register 24-hour/72-hour freshness policies, contextual confidence weights, no LLM weight, and direct-source provenance allowlists. Update every runtime parser set in `src/domain/taxonomy/validation.ts`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/contracts/news-events.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts`

Run: `pnpm exec eslint src/contracts/news-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/contracts/news-events.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/evidence-bundle/assemble.test.ts tests/domain/evidence-bundle/context-events-assemble.test.ts`

Expected: selected tests and lint pass; the automatic `pnpm -r typecheck` gate also passes because the union types, registries, parsers, and exports change together.

Commit: `git add src/contracts/news-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/contracts/news-events.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/evidence-bundle/assemble.test.ts tests/domain/evidence-bundle/context-events-assemble.test.ts && git commit -m "feat: define news evidence taxonomy and contracts"`

## Task 2: Validate normalize identify and enrich bounded records

**Files:**

- Create: `src/domain/news-events/validate.ts`
- Create: `src/domain/news-events/normalize.ts`
- Create: `src/domain/news-events/enrich.ts`
- Create: `src/domain/news-events/identity.ts`
- Create: `src/domain/news-events/index.ts`
- Create: `tests/fixtures/news-events.ts`
- Create: `tests/domain/news-events/validate.test.ts`
- Create: `tests/domain/news-events/normalize.test.ts`
- Create: `tests/domain/news-events/enrich.test.ts`
- Create: `tests/domain/news-events/identity.test.ts`

- [ ] **Step 1: Write invariant-first domain tests**

Write the exact named cases:

- `rejects retention when robots or terms disallow bounded extracts`
- `uses publication time as asOf and retrieval time only as fallback`
- `caps ecosystem news expiry at 24 hours and regulatory risk at 72 hours`
- `caps contextual confidence below high`
- `stale partial and paywalled material remains explicit and degraded`

Also cover strict unknown-field rejection, the explicit prohibited long-form field names, all length/count bounds, finite ordered timestamps, sorted/deduplicated tags and scopes, correction warning/link validation, regulatory jurisdictions, absolute HTTPS references, family/source matching, canonical identity stability, freshness, validated provenance, and secret-free payloads.

- [ ] **Step 2: Confirm the domain tests fail**

Run: `pnpm exec vitest run tests/domain/news-events/validate.test.ts tests/domain/news-events/normalize.test.ts tests/domain/news-events/enrich.test.ts tests/domain/news-events/identity.test.ts`

Expected: FAIL because the news-event domain modules do not exist.

- [ ] **Step 3: Implement the bounded domain pipeline**

Expose the following APIs through `src/domain/news-events/index.ts`:

```ts
export function acceptBoundedNewsRecord(input: unknown): BoundedNewsSourceRecord;
export function normalizeNewsRecord(
  input: BoundedNewsSourceRecord,
  nowMs: number
): UnclusteredNewsEvidencePayload;
export function deriveNewsObservationKey(input: {
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly providerId: string;
  readonly articleId: string;
  readonly sourceVersionId: string;
  readonly boundedPayloadHash: string;
}): Promise<string>;
export function enrichNewsEvidence(input: {
  readonly payload: NewsEvidencePayload;
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly rawId: number;
  readonly nowMs: number;
  readonly codeVersion: string;
  readonly runId: string | null;
}): Promise<EnrichedNewsEvidenceObservation>;
```

Use strict Zod schemas and explicit refinements for compliance, HTTPS references, family/source matching, correction self-links, timestamp ordering, and prohibited content fields. Normalize strings and arrays without generating prose. Compute family-capped expiry, warnings, freshness, and confidence with these fixed degradation factors: unconfirmed `0.60`, partial `0.75`, paywalled `0.80`, conflicting `0.60`, stale `0.50`; multiply applicable factors, cap the resulting composite at `0.69`, recompute the level from the registry thresholds, and append `contextual_source_quality_cap_applied` when capped.

Build provenance with the raw parent in both `sourceRefs` and `rawObservationRefs`, collector/job names `sol-usdc-clmm-intelligence`/`news-evidence`, no derived refs, and no LLM/model version. The normalized payload must not include direction, recommendation, or sentiment.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/news-events/validate.test.ts tests/domain/news-events/normalize.test.ts tests/domain/news-events/enrich.test.ts tests/domain/news-events/identity.test.ts`

Run: `pnpm exec eslint src/domain/news-events tests/domain/news-events tests/fixtures/news-events.ts`

Expected: selected tests and lint pass.

Commit: `git add src/domain/news-events tests/domain/news-events tests/fixtures/news-events.ts && git commit -m "feat: normalize bounded news evidence"`

## Task 3: Cluster duplicates corroboration conflicts and corrections

**Files:**

- Create: `src/domain/news-events/cluster.ts`
- Create: `tests/domain/news-events/cluster.test.ts`
- Modify: `src/domain/news-events/index.ts`

- [ ] **Step 1: Write clustering state-transition tests first**

Write the exact named cases:

- `provider syndication id groups copies without corroboration`
- `near duplicate clustering is deterministic across input order`
- `independent publishers with distinct originating reports corroborate`
- `conflicting reports remain visible as conflicting evidence`
- `correction appends a linked version without overwriting history`

Add threshold boundary tests at `0.79` and `0.80`, 72-hour boundary tests, affected-scope mismatch tests, a case proving same-publisher rewrites do not corroborate, and a case proving corrections inherit the corrected record's cluster even when the corrected title changes.

- [ ] **Step 2: Confirm clustering tests fail**

Run: `pnpm exec vitest run tests/domain/news-events/cluster.test.ts`

Expected: FAIL because the clustering API is absent.

- [ ] **Step 3: Implement deterministic clustering**

Export:

```ts
export interface ClusterNewsEvidenceInput {
  readonly historical: readonly NewsEvidencePayload[];
  readonly incoming: readonly UnclusteredNewsEvidencePayload[];
}

export function clusterNewsEvidence(
  input: ClusterNewsEvidenceInput
): Promise<readonly NewsEvidencePayload[]>;
```

Normalize tokens by Unicode lowercase, punctuation removal, whitespace collapse, stop-word removal, and unique sorting. Prefer exact correction targets, then exact non-null syndication IDs, then the `0.80` Jaccard/time/scope heuristic. Sort historical and incoming records by the deterministic representative tuple before unioning groups. Hash only the chosen representative identity to derive `clusterId`.

For each incoming payload, aggregate sorted unique source references and claims from its resolved group. Count independent corroboration only across distinct `(publisher.id, originatingReportId)` pairs. Preserve the incoming record as its own immutable version; do not mutate historical payloads. If any accepted record declares a conflict with another source version, set `conflicting`, add `source_disagreement`, retain both claim arrays, and apply the conflict degradation during enrichment.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/news-events/cluster.test.ts`

Run: `pnpm exec eslint src/domain/news-events/cluster.ts src/domain/news-events/index.ts tests/domain/news-events/cluster.test.ts`

Expected: selected tests and lint pass.

Commit: `git add src/domain/news-events/cluster.ts src/domain/news-events/index.ts tests/domain/news-events/cluster.test.ts && git commit -m "feat: cluster and corroborate news evidence"`

## Task 4: Add the news source port and all adapters

**Files:**

- Create: `src/ports/news-source.ts`
- Create: `src/adapters/node/http-news-source.ts`
- Create: `tests/fakes/fake-news-source.ts`
- Create: `tests/adapters/node/http-news-source.test.ts`
- Modify: `src/ports/index.ts`
- Modify: `tests/fakes/index.ts`

- [ ] **Step 1: Write adapter and fake tests**

Test both source kinds, the SOL/USDC request filter, time window query parameters, optional bearer auth, strict bounded response projection, removal of arbitrary provider fields, rejection of missing licenses/references/compliance flags, prohibited full-text fields, malformed JSON, timeout, network errors, non-retryable 4xx, unavailable 404/429/5xx, two-attempt retry/backoff, and configured credential redaction.

- [ ] **Step 2: Confirm adapter tests fail**

Run: `pnpm exec vitest run tests/adapters/node/http-news-source.test.ts`

Expected: FAIL because the port, adapter, and fake do not exist.

- [ ] **Step 3: Add the interface and every implementation in the same task**

Define the complete port contract:

```ts
export interface NewsSourceRequest {
  readonly pair: "SOL/USDC";
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly fromUnixMs: number;
  readonly toUnixMs: number;
}

export interface NewsSourceSnapshot {
  readonly source: NewsSourceRequest["source"];
  readonly providerId: string;
  readonly providerRunId: string;
  readonly retrievedAtUnixMs: number;
  readonly records: readonly BoundedNewsSourceRecord[];
}

export type NewsSourceError =
  | { readonly kind: "timeout"; readonly diagnostic: string }
  | { readonly kind: "network"; readonly diagnostic: string }
  | { readonly kind: "unavailable"; readonly diagnostic: string }
  | { readonly kind: "malformed"; readonly diagnostic: string };

export interface NewsSourcePort {
  collect(request: NewsSourceRequest): Promise<NewsSourceSnapshot>;
}
```

Implement `HttpNewsSource implements NewsSourcePort` and `FakeNewsSource implements NewsSourcePort` in this task so the required-member shape never breaks the automatic workspace typecheck gate. The HTTP adapter validates the configured source against the request, uses the existing `HttpClient` and injected `RetryControl`, makes at most two attempts, caps exponential backoff at 400 ms plus injected jitter, never retries malformed/non-retryable 4xx responses, freezes its bounded projection, and never exposes or persists auth headers.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/adapters/node/http-news-source.test.ts`

Run: `pnpm exec eslint src/ports/news-source.ts src/ports/index.ts src/adapters/node/http-news-source.ts tests/fakes/fake-news-source.ts tests/fakes/index.ts tests/adapters/node/http-news-source.test.ts`

Expected: selected tests and lint pass; the interface, adapter, fake, and barrel exports compile together.

Commit: `git add src/ports/news-source.ts src/ports/index.ts src/adapters/node/http-news-source.ts tests/fakes/fake-news-source.ts tests/fakes/index.ts tests/adapters/node/http-news-source.test.ts && git commit -m "feat: add bounded news source adapter"`

## Task 5: Persist article versions raw first and append only

**Files:**

- Create: `src/application/collect-news-evidence.ts`
- Create: `tests/application/collect-news-evidence.test.ts`

- [ ] **Step 1: Write persistence loop tests first**

Write the exact named cases:

- `exact article version replay writes no duplicate rows`
- `reused article version with changed content is a conflict`
- `correction appends a linked version without overwriting history`
- `unavailable sources create no no-risk observation`
- `successful articles remain committed when a later article fails`

Also prove source collection happens before persistence; malformed source snapshots write nothing; raw insert precedes history lookup and normalized insert for each record; both new observation kinds query seven days of existing candidates across both allowlisted sources; normalized rows carry the raw parent, payload hash, contextual class/family, freshness, confidence, stale behavior, and provenance; diagnostics redact secret-like values; and an empty successful source response returns accepted with zero rows but no absence claim.

- [ ] **Step 2: Confirm application tests fail**

Run: `pnpm exec vitest run tests/application/collect-news-evidence.test.ts`

Expected: FAIL because the collection use case does not exist.

- [ ] **Step 3: Implement the per-source per-article ingestion loop**

Expose:

```ts
export type NewsEvidenceCollectionStatus =
  | "accepted"
  | "partial"
  | "degraded"
  | "identical_replay"
  | "timeout"
  | "network"
  | "unavailable"
  | "malformed"
  | "conflict"
  | "failed";

export interface NewsEvidenceCollectionResult {
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly status: NewsEvidenceCollectionStatus;
  readonly rawObservationIds: readonly number[];
  readonly normalizedCount: number;
  readonly failedArticleIds: readonly string[];
  readonly warnings: readonly string[];
  readonly diagnostic: string | null;
}

export async function collectNewsEvidence(
  deps: CollectNewsEvidenceDeps,
  context: CollectionRunContext,
  source: "crypto-news-api" | "regulatory-monitor-api"
): Promise<NewsEvidenceCollectionResult>;
```

Request the prior seven days through `NewsSourcePort`, reject a response whose declared source differs from the configured source, and process records in deterministic `(articleId, sourceVersionId)` order. For each record, canonicalize only the accepted bounded projection, derive the raw key, and call `ingestRawObservation`. In `buildCandidates`, normalize the record; in `enrichCandidates`, load recent normalized candidates with `listCandidates`, parse only valid news payloads, cluster the incoming record against history, and enrich it; in `insertNormalized`, use the existing `insertMany`.

Continue after an article-local validation or persistence failure because earlier database writes are irreversible and valid; return `partial` with failed IDs when at least one article succeeds, otherwise return the mapped failure. A raw identity conflict is not a correction: report `conflict` and never normalize the changed version. If every record is an identical parsed replay, return `identical_replay`. Never synthesize a normalized row for zero records or source failure.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/application/collect-news-evidence.test.ts`

Run: `pnpm exec eslint src/application/collect-news-evidence.ts tests/application/collect-news-evidence.test.ts`

Expected: selected tests and lint pass.

Commit: `git add src/application/collect-news-evidence.ts tests/application/collect-news-evidence.test.ts && git commit -m "feat: persist immutable news evidence versions"`

## Task 6: Orchestrate allowlisted news sources

**Files:**

- Create: `src/jobs/news-evidence-job.ts`
- Create: `tests/jobs/news-evidence-job.test.ts`
- Modify: `src/jobs/index.ts`

- [ ] **Step 1: Write job reducer and concurrency tests**

Test the exact source set is invoked once with one shared `CollectionRunContext`, collection runs concurrently, output order follows configured source order, thrown source calls become failed outcomes with redacted diagnostics, and the reducer follows this truth table:

```text
all configured sources usable                         -> COMPLETE
at least one usable and at least one non-usable       -> PARTIAL
all sources timeout/network/unavailable               -> UNAVAILABLE
zero usable with malformed/conflict/failed            -> FAILED
```

Treat `accepted`, `partial`, `degraded`, and `identical_replay` as usable. `shouldFailCommand` is false only for `COMPLETE` and `PARTIAL`.

- [ ] **Step 2: Confirm job tests fail**

Run: `pnpm exec vitest run tests/jobs/news-evidence-job.test.ts`

Expected: FAIL because the job API is absent.

- [ ] **Step 3: Implement job orchestration**

Export:

```ts
export interface ConfiguredNewsSource {
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly adapter: NewsSourcePort;
}

export interface NewsEvidenceJobDeps {
  readonly sources: readonly ConfiguredNewsSource[];
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
}

export function newsEvidenceJob(deps: NewsEvidenceJobDeps): () => Promise<NewsEvidenceJobResult>;

export async function runNewsEvidenceJob(deps: NewsEvidenceJobDeps): Promise<NewsEvidenceJobResult>;
```

Reject an empty source list or duplicate source names before collection. Create one run context, execute configured sources through `Promise.all`, catch each source independently, preserve configured ordering, reduce the truth table deterministically, and export the job from `src/jobs/index.ts`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/jobs/news-evidence-job.test.ts`

Run: `pnpm exec eslint src/jobs/news-evidence-job.ts src/jobs/index.ts tests/jobs/news-evidence-job.test.ts`

Expected: selected tests and lint pass.

Commit: `git add src/jobs/news-evidence-job.ts src/jobs/index.ts tests/jobs/news-evidence-job.test.ts && git commit -m "feat: orchestrate news evidence sources"`

## Task 7: Add fail closed CLI configuration

**Files:**

- Create: `scripts/collectors/news-evidence.ts`
- Create: `tests/scripts/news-evidence.test.ts`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Write CLI configuration and lifecycle tests**

Test required `NEWS_SOURCE_ALLOWLIST`; rejection of empty, duplicate, or unknown entries; stable allowlist ordering; per-source required URL and optional API key; construction of the correct `HttpNewsSource`; no database initialization or HTTP call after invalid configuration; result JSON secret redaction; exit code 0 for complete/partial; exit code 1 for unavailable/failed; and database close on success, job failure, and output failure.

- [ ] **Step 2: Confirm script tests fail**

Run: `pnpm exec vitest run tests/scripts/news-evidence.test.ts`

Expected: FAIL because the CLI and package command do not exist.

- [ ] **Step 3: Implement configuration and the entrypoint**

Add `pnpm collect:news-evidence` mapped to `tsx scripts/collectors/news-evidence.ts`. Parse:

```text
NEWS_SOURCE_ALLOWLIST=crypto-news-api,regulatory-monitor-api
CRYPTO_NEWS_API_URL=
CRYPTO_NEWS_API_KEY=
REGULATORY_MONITOR_API_URL=
REGULATORY_MONITOR_API_KEY=
```

The parser trims values, rejects empty/duplicate/unknown names, retains canonical allowlist order, and requires only the URL variables for selected sources. Construct one `HttpNewsSource` per selected source using the shared runtime HTTP and retry controls, initialize persistence only after configuration succeeds, run `runNewsEvidenceJob`, print through `secretRedactingReplacer`, set the documented exit code, and close persistence exactly once in `finally`. Export `runNewsEvidenceCollect()` for tests and guard direct execution consistently with the other collector scripts.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/scripts/news-evidence.test.ts`

Run: `pnpm exec eslint scripts/collectors/news-evidence.ts tests/scripts/news-evidence.test.ts`

Run: `pnpm exec prettier --check package.json`

Expected: selected tests, lint, and formatting pass.

Commit: `git add scripts/collectors/news-evidence.ts tests/scripts/news-evidence.test.ts package.json .env.example && git commit -m "feat: add news evidence collector command"`

## Task 8: Document schedule retention and authority boundaries

**Files:**

- Create: `cron/routines/news-evidence.md`
- Modify: `cron/jobs.yaml`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Add the scheduled routine and operator documentation**

Add a `news-evidence` cron entry running every two hours and a routine that invokes `pnpm collect:news-evidence`, reports source outcomes, and explicitly forbids headline-based trading recommendations. Document:

- the two-source allowlist and exact environment variables;
- bounded extract limits and the HTTPS/license/robots/terms requirements;
- immutable article/version and correction semantics;
- 24-hour ecosystem and 72-hour regulatory freshness caps;
- syndication versus independent corroboration;
- conflict and stale behavior;
- the COMPLETE/PARTIAL/UNAVAILABLE/FAILED command meanings;
- the lower-confidence contextual cap;
- missing coverage not meaning no risk;
- no full-text retention, LLM briefs, policy synthesis, or execution authority;
- persisted normalized observations as the end of this issue's scope.

- [ ] **Step 2: Verify the scoped configuration and documents**

Run: `pnpm exec tsx scripts/openclaw/render-cron-commands.ts`

Expected: exits 0 and prints commands for both `context-events` and `news-evidence`, with the new job pointing to `cron/routines/news-evidence.md`.

Run: `pnpm exec prettier --check cron/jobs.yaml cron/routines/news-evidence.md README.md docs/architecture.md docs/operator-runbook.md`

Expected: all changed configuration and documentation files are formatted.

Commit: `git add cron/jobs.yaml cron/routines/news-evidence.md README.md docs/architecture.md docs/operator-runbook.md && git commit -m "docs: define news evidence operating policy"`

**Tests to add or update**

- Contract shape and authority boundary: `tests/contracts/news-events.test.ts`.
- Taxonomy registration/parsing: focused additions to `tests/domain/taxonomy/registry.test.ts` and `tests/domain/taxonomy/validation.test.ts`.
- Compliance, bounds, time rules, normalization, confidence, freshness, provenance, and identity: four focused files under `tests/domain/news-events/`.
- Clustering, deduplication, syndication, corroboration, conflicts, and corrections: `tests/domain/news-events/cluster.test.ts`.
- HTTP response projection, errors, retries, and redaction: `tests/adapters/node/http-news-source.test.ts`.
- Raw-first idempotency and partial loop persistence: `tests/application/collect-news-evidence.test.ts`.
- Multi-source status reduction: `tests/jobs/news-evidence-job.test.ts`.
- Allowlist/configuration/exit/close behavior: `tests/scripts/news-evidence.test.ts`.

All new test files should remain focused and below the repository's oversized-test threshold. Existing taxonomy files exceed ten cases, but the tasks modifying them are contract/taxonomy implementation tasks rather than test-update-only tasks; additions stay in isolated describe blocks.

**Validation commands**

Each implementation task contains file-scoped Vitest, ESLint, or Prettier commands as acceptance criteria. The implementation harness additionally runs its mandatory workspace `pnpm -r typecheck` gate after every task. After all implementation tasks, the dedicated validation phase may run the repository's standard `pnpm verify`; it is intentionally not represented as a standalone implementation task.

**Risk areas**

- Deterministic text similarity can under-cluster rewritten syndication or over-cluster generic headlines. The family, time, and affected-scope gates plus threshold-boundary tests constrain this risk.
- Immutable records mean later corroboration does not rewrite earlier states. Consumers must use the newest relevant record/cluster state while retaining the historical view.
- A provider that reuses `sourceVersionId` for changed content creates a hard conflict rather than an inferred correction; this is deliberately fail closed.
- Per-article persistence is not one transaction across a provider response. Valid earlier writes survive a later failure and the source outcome becomes PARTIAL; reruns remain safe through raw identity.
- Compliance declarations are provider metadata, not legal advice. The adapter rejects missing/negative declarations and never stores full text, but operators still own provider-contract review.
- Source quality and confirmation are provider-supplied facts. Deterministic confidence caps prevent them from attaining deterministic-evidence authority.
- The generated evidence bundle contract does not currently accept these kinds; attempting to publish them in this issue would violate the cross-repo contract boundary.

**Stop conditions**

- Stop if `design.md`/`issue.md` requirements would require retaining full copyrighted bodies, scraping disallowed pages, or bypassing a paywall.
- Stop if a selected provider cannot supply stable article and version identities, at least one traceable HTTPS reference, bounded-retention permission, or explicit robots/terms flags.
- Stop if implementing publication requires editing the generated evidence-bundle contract without an approved upstream Regime Engine schema.
- Stop if repository history shows a newer canonical news taxonomy or source contract that conflicts with the names in this plan; reconcile the design before duplicating it.
- Stop if the existing repository ports cannot express the required append-only lookup/insert behavior without a new method; revise the relevant task so the port method and every adapter/fake implementation land together.
- Stop if tests reveal that partial per-article writes cannot be classified and safely replayed; do not add compensating deletes or overwrite history.
- Stop on pre-existing failing scoped tests or boundary violations that make the planned task non-independently committable; record the evidence instead of broadening scope into unrelated fixes.
