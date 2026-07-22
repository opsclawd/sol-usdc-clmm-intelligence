# Design: SOL/USDC Support/Resistance Evidence

## 1. Problem Statement

The regime-engine requires contextual market evidence to make informed policy decisions, moving beyond purely deterministic pool and oracle facts. This issue implements the collection, normalization, and deduplication of SOL/USDC support and resistance levels. By retaining source evidence, tracking provenance, and standardizing levels with explicit timeframes and confidence metrics, this contextual intelligence can be safely consumed by the regime engine. Crucially, this evidence remains probabilistic and contextual, ensuring it cannot silently override deterministic execution rules or hard guards.

## 2. Key Design Decisions & Trade-offs

- **Point Levels vs. Bounded Zones**
  - _Trade-off_: Creating distinct normalized types for points vs. zones vs. a single unified type.
  - _Decision_: Use a single unified payload schema (`SupportResistancePayload`) containing a `levelType` discriminant (`point` or `zone`). This ensures one is not silently converted into the other, and standardizes parsing while accommodating explicit `USDC_PER_SOL` units.
- **Deduplication vs. Consensus Merging**
  - _Trade-off_: Grouping similar levels from different sources into a single "consensus" level vs. preserving all distinct assertions.
  - _Decision_: Preserve distinct sources and disagreements. Exact replays from the same source will be idempotently collapsed using deterministic payload hashing, but materially distinct levels will not be merged into a false consensus.
- **Handling Ambiguity and Missing Data**
  - _Trade-off_: Discarding ambiguous data vs. retaining it with metadata.
  - _Decision_: Ambiguous data will be normalized but flagged explicitly via a `warnings` array in the payload. Missing levels will not be fabricated; they will remain unavailable to prevent hallucinatory technical levels.
- **Raw Material Retention and Compliance**
  - _Trade-off_: Storing entire raw source payloads vs. storing parsed snippets/references.
  - _Decision_: Retain bounded source extracts or references within `raw_observations`. This complies with licensing constraints while preserving auditability and replayability.

## 3. Proposed Approach & Rationale

### Taxonomy Updates

In `src/contracts/taxonomy.ts`:

- Add `ObservationKind`: `"support_resistance_level"`
- Add applicable generic sources to `Source` (e.g., `"technical_analysis_api"`, `"market_feed"`, depending on the implemented adapters).
- Leverage existing `EvidenceFamily`: `"support_resistance"` and `SignalClass`: `"contextual"`.

### Normalized Contract Schema

Create a new schema defining the structure of the normalized payload stored within `NormalizedObservationRow`:

```typescript
export interface SupportResistancePayload {
  pair: "SOL/USDC";
  evidenceSide: "SUPPORT" | "RESISTANCE";
  levelType: "point" | "zone";
  levelUsdcPerSol?: number;
  zoneLowerUsdcPerSol?: number;
  zoneUpperUsdcPerSol?: number;
  timeframe: string; // e.g., "1H", "4H", "1D"
  thesisCodes: string[];
  asOfUnixMs: number;
  expiresAtUnixMs: number;
  invalidationConditions: string[]; // Explicit array for source invalidation rules
  warnings: string[]; // Captures ambiguity or disagreement signals
  sourceReferences: string[]; // Links to retained raw material / URLs
}
```

### Pipeline Flow

1. **Collection (Ports/Adapters)**: Implement source adapters implementing a standard collector port to fetch raw technical levels.
2. **Raw Persistence**: Store bounded extracts and references in the existing `raw_observations` Drizzle schema.
3. **Normalization**: Implement an application use case to map `raw_observations` to `normalized_observations`. This layer validates units, extracts timeframes, and calculates confidence components.
4. **Deduplication**: Calculate a deterministic `payloadHash` based on the source, pair, side, level bounds, timeframe, and thesis. Identical hashes are treated as exact replays and collapsed. Superseded historical evidence is preserved explicitly (new rows added, previous ones expire naturally based on `validUntilUnixMs`).

## 4. Assumptions Made

- The existing JSONB payload columns in `raw_observations` and `normalized_observations` can store the new schema without a database migration.
- Specific source APIs will be implemented behind generic port adapters; the exact providers are implementation details not strictly defined in the taxonomy yet.
- The default stale behavior for this contextual evidence will be either `exclude` or `degrade_confidence` depending on downstream regime-engine requirements.
- The `clmm-v2` deterministic guards will completely ignore this data. It is only routed to the `regime-engine` via evidence bundles.

## 5. Scope

**In Scope:**

- Creating support/resistance source adapters and port interfaces.
- Persisting raw retention extracts and source references.
- Defining the normalized contracts and taxonomy additions.
- Implementing rules for freshness, confidence, provenance, deduplication, and conflicts.
- Adding comprehensive tests (point levels, zones, duplicates, stale data, malformed data).
- Updating documentation to reinforce that this is contextual evidence.

**Out of Scope:**

- Macro calendars or scheduled events.
- Solana protocol incidents, ecosystem news, or regulatory headlines.
- On-chain flow or perp/liquidation evidence.
- LLM research-brief generation.
- Final policy synthesis or regime-engine decision logic.

## 6. Risks and Concerns from Code Analysis

- **Loss of Nuance in Normalization**: If the `SupportResistancePayload` is too rigid, prose-heavy source material may be poorly parsed. The `warnings` array is critical for flagging when a level is inferred or lacks strict numeric boundaries.
- **Copyright and Licensing Constraints**: We must be careful that `raw_observations.payloadCanonical` does not ingest full copyrighted articles, only the legally permissible bounded extracts or metadata references.
- **Deduplication Conflicts**: Defining "materially equivalent" levels can be tricky. A strict hash on the rounded numeric level and timeframe is the safest way to achieve idempotency without accidentally merging conflicting assertions from different analysts on the same platform.
