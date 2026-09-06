#!/usr/bin/env python3
"""Capture Messaging Platform execution baseline and enforce the final cutover."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from _acceptance_artifacts import artifact_session, explicit_output_path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = "reports/messaging-platform-baseline.json"
OWNERSHIP_PATH = (
    ROOT / "tooling/acceptance/plans/messaging-platform-ownership.json"
)

TRACE_RANGES = {
    "capabilities": ("C", 1, 14),
    "journeys": ("J", 1, 12),
    "architecture": ("A", 1, 12),
    "decisions": ("D", 1, 12),
    "workstreams": ("W", 0, 11),
    "gates": ("G", 1, 14),
}

SOURCE_ROOTS = (
    "model/domain/chat",
    "apps/station/frame/touch/model/chat",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/envelope",
    "apps/station/app/subserver/key_exchange",
    "apps/desktop/src/gen/proto/domain/chat",
    "apps/desktop/src-tauri/build.rs",
    "apps/desktop/src/runtimes/cryptoRuntime.ts",
    "apps/desktop/src/runtimes/imRuntime.ts",
    "apps/desktop/src/services/crypto-service.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/services/im-service.ts",
    "apps/desktop/src/services/mediaRuntime.ts",
    "apps/desktop/src/store/socialChat",
    "apps/desktop/src/components/chat",
    "apps/desktop/src-tauri/src/application/key_exchange",
    "apps/desktop/src-tauri/src/domain/crypto",
    "apps/desktop/src-tauri/src/infrastructure/local_chat_store.rs",
    "apps/desktop/src-tauri/src/infrastructure/station_client.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/conversation.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/crypto.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/crypto_backup.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/friend_chat.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/mls.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/messaging",
    "apps/mobile/src/gen/proto/domain/chat",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/features/group",
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src-tauri/src/commands/group_crypto.rs",
    "apps/mobile/src-tauri/src/domain/crypto",
    "apps/mobile/src-tauri/src/messaging",
    "docs/architecture/messaging-platform",
    "docs/architecture/encryption",
    "docs/architecture/federated-im",
    "tooling/acceptance",
    "tooling/scripts",
)

SCAN_ROOTS = (
    "model/domain/chat",
    "apps/station/app/subserver",
    "apps/desktop/src",
    "apps/desktop/src-tauri/src",
    "apps/mobile/src",
    "apps/mobile/src-tauri/src",
)

FORBIDDEN_PATHS = {
    "station_messaging_subserver": "apps/station/app/subserver/messaging",
}

FORBIDDEN_RULES = {
    "public_messaging_route": (
        re.compile(r"""["']/messaging/"""),
        SCAN_ROOTS,
    ),
    "frontend_inbox_ownership": (
        re.compile(r"\b(envelope_ack|envelope_resume|dkx_send)\b"),
        ("apps/desktop/src",),
    ),
    "frontend_crypto_ownership": (
        re.compile(r"\bcrypto_(encrypt|decrypt)(?:_message)?\b"),
        ("apps/desktop/src",),
    ),
    "frontend_durable_queue_local_storage": (
        re.compile(r"PENDING_COMMAND_PROPOSALS_KEY|peers_im_device_id"),
        ("apps/desktop/src",),
    ),
    "global_device_header": (
        re.compile(r"static\s+DEVICE_ID|set_device_id\("),
        ("apps/desktop/src-tauri/src",),
    ),
    "old_friend_transport": (
        re.compile(r"friend_chat_(send_message|ack_messages|sync_from_station_scoped)"),
        (
            "apps/desktop/src",
            "apps/desktop/src-tauri/src",
            "apps/station/app/subserver",
        ),
    ),
    "sender_keys": (
        re.compile(r"SenderKey|sender_key|sender-key"),
        ("apps/mobile/src", "apps/mobile/src-tauri/src", "model/domain/chat"),
    ),
    "generic_decrypt_placeholder": (
        re.compile(r"\[Message cannot be decrypted\]"),
        ("apps/desktop/src", "apps/mobile/src"),
    ),
}


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.rstrip("\n")


def is_generated(path: str) -> bool:
    return "/gen/proto/" in path or path.endswith(".pb.go")


def classify(path: str) -> str:
    if path.startswith(SOURCE_ROOTS):
        if is_generated(path):
            return "generated"
        return "messaging_scope"
    return "unrelated_or_shared"


def load_ownership() -> dict[str, list[str]]:
    raw = json.loads(OWNERSHIP_PATH.read_text(encoding="utf-8"))
    return {
        workstream: list(prefixes)
        for workstream, prefixes in raw["workstreams"].items()
    }


def mapped_workstreams(
    path: str, ownership: dict[str, list[str]]
) -> list[str]:
    return sorted(
        workstream
        for workstream, prefixes in ownership.items()
        if any(path == prefix or path.startswith(prefix) for prefix in prefixes)
    )


