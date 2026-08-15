#!/bin/sh
# A/B-verify an Oxlint scope card: did it FIX the errors, or SILENCE them?
#
# Usage:  verify-lint-card.sh <task-id> [scope-path ...]
#
# With no scope paths, the changed files' directories are used.
#
# WHY THIS EXISTS: a lint card has two outcomes that produce identical output —
# the error is gone because the code is safer, or gone because someone added a
# disable directive. `oxlint` prints the same clean result either way. The only
# place they differ is the diff, so this checks both, always, in one pass.
#
# NOTE: oxlint cannot start from a clean checkout here — it aborts with
#   Failed to load JS plugin: eslint-plugin-lit
# The package is pinned (2.2.1) and in bun.lock, just absent from node_modules,
# and a full `bun install` stalls on this workspace graph. Fetch the three
# surgically (no manifest/lockfile change); worktrees resolve node_modules
# upward, so installing once at the repo root covers every card:
#
#   for p in eslint-plugin-lit@2.2.1 parse5@6.0.1 parse5-htmlparser2-tree-adapter@6.0.1; do
#     n=${p%@*}; v=${p#*@}; t=$(mktemp -d)
#     curl -sL "https://registry.npmjs.org/$n/-/$n-$v.tgz" -o "$t/p.tgz"
#     mkdir -p "node_modules/$n" && tar -xzf "$t/p.tgz" -C "node_modules/$n" --strip-components=1
#   done
set -u

TASK="${1:-}"
[ -n "$TASK" ] || { echo "usage: $0 <task-id> [scope-path ...]" >&2; exit 2; }
shift 2>/dev/null || true

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo" >&2; exit 2; }
WT="$REPO/.worktrees/$TASK"
[ -d "$WT" ] || { echo "no worktree at $WT" >&2; exit 2; }

command -v oxlint >/dev/null || { echo "oxlint not on PATH" >&2; exit 2; }

# Scope: explicit args, else the directories the card actually touched.
if [ "$#" -gt 0 ]; then
    SCOPES="$*"
else
    SCOPES=$(git -C "$WT" diff --name-only main...HEAD 2>/dev/null \
             | grep -vE '\.(md|json|lock)$' \
             | xargs -n1 dirname 2>/dev/null | sort -u | tr '\n' ' ')
fi
[ -n "$SCOPES" ] || { echo "could not determine a scope; pass paths explicitly" >&2; exit 2; }

echo "task:   $TASK"
echo "scopes: $SCOPES"
echo

count_errors () {  # $1=dir  $2...=scopes
    d=$1; shift
    ( cd "$d" && timeout 300 oxlint $@ 2>&1 ) | grep -cE ': error ' 2>/dev/null | head -1
}

BEFORE=$(count_errors "$REPO" $SCOPES)
AFTER=$(count_errors "$WT" $SCOPES)

echo "errors in scope"
echo "  before (main):      $BEFORE"
echo "  after  (worktree):  $AFTER"
echo

# The check that matters more than the counts.
SUPPRESSIONS=$(git -C "$WT" diff main...HEAD 2>/dev/null \
    | grep -cE '^\+.*(eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error)' 2>/dev/null | head -1)

echo "suppression directives ADDED: $SUPPRESSIONS"
if [ "$SUPPRESSIONS" -gt 0 ]; then
    echo
    echo "  !! errors may be SILENCED rather than fixed — inspect these:"
    git -C "$WT" diff main...HEAD \
        | grep -E '^\+.*(eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error)' \
        | sed 's/^/    /'
fi

echo
if [ "$SUPPRESSIONS" -gt 0 ]; then
    echo "VERDICT: INSPECT — suppression directives added"; exit 1
elif [ "$AFTER" -lt "$BEFORE" ]; then
    echo "VERDICT: FIXED — $((BEFORE - AFTER)) fewer errors, no suppressions"; exit 0
elif [ "$AFTER" -eq "$BEFORE" ]; then
    echo "VERDICT: NO CHANGE — same error count; did the fix reach this scope?"; exit 1
else
    echo "VERDICT: REGRESSED — more errors than main"; exit 1
fi
