TEMPLATES = {
    "peak_focus":             "Your most focused window tends to be {time_range}.",
    "gaming_above_avg":       "Gaming ran {delta} above your weekly average.",
    "gaming_below_avg":       "Gaming is down {delta} on your usual week.",
    "focus_fragmented":       "You switched apps {count} times during focused work today.",
    "long_streak":            "You held a focused session for {duration} today.",
    "week_category_up":       "{category} time is up {pct}% on last week.",
    "week_category_down":     "{category} time is down {pct}% on last week.",
    "productive_peak_missed": "Your usual focus window was {category} today.",
    "insufficient_data":      None,
}

FORBIDDEN_WORDS = [
    "waste", "wasting", "wasted", "too much", "should",
    "warning", "great job", "well done", "bad", "unproductive",
    "shame", "guilty", "problem",
]


def validate(text: str) -> str:
    lower = text.lower()
    for word in FORBIDDEN_WORDS:
        if word.lower() in lower:
            raise ValueError(f"Forbidden word {word!r} in insight text: {text!r}")
    return text
