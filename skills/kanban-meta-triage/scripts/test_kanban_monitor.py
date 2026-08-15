#!/usr/bin/env python3
"""Regression coverage for the board monitor's starvation age query."""

import importlib.util
import sqlite3
import types
import unittest
from pathlib import Path
from unittest import mock

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MONITOR_PATHS = (
    REPOSITORY_ROOT / ".agents/skills/kanban-meta-triage/scripts/kanban-monitor.py",
    REPOSITORY_ROOT / ".claude/skills/kanban-meta-triage/scripts/kanban-monitor.py",
)
NOW = 2_000_000_000


def load_monitor(path: Path):
    module_name = "kanban_monitor_" + path.parts[-5].lstrip(".")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load monitor at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def synthetic_board() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            assignee TEXT,
            status TEXT NOT NULL,
            last_heartbeat_at INTEGER,
            started_at INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE task_events (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            task_id TEXT NOT NULL,
            payload TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE task_runs (
            task_id TEXT NOT NULL,
            started_at INTEGER,
            status TEXT NOT NULL
        );
        CREATE TABLE task_links (
            parent_id TEXT NOT NULL,
            child_id TEXT NOT NULL
        );
        """
    )
    connection.executemany(
        "INSERT INTO tasks (id, title, status, created_at) VALUES (?, ?, 'ready', ?)",
        (
            ("old", "old ready card", NOW - 1_200),
            ("fresh", "freshly promoted card", NOW - 10),
        ),
    )
    connection.executemany(
        "INSERT INTO task_events (id, kind, task_id, created_at) VALUES (?, 'unblocked', ?, ?)",
        (
            (1, "old", NOW - 1_200),
            (2, "fresh", NOW - 10),
        ),
    )
    return connection


class PipelineStarvationTest(unittest.TestCase):
    def test_oldest_ready_card_triggers_even_when_another_card_is_fresh(self):
        for path in MONITOR_PATHS:
            with self.subTest(path=path):
                monitor = load_monitor(path)
                emitted = []
                with (
                    synthetic_board() as connection,
                    mock.patch.object(monitor.time, "time", return_value=NOW),
                    mock.patch.object(
                        monitor.subprocess,
                        "run",
                        return_value=types.SimpleNamespace(stdout="[]"),
                    ),
                    mock.patch.object(monitor, "emit", side_effect=emitted.append),
                ):
                    active = monitor.check_health(connection, set())

                self.assertIn("starved", active)
                self.assertTrue(
                    any("oldest ready age 20m" in line for line in emitted),
                    emitted,
                )


if __name__ == "__main__":
    unittest.main()
