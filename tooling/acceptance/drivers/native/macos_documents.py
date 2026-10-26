"""Bounded macOS document observations for source-bound file actions."""

from __future__ import annotations

import json
import subprocess
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
    value = run_document_script(f"""
        tell application "System Events"
          if not (exists (application process whose unix id is {pid})) then return ""
          set targetProcess to first application process whose unix id is {pid}
          set titles to name of every window of targetProcess
          set AppleScript's text item delimiters to linefeed
          return titles as text
        end tell
    """)
    return value.splitlines() if value else []


def document_contains(pid: int, expected_text: str) -> bool:
    value = run_document_script(f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {pid}
          set nodes to entire contents of window 1 of targetProcess
          if (count of nodes) > 1000 then error "preview AX tree exceeds bound"
          repeat with node in nodes
            try
              set content to value of attribute "AXValue" of node as text
              if content contains {json.dumps(expected_text)} then return "matched"
            end try
          end repeat
          return "unproven"
        end tell
    """)
    return value == "matched"


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
    return run_document_script("""
        tell application "System Events"
          return exists (application process whose bundle identifier is "com.apple.TextEdit")
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
