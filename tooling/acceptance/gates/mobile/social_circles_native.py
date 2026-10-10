#!/usr/bin/env python3
"""Deterministic Mobile Social Circle lifecycle source contract Gate."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileSocialCirclesNativeGate(AcceptanceGate):
    gate_id = "mobile-social-circles-native"
    phase = "MPS-04 Station-owned Circle lifecycle"
    bom = ("MPS-04-CIRCLES",)
    spec = ("MPS-D05", "MPS-D12")

    def run(self) -> dict[str, Any]:
        self._assert_source_contract()
        commands = (
            (
                "pnpm",
                "--dir",
                "apps/mobile",
                "exec",
                "vitest",
                "run",
                "src/features/social/socialCircles.test.ts",
                "src/pages/moments/SocialCirclePages.test.ts",
                "src/services/stationTransport.test.ts",
                "src/services/socialNativeAdapter.test.ts",
                "src/app/navigation/navigationDescriptors.test.ts",
            ),
            (
                "cargo",
                "test",
                "--manifest-path",
                "apps/mobile/src-tauri/Cargo.toml",
                "social",
                "--offline",
            ),
            ("pnpm", "--dir", "apps/mobile", "run", "build"),
        )
        for command in commands:
            self._run_command(command)

        return {
            "proven_scope": [
                "Station-owned Circle list, create, edit, delete, and member operations",
                "canonical protobuf JSON decoding with bigint Circle identity",
                "session-fenced paginated Circle and member projections",
                "member writes pending until list and member-count readback converge",
                "remote lookup failure preserves the member-picker edit surface",
                "descriptor-owned Circle list, editor, and full-screen member picker",
                "composer Circle Audience refreshes and explicitly selects from the Station-owned Circle projection",
            ],
            "unproven_scope": [
                "native iOS visual and interaction journey",
                "physical Android behavior",
                "cross-Station remote member runtime convergence",
            ],
        }

    def _assert_source_contract(self) -> None:
        transport = self._read("apps/mobile/src/services/stationTransport.ts")
        rust_transport = self._read(
            "apps/mobile/src-tauri/src/runtime/station_transport/mod.rs"
        )
        adapter = self._read("apps/mobile/src-tauri/src/social/adapter.rs")
        circles = self._read(
            "apps/mobile/src/features/social/socialCircles.ts"
        )
        navigation = self._read(
            "apps/mobile/src/app/navigation/navigationStore.ts"
        )
        shell = self._read("apps/mobile/src/components/MobileShell.tsx")
        picker = self._read(
            "apps/mobile/src/pages/moments/SocialCircleMemberPickerPage.tsx"
        )
        composer = self._read(
            "apps/mobile/src/pages/moments/MomentComposer.tsx"
        )
        audience_target = self._read(
            "apps/mobile/src/pages/moments/MomentAudienceTargetPicker.tsx"
        )

        operations = (
            "social_circles_list",
            "social_circle_create",
            "social_circle_update",
            "social_circle_delete",
            "social_circle_members_list",
            "social_circle_members_add",
            "social_circle_members_remove",
        )
        self._require_markers(transport, operations, "TypeScript transport")
        self._require_markers(rust_transport, operations, "Rust transport")
        self._require_markers(adapter, operations, "Social adapter")
        self._require_markers(
            circles,
            (
                "fromJson(schema, payload as JsonValue)",
                "mobileAuthScopeKey(session)",
                "readAllCircles(context.gateway)",
                "readAllMembers(context.gateway, circleId)",
                "circle.memberCount === expectedCount",
                "membershipConverged",
                "pickerError: errorMessage(error)",
            ),
            "Circle projection owner",
        )
        self._require_markers(
            navigation,
            (
                "detail:social-circles",
                "detail:social-circle",
                "detail:social-circle-members",
            ),
            "navigation route state",
        )
        self._require_markers(
            shell,
            (
                "<SocialCirclesPage",
                "<SocialCircleDetailPage",
                "<SocialCircleMemberPickerPage",
            ),
            "Mobile shell",
        )
        self._require_markers(
            picker,
            (
                "searchPickerPeople",
                "addMembers(circleId, [...selected])",
                "refreshMembers(circleId)",
            ),
            "Circle member picker",
        )
        self._require_markers(
            composer,
            (
                "useSocialCirclesStore",
                'data-acceptance-id="social-audience-select"',
                "<MomentAudienceTargetPicker",
                "isMomentAudienceTargetChoice(option.id)",
            ),
            "Moment composer Circle Audience",
        )
        self._require_markers(
            audience_target,
            (
                'data-acceptance-id="social-audience-circle"',
                "if (choice === 'CIRCLE') void refreshCircles()",
                "onSelectCircle(circle.id.toString())",
            ),
            "Moment Audience target picker",
        )

    def _read(self, relative_path: str) -> str:
        return (REPO_ROOT / relative_path).read_text(encoding="utf-8")

    @staticmethod
    def _require_markers(
        source: str,
        markers: Iterable[str],
        owner: str,
    ) -> None:
        missing = [marker for marker in markers if marker not in source]
        if missing:
            raise GateError(f"{owner} is missing contract markers: {missing}")

    @staticmethod
    def _run_command(command: tuple[str, ...]) -> None:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stdout + completed.stderr)[-6000:]
            raise GateError(f"Mobile Social Circles command failed: {detail}")


def main() -> int:
    return MobileSocialCirclesNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
