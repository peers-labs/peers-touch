"""Bounded macOS document observations for source-bound file actions."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.core.errors import BlockedError


def run_document_script(script: str) -> str:
    result = subprocess.run(
        ("/usr/bin/osascript", "-e", script),
        capture_output=True, text=True, check=False, timeout=10,
    )
    if result.returncode:
        raise GateError("Native document observation failed")
    return result.stdout.strip()


def document_windows(pid: int) -> list[str]:
    # `exists (application process whose unix id is ...)` returns
    # errAEEventFailed (-1728) on current macOS releases even when the
    # process exists; resolve the process reference directly instead.
    value = run_document_script(f"""
        tell application "System Events"
          set targetProcess to missing value
          try
            set targetProcess to first application process whose unix id is {pid}
          end try
          if targetProcess is missing value then return ""
          set titles to name of every window of targetProcess
          set AppleScript's text item delimiters to linefeed
          return titles as text
        end tell
    """)
    return value.splitlines() if value else []


def process_document_window(pid: int) -> dict | None:
    """Read the on-screen window owned by a document process, including qlmanage."""
    if pid <= 0:
        raise GateError("Native document process identity is invalid")
    probe = r"""
import json
import sys
import Quartz

windows = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
    Quartz.kCGNullWindowID,
)
candidates = []
for window in windows:
    if int(window.get(Quartz.kCGWindowOwnerPID, -1)) != int(sys.argv[1]):
        continue
    bounds = window.get(Quartz.kCGWindowBounds) or {}
    if float(window.get(Quartz.kCGWindowAlpha, 0)) <= 0:
        continue
    if float(bounds.get("Width", 0)) <= 1 or float(bounds.get("Height", 0)) <= 1:
        continue
    candidates.append({
        "processId": int(sys.argv[1]),
        "windowId": int(window[Quartz.kCGWindowNumber]),
        "x": float(bounds["X"]), "y": float(bounds["Y"]),
        "width": float(bounds["Width"]), "height": float(bounds["Height"]),
    })
if len(candidates) > 1:
    raise SystemExit("Native document window identity is ambiguous")
if candidates:
    display = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())
    candidates[0]["display"] = {
        "x": float(display.origin.x), "y": float(display.origin.y),
        "width": float(display.size.width), "height": float(display.size.height),
    }
print(json.dumps(candidates[0] if candidates else None))
"""
    completed = subprocess.run(
        (sys.executable, "-c", probe, str(pid)),
        capture_output=True, text=True, check=False, timeout=2,
    )
    if completed.returncode:
        raise GateError(f"Native document window inspection failed: {completed.stderr.strip()}")
    value = json.loads(completed.stdout)
    if value is not None and (not isinstance(value, dict) or value.get("processId") != pid):
        raise GateError("Native document window inspection returned an invalid identity")
    return value


def text_editor_document(path: Path, operation: str = "read") -> str:
    commands = {
        "read": "return text of targetDocument",
        "close": "close targetDocument saving no",
        "edit": 'set text of targetDocument to "edited-by-external-application"\n'
                "save targetDocument",
    }
    return run_document_script(f"""
        tell application id "com.apple.TextEdit"
          set targetDocument to first document whose path is {json.dumps(str(path))}
          {commands[operation]}
        end tell
    """)


def text_editor_running() -> bool:
    # Direct process lookup works across macOS releases; the
    # `exists (application process whose bundle identifier is ...)`
    # predicate fails with -1728 on current System Events.
    return run_document_script("""
        tell application "System Events"
          return exists application process "TextEdit"
        end tell
    """) == "true"


def require_text_editor_default(source: Path) -> bool:
    script = """
        ObjC.import('AppKit');
        function run(args) {
            const file = $.NSURL.fileURLWithPath($(args[0]));
            const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(file);
            if (!app) return '';
            return ObjC.unwrap($.NSBundle.bundleWithURL(app).bundleIdentifier);
        }
    """
    result = subprocess.run(
        ("/usr/bin/osascript", "-l", "JavaScript", "-e", script, str(source)),
        capture_output=True, text=True, check=True, timeout=10,
    )
    if result.stdout.strip() != "com.apple.TextEdit":
        raise BlockedError(
            reason="Native external-edit oracle requires the current text-file handler",
            resource="desktop-macos-native:default-text-application",
        )
    return text_editor_running()


def text_editor_pid() -> int:
    return int(run_document_script("""
        tell application "System Events"
          return unix id of first application process whose bundle identifier is "com.apple.TextEdit"
        end tell
    """))


def close_owned_text_editor_document(path: Path, already_running: bool) -> None:
    run_document_script(f"""
        if application id "com.apple.TextEdit" is running then
          tell application id "com.apple.TextEdit"
            set matchingDocuments to every document whose path is {json.dumps(str(path))}
            repeat with targetDocument in matchingDocuments
              close targetDocument saving no
            end repeat
            if not {str(already_running).lower()} and (count of documents) is 0 then quit
          end tell
        end if
    """)
