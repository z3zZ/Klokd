import sqlite3
from contextlib import closing
from datetime import datetime, timezone

from insights import templates as t

POLL = 5  # seconds per event (matches daemon default)


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _fmt_hour(h: int) -> str:
    if h == 0:
        return "12am"
    if h < 12:
        return f"{h}am"
    if h == 12:
        return "12pm"
    return f"{h - 12}pm"


def _fmt_time_range(h: int) -> str:
    return f"{_fmt_hour(h)}–{_fmt_hour(h + 2)}"


def _fmt_seconds(s: int) -> str:
    h, m = s // 3600, (s % 3600) // 60
    return f"{h}h {m}m" if h else f"{m}m"


def _peak_hour(conn: sqlite3.Connection) -> int | None:
    """Return the starting hour of the best 2-hour productive window, or None."""
    days = conn.execute("""
        SELECT COUNT(DISTINCT date(timestamp)) AS d
        FROM events
        WHERE timestamp >= datetime('now', '-7 days')
          AND category = 'productive'
          AND is_idle = 0
    """).fetchone()["d"]
    if days < 4:
        return None

    rows = conn.execute("""
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS cnt
        FROM events
        WHERE timestamp >= datetime('now', '-7 days')
          AND category = 'productive'
          AND is_idle = 0
        GROUP BY hour
    """).fetchall()

    hour_counts = {r["hour"]: r["cnt"] for r in rows}
    if not hour_counts:
        return None

    # Scan hours 0-22 so the window [h, h+1] never wraps midnight
    best = max(range(23), key=lambda h: hour_counts.get(h, 0) + hour_counts.get(h + 1, 0))
    if hour_counts.get(best, 0) + hour_counts.get(best + 1, 0) == 0:
        return None
    return best


def peak_focus_window(db_path: str) -> dict | None:
    try:
        with closing(_connect(db_path)) as conn:
            hour = _peak_hour(conn)
    except Exception:
        return None

    if hour is None:
        return None

    text = t.TEMPLATES["peak_focus"].format(time_range=_fmt_time_range(hour))
    return {"text": t.validate(text), "priority": 2}


def gaming_vs_average(db_path: str) -> dict | None:
    MIN_DELTA = 30 * 60  # 30 minutes

    try:
        with closing(_connect(db_path)) as conn:
            today_cnt = conn.execute("""
                SELECT COUNT(*) AS n FROM events
                WHERE date(timestamp) = date('now')
                  AND category = 'gaming'
                  AND is_idle = 0
            """).fetchone()["n"]

            past_rows = conn.execute("""
                SELECT COUNT(*) AS n FROM events
                WHERE timestamp >= datetime('now', '-7 days')
                  AND date(timestamp) < date('now')
                  AND category = 'gaming'
                  AND is_idle = 0
            """).fetchone()["n"]
    except Exception:
        return None

    today_secs = today_cnt * POLL
    avg_secs = (past_rows * POLL) / 7
    delta = today_secs - avg_secs

    if abs(delta) < MIN_DELTA:
        return None

    key = "gaming_above_avg" if delta > 0 else "gaming_below_avg"
    text = t.TEMPLATES[key].format(delta=_fmt_seconds(int(abs(delta))))
    return {"text": t.validate(text), "priority": 1}


def focus_fragmentation(db_path: str) -> dict | None:
    try:
        with closing(_connect(db_path)) as conn:
            rows = conn.execute("""
                SELECT exe FROM events
                WHERE date(timestamp) = date('now')
                  AND category = 'productive'
                  AND is_idle = 0
                ORDER BY timestamp
            """).fetchall()
    except Exception:
        return None

    if len(rows) < 2:
        return None

    productive_hours = (len(rows) * POLL) / 3600
    if productive_hours < 0.5:
        return None

    switches = sum(1 for i in range(1, len(rows)) if rows[i]["exe"] != rows[i - 1]["exe"])
    if switches / productive_hours <= 8:
        return None

    text = t.TEMPLATES["focus_fragmented"].format(count=switches)
    return {"text": t.validate(text), "priority": 2}


