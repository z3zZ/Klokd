import datetime
import psutil
import win32gui
import win32process

# PRIVACY: This function reads only the executable name and window
# title of the foreground window. No content, keystrokes, clipboard,
# or user data is accessed. See PRIVACY.md.


def get_active_window() -> dict:
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return {
            "exe": "desktop",
            "title": "Desktop",
            "timestamp": _utc_now(),
        }

    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    try:
        exe = psutil.Process(pid).name()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        exe = "unknown"

    title = win32gui.GetWindowText(hwnd)
    return {
        "exe": exe,
        "title": title,
        "timestamp": _utc_now(),
    }


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
