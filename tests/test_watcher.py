"""Tests for daemon.watcher — mocked so they run without Windows APIs."""
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stub out pywin32 and psutil before importing watcher
# ---------------------------------------------------------------------------

def _make_win32_stubs():
    win32gui = types.ModuleType("win32gui")
    win32process = types.ModuleType("win32process")
    psutil = types.ModuleType("psutil")

    # Default: a valid foreground window
    win32gui.GetForegroundWindow = MagicMock(return_value=1234)
    win32gui.GetWindowText = MagicMock(return_value="Test Window Title")
    win32process.GetWindowThreadProcessId = MagicMock(return_value=(0, 9999))

    process_mock = MagicMock()
    process_mock.name.return_value = "notepad.exe"
    psutil.Process = MagicMock(return_value=process_mock)
    psutil.NoSuchProcess = type("NoSuchProcess", (Exception,), {})
    psutil.AccessDenied = type("AccessDenied", (Exception,), {})

    sys.modules.setdefault("win32gui", win32gui)
    sys.modules.setdefault("win32process", win32process)
    sys.modules.setdefault("psutil", psutil)
    return win32gui, win32process, psutil


_win32gui, _win32process, _psutil = _make_win32_stubs()

from daemon.watcher import get_active_window  # noqa: E402


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestGetActiveWindow:
    def test_normal_window(self):
        _win32gui.GetForegroundWindow.return_value = 1234
        _win32gui.GetWindowText.return_value = "My Editor"
        _win32process.GetWindowThreadProcessId.return_value = (0, 9999)
        _psutil.Process.return_value.name.return_value = "code.exe"

        result = get_active_window()

        assert result["exe"] == "code.exe"
        assert result["title"] == "My Editor"
        assert "timestamp" in result
        assert result["timestamp"].endswith("+00:00")

    def test_no_foreground_window(self):
        _win32gui.GetForegroundWindow.return_value = 0

        result = get_active_window()

        assert result["exe"] == "desktop"
        assert result["title"] == "Desktop"
        assert "timestamp" in result

    def test_access_denied(self):
        _win32gui.GetForegroundWindow.return_value = 5678
        _win32gui.GetWindowText.return_value = "Some Window"
        _win32process.GetWindowThreadProcessId.return_value = (0, 1111)
        _psutil.Process.return_value.name.side_effect = _psutil.AccessDenied("denied")

        result = get_active_window()

        assert result["exe"] == "unknown"
        assert result["title"] == "Some Window"

    def test_no_such_process(self):
        _win32gui.GetForegroundWindow.return_value = 5678
        _win32gui.GetWindowText.return_value = "Ghost Window"
        _win32process.GetWindowThreadProcessId.return_value = (0, 2222)
        _psutil.Process.return_value.name.side_effect = _psutil.NoSuchProcess("gone")

        result = get_active_window()

        assert result["exe"] == "unknown"

    def test_timestamp_is_iso8601_utc(self):
        _win32gui.GetForegroundWindow.return_value = 1234
        _win32gui.GetWindowText.return_value = "Window"
        _win32process.GetWindowThreadProcessId.return_value = (0, 9999)
        _psutil.Process.return_value.name.return_value = "app.exe"
        _psutil.Process.return_value.name.side_effect = None

        result = get_active_window()

        # Should be a valid ISO 8601 UTC string
        from datetime import datetime, timezone
        parsed = datetime.fromisoformat(result["timestamp"])
        assert parsed.tzinfo == timezone.utc
