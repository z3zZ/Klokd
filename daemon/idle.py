import win32api


def get_idle_seconds() -> float:
    last = win32api.GetLastInputInfo()
    tick = win32api.GetTickCount()
    return (tick - last) / 1000.0


def is_idle(threshold_seconds: float = 120) -> bool:
    return get_idle_seconds() > threshold_seconds