def dirty_inventory() -> dict[str, object]:
    ownership = load_ownership()
    entries: list[dict[str, object]] = []
    for raw in run_git("status", "--porcelain=v1").splitlines():
        if not raw:
            continue
        status = raw[:2]
        path = raw[3:]
        entry = {
            "status": status,
            "path": path,
            "classification": classify(path),
            "workstreams": mapped_workstreams(path, ownership),
        }
        entries.append(entry)
    counts: dict[str, int] = {}
    for entry in entries:
        key = entry["classification"]
        counts[key] = counts.get(key, 0) + 1
    unmapped = [
        entry["path"]
        for entry in entries
        if entry["classification"] != "unrelated_or_shared"
        and not entry["workstreams"]
    ]
    return {
        "count": len(entries),
        "counts": counts,
        "unmapped_messaging_paths": unmapped,
        "entries": entries,
    }


def iter_source_files(prefixes: Iterable[str]) -> Iterable[Path]:
    for prefix in prefixes:
        root = ROOT / prefix
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or is_generated(path.relative_to(ROOT).as_posix()):
                continue
            if path.suffix not in {
                ".go",
                ".proto",
                ".rs",
                ".ts",
                ".tsx",
            }:
                continue
            yield path


def forbidden_inventory() -> dict[str, object]:
    result: dict[str, object] = {
        rule_id: {
            "count": int((ROOT / relative_path).exists()),
            "examples": (
                [{"path": relative_path}]
                if (ROOT / relative_path).exists()
                else []
            ),
        }
        for rule_id, relative_path in FORBIDDEN_PATHS.items()
    }
    for rule_id, (pattern, prefixes) in FORBIDDEN_RULES.items():
        matches: list[dict[str, object]] = []
        for path in iter_source_files(prefixes):
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for line_number, line in enumerate(text.splitlines(), start=1):
                if pattern.search(line):
                    matches.append(
                        {
                            "path": path.relative_to(ROOT).as_posix(),
                            "line": line_number,
                            "text": line.strip()[:240],
                        }
                    )
        result[rule_id] = {
            "count": len(matches),
            "examples": matches[:20],
        }
    return result


def traceability_inventory() -> dict[str, object]:
    docs_root = ROOT / "docs/architecture/messaging-platform"
    text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(docs_root.rglob("*.md"))
    )
    missing: dict[str, list[str]] = {}
    for group, (prefix, start, end) in TRACE_RANGES.items():
        expected = [
            f"MP-{prefix}{index:02d}" for index in range(start, end + 1)
        ]
        group_missing = [item for item in expected if item not in text]
        if group_missing:
            missing[group] = group_missing
    status = {
        "product_accepted": "PRODUCT_ACCEPTED" in text,
        "architecture_accepted": "ARCHITECTURE_ACCEPTED" in text,
        "plan_approved": "PLAN_APPROVED" in text,
    }
    return {"missing_ids": missing, "status": status}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail unless all cutover-forbidden source patterns are absent.",
    )
    args = parser.parse_args()

    forbidden = forbidden_inventory()
    traceability = traceability_inventory()
    dirty = dirty_inventory()
    plan_ready = (
        not traceability["missing_ids"]
        and all(traceability["status"].values())
        and not dirty["unmapped_messaging_paths"]
    )
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workstream": "MP-W00",
        "runtime_evidence_schema": (
            "tooling/acceptance/schemas/messaging-platform-evidence.schema.json"
        ),
        "repository": {
            "commit": run_git("rev-parse", "HEAD"),
            "branch": run_git("branch", "--show-current"),
        },
        "dirty_worktree": dirty,
        "traceability": traceability,
        "cutover_forbidden": forbidden,
        "plan_ready": plan_ready,
        "strict_ready": (
            plan_ready
            and all(item["count"] == 0 for item in forbidden.values())
        ),
    }

    if args.output is not None:
        output = explicit_output_path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(output)
    else:
        with artifact_session("messaging-platform-baseline") as session:
            session.write_json(DEFAULT_OUTPUT, report, role="baseline")
            session.complete(
                status="pass" if report["plan_ready"] else "fail",
                completion_status=(
                    "DONE" if report["plan_ready"] else "PARTIAL"
                ),
                proof_status=(
                    "PROVEN" if report["plan_ready"] else "UNPROVEN"
                ),
            )
        print(DEFAULT_OUTPUT)
    print(
        json.dumps(
            {
                "dirty": report["dirty_worktree"]["count"],
                "unmapped_messaging_paths": dirty["unmapped_messaging_paths"],
                "missing_ids": traceability["missing_ids"],
                "plan_ready": report["plan_ready"],
                "forbidden_counts": {
                    key: value["count"] for key, value in forbidden.items()
                },
                "strict_ready": report["strict_ready"],
            },
            sort_keys=True,
        )
    )
    if not report["plan_ready"]:
        return 1
    if args.strict and not report["strict_ready"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
