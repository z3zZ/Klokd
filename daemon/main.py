# NETWORK AUDIT — klokd makes zero outbound network requests at runtime.
# Python dependencies: pywin32, psutil, watchdog, pyyaml, sqlite3 (stdlib)
# None of these make network calls during normal operation.
# The only network call in the entire app is loading JetBrains Mono
# from Google Fonts in the Electron renderer on first load.
# This can be replaced with a local font file for fully offline operation.

import logging
import logging.handlers
import os
import signal
import sys
import time
import uuid
from pathlib import Path

# Ensure project root is on sys.path when run as a script (pythonw.exe daemon/main.py)
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import yaml  # noqa: E402 — after sys.path setup

from daemon.classifier import start_watching, stop_watching  # noqa: E402
from daemon.idle import is_idle  # noqa: E402
from daemon.logger import init_db, write_event  # noqa: E402
from daemon.watcher import get_active_window  # noqa: E402

_SETTINGS_PATH = _project_root / "config" / "settings.yaml"
_shutdown = False


def _load_settings() -> dict:
    with open(_SETTINGS_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _setup_logging(log_path: str) -> None:
    Path(log_path).parent.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(
        log_path, maxBytes=10 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[handler],
    )


def _write_pid(pid_path: str) -> None:
    Path(pid_path).parent.mkdir(parents=True, exist_ok=True)
    Path(pid_path).write_text(str(os.getpid()), encoding="utf-8")


def _remove_pid(pid_path: str) -> None:
    try:
        Path(pid_path).unlink()
    except FileNotFoundError:
        pass


def _handle_signal(signum, frame):
    global _shutdown
    logging.info("Received signal %s — shutting down", signum)
    _shutdown = True


def main() -> None:
    settings = _load_settings()
    _setup_logging(settings["log_path"])
    logging.info("klokd daemon starting")

    pid_path = str(_project_root / "data" / "daemon.pid")
    _write_pid(pid_path)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    db_path = settings["db_path"]
    init_db(db_path)
    start_watching()

    session_id = str(uuid.uuid4())
    poll_interval = settings["poll_interval_seconds"]
    idle_threshold = settings["idle_threshold_seconds"]

    logging.info("Session %s started — polling every %ss", session_id, poll_interval)

    try:
        while not _shutdown:
            time.sleep(poll_interval)
            if _shutdown:
                break
            try:
                window = get_active_window()
                idle = is_idle(idle_threshold)
                write_event(
                    db_path=db_path,
                    exe=window["exe"],
                    title=window["title"],
                    is_idle=idle,
                    session_id=session_id,
                )
            except Exception:
                logging.exception("Error during poll tick — continuing")
    finally:
        stop_watching()
        _remove_pid(pid_path)
        logging.info("klokd daemon stopped cleanly")


if __name__ == "__main__":
    main()
