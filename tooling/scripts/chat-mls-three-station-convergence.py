#!/usr/bin/env python3
"""Own the immutable Evidence Store run for the C6 convergence Gate."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from _acceptance_artifacts import REPO_ROOT, artifact_session
from tooling.acceptance.core import EvidenceStore
from tooling.acceptance.core.errors import EvidenceError


GATE_ID = "chat-mls-three-station-convergence-gate"
REPORT_ROLE = "reports/chat-mls-three-station-convergence.json"
TOPOLOGY_GATE_ID = "federation-three-node-e2e"
TOPOLOGY_ROLE = "report"


def run_convergence_shell(
    environment: dict[str, str],
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [
            "bash",
            "tooling/scripts/chat-mls-three-station-convergence.sh",
        ],
        cwd=REPO_ROOT,
        env=environment,
        check=False,
    )


def execute() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    with artifact_session(GATE_ID) as session:
        try:
            topology_ref = store.latest_artifact_ref(
                TOPOLOGY_GATE_ID,
                TOPOLOGY_ROLE,
            )
            topology_path = store.resolve(topology_ref)
            with tempfile.TemporaryDirectory(
                prefix="pt-c6-convergence-"
            ) as directory:
                draft_path = Path(directory) / "report.json"
                environment = session.subprocess_environment()
                environment.update(
                    {
                        "PT_C6_TOPOLOGY_PATH": str(topology_path),
                        "PT_C6_REPORT_DRAFT_PATH": str(draft_path),
                    }
                )
                completed = run_convergence_shell(environment)
                if completed.returncode != 0:
                    raise RuntimeError(
                        f"convergence shell exited {completed.returncode}"
                    )
                report = json.loads(draft_path.read_text(encoding="utf-8"))
            if not isinstance(report, dict) or report.get("status") != "pass":
                raise RuntimeError(
                    "convergence draft is missing a passing report"
                )
            report["topology_artifact_ref"] = topology_ref.to_dict()
        except Exception as error:
            session.write_json(
                REPORT_ROLE,
                {
                    "schema_version": 1,
                    "gate": GATE_ID,
                    "status": "fail",
                    "proofStatus": "UNPROVEN",
                    "error_type": type(error).__name__,
                    "access_tokens_present": False,
                },
                role="report",
            )
            session.complete(
                status="fail",
                completion_status="PARTIAL",
                proof_status="UNPROVEN",
            )
            print(
                f"chat_mls_three_station_convergence_failed: {error}",
                file=sys.stderr,
            )
            return 1

        session.write_json(REPORT_ROLE, report, role="report")
        session.complete(
            status="pass",
            completion_status="DONE",
            proof_status="PROVEN",
        )
    print(f"chat_mls_three_station_convergence_ok report={REPORT_ROLE}")
    return 0


def main() -> int:
    try:
        return execute()
    except EvidenceError as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
