import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

from insights import templates as t
from insights import engine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db(events: list[dict]) -> str:
    """Write a temp SQLite DB seeded with `events` and return its path."""
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    f.close()
    conn = sqlite3.connect(f.name)
    conn.execute("""
        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            exe TEXT NOT NULL,
            title TEXT NOT NULL,
            is_idle INTEGER NOT NULL DEFAULT 0,
            category TEXT,
            session_id TEXT NOT NULL DEFAULT 'test'
        )
    """)
    conn.execute("CREATE INDEX idx_ts  ON events(timestamp)")
    conn.execute("CREATE INDEX idx_cat ON events(category)")
    conn.executemany(
        "INSERT INTO events (timestamp, exe, title, is_idle, category) VALUES (?,?,?,?,?)",
        [(e["ts"], e.get("exe", "app.exe"), e.get("title", ""), e.get("idle", 0), e.get("cat")) for e in events],
    )
    conn.commit()
    conn.close()
    return f.name


def _ts(days_ago: int = 0, hour: int = 10, minute: int = 0) -> str:
    """UTC timestamp string N days ago at the given hour."""
    dt = datetime.now(timezone.utc).replace(hour=hour, minute=minute, second=0, microsecond=0)
    dt = dt - timedelta(days=days_ago)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _productive_events(days_ago: int, start_hour: int, count: int, exe: str = "code.exe") -> list[dict]:
    """Generate `count` productive events spaced 5s apart from start_hour."""
    events = []
    base = datetime.now(timezone.utc).replace(hour=start_hour, minute=0, second=0, microsecond=0)
    base -= timedelta(days=days_ago)
    for i in range(count):
        ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
        events.append({"ts": ts, "exe": exe, "cat": "productive"})
    return events


@pytest.fixture(autouse=True)
def cleanup_db(request):
    """Remove temp DB files after each test."""
    dbs: list[str] = []
    request.addfinalizer(lambda: [os.unlink(p) for p in dbs if os.path.exists(p)])

    original_make = _make_db.__wrapped__ if hasattr(_make_db, "__wrapped__") else None

    def tracked_make(events):
        path = _make_db(events)
        dbs.append(path)
        return path

    request.cls._make_db = staticmethod(tracked_make) if request.cls else None
    return tracked_make


# ---------------------------------------------------------------------------
# templates.validate
# ---------------------------------------------------------------------------

class TestValidate:
    def test_clean_text_passes(self):
        assert t.validate("Your focus window is 10am–12pm.") == "Your focus window is 10am–12pm."

    @pytest.mark.parametrize("word", t.FORBIDDEN_WORDS)
    def test_forbidden_word_raises(self, word):
        with pytest.raises(ValueError, match="Forbidden word"):
            t.validate(f"You have a {word} habit.")

    def test_case_insensitive_detection(self):
        with pytest.raises(ValueError):
            t.validate("You WASTED time today.")

    def test_returns_text_on_success(self):
        text = "Your session is looking good."
        assert t.validate(text) is text


# ---------------------------------------------------------------------------
# peak_focus_window
# ---------------------------------------------------------------------------

class TestPeakFocusWindow:
    def test_returns_insight_with_enough_data(self, cleanup_db):
        events = []
        for day in range(5):
            events += _productive_events(day, start_hour=10, count=720)  # 1h of events at 10am
        path = cleanup_db(events)
        result = engine.peak_focus_window(path)
        assert result is not None
        assert "10am" in result["text"] or "11am" in result["text"]
        assert result["priority"] == 2

    def test_returns_none_with_fewer_than_4_days(self, cleanup_db):
        events = []
        for day in range(3):
            events += _productive_events(day, start_hour=10, count=720)
        path = cleanup_db(events)
        assert engine.peak_focus_window(path) is None

    def test_returns_none_on_empty_db(self, cleanup_db):
        path = cleanup_db([])
        assert engine.peak_focus_window(path) is None

    def test_identifies_peak_hour_correctly(self, cleanup_db):
        events = []
        for day in range(5):
            # Heavy activity at 14:00, sparse at 10:00
            events += _productive_events(day, start_hour=14, count=3600)  # 5h
            events += _productive_events(day, start_hour=10, count=120)
        path = cleanup_db(events)
        result = engine.peak_focus_window(path)
        assert result is not None
        assert "2pm" in result["text"] or "3pm" in result["text"]

    def test_text_validates_no_forbidden_words(self, cleanup_db):
        events = []
        for day in range(5):
            events += _productive_events(day, start_hour=9, count=720)
        path = cleanup_db(events)
        result = engine.peak_focus_window(path)
        assert result is not None
        t.validate(result["text"])  # must not raise


# ---------------------------------------------------------------------------
# gaming_vs_average
# ---------------------------------------------------------------------------

