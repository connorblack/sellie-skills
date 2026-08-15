# Kanban failure catalog

Every entry was observed on the `sellie-emdash` board. Each is listed with what it looks like, what it actually is, and how to confirm it yourself. They are grouped by how they deceive you.

---

## A. Silent data loss

### A1. Completing a `scratch` card deletes its uncommitted work

**Looks like:** a card is `done`; later its workspace directory simply does not exist.

**Actually:** `_cleanup_workspace` runs after `complete_task` commits, and `kanban gc` runs over archived tasks. **Both delete `scratch` workspaces only** — from the source:

> Only `scratch` workspaces are removed; `worktree` and `dir` workspaces are intentionally preserved.

A scratch dir is not a git repo, so the contents exist nowhere else: no stash, no reflog, no dangling commit. Unrecoverable.

**Cost when hit:** six code-producing cards, ~30 files, including a reviewed email migration with 9/9 passing tests. Every one of those was a `scratch` card.

**Two corrections to the earlier version of this entry**, both of which sent people to the wrong defence:

1. The mechanism is **not** `reconcile_orphans`. `reconcile_orphaned_running` requeues `running` cards whose claim bookkeeping broke (running with NULL `claim_lock`/`claim_expires`) — it never deletes a workspace. `hermes config set kanban.reconcile_orphans false` therefore does **not** protect anything here.
2. It does **not** apply to worktree cards. Those are never deleted by hermes, so there is no approval race for them — commit for reviewability and handoff, not to beat a reaper.

**Confirm:**
```bash
# what kind is it? this is the whole question
python3 -c "import sys;sys.path.insert(0,'$HOME/.hermes/hermes-agent');\
import hermes_cli.kanban_db as kb;c=kb.connect(board='<slug>');\
print(kb.get_task(c,'<task_id>').workspace_kind)"
ls ~/.hermes/kanban/boards/<slug>/workspaces/<task_id>   # scratch: gone after archive+gc
```

**Defend:** for `scratch`, declare deliverables — `kanban_complete(artifacts=[...])`, which hermes copies out before cleanup (`_persist_scratch_completion_artifacts`); `ArtifactPreservationError` is raised when a declared deliverable cannot be preserved. For `worktree`, commit incrementally to the card branch. `scripts/preserve-cards.py` reports the first and does the second.

### A2. A timeout discards uncommitted work the same way

A SIGKILL at the runtime limit leaves nothing behind. One card ran 7593s against a 7200s limit and lost ~320 lines of real work on its first attempt.

**Defend:** tell long-running cards to commit incrementally, and to `block --kind needs_input` with committed progress rather than running out silently. A blocked card with commits is recoverable; a timed-out card without them is not.

### A3. Staging a card's workspace can sweep in the human's work

**Looks like:** a normal preservation commit.

**Actually:** a card can be legitimately configured to run in an existing directory — `--workspace dir:<abs path>`, including the repo itself. That is a **supported configuration, not a misconfiguration**: sometimes you want the card to execute in the repository directory, and `resolve_workspace` requires the path be absolute specifically to prevent confused-deputy traversal. What it changes is preservation, because the directory is shared with the human and other agents: enumerating `git status --porcelain` and staging every path is correct inside a per-card worktree and functionally `git add -A` anywhere else. This once committed 13 files to `main`, four of them the human's unrelated in-flight files.

**Defend:** dispatch on the declared `workspace_kind`, never on a path heuristic. `scripts/preserve-cards.py` commits only `worktree` cards (and only when the branch or path identifies the card, and the branch is not protected); for `dir` it reports the dirty paths and stages nothing, because only the author knows which files are the card's. Do not "fix" a `dir` card by converting it to a worktree — check with the operator, since the placement was chosen deliberately.

---

## B. Silent no-ops

### B1. `hermes kanban decompose` exits 0 and does nothing

**Looks like:** success. No output, no error, no `decomposed` event, no diagnostic, card unchanged in `triage`.

**Actually:** the manual CLI path no-ops. The **dispatcher's** auto-decompose is a different code path and does work. Do not generalize from one to the other.

