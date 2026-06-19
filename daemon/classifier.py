import sqlite3
import threading
from pathlib import Path

import yaml
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "config" / "categories.yaml"

_lock = threading.Lock()
_categories: dict = {}
_observer: Observer | None = None


# ---------------------------------------------------------------------------
# Internal load / reload
# ---------------------------------------------------------------------------

def _load_file(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("categories", {})


def _reload(path: Path) -> None:
    global _categories
    try:
        loaded = _load_file(path)
    except Exception:
        return
    with _lock:
        _categories = loaded


# Auto-load on import so classify() works without calling start_watching() first.
try:
    _reload(_DEFAULT_PATH)
except Exception:
    pass


# ---------------------------------------------------------------------------
# Watchdog
# ---------------------------------------------------------------------------

def start_watching(categories_path: str | None = None) -> None:
    global _observer
    path = Path(categories_path) if categories_path else _DEFAULT_PATH
    _reload(path)

    class _Handler(FileSystemEventHandler):
        def on_modified(self, event):
            if not event.is_directory and Path(event.src_path).resolve() == path.resolve():
                _reload(path)

    _observer = Observer()
    _observer.schedule(_Handler(), str(path.parent), recursive=False)
    _observer.daemon = True
    _observer.start()


def stop_watching() -> None:
    global _observer
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify(exe: str, title: str) -> str:
    with _lock:
        cats = dict(_categories)

    exe_lower = exe.lower()
    title_lower = title.lower()

    # Priority 1: exact exe match
    for cat_data in cats.values():
        apps = [a.lower() for a in cat_data.get("apps", [])]
        if exe_lower in apps:
            return cat_data.get("label", "uncategorised")

    # Priority 2: title substring match
    for cat_data in cats.values():
        for pattern in cat_data.get("title_patterns", []):
            if pattern.lower() in title_lower:
                return cat_data.get("label", "uncategorised")

    return "uncategorised"


def classify_batch(events: list[dict]) -> list[dict]:
    result = []
    for event in events:
        updated = dict(event)
        updated["category"] = classify(event.get("exe", ""), event.get("title", ""))
        result.append(updated)
    return result


def recategorise_all(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute("SELECT id, exe, title FROM events").fetchall()
        for row_id, exe, title in rows:
            conn.execute(
                "UPDATE events SET category = ? WHERE id = ?",
                (classify(exe, title), row_id),
            )
        conn.commit()
    finally:
        conn.close()