class TestGamingVsAverage:
    def _gaming(self, days_ago: int, count: int) -> list[dict]:
        events = []
        base = datetime.now(timezone.utc).replace(hour=20, minute=0, second=0, microsecond=0)
        base -= timedelta(days=days_ago)
        for i in range(count):
            ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            events.append({"ts": ts, "exe": "game.exe", "cat": "gaming"})
        return events

    def test_above_average_fires(self, cleanup_db):
        # Past 7 days: ~10min/day average; today: 60min → delta ~50min > 30min threshold
        events = []
        for day in range(1, 8):
            events += self._gaming(day, count=120)  # 120*5 = 600s = 10min
        events += self._gaming(0, count=720)  # 3600s = 60min
        path = cleanup_db(events)
        result = engine.gaming_vs_average(path)
        assert result is not None
        assert "above" in result["text"]
        assert result["priority"] == 1

    def test_below_average_fires(self, cleanup_db):
        # Past 7 days: 60min/day; today: 0 → delta -60min < -30min threshold
        events = []
        for day in range(1, 8):
            events += self._gaming(day, count=720)  # 3600s = 60min
        path = cleanup_db(events)
        result = engine.gaming_vs_average(path)
        assert result is not None
        assert "down" in result["text"]

    def test_small_delta_returns_none(self, cleanup_db):
        # Today and average both ~10min; delta well under 30min
        events = []
        for day in range(0, 8):
            events += self._gaming(day, count=120)
        path = cleanup_db(events)
        assert engine.gaming_vs_average(path) is None

    def test_no_gaming_data_returns_none(self, cleanup_db):
        path = cleanup_db([])
        assert engine.gaming_vs_average(path) is None


# ---------------------------------------------------------------------------
# focus_fragmentation
# ---------------------------------------------------------------------------

class TestFocusFragmentation:
    def test_fires_on_high_switch_rate(self, cleanup_db):
        # 1 hour of productive events alternating between 2 executables → ~720 switches/hour > 8
        events = []
        base = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
        for i in range(720):  # 1h at 5s each
            ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            exe = "app_a.exe" if i % 2 == 0 else "app_b.exe"
            events.append({"ts": ts, "exe": exe, "cat": "productive"})
        path = cleanup_db(events)
        result = engine.focus_fragmentation(path)
        assert result is not None
        assert result["priority"] == 2
        assert "switched" in result["text"]

    def test_low_switch_rate_returns_none(self, cleanup_db):
        # 1 hour on one exe, no switches
        events = _productive_events(0, start_hour=10, count=720, exe="code.exe")
        path = cleanup_db(events)
        assert engine.focus_fragmentation(path) is None

    def test_insufficient_productive_time_returns_none(self, cleanup_db):
        # Only 5 minutes (< 30 min threshold)
        events = _productive_events(0, start_hour=10, count=60)
        path = cleanup_db(events)
        assert engine.focus_fragmentation(path) is None

    def test_no_data_returns_none(self, cleanup_db):
        path = cleanup_db([])
        assert engine.focus_fragmentation(path) is None


# ---------------------------------------------------------------------------
# long_streak
# ---------------------------------------------------------------------------