**Workaround:** `hermes kanban --board <b> specify <id>` works immediately — it retitles, writes a body, and promotes `triage → todo → ready`.

### B2. `create --initial-status blocked` sets the status but does NOT park the card

**Wrong in both directions before this entry.** The original claim was "fails silently"; the first correction said "it works". Both were wrong, and both came from checking the *create response* instead of the card a minute later.

What actually happens: `--initial-status blocked` is validated against `VALID_INITIAL_STATUSES` and the create response genuinely reports `blocked` — then the dispatcher **promotes the card within seconds**, because a block carrying no `block_kind` is not a human gate.

Observed 2026-08-14 on `t_f9c10d93`, a card deliberately parked pending an operator decision:

```
16:51:38 created      (status: blocked)
16:52:01 promoted     <- 23 seconds later
16:52:01 claimed
16:52:04 spawned
17:07:35 completed    <- did the work nobody approved
```

**Real parking is two steps, and the `--kind` is the part that sticks:**

```bash
hermes kanban --board <b> create "<title>" --body "..." --json   # capture the id
hermes kanban --board <b> block --kind needs_input <id> "Backlog - parked."
```

`needs_input` / `capability` wait for a human. `dependency` waits in todo and auto-promotes. A card blocked with `kind=None` is indistinguishable from one the dispatcher may resume — and it will.

**Verify parking by re-reading the card ~60s after creating it**, never by trusting the create call's output.

### B6. The docs describe `scheduled_at` scheduling that does not exist

`website/docs/user-guide/features/kanban.md` documents time-delayed dispatch:

```bash
hermes kanban create "nightly backup audit" --assignee ops \
  --scheduled-at "2026-06-01T03:00:00Z"
hermes kanban schedule <id> --at <ISO8601>
```

> *"The dispatcher skips ready tasks whose `scheduled_at` is in the future and picks them up on the first tick after that timestamp."*

**None of it is implemented.** Verified on v0.20.1 (2026.8.13, upstream `452465bf`) after a full `hermes update`:

- `create` has no `--scheduled-at`; `schedule` has no `--at` (it takes `task_id` and a free-text reason only).
- The `tasks` table has **no `scheduled_at` column**.
- The string `scheduled_at` appears in exactly two files in the whole tree: that doc, and `gateway/systemd_notify.py` (unrelated meaning).

This was checked *before and after* updating 384 commits, so it is not version lag and not a disabled feature — it is documentation for something that was never built.

**What `schedule` actually does:** parks a card in the `scheduled` column with no time component. That parking is real and unconditional — `recompute_ready` promotes only `WHERE status IN ('todo','blocked')`, so a `scheduled` card is never considered. Release with `unblock <id>`, which accepts `blocked` and `scheduled`.

**If a card must start at a time, use a cron job, not a card.**

### B3. `block` argument order matters

```bash
hermes kanban --board <b> block --kind needs_input <id> "reason"   # works
hermes kanban --board <b> block <id> --kind needs_input "reason"   # unrecognized arguments
```

### B4. zsh does not word-split unquoted variables

```bash
B="hermes kanban --board sellie-emdash"
$B create "..."     # zsh: command not found: hermes kanban --board sellie-emdash
```
The card is never created and nothing obvious says so. Write commands out in full.

### B5. `triage` is not parking

A card blocked with `--kind needs_input` can be re-routed to `triage` by hermes' own unblock-loop breaker. Auto-decompose then eventually fans it into children, one of which reaches `ready` and dispatches — spending tokens on work explicitly parked. Only `blocked` is safe.

Release differs by state: `unblock <id>` for blocked, `specify <id>` for triage.

---

## C. Tooling that answers wrongly

### C1. The `sqlite3` CLI cannot reliably read the live board DB

Any JOIN while workers hold the WAL database returns:
```
Parse error in Nth command line argument: unable to open database file (14)
```
while `SELECT COUNT(*)` on the same DB in the same second succeeds — so it presents as intermittent. Python's module is reliable:
```python
sqlite3.connect(f"file:{db}?mode=ro", uri=True)
```
A shell monitor built on the CLI returns empty and exits 0: **silently blind**.

