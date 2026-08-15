#!/usr/bin/env python3
"""Preserve kanban card work, dispatching on the card's declared workspace kind.

WHAT ACTUALLY DELETES WORK (verified against hermes_cli/kanban_db.py, not
assumed). Both deletion paths -- ``_cleanup_workspace`` on completion and
``kanban gc`` on archived tasks -- skip non-scratch kinds:

    "Only ``scratch`` workspaces are removed; ``worktree`` and ``dir``
     workspaces are intentionally preserved."   -- _cleanup_workspace

So the three kinds need three different treatments, and a single blanket
"stage everything dirty" pass is wrong for two of them:

  scratch   The workspace IS destroyed on complete/archive. It is a plain dir,
            not a git repo, so there is nothing to commit -- the supported
            mechanism is ``kanban_complete(artifacts=[...])``, which hermes
            copies out before cleanup (_persist_scratch_completion_artifacts).
            This script cannot rescue those; it REPORTS them while the files
            still exist so a human can act.

  worktree  Nothing deletes it, so there is no race -- but the branch is what
            gets reviewed and merged, and a run that dies at its iteration cap
            hands the next run nothing if work was never committed. Safe to
            stage wholesale: everything dirty in a per-card worktree belongs to
            that one card. This is the only kind this script commits.

  dir       A deliberate, supported configuration (``--workspace dir:<abs>``);
            sometimes you WANT a card to run in the repository itself. The
            directory is shared with the human and other agents, so enumerating
            `status --porcelain` and staging every path is functionally
            `git add -A`. Never auto-stage. Report only.

HISTORY: on 2026-08-12 an earlier inline version of this sweep committed 13
files directly to `main`, including the user's unrelated in-flight files,
because card t_a9d4f673 ran with workspace_kind='dir' pointed at the repo root.
The fix is to dispatch on the declared kind -- not to treat 'dir' as damage.
"""
import os
import subprocess
import sys

_HERMES_HOME = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
sys.path.insert(
    0,
    os.environ.get("HERMES_HOME_SRC", os.path.join(_HERMES_HOME, "hermes-agent")),
)
try:
    import hermes_cli.kanban_db as kb
except Exception as exc:  # pragma: no cover - surfaced, never silent
    sys.exit(f"[MON-ERR] cannot import hermes_cli.kanban_db: {exc}")

BOARD = os.environ.get("BOARD", "sellie-emdash")
MAX_FILES = int(os.environ.get("MAX_FILES", "200"))
PROTECTED_BRANCHES = {"main", "master", "develop"}
# Cards in these states hold work worth preserving. 'review' matters as much as
# 'done': a card can request review with an empty branch, and the reviewer then
# has nothing to review. Terminal-failure states keep a crashed run's progress.
PRESERVE_STATES = ("done", "review", "blocked", "running")


def git(path, *args):
    return subprocess.run(["git", "-C", path, *args], capture_output=True, text=True)


def dirty_files(path):
    out = git(path, "status", "--porcelain").stdout
    return [l[3:].strip().strip('"') for l in out.splitlines() if l.strip()]


def is_git_repo(path):
    return git(path, "rev-parse", "--git-dir").returncode == 0


def handle_worktree(task, files):
    """The one kind we commit. Verify the surface is exclusive to this card."""
    path = task.workspace_path
    branch = git(path, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch in PROTECTED_BRANCHES:
        print(f"  {task.id}: REFUSED — worktree is on protected branch '{branch}'")
        return 0
    # The card id must appear in the branch or the path, so we know this surface
    # belongs to THIS card and not to a shared or borrowed checkout.
    if task.id not in branch and task.id not in os.path.realpath(path):
        print(f"  {task.id}: REFUSED — branch '{branch}' and path do not identify the card")
        return 0
    if len(files) > MAX_FILES:
        print(f"  {task.id}: SKIPPED — {len(files)} files, looks like a formatter "
              f"blowup rather than card work; stage explicitly instead")
        return 0
    if git(path, "add", "--", *files).returncode != 0:
        print(f"  {task.id}: REFUSED — git add failed")
        return 0
    commit = git(
        path, "-c", "user.name=connor-loop", "-c", "user.email=connor@blackfinbrands.com",
        "commit", "-m",
        f"wip({task.id}): preserve card work\n\n"
        f"Committed by the meta-triage sweep so the card's branch carries its "
        f"work: the branch is what gets reviewed and merged, and an interrupted "
        f"run otherwise hands its successor nothing.",
    )
    if commit.returncode != 0:
        print(f"  {task.id}: REFUSED — {(commit.stdout + commit.stderr).strip()[:120]}")
        return 0
    sha = git(path, "rev-parse", "--short", "HEAD").stdout.strip()
    print(f"  {task.id}: SAVED {len(files)} files -> {branch} @ {sha}")
    return 1


def handle_scratch(task, entries):
    """Cannot be committed — report while the files still exist."""
    verb = "WILL BE DELETED" if task.status in ("done", "archived") else "at risk"
    print(f"  {task.id}: [ATTN] scratch workspace {verb} on completion/gc — "
          f"{len(entries)} path(s) at {task.workspace_path}")
    print(f"           hermes only preserves scratch deliverables declared via "
          f"kanban_complete(artifacts=[...]); copy them out or re-complete with "
          f"artifacts before this card is archived.")
    return 0


def handle_dir(task, files):
    """Deliberate configuration. Never auto-stage a shared directory."""
    print(f"  {task.id}: [INFO] workspace_kind='dir' at {task.workspace_path} — "
          f"{len(files)} dirty path(s), NOT staged.")
    print(f"           This is a supported configuration, not an error: the "
          f"directory is shared, so only the card's own files should be staged, "
          f"by whoever knows which those are.")
    return 0


def main():
    saved = 0
    with kb.connect_closing(board=BOARD) as conn:
        tasks = [t for s in PRESERVE_STATES for t in kb.list_tasks(conn, status=s)]

    for task in tasks:
        path = task.workspace_path
        if not path or not os.path.isdir(path):
            continue
        kind = task.workspace_kind

        if kind == "scratch":
            entries = os.listdir(path)
            if entries:
                handle_scratch(task, entries)
            continue

        if not is_git_repo(path):
            print(f"  {task.id}: [INFO] {kind} workspace is not a git repo — nothing to commit")
            continue

        files = dirty_files(path)
        if not files:
            continue

        if kind == "worktree":
            saved += handle_worktree(task, files)
        elif kind == "dir":
            handle_dir(task, files)
        else:
            print(f"  {task.id}: [ATTN] unknown workspace_kind={kind!r} — "
                  f"{len(files)} dirty path(s), taking no action")

    print(f"preserved: {saved}")


if __name__ == "__main__":
    main()