class TestLongStreak:
    def test_fires_on_long_unbroken_streak(self, cleanup_db):
        # 2 hours with 5-second gaps between events → streak >= 90min
        events = _productive_events(0, start_hour=9, count=1440, exe="code.exe")
        path = cleanup_db(events)
        result = engine.long_streak(path)
        assert result is not None
        assert result["priority"] == 3
        assert "h" in result["text"]

    def test_short_streak_returns_none(self, cleanup_db):
        # 30 minutes continuous
        events = _productive_events(0, start_hour=10, count=360)
        path = cleanup_db(events)
        assert engine.long_streak(path) is None

    def test_gap_breaks_streak(self, cleanup_db):
        # Two 50-min blocks separated by a 5-minute gap — neither reaches 90min
        base = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
        events = []
        for i in range(600):  # 50 min
            ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            events.append({"ts": ts, "exe": "code.exe", "cat": "productive"})
        # 5-minute gap, then another 50-min block
        gap_start = base + timedelta(minutes=55)
        for i in range(600):
            ts = (gap_start + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            events.append({"ts": ts, "exe": "code.exe", "cat": "productive"})
        path = cleanup_db(events)
        assert engine.long_streak(path) is None

    def test_no_data_returns_none(self, cleanup_db):
        path = cleanup_db([])
        assert engine.long_streak(path) is None

    def test_exactly_90_min_fires(self, cleanup_db):
        # Exactly 90 minutes of continuous productive events
        events = _productive_events(0, start_hour=10, count=1080)  # 1080 * 5s = 5400s = 90min
        path = cleanup_db(events)
        result = engine.long_streak(path)
        assert result is not None


# ---------------------------------------------------------------------------
# week_over_week
# ---------------------------------------------------------------------------

class TestWeekOverWeek:
    def _cat_events(self, days_ago: int, cat: str, count: int) -> list[dict]:
        events = []
        base = datetime.now(timezone.utc).replace(hour=14, minute=0, second=0, microsecond=0)
        base -= timedelta(days=days_ago)
        for i in range(count):
            ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            events.append({"ts": ts, "exe": "app.exe", "cat": cat})
        return events

    def test_fires_on_large_increase(self, cleanup_db):
        # Last week: 1h productive; this week: 2h productive → +100% > 25%
        events = []
        for day in range(8, 15):
            events += self._cat_events(day, "productive", 720)  # 1h
        for day in range(1, 8):
            events += self._cat_events(day, "productive", 1440)  # 2h
        path = cleanup_db(events)
        result = engine.week_over_week(path)
        assert result is not None
        assert "up" in result["text"] or "%" in result["text"]
        assert result["priority"] == 2

    def test_fires_on_large_decrease(self, cleanup_db):
        events = []
        for day in range(8, 15):
            events += self._cat_events(day, "productive", 1440)  # 2h
        for day in range(1, 8):
            events += self._cat_events(day, "productive", 720)  # 1h → -50%
        path = cleanup_db(events)
        result = engine.week_over_week(path)
        assert result is not None
        assert "down" in result["text"]

    def test_small_change_returns_none(self, cleanup_db):
        # 10% change — below 25% threshold
        events = []
        for day in range(8, 15):
            events += self._cat_events(day, "productive", 1000)
        for day in range(1, 8):
            events += self._cat_events(day, "productive", 1100)  # +10%
        path = cleanup_db(events)
        assert engine.week_over_week(path) is None

    def test_no_last_week_data_returns_none(self, cleanup_db):
        events = []
        for day in range(0, 7):
            events += self._cat_events(day, "productive", 720)
        path = cleanup_db(events)
        assert engine.week_over_week(path) is None


# ---------------------------------------------------------------------------
# productive_peak_missed
# ---------------------------------------------------------------------------

class TestProductivePeakMissed:
    def test_fires_when_peak_window_spent_on_other_category(self, cleanup_db):
        events = []
        # Build historical peak at 10am (4+ days of productive data there)
        for day in range(1, 6):
            events += _productive_events(day, start_hour=10, count=1440)
        # Today: gaming at 10am (the peak window)
        base = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
        for i in range(720):
            ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            events.append({"ts": ts, "exe": "game.exe", "cat": "gaming"})
        path = cleanup_db(events)
        result = engine.productive_peak_missed(path)
        assert result is not None
        assert "gaming" in result["text"]
        assert result["priority"] == 1

    def test_returns_none_when_peak_window_is_productive(self, cleanup_db):
        events = []
        for day in range(0, 6):
            events += _productive_events(day, start_hour=10, count=1440)
        path = cleanup_db(events)
        assert engine.productive_peak_missed(path) is None

    def test_returns_none_with_insufficient_history(self, cleanup_db):
        # Only 2 days of history — peak_hour returns None
        events = []
        for day in range(0, 3):
            events += _productive_events(day, start_hour=10, count=720)
        path = cleanup_db(events)
        assert engine.productive_peak_missed(path) is None


# ---------------------------------------------------------------------------
# get_insights (integration)
# ---------------------------------------------------------------------------

class TestGetInsights:
    def test_returns_empty_list_on_no_data(self, cleanup_db):
        path = cleanup_db([])
        result = engine.get_insights(path, max=2)
        assert result == []

    def test_respects_max_parameter(self, cleanup_db):
        # Insert data that should trigger multiple insights
        events = []
        for day in range(0, 8):
            base = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
            base -= timedelta(days=day)
            for i in range(1440):  # 2h productive
                ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
                events.append({"ts": ts, "exe": "app_a.exe" if i % 4 == 0 else "code.exe", "cat": "productive"})
        path = cleanup_db(events)
        result = engine.get_insights(path, max=1)
        assert len(result) <= 1

    def test_results_sorted_by_priority(self, cleanup_db):
        events = []
        # Data that reliably triggers long_streak (priority 3) and focus_fragmentation (priority 2)
        base = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
        for i in range(3600):
            ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
            exe = "app_a.exe" if i % 2 == 0 else "app_b.exe"
            events.append({"ts": ts, "exe": exe, "cat": "productive"})
        path = cleanup_db(events)
        result = engine.get_insights(path, max=5)
        priorities = [r["priority"] for r in result]
        assert priorities == sorted(priorities)

    def test_all_texts_pass_validate(self, cleanup_db):
        events = []
        for day in range(0, 8):
            base = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
            base -= timedelta(days=day)
            for i in range(720):
                ts = (base + timedelta(seconds=i * 5)).strftime("%Y-%m-%d %H:%M:%S")
                events.append({"ts": ts, "exe": "code.exe", "cat": "productive"})
        path = cleanup_db(events)
        result = engine.get_insights(path, max=5)
        for item in result:
            t.validate(item["text"])  # must not raise