### C2. Board DBs are per-board

`~/.hermes/kanban/boards/<slug>/kanban.db`. The root `~/.hermes/kanban/kanban.db` exists with **zero tables**, so querying it returns "no such table: task_events" and looks like a schema problem rather than a wrong path.

### C3. `hermes kanban show` crashes in text mode — RETRACTED, fixed upstream

Earlier versions said text-mode `show` raises `sqlite3.ProgrammingError: Cannot operate on a closed database` from `task_graph_context`, and that you must always pass `--json`.

**No longer reproducible** (2026-08-14). Verified on both a card with no parents and a card with five parents — both render the full task, parents included, and exit 0. Text mode is fine; use `--json` when you want to parse, not to avoid a crash.

This is the third entry in this file to have been overtaken by a hermes upgrade. Treat every version-sensitive claim here as provisional and re-verify after `hermes update` — a stale workaround costs less than a stale prohibition, but both mislead.

### C4. Event-kind names — `crashed` IS real; `started` and `failed` are not

**Partially retracted.** Earlier versions listed `crashed` as a non-existent kind. It is a real `task_events` kind, written by `detect_crashed_workers` when a worker PID dies; this board has 10 of them. A monitor built on the old claim drops every crash on the floor — the exact silent failure this file exists to prevent.

`started` and `failed` are genuinely absent.

Two separate vocabularies, which is what caused the confusion:

- **`task_events` kinds** — what `watch --kinds` and any event query filter on. Derive them, never recall them:
  ```sql
  select kind, count(*) from task_events group by kind order by 2 desc;
  ```
  Terminal-failure set: `gave_up, timed_out, protocol_violation, crashed, blocked, block_loop_detected, changes_requested`.
- **diagnostics kinds** — a different engine (`hermes kanban diagnostics --json`): `stuck_in_blocked`, `stranded_in_ready`, `repeated_failures`, `repeated_crashes`, `block_unblock_cycling`, `review_dependency_deadlock`. `repeated_crashes` is a diagnostic; `crashed` is an event. Both exist.

`protocol_violation` is the one worth learning: the worker exited **rc=0** while its card was still `running` — it answered conversationally without ever calling `kanban_complete`. A worker-behaviour bug, not infrastructure; retrying it unchanged reproduces it.

### C4b. `repeated_crashes` fires `critical` on correctly-parked cards

Observed 2026-08-14 on `t_0f50fd5d`. The diagnostic read:

> Agent crashed 5x … The last 5 runs ended with outcome=crashed.

**Both halves were false at the time it fired.** The card was `blocked` with `block_kind=capability`, `worker_pid=None`, `consecutive_failures=1`, and its two most recent runs were `blocked` (a clean, worker-initiated block with a real reason) and `timed_out`. The five crashes were older runs from three hours earlier. The engine counts historical crashes and labels them "the last 5 runs" without noticing that later runs ended otherwise.

**Triage rule:** before acting on a `repeated_crashes` critical, check the card's *current* `status`/`block_kind` and the outcome of its **latest** run (`hermes kanban runs <id>` — the last row, not the count). A correctly parked card needs no action, and treating this alarm as live is how an operator learns to ignore criticals — which is worse than not having them.

### C5. `diagnostics --json` is nested

The top level is a list of **task** objects, each carrying its own `diagnostics` array. The `kind`/`severity`/`title` fields live on the inner entries. Parsing the outer level yields empty fields and an alert that fires correctly while saying nothing.

---

## D. Concurrency and dispatch

### D1. The review lane dispatches last against a shared budget

Ready dispatch runs before review dispatch each tick, both drawing on `kanban.max_in_progress`. With a deep implementer queue, reviews are starved indefinitely — cards reach `review` and stop, so nothing ever reaches `done`.

Symptoms: review cards with `claim_lock` null and only a `review_requested` run, aging past 20 minutes while implementers run.

