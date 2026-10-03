#!/usr/bin/env python3
"""Deterministic session-CLI fixture configuration for P12 Acceptance."""

from __future__ import annotations

import json
import re


RUNTIME_ROOT_BASE = "/app/data/acceptance-external-runtimes"

START_SCRIPT = (
    'set -eu; home="$1"; '
    'session="session-${PEERS_TOUCH_EXTERNAL_SESSION_EPOCH}-${home##*/}"; '
    'printf "%s" "$session" > "$home/session-id"; '
    'printf \'{"type":"session.started","session_id":"%s"}\\n\' "$session"; '
    'printf \'%s\\n\' '
    '\'{"type":"activity","activity":{"id":"p12-start",'
    '"kind":"command","status":"completed","title":"External session"}}\'; '
    'printf \'%s\\n\' '
    '\'{"type":"turn.completed","content":"external-start-ok"}\''
)

RESUME_SCRIPT = (
    'set -eu; session="$1"; home="$2"; prompt="$(cat)"; '
    'test -f "$home/session-id"; '
    'test "$(cat "$home/session-id")" = "$session"; '
    'case "$prompt" in '
    '*P12_FORCE_RESUME_UNAVAILABLE*) '
    'printf \'%s\\n\' '
    '\'{"type":"turn.failed","code":"resume_unavailable"}\'; exit 7 ;; '
    '*P12_BLOCK_UNTIL_CANCEL*) '
    'printf \'{"type":"session.started","session_id":"%s"}\\n\' "$session"; '
    'sleep 300; exit 8 ;; '
    '*P12_ARM_RESET_FAILURE*) : > "$home/.fail-reset-once" ;; '
    'esac; '
    'printf \'{"type":"session.started","session_id":"%s"}\\n\' "$session"; '
    'printf \'%s\\n\' '
    '\'{"type":"turn.completed","content":"external-resume-ok"}\''
)

RESET_SCRIPT = (
    'set -eu; session="$1"; home="$2"; '
    'audit_dir="${home%/*}/audit"; mkdir -p "$audit_dir"; '
    'audit="$audit_dir/${home##*/}.reset"; '
    'if [ ! -f "$home/session-id" ]; then '
    'test -f "$audit" && grep -qx success "$audit" && exit 0; exit 4; fi; '
    'test "$(cat "$home/session-id")" = "$session"; '
    'if [ -f "$home/.fail-reset-once" ]; then '
    'rm -f "$home/.fail-reset-once"; printf \'failed\\n\' >> "$audit"; exit 9; '
    'fi; '
    'sleep 1; '
    'printf \'success\\n\' >> "$audit"'
)


def external_runtime_root(run_id: str) -> str:
    safe_run_id = re.sub(r"[^A-Za-z0-9._-]", "-", run_id).strip(".-")
    if not safe_run_id:
        raise ValueError("external runtime fixture run ID is invalid")
    return f"{RUNTIME_ROOT_BASE}/{safe_run_id}"


def external_runtime_environment(run_id: str) -> dict[str, str]:
    return {
        "PT_AGENT_EXTERNAL_RUNTIME_ROOT": external_runtime_root(run_id),
        "PT_AGENT_EXTERNAL_START_ARGV_JSON": json.dumps(
            ["/bin/sh", "-c", START_SCRIPT, "p12-start", "{runtime_home}"],
            separators=(",", ":"),
        ),
        "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON": json.dumps(
            [
                "/bin/sh",
                "-c",
                RESUME_SCRIPT,
                "p12-resume",
                "{session_id}",
                "{runtime_home}",
            ],
            separators=(",", ":"),
        ),
        "PT_AGENT_EXTERNAL_RESET_ARGV_JSON": json.dumps(
            [
                "/bin/sh",
                "-c",
                RESET_SCRIPT,
                "p12-reset",
                "{session_id}",
                "{runtime_home}",
            ],
            separators=(",", ":"),
        ),
    }
