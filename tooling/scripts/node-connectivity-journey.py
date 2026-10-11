#!/usr/bin/env python3
"""Run bounded Node Connectivity development and Gate journeys."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
STANDARD_STREAM_CLOSURE = "ncp-standard-stream"
NATIVE_CUT_CLOSURE = "ncp-native-cut"
GATE_TESTS = {
    "NCP-G01": (
        "TestSecureHTTPDirectAndCircuitUseCanonicalHertzRouter",
        "TestSecureHTTPRejectsWrongRouteSPKIBeforeRequestBody",
        "TestSecureHTTPIngressCloseDoesNotCloseBorrowedHost",
    ),
    "NCP-G02": (
        "TestSecureHTTPDirectAndCircuitUseCanonicalHertzRouter",
    ),
}
RUST_GO_CIRCUIT_INTEROP_COMMAND = [
    "cargo",
    "test",
    "--manifest-path",
    "packages/station-libp2p-http/Cargo.toml",
    "--test",
    "go_interop",
    "--",
    "--nocapture",
]
NATIVE_CUT_COMMANDS = {
    "NCP-G07": [
        "go",
        "test",
        "./relay",
        "-run",
        "^TestAdmission",
        "-count=1",
    ],
}


def run_go_tests(test_names: tuple[str, ...]) -> dict[str, object]:
    pattern = "^(" + "|".join(test_names) + ")$"
    command = [
        "go",
        "test",
        "./apps/station/frame/core/plugin/server/hertz",
        "-run",
        pattern,
        "-count=1",
    ]
    started = time.monotonic()
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    if completed.stdout:
        print(completed.stdout, end="", file=sys.stderr)
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr)
    return {
        "command": command,
        "durationMs": elapsed_ms,
        "status": "passed" if completed.returncode == 0 else "failed",
        "returnCode": completed.returncode,
        "tests": list(test_names),
    }


def run_command(command: list[str], cwd: Path, timeout: int = 300) -> dict[str, object]:
    started = time.monotonic()
    completed = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    if completed.stdout:
        print(completed.stdout, end="", file=sys.stderr)
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr)
    return {
        "command": command,
        "durationMs": elapsed_ms,
        "status": "passed" if completed.returncode == 0 else "failed",
        "returnCode": completed.returncode,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--closure",
        required=True,
        choices=(STANDARD_STREAM_CLOSURE, NATIVE_CUT_CLOSURE),
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--functional", action="store_true")
    mode.add_argument(
        "--gate",
        choices=tuple(GATE_TESTS) + tuple(NATIVE_CUT_COMMANDS) + ("NCP-G08",),
    )
    args = parser.parse_args()

    if args.closure == STANDARD_STREAM_CLOSURE:
        if args.gate not in GATE_TESTS and not args.functional:
            parser.error(f"{args.gate} does not belong to {args.closure}")
        test_names = (
            tuple(dict.fromkeys(name for names in GATE_TESTS.values() for name in names))
            if args.functional
            else GATE_TESTS[args.gate]
        )
        results = [run_go_tests(test_names)]
    else:
        if args.gate in GATE_TESTS:
            parser.error(f"{args.gate} does not belong to {args.closure}")
        gate_ids = (
            ("NCP-G08",)
            if args.functional
            else (args.gate,)
        )
        results = []
        for gate_id in gate_ids:
            if gate_id == "NCP-G08":
                commands = [
                    (RUST_GO_CIRCUIT_INTEROP_COMMAND, REPO_ROOT),
                    (
                        NATIVE_CUT_COMMANDS["NCP-G07"],
                        REPO_ROOT / "apps/station/frame/core/plugin/native",
                    ),
                    (
                        [
                            "python3",
                            "-c",
                            (
                                "from pathlib import Path; import sys; "
                                "root=Path('.'); "
                                "paths=[root/'apps/station/frame/core/plugin/native/"
                                "subserver/relay-client',root/'model/domain/"
                                "federation/relay_transport.proto']; "
                                "sys.exit(1 if any(path.is_file() or "
                                "(path.is_dir() and any(item.is_file() "
                                "for item in path.rglob('*'))) "
                                "for path in paths) else 0)"
                            ),
                        ],
                        REPO_ROOT,
                    ),
                ]
                results.extend(
                    run_command(command, cwd)
                    for command, cwd in commands
                )
            else:
                command = NATIVE_CUT_COMMANDS[gate_id]
                results.append(
                    run_command(
                        command,
                        REPO_ROOT
                        / "apps/station/frame/core/plugin/native",
                    )
                )
    status = "passed" if all(
        result["status"] == "passed" for result in results
    ) else "failed"
    report = {
        "artifactKind": "node-connectivity-journey-result",
        "closureId": args.closure,
        "executionClass": "functional" if args.functional else "acceptance-gate",
        "gateId": args.gate,
        "status": status,
        "results": results,
    }
    print(json.dumps(report, sort_keys=True))
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
