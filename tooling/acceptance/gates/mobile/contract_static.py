#!/usr/bin/env python3
"""Static Mobile Shell contract Gate."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileContractStaticGate(AcceptanceGate):
    gate_id = "mobile-contract-static"

    def __init__(self, hard_cut: bool = False) -> None:
        self.hard_cut = hard_cut
        if hard_cut:
            self.gate_id = "mobile-hard-cut-static"
            self.phase = "W8 Atomic old-path deletion"
            self.bom = ("W8",)
            self.spec = ("MS-AG01",)
        super().__init__()

    def run(self) -> dict[str, Any]:
        commands = [
            [
                "pnpm",
                "--dir",
                "apps/mobile",
                "run",
                "check:mobile-shell-contracts",
            ],
            [
                "pnpm",
                "--dir",
                "apps/mobile",
                "exec",
                "vitest",
                "run",
                "src/acceptance/actions.social.test.ts",
                "src/features/social/momentsFeedStore.test.ts",
                "src/features/social/socialStore.profileSessionFence.test.ts",
                "src/runtimes/socialProjectionRuntime.test.ts",
                "src/pages/MomentsPage.test.ts",
                "src/pages/moments/MomentCommentsSection.test.tsx",
            ],
        ]
        if self.hard_cut:
            commands[0].extend(("--", "--hard-cut"))
        for command in commands:
            completed = subprocess.run(
                command,
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if completed.returncode != 0:
                detail = (completed.stdout + completed.stderr)[-4000:]
                raise GateError(
                    f"Mobile Shell contract or source regression check failed: {detail}"
                )
        self.assert_condition(
            "mobile_shell_contracts",
            True,
            "Mobile contract graph, Auth identity, service topology, and "
            "runtime projection fences are valid",
        )
        return {
            "mode": "hard-cut" if self.hard_cut else "contract",
            "proven_scope": [
                "Mobile Acceptance contract structure",
                "Mobile Auth asset and composition identity",
                "Mobile Moments and Profile source-level runtime projection fencing",
            ],
            "unproven_scope": ["native iOS and Android product behavior"],
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hard-cut", action="store_true")
    args = parser.parse_args()
    return MobileContractStaticGate(hard_cut=args.hard_cut).execute()


if __name__ == "__main__":
    raise SystemExit(main())