Remedies: raise `max_in_progress` (costs tokens), or drain the ready queue. `max_in_progress_per_profile` alone does not help if the reviewer profile's allowance is consumed by todo-lane cards assigned to it.

### D2. Review-flavoured cards in the todo lane cannot request changes

`kanban_request_changes` requires an active **review run**. A card dispatched into `running` as an ordinary task has no legal way to express a changes-requested verdict, so a reviewer with valid findings blocks instead — and the findings sit on a blocked card.

**Defend:** when triaging such a block, treat it as a lifecycle mismatch rather than a defect, route the findings to a new card, and close the review card.

### D3. One card's workspace can depend on another's

Observed: `sites/frank/node_modules` in one card's worktree was a symlink into a **different, already-`done`** card's workspace — a reclamation candidate. If it is removed mid-run, builds fail in a way that looks like a dependency bug.

---

## E. Worktree isolation and merging

### E1. Sibling cards cannot see each other's work

Each card works in its own worktree and finishes with changes **uncommitted**, all branches at the same base with 0 commits ahead. Uncommitted changes never enter the shared object store, so a sibling cannot reach them by any git operation — no branch, no ref, no cherry-pick.

Two independent reviews returned FAIL for this reason alone, both concluding "the changes remain in separate uncommitted worktrees rather than one reviewable artifact."

**Defend:** preserve work to branches early (A1). Once committed, integration becomes an ordinary `git diff <base>..<branch>` instead of filesystem archaeology. If work is still uncommitted, give the integrating card the absolute sibling paths and per-file change lists — it cannot discover them.

### E2. Cards created before a landing are silently stale

After work lands on `main`, every in-flight card is based on the old commit. The staleness is invisible from inside the worktree — `git diff` there shows a clean, coherent changeset — so a reviewer approves something that reverts landed work on merge.

**Confirm before approving:**
```bash
git -C "$REPO" rev-list --count <branch>..main
git -C "$REPO" merge-tree $(git -C "$REPO" merge-base main <branch>) main <branch> | grep -c '^<<<<<<<'
```

**Defend:** rebase onto main and re-run that branch's tests **after** the rebase. Tests passing at the old base prove nothing about the merged result. Resolve by taking **both** intents; check specifically that features added on main are still present afterwards.

### E3. A repo-wide formatter turns small changes into whole-file conflicts

If a formatter config is committed without reformatting the codebase, any card that runs the formatter to satisfy a lint gate produces a ~4000-file diff. Three cards were rejected for this. Worse, once some files are reformatted on `main` and branches are not, every line differs on quote style and a ~34-line semantic addition presents as an unmergeable whole-file conflict.

**Confirm:** `git diff --ignore-all-space --stat` — if the file count barely drops, the change is genuine; if it collapses, it is formatting noise.

---

## F. Verification traps

### F1. A pipeline hides the exit code you are testing

```bash
guard.ts | tail -5 ; echo $?    # this is tail's exit code, always 0
```
A guard that prints violations and "exits 0" may simply have been measured through a pipe. Re-run unpiped.

### F2. Editing a manifest does not install anything

Verifying that a version bump "still builds" proves nothing unless the new version is actually in `node_modules`. Check the installed version before trusting a green build.

### F3. A test asserting a failure path prints scary output while passing

Injected errors (`throw new Error('KV unavailable')`) appear in test output verbatim. Scanning for the word "error" reads a passing suite as broken. Read the pass/fail counts.

### F4. `Bun.spawnSync` inside `bun test` can fail with EBADF

Observed on bun 1.4.0-canary.1, reproducible with the sandbox disabled, while `Bun.spawnSync` works standalone in the same shell. A test that shells out to the tool under test fails for harness reasons while the tool itself is fine.

**Defend:** verify the tool directly by its own CLI contract before concluding the code is broken. Prefer in-process assertions over spawning inside tests.

### F5. "Done" does not mean reviewed, and reviews can close as FAIL

Cards can complete without ever entering the review lane — the gate is opt-in per card. Separately, a review card whose verdict is FAIL still closes as `completed`, so board status alone reads as success. Read the summary, not the status.
