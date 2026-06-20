import logging
import sqlite3
from contextlib import closing
from pathlib import Path

from daemon.classifier import classify

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
    try:
        _create_schema(db_path)
    except sqlite3.DatabaseError:
        logging.warning("klokd.db corrupt — deleting and recreating schema")
        Path(db_path).unlink(missing_ok=True)
        _create_schema(db_path)


def write_event(
    db_path: str,
    exe: str,
    title: str,
    is_idle: bool,
    session_id: str,
) -> None:
    category = classify(exe, title)
    with closing(_connect(db_path)) as conn:
        conn.execute(
            "INSERT INTO events (timestamp, exe, title, is_idle, category, session_id) "
            "VALUES (datetime('now'), ?, ?, ?, ?, ?)",
            (exe, title, int(is_idle), category, session_id),
        )
        conn.commit()


def _create_schema(db_path: str) -> None:
    with closing(_connect(db_path, wal=True)) as conn:
        conn.execute(_CREATE_TABLE)
        conn.execute(_CREATE_IDX_TS)
        conn.execute(_CREATE_IDX_CAT)
        conn.commit()


def _connect(db_path: str, wal: bool = False) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    if wal:
        conn.execute("PRAGMA journal_mode=WAL;")
    return conn
