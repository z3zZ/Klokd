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

_DEFAULT_CATEGORIES_YAML = """\
categories:
  productive:
    label: "productive"
    color: "#C8F135"
    apps: [code.exe, devenv.exe, windowsterminal.exe, python.exe, pythonw.exe, node.exe]
    title_patterns: ["Visual Studio Code", "GitHub", "Stack Overflow", "localhost"]
  gaming:
    label: "gaming"
    color: "#7C6FE8"
    apps: [steam.exe, epicgameslauncher.exe, battle.net.exe]
    title_patterns: ["- Steam"]
  social:
    label: "social"
    color: "#E8785A"
    apps: [discord.exe, slack.exe, teams.exe]
    title_patterns: [Twitter, Reddit, WhatsApp, Messenger]
  entertainment:
    label: "entertainment"
    color: "#5AB4E8"
    apps: [vlc.exe, spotify.exe]
    title_patterns: [YouTube, Netflix, Twitch]
  system:
    label: "system"
    color: "#333333"
    apps: [explorer.exe, taskmgr.exe, desktop, unknown]
    title_patterns: []
"""


def _load_file(path: Path) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return data.get("categories", {})
    except FileNotFoundError:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_DEFAULT_CATEGORIES_YAML, encoding="utf-8")
        return yaml.safe_load(_DEFAULT_CATEGORIES_YAML).get("categories", {})


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
        cats = _categories

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
