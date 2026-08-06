Run `pnpm collect:price`.

## Operating constraints

This is a **read-only operational task**. Run the command and report its output.

- Do **not** modify, create, or delete any file in the repository.
- Do **not** run state-changing `git` commands (`commit`, `checkout`, `stash`, `reset`, `restore`, `push`).
- Do **not** attempt to diagnose or fix a failure by changing code or configuration.

If the command fails, report the failing command, its exit code, and its output verbatim, then stop. A human triages failures; unreviewed edits to this production checkout break deployment and are discarded.

Writing collected data under `data/` is expected and allowed.
