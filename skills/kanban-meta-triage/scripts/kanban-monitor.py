#!/usr/bin/env python3
"""Board-scoped kanban monitor for the sellie-emdash autonomous loop.

WHY PYTHON, NOT THE sqlite3 CLI: the sqlite3 command-line tool fails with
"unable to open database file (14)" on any JOIN against the live WAL database
while hermes' dispatcher/workers hold it -- while SELECT COUNT(*) succeeds.
A shell monitor built on it goes SILENTLY BLIND. Python's sqlite3 module with
the same read-only URI is reliable. Verified empirically 2026-08-11.

WHY BOARD-SCOPED, NOT ONE MONITOR PER CARD: 19 of the 25 cards on this board
were created by auto-decomposer, not by this session. A per-card monitor can
only be armed for a card you know exists, so it structurally cannot cover
decomposer-spawned children -- ~76% of the board. A board-scoped cursor covers
every card, including ones created after the monitor is armed.

Emits tagged lines:
  [ATTN]    a card needs a decision from me (blocked, review, failure, phantom)
  [FLOW]    the pipeline advanced (completed, decomposed, unblocked, specified)
  [HEALTH]  ABSENCE of progress -- stalls, starvation, hermes diagnostics
  [MON-ERR] the monitor itself failed. Silence must never look like success.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time

BOARD = os.environ.get("BOARD", "sellie-emdash")
DB = os.path.expanduser(f"~/.hermes/kanban/boards/{BOARD}/kanban.db")
# Per-board so two boards watched at once don't share a cursor. Override with
# STATE_FILE to keep state across reboots; the default is fine per session.
STATE = os.environ.get(
    "STATE_FILE",
    os.path.join(tempfile.gettempdir(), f"kanban-monitor-{BOARD}.json"),
)
EVENT_POLL_S = int(os.environ.get("EVENT_POLL_S", "15"))
HEALTH_EVERY = int(os.environ.get("HEALTH_EVERY", "8"))     # 8 * 15s = 2 min
HEARTBEAT_COLD_S = int(os.environ.get("HEARTBEAT_COLD_S", "900"))
STARVED_S = int(os.environ.get("STARVED_S", "600"))
REVIEW_STALL_S = int(os.environ.get("REVIEW_STALL_S", "1200"))   # 20m in review, no reviewer
BOARD_STALL_S = int(os.environ.get("BOARD_STALL_S", "1800"))     # 30m, zero events board-wide
REPLAY = os.environ.get("REPLAY") == "1"                     # test hook

# Cards needing MY decision. Names verified against _append_event call sites
# in hermes_cli/*.py -- NOT guessed. 'crashed'/'started'/'failed' are NOT
# task_event kinds (crashed belongs to the diagnostics engine; the real names
# are spawned/claimed and error).
ATTN = (
    "blocked", "gave_up", "timed_out", "error", "block_loop_detected",
    "claim_rejected", "phantom_cards", "phantom_refs", "respawn_guarded",
    "review_requested", "changes_requested", "stale",
    "descendant_invalidated", "review_reopened",
)
FLOW = ("completed", "decomposed", "unblocked", "specified")
WATCHED = ATTN + FLOW


def emit(line):
    print(line, flush=True)


def load_state():
    try:
        with open(STATE) as fh:
            s = json.load(fh)
        return int(s.get("cursor", 0)), set(s.get("health", []))
    except Exception:
        return None, set()


def save_state(cursor, health):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump({"cursor": cursor, "health": sorted(health)}, fh)
    os.replace(tmp, STATE)


def connect():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    con.execute("PRAGMA busy_timeout=10000")
    return con


def one_line(v, n):
    return " ".join(str(v or "").split())[:n]


def poll_events(con, cursor):
    q = f"""SELECT e.id, e.kind, e.task_id, t.title, t.assignee, e.payload
            FROM task_events e JOIN tasks t ON t.id = e.task_id
            WHERE e.id > ? AND e.kind IN ({','.join('?' * len(WATCHED))})
            ORDER BY e.id"""
    rows = con.execute(q, (cursor, *WATCHED)).fetchall()
    for eid, kind, tid, title, assignee, payload in rows:
        tag = "ATTN" if kind in ATTN else "FLOW"
        emit(f"[{tag}] {kind:<18} {tid}  {one_line(title, 70)}  "
             f"({assignee or '-'})  {one_line(payload, 220)}")
        cursor = eid
    return cursor



_TASK_ROW_WARNED = False


def _task_row(tid):
    """Current status/failure count for a card, or None. Used to suppress
    failure diagnostics that describe history the card has already recovered
    from.

    A failure here must NOT be silent: returning None fails OPEN (the
    diagnostic still fires), so a broken probe would quietly restore the exact
    noise this filter exists to remove. Warn once per process instead.
    """
    global _TASK_ROW_WARNED
    con = None
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        return con.execute(
            "SELECT status, consecutive_failures FROM tasks WHERE id = ?",
            (tid,),
        ).fetchone()
    except Exception as ex:
        if not _TASK_ROW_WARNED:
            _TASK_ROW_WARNED = True
            emit(f"[MON-ERR] staleness filter disabled — cannot read task rows: "
                 f"{type(ex).__name__}: {ex}. Failure diagnostics will include "
                 f"stale history until this is fixed.")
        return None
    finally:
        if con is not None:
            con.close()

def check_health(con, active):
    """Return the set of currently-active health signals, emitting new ones."""
    now = int(time.time())
    found = {}

    # 1. hermes' own diagnostics engine (stuck_in_blocked, stranded_in_ready,
    #    repeated_failures, block_unblock_cycling, review_dependency_deadlock...)
    try:
        out = subprocess.run(
            ["hermes", "kanban", "--board", BOARD, "diagnostics", "--json"],
            capture_output=True, text=True, timeout=60,
        ).stdout.strip()
        if out:
            # Shape is NESTED: a list of task objects, each carrying its own
            # `diagnostics` array. The kind/severity/title live on the INNER
            # entries -- reading them off the outer row yields empty fields.
            for task in json.loads(out):
                tid = task.get("task_id")
                for r in task.get("diagnostics", []):
                    kind = r.get("kind")
                    # STALENESS FILTER. The failure diagnostics count HISTORICAL
                    # runs and label them "the last N runs", without checking
                    # whether a later run ended otherwise. Six false-positive
                    # `repeated_crashes` criticals fired on 2026-08-14 against
                    # cards that were parked, reassigned, or already recovered --
                    # one of them while the card sat at fails=0 having just
                    # ended a run with a deliberate `blocked`.
                    #
                    # A card is only genuinely failing if its CURRENT state says
                    # so. consecutive_failures is reset by the dispatcher on a
                    # clean run, so it is the honest signal.
                    if kind in ("repeated_crashes", "repeated_failures"):
                        cur = _task_row(tid)
                        if cur and cur["consecutive_failures"] == 0:
                            continue  # recovered since; the count is history
                        if cur and cur["status"] in ("done", "archived", "blocked"):
                            continue  # parked or finished; nothing to act on
                    k = f"diag:{kind}:{tid}"
                    found[k] = (
                        f"[HEALTH] diagnostic {r.get('severity', '?')} "
                        f"{kind} {tid} (x{r.get('count', 1)}) "
                        f"{one_line(r.get('title'), 120)} — "
                        f"{one_line(r.get('detail'), 160)}")
    except Exception as ex:
        emit(f"[MON-ERR] diagnostics probe failed: {type(ex).__name__}: {ex}")

    # 2. running card whose heartbeat has gone cold (a hung worker emits
    #    nothing at all -- no event stream can see this)
    for tid, age, title in con.execute(
        "SELECT id, ? - COALESCE(last_heartbeat_at, started_at, created_at), title "
        "FROM tasks WHERE status='running' "
        "AND ? - COALESCE(last_heartbeat_at, started_at, created_at) > ?",
        (now, now, HEARTBEAT_COLD_S),
    ):
        found[f"cold:{tid}"] = (f"[HEALTH] STALLED {tid} no heartbeat {age}s "
                                f"({age // 60}m) — {one_line(title, 70)}")

    # 3. pipeline starvation -- work queued but nothing spawning
    # "oldest ready" must measure time-since-READY, not time-since-created.
    # Epic parents are created at decomposition and promoted last, so a
    # created_at-based age reports every epic's final card as ~hours stale at
    # the exact moment it legitimately becomes ready -- a guaranteed false
    # alarm on normal completion. Use the card's newest event instead, which
    # is its promotion.
    nready, nrunning, oldest_age = con.execute(
        "SELECT (SELECT COUNT(*) FROM tasks WHERE status='ready'),"
        "       (SELECT COUNT(*) FROM tasks WHERE status='running'),"
        "       COALESCE((SELECT MAX(? - ready_since) FROM ("
        "           SELECT COALESCE((SELECT MAX(e.created_at) FROM task_events e"
        "                            WHERE e.task_id = t.id), t.created_at) AS ready_since"
        "           FROM tasks t WHERE t.status='ready')),0)",
        (now,),
    ).fetchone()
    if nready and not nrunning and oldest_age > STARVED_S:
        found["starved"] = (f"[HEALTH] PIPELINE STARVED — {nready} ready, 0 running, "
                            f"oldest ready age {oldest_age // 60}m. Check `hermes gateway status`.")

    # 4. review-lane stall. The starvation check above requires running==0, so
    #    with implementers busy it can NEVER fire even if the review lane is
    #    completely dead -- and cards stuck in review never reach 'done', which
    #    is exactly the create->done loop failing.
    for tid, age, title in con.execute(
        "SELECT t.id, ? - COALESCE(MAX(r.started_at), t.created_at) AS age, t.title "
        "FROM tasks t LEFT JOIN task_runs r ON r.task_id = t.id "
        "WHERE t.status='review' GROUP BY t.id "
        "HAVING age > ? AND SUM(CASE WHEN r.status='running' THEN 1 ELSE 0 END) = 0",
        (now, REVIEW_STALL_S),
    ):
        found[f"revstall:{tid}"] = (
            f"[HEALTH] REVIEW STALLED {tid} — in review {age // 60}m, no reviewer run "
            f"claimed — {one_line(title, 60)}")

    # 5. whole-board wedge. Catches every lane at once, including ones not
    #    enumerated above: outstanding work exists but NOTHING has happened.
    newest = con.execute("SELECT COALESCE(MAX(created_at),0) FROM task_events").fetchone()[0]
    outstanding, in_triage = con.execute(
        "SELECT (SELECT COUNT(*) FROM tasks WHERE status IN "
        "        ('ready','running','review','todo','triage')),"
        "       (SELECT COUNT(*) FROM tasks WHERE status='triage')").fetchone()
    # A card only counts as STALLED if it could actually be progressing.
    # Observed 2026-08-12: this fired over 4 todo cards gated behind a blocked
    # parent and told the operator to check the gateway. Dependency-gated todo,
    # triage, and blocked are all legitimately non-progressing states -- a quiet
    # board holding only those is the intended steady state, not a fault.
    # Genuine stalls are ready/review cards nobody claims (cold heartbeats are
    # already covered by check 2).
    dispatchable = con.execute(
        "SELECT COUNT(*) FROM tasks t WHERE t.status IN ('ready','review') "
        "   OR (t.status='todo' AND NOT EXISTS ("
        "        SELECT 1 FROM task_links l JOIN tasks p ON p.id = l.parent_id"
        "        WHERE l.child_id = t.id AND p.status NOT IN ('done','archived')))"
    ).fetchone()[0]
    if dispatchable and outstanding and newest and (now - newest) > BOARD_STALL_S:
        # Do NOT assert a cause. Observed 2026-08-12: this fired reporting
        # "dispatcher likely dead" while the gateway was healthy and
        # `dispatch --dry-run` was clean. The real cause was a triage card the
        # decomposer silently no-opped on -- `decompose` exits 0 with no output
        # and no state change, while `specify` works. Triage cards legitimately
        # emit no events while parked, so name the likely cause, don't guess it.
        cause = ("all open work is parked in TRIAGE — the decomposer may be "
                 "silently no-opping; try `hermes kanban --board <b> specify <id>`"
                 if in_triage == outstanding else
                 "check `hermes gateway status` and `hermes kanban dispatch --dry-run`")
        found["boardstall"] = (
            f"[HEALTH] BOARD IDLE — {outstanding} open cards ({in_triage} in triage), "
            f"no event of any kind for {(now - newest) // 60}m. {cause}")

    for k, msg in found.items():
        if k not in active:
            emit(msg)
    return set(found)


def main():
    if not os.path.exists(DB):
        emit(f"[MON-ERR] board db missing: {DB}")
        sys.exit(1)

    cursor, health = load_state()
    if cursor is None:
        with connect() as con:
            cursor = 0 if REPLAY else (
                con.execute("SELECT COALESCE(MAX(id),0) FROM task_events").fetchone()[0])

    tick, fails = 0, 0
    while True:
        try:
            with connect() as con:
                cursor = poll_events(con, cursor)
                if tick % HEALTH_EVERY == 0:
                    health = check_health(con, health)
            save_state(cursor, health)
            fails = 0
        except Exception as ex:
            fails += 1
            # Surface every 4th consecutive failure: loud enough to notice,
            # quiet enough not to flood if the board is briefly locked.
            if fails == 1 or fails % 4 == 0:
                emit(f"[MON-ERR] poll failed x{fails}: {type(ex).__name__}: {ex}")
        tick += 1
        time.sleep(EVENT_POLL_S)


if __name__ == "__main__":
    main()
