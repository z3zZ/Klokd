"""Tests for daemon.classifier."""
import sqlite3
import tempfile
from pathlib import Path

import pytest
import yaml

import daemon.classifier as clf


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _set_categories(cats: dict) -> None:
    """Directly inject categories into the classifier module (no file I/O)."""
    with clf._lock:
        clf._categories = cats


_BASIC_CATS = {
    "productive": {
        "label": "productive",
        "apps": ["code.exe", "python.exe"],
        "title_patterns": ["GitHub", "Stack Overflow"],
    },
    "gaming": {
        "label": "gaming",
        "apps": ["steam.exe"],
        "title_patterns": ["- Steam"],
    },
    "system": {
        "label": "system",
        "apps": ["explorer.exe", "desktop", "unknown"],
        "title_patterns": [],
    },
}


# ---------------------------------------------------------------------------
# classify()
# ---------------------------------------------------------------------------

class TestClassify:
    def setup_method(self):
        _set_categories(_BASIC_CATS)

    def test_exact_exe_match(self):
        assert clf.classify("code.exe", "Some Window") == "productive"

    def test_exact_exe_match_steam(self):
        assert clf.classify("steam.exe", "Steam Library") == "gaming"

    def test_title_pattern_match(self):
        assert clf.classify("chrome.exe", "GitHub — klokd") == "productive"

    def test_title_pattern_match_steam(self):
        assert clf.classify("chrome.exe", "Counter-Strike - Steam") == "gaming"

    def test_exe_beats_title(self):
        # steam.exe should be 'gaming' even if title contains 'GitHub'
        assert clf.classify("steam.exe", "GitHub - Steam") == "gaming"

    def test_unknown_exe_no_title_match(self):
        assert clf.classify("randapp.exe", "Some random title") == "uncategorised"

    def test_case_insensitive_exe(self):
        assert clf.classify("CODE.EXE", "Editor") == "productive"
        assert clf.classify("Code.Exe", "Editor") == "productive"

    def test_case_insensitive_title(self):
        assert clf.classify("chrome.exe", "github — repo") == "productive"

    def test_system_desktop(self):
        assert clf.classify("desktop", "Desktop") == "system"

    def test_system_unknown(self):
        assert clf.classify("unknown", "") == "system"


# ---------------------------------------------------------------------------
# classify_batch()
# ---------------------------------------------------------------------------

class TestClassifyBatch:
    def setup_method(self):
        _set_categories(_BASIC_CATS)

    def test_batch_classifies_all(self):
        events = [
            {"exe": "code.exe", "title": "main.py"},
            {"exe": "steam.exe", "title": "Steam Library"},
            {"exe": "notepad.exe", "title": "untitled"},
        ]
        result = clf.classify_batch(events)
        assert result[0]["category"] == "productive"
        assert result[1]["category"] == "gaming"
        assert result[2]["category"] == "uncategorised"

    def test_batch_does_not_mutate_originals(self):
        events = [{"exe": "code.exe", "title": "file"}]
        original = dict(events[0])
        clf.classify_batch(events)
        assert events[0] == original


# ---------------------------------------------------------------------------
# recategorise_all()
# ---------------------------------------------------------------------------

class TestRecategoriseAll:
    def setup_method(self):
        _set_categories(_BASIC_CATS)

    def test_updates_existing_rows(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        conn = sqlite3.connect(db_path)
        conn.execute(
            "CREATE TABLE events "
            "(id INTEGER PRIMARY KEY, timestamp TEXT, exe TEXT, title TEXT, "
            "is_idle INTEGER, category TEXT, session_id TEXT)"
        )
        conn.execute(
            "INSERT INTO events VALUES (1, '2024-01-01', 'code.exe', 'Editor', 0, NULL, 'sess1')"
        )
        conn.execute(
            "INSERT INTO events VALUES (2, '2024-01-01', 'steam.exe', 'Library', 0, NULL, 'sess1')"
        )
        conn.execute(
            "INSERT INTO events VALUES (3, '2024-01-01', 'randapp.exe', 'Nothing', 0, NULL, 'sess1')"
        )
        conn.commit()
        conn.close()

        clf.recategorise_all(db_path)

        conn = sqlite3.connect(db_path)
        rows = {r[0]: r[1] for r in conn.execute("SELECT id, category FROM events")}
        conn.close()

        assert rows[1] == "productive"
        assert rows[2] == "gaming"
        assert rows[3] == "uncategorised"


# ---------------------------------------------------------------------------
# Hot-reload
# ---------------------------------------------------------------------------

class TestHotReload:
    def test_reload_picks_up_new_categories(self, tmp_path):
        cats_file = tmp_path / "categories.yaml"
        cats_file.write_text(
            yaml.dump({"categories": {
                "productive": {"label": "productive", "apps": ["code.exe"], "title_patterns": []}
            }}),
            encoding="utf-8",
        )

        clf._reload(cats_file)
        assert clf.classify("code.exe", "") == "productive"
        assert clf.classify("steam.exe", "") == "uncategorised"

        # Now write a new version with gaming added
        cats_file.write_text(
            yaml.dump({"categories": {
                "productive": {"label": "productive", "apps": ["code.exe"], "title_patterns": []},
                "gaming": {"label": "gaming", "apps": ["steam.exe"], "title_patterns": []},
            }}),
            encoding="utf-8",
        )
        clf._reload(cats_file)

        assert clf.classify("steam.exe", "") == "gaming"

    def test_reload_tolerates_bad_file(self, tmp_path):
        # Prime with known good state
        _set_categories(_BASIC_CATS)

        bad_file = tmp_path / "bad.yaml"
        bad_file.write_text(": : : invalid yaml :::", encoding="utf-8")

        # _reload should silently keep existing state on failure
        clf._reload(bad_file)
        assert clf.classify("code.exe", "") == "productive"
