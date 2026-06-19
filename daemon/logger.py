import sqlite3
from pathlib import Path

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    exe         TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    is_idle     INTEGER NOT NULL DEFAULT 0,
    category    TEXT,
    session_id  TEXT    NOT NULL
);
"""
_CREATE_IDX_TS = "CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp);"
_CREATE_IDX_CAT = "CREATE INDEX IF NOT EXISTS idx_cat ON events(category);"


def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        conn.execute(_CREATE_TABLE)
        conn.execute(_CREATE_IDX_TS)
        conn.execute(_CREATE_IDX_CAT)


def write_event(
    db_path: str,
    exe: str,
    title: str,
    is_idle: bool,
    category: str | None,
    session_id: str,
) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT INTO events (timestamp, exe, title, is_idle, category, session_id) "
            "VALUES (datetime('now'), ?, ?, ?, ?, ?)",
            (exe, title, int(is_idle), category, session_id),
        )


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn
