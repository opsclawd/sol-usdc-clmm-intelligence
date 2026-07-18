# Task Context: Task 6

Title: Add atomic raw insert classification and parse-status operations

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-22
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-22
Start Commit: 354e656925912cc7e58de7220277b1694b69286d

## Task Requirements

**Files:**

- Modify: `src/ports/observation-repo.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/drizzle-observation-repo.ts`
- Modify: `tests/fakes/fake-observation-repo.ts`
- Modify: `tests/ports/observation-repo.test.ts`
- Create: `tests/adapters/node/drizzle-observation-repos.integration.test.ts`

**Behavioral invariants to test first:**

- `insertOrClassify returns inserted for a new source identity` creates one immutable pending row.
- `insertOrClassify returns identical_replay for equal identity and content` returns the existing row without mutation.
- `insertOrClassify returns conflict for equal identity and unequal content` exposes existing/incoming hashes and preserves stored evidence.
- `equal content under distinct source identities creates distinct raw rows` prevents cross-wallet collapse.
- `updateParseStatus changes only parseStatus and findById reloads the persisted row` keeps raw evidence immutable.
- `concurrent equivalent inserts classify as one inserted and one identical replay` requires unique-constraint recovery rather than check-then-insert alone.

- [ ] **Step 1: Rewrite the fake port contract tests around `sourceObservationKey`, `insertOrClassify`, `findById`, `findByIdentity`, and `updateParseStatus`; add raw-only disposable-Postgres integration cases for unique-race and immutability behavior.**
- [ ] **Step 2: Run `pnpm vitest run tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts` and confirm interface/method failures.** The integration suite may use `TEST_DATABASE_URL` and must skip with an explicit message when absent; never point it at a production/shared database.
- [ ] **Step 3: Change the port and every implementation in this same task.** Define:

```ts
export type RawInsertOutcome =
  | { outcome: "inserted"; row: RawObservationRow }
  | { outcome: "identical_replay"; row: RawObservationRow }
  | { outcome: "conflict"; row: RawObservationRow; incomingPayloadHash: string };

export interface RawObservationRepo {
  insertOrClassify(row: RawObservationInsert): Promise<RawInsertOutcome>;
  findById(id: number): Promise<RawObservationRow | undefined>;
  findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined>;
  findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]>;
  updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow>;
}
```

Add `sourceObservationKey` to insert/row shapes. The Drizzle adapter must attempt insert with conflict-do-nothing on `(source, sourceObservationKey)`, reload by identity, and classify by payload hash; the fake must mirror these semantics.

- [ ] **Step 4: Rerun the focused port/integration tests, then run `pnpm exec eslint src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts --max-warnings 0` and `pnpm exec prettier --check src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts`.**
- [ ] **Step 5: Commit:** `git add src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts && git commit -m "feat(persist): classify raw observation replays"`.

## Repository Targets

### Expected Files

- src/ports/observation-repo.ts
- src/ports/index.ts
- src/adapters/node/drizzle-observation-repo.ts
- tests/fakes/fake-observation-repo.ts
- tests/ports/observation-repo.test.ts
- tests/adapters/node/drizzle-observation-repos.integration.test.ts

## Validation Commands

```bash
pnpm vitest run tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts
pnpm exec eslint src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **new raw insertion**: A previously unseen source identity creates one pending immutable row and returns inserted. (Test: `insertOrClassify returns inserted for a new source identity`)
- **identical raw replay**: Equal identity and content returns the existing row without mutation. (Test: `insertOrClassify returns identical_replay for equal identity and content`)
- **raw identity conflict**: Equal identity and unequal content reports both hashes and preserves stored evidence. (Test: `insertOrClassify returns conflict for equal identity and unequal content`)
- **equal content distinct identity**: Equal payload hashes under different source identities create different rows. (Test: `equal content under distinct source identities creates distinct raw rows`)
- **parse metadata mutability**: Status updates cannot mutate identity, content, timestamps, or request metadata. (Test: `updateParseStatus changes only parseStatus and findById reloads the persisted row`)
- **concurrent replay classification**: A unique-constraint race yields one inserted and one identical replay outcome. (Test: `concurrent equivalent inserts classify as one inserted and one identical replay`)