def long_streak(db_path: str) -> dict | None:
    MIN_STREAK = 90 * 60    # 90 minutes
    GAP_LIMIT = 120         # 2-minute gap breaks the streak

    try:
        with closing(_connect(db_path)) as conn:
            rows = conn.execute("""
                SELECT timestamp FROM events
                WHERE date(timestamp) = date('now')
                  AND category = 'productive'
                  AND is_idle = 0
                ORDER BY timestamp
            """).fetchall()
    except Exception:
        return None

    if not rows:
        return None

    def parse(ts: str) -> datetime:
        return datetime.fromisoformat(ts.replace(" ", "T")).replace(tzinfo=timezone.utc)

    best = current = POLL
    for i in range(1, len(rows)):
        gap = (parse(rows[i]["timestamp"]) - parse(rows[i - 1]["timestamp"])).total_seconds()
        if gap <= GAP_LIMIT:
            current += POLL
        else:
            best = max(best, current)
            current = POLL
    best = max(best, current)

    if best < MIN_STREAK:
        return None

    text = t.TEMPLATES["long_streak"].format(duration=_fmt_seconds(best))
    return {"text": t.validate(text), "priority": 3}


def week_over_week(db_path: str) -> dict | None:
    try:
        with closing(_connect(db_path)) as conn:
            def _totals(sql: str) -> dict:
                return {
                    r["cat"]: r["cnt"] * POLL
                    for r in conn.execute(sql).fetchall()
                }

            this_week = _totals("""
                SELECT COALESCE(category, 'uncategorised') AS cat, COUNT(*) AS cnt
                FROM events
                WHERE timestamp >= datetime('now', '-7 days')
                  AND is_idle = 0
                GROUP BY cat
            """)
            last_week = _totals("""
                SELECT COALESCE(category, 'uncategorised') AS cat, COUNT(*) AS cnt
                FROM events
                WHERE timestamp >= datetime('now', '-14 days')
                  AND timestamp < datetime('now', '-7 days')
                  AND is_idle = 0
                GROUP BY cat
            """)
    except Exception:
        return None

    if not this_week or not last_week:
        return None

    top_cat = max(this_week, key=this_week.get)
    this_secs = this_week[top_cat]
    prev_secs = last_week.get(top_cat, 0)

    if prev_secs == 0:
        return None

    pct_change = (this_secs - prev_secs) / prev_secs * 100
    if abs(pct_change) <= 25:
        return None

    pct = int(abs(pct_change))
    key = "week_category_up" if pct_change > 0 else "week_category_down"
    text = t.TEMPLATES[key].format(category=top_cat.capitalize(), pct=pct)
    return {"text": t.validate(text), "priority": 2}


def productive_peak_missed(db_path: str) -> dict | None:
    try:
        with closing(_connect(db_path)) as conn:
            hour = _peak_hour(conn)
            if hour is None:
                return None

            row = conn.execute(f"""
                SELECT COALESCE(category, 'uncategorised') AS cat, COUNT(*) AS cnt
                FROM events
                WHERE date(timestamp) = date('now')
                  AND CAST(strftime('%H', timestamp) AS INTEGER) IN ({hour}, {hour + 1})
                  AND is_idle = 0
                GROUP BY cat
                ORDER BY cnt DESC
                LIMIT 1
            """).fetchone()
    except Exception:
        return None

    if not row:
        return None

    dominant = row["cat"]
    if dominant == "productive":
        return None

    text = t.TEMPLATES["productive_peak_missed"].format(category=dominant)
    return {"text": t.validate(text), "priority": 1}


def get_insights(db_path: str, max: int = 2) -> list[dict]:
    fns = [
        gaming_vs_average,
        productive_peak_missed,
        peak_focus_window,
        focus_fragmentation,
        week_over_week,
        long_streak,
    ]
    results = []
    for fn in fns:
        try:
            result = fn(db_path)
            if result is not None:
                results.append(result)
        except Exception:
            pass
    results.sort(key=lambda r: r["priority"])
    return results[:max]
