#!/usr/bin/env python3
"""Fail closed on undeclared Chat debug egress and fabricated identity evidence."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
PRODUCTION_ROOTS = (
    Path("apps/station/app/subserver/conversation"),
    Path("apps/mobile/src"),
    Path("apps/mobile/src-tauri/src"),
)
SOURCE_SUFFIXES = frozenset({".go", ".rs", ".ts", ".tsx"})
COLLECTOR_URL_PATTERN = re.compile(
    r"https?://(?:\d{1,3}\.){3}\d{1,3}:\d+/(?:event|events?)\b"
)
DEBUG_MARKER = "#region debug-point"
SEARCH_ACTION_PATH = Path("apps/mobile/src/acceptance/actions.ts")
SEARCH_CONTRACT_PATH = Path("apps/mobile/src/acceptance/contracts.ts")
DESKTOP_HARNESS_PATH = Path("apps/desktop/src/acceptance/chat/harness.ts")


@dataclass(frozen=True)
class SafetyFinding:
    path: str
    line: int
    code: str
    message: str


def _source_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for relative_root in PRODUCTION_ROOTS:
        source_root = root / relative_root
        if not source_root.is_dir():
            continue
        files.extend(
            path
            for path in source_root.rglob("*")
            if path.is_file() and path.suffix in SOURCE_SUFFIXES
        )
    return sorted(set(files))


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _scan_debug_egress(root: Path) -> list[SafetyFinding]:
    findings: list[SafetyFinding] = []
    for path in _source_files(root):
        text = path.read_text(encoding="utf-8", errors="replace")
        relative_path = str(path.relative_to(root))
        for match in COLLECTOR_URL_PATTERN.finditer(text):
            findings.append(
                SafetyFinding(
                    path=relative_path,
                    line=_line_number(text, match.start()),
                    code="hard-coded-collector-url",
                    message=f"undeclared collector endpoint {match.group(0)!r}",
                )
            )
        for line_number, line in enumerate(text.splitlines(), 1):
            if DEBUG_MARKER in line:
                findings.append(
                    SafetyFinding(
                        path=relative_path,
                        line=line_number,
                        code="debug-instrumentation-marker",
                        message="temporary debug instrumentation remains in production source",
                    )
                )
    return findings


def _action_block(
    source: str,
    action: str,
    *next_actions: str,
) -> tuple[str, int]:
    start_token = f"'{action}':"
    start = source.find(start_token)
    ends = [
        offset
        for next_action in next_actions
        if (offset := source.find(
            f"'{next_action}':",
            start + len(start_token),
        )) >= 0
    ]
    end = min(ends, default=-1)
    if start < 0 or end < 0:
        raise ValueError(f"cannot locate acceptance action block {action!r}")
    return source[start:end], _line_number(source, start)


def _scan_identity_evidence(root: Path) -> list[SafetyFinding]:
    findings: list[SafetyFinding] = []
    action_path = root / SEARCH_ACTION_PATH
    contract_path = root / SEARCH_CONTRACT_PATH
    if not action_path.is_file():
        return [
            SafetyFinding(
                path=str(SEARCH_ACTION_PATH),
                line=1,
                code="search-action-missing",
                message="social.people.search acceptance action is unavailable",
            )
        ]

    source = action_path.read_text(encoding="utf-8")
    try:
        block, start_line = _action_block(
            source,
            "social.people.search",
            "reliability.fixture.configure",
            "social.request.send",
        )
    except ValueError as error:
        findings.append(
            SafetyFinding(
                path=str(SEARCH_ACTION_PATH),
                line=1,
                code="search-action-missing",
                message=str(error),
            )
        )
        return findings

    if "input?.federationId" in block or "input.federationId" in block:
        findings.append(
            SafetyFinding(
                path=str(SEARCH_ACTION_PATH),
                line=start_line,
                code="request-echoed-as-evidence",
                message="social.people.search reads Federation identity from request input",
            )
        )
    if "federationId: result.federationId" not in block:
        findings.append(
            SafetyFinding(
                path=str(SEARCH_ACTION_PATH),
                line=start_line,
                code="observed-identity-missing",
                message="social.people.search must project the observed result Federation identity",
            )
        )

    if contract_path.is_file():
        contract_source = contract_path.read_text(encoding="utf-8")
        contract_match = re.search(
            r"export interface SocialPeopleSearchActionInput\s*\{(?P<body>.*?)\}",
            contract_source,
            re.DOTALL,
        )
        if contract_match is None:
            findings.append(
                SafetyFinding(
                    path=str(SEARCH_CONTRACT_PATH),
                    line=1,
                    code="search-contract-missing",
                    message="SocialPeopleSearchActionInput contract is unavailable",
                )
            )
        elif re.search(r"\bfederationId\s*:", contract_match.group("body")):
            findings.append(
                SafetyFinding(
                    path=str(SEARCH_CONTRACT_PATH),
                    line=_line_number(contract_source, contract_match.start()),
                    code="request-identity-contract",
                    message="search input must not accept Federation identity as evidence",
                )
            )
    return findings


def _scan_desktop_identity_evidence(root: Path) -> list[SafetyFinding]:
    harness_path = root / DESKTOP_HARNESS_PATH
    if not harness_path.is_file():
        return []
    source = harness_path.read_text(encoding="utf-8")
    start = source.find("async federationContext()")
    end = source.find("async createDirectConversation", start)
    if start < 0 or end < 0:
        return [
            SafetyFinding(
                path=str(DESKTOP_HARNESS_PATH),
                line=1,
                code="desktop-federation-context-missing",
                message="Desktop acceptance has no bounded Federation context readback",
            )
        ]
    block = source[start:end]
    findings: list[SafetyFinding] = []
    if "api.federationListFederations()" not in block:
        findings.append(
            SafetyFinding(
                path=str(DESKTOP_HARNESS_PATH),
                line=_line_number(source, start),
                code="desktop-federation-readback-missing",
                message="Desktop Federation context must read production API output",
            )
        )
    if "federationId: federation.federationId" not in block:
        findings.append(
            SafetyFinding(
                path=str(DESKTOP_HARNESS_PATH),
                line=_line_number(source, start),
                code="desktop-observed-identity-missing",
                message="Desktop Federation context must project observed Federation identity",
            )
        )
    return findings


def scan_repository(root: Path) -> list[SafetyFinding]:
    return sorted(
        [
            *_scan_debug_egress(root),
            *_scan_identity_evidence(root),
            *_scan_desktop_identity_evidence(root),
        ],
        key=lambda finding: (finding.path, finding.line, finding.code),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=REPO_ROOT)
    args = parser.parse_args()

    findings = scan_repository(args.root.resolve())
    payload = {
        "gate": "chat-lifecycle-safety-e2e",
        "status": "PASS" if not findings else "FAIL",
        "findings": [asdict(finding) for finding in findings],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
