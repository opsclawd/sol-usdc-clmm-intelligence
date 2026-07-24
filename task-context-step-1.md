# Task Context: Task 1

Title: Define news evidence contracts and taxonomy

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-29
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-29
Start Commit: c4ebafe2e56545826828c5cef80a53840e1a3cda

## Task Requirements

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

## Repository Targets

### Expected Files

- src/contracts/news-events.ts
- src/contracts/taxonomy.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- src/domain/taxonomy/validation.ts
- tests/contracts/news-events.test.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/validation.test.ts
- tests/domain/evidence-bundle/assemble.test.ts
- tests/domain/evidence-bundle/context-events-assemble.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/contracts/news-events.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
pnpm exec eslint src/contracts/news-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/contracts/news-events.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/evidence-bundle/assemble.test.ts tests/domain/evidence-bundle/context-events-assemble.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded source linked contract**: A compliant record with an HTTPS reference is represented as contextual news evidence without any directional or recommendation field. (Test: `accepts a source-linked bounded ecosystem news record`)
- **traceable source required**: A record with no absolute HTTPS source reference is rejected and cannot become normalized evidence. (Test: `rejects content that cannot be traced to an https source reference`)
