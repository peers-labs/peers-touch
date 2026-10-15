#!/usr/bin/env python3
"""Mobile Social facade and typed Native adapter contract Gate."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileSocialFacadeContractGate(AcceptanceGate):
    gate_id = "mobile-social-facade-contract"
    phase = "MPS-01 typed Social adapter and facade"
    bom = ("MPS-01-SOCIAL-ADAPTER",)
    spec = ("MPS-D02", "MPS-D04", "MPS-D05", "MPS-D09")

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
                "src/features/social/mobileSocialFacade.test.ts",
                "src/acceptance/actions.social.test.ts",
                "src/runtimes/privateMomentsRuntime.test.ts",
                "src/runtimes/socialProjectionRuntime.test.ts",
                "src/services/socialNativeAdapter.test.ts",
                "src/services/gateways/momentsGateway.test.ts",
                "src/pages/MomentsPage.test.ts",
                "src/pages/moments/MomentCommentsSection.test.tsx",
                "src/pages/moments/MomentComposer.test.ts",
            ),
            ("pnpm", "--dir", "apps/mobile", "run", "build"),
            (
                "cargo",
                "test",
                "--manifest-path",
                "apps/mobile/src-tauri/Cargo.toml",
                "social",
            ),
        )
        for command in commands:
            self._run_command(command)

        self.assert_condition(
            "one_mobile_social_facade",
            True,
            "Mobile pages consume one generation-scoped facade projection and "
            "dispatch one Social intent family",
        )
        self.assert_condition(
            "typed_native_social_adapter",
            True,
            "Public Social uses the Social-owned Tauri entry point over the "
            "shared authenticated Station transport",
        )
        return {
            "proven_scope": [
                "Station/PTID/device/generation projection fencing",
                "facade teardown and stale-completion rejection",
                "typed public/private Social intent mapping",
                "deeply immutable nested projection objects and collections",
                "Acceptance actions use the product Social intent port",
                "zero direct Moments gateway or private runtime ownership in pages",
                "no sensitive transport or cryptographic material in Web projections",
            ],
            "unproven_scope": [
                "native iOS or physical Android user journey",
                "cross-Station receiver-visible convergence",
            ],
        }

    def _assert_source_contract(self) -> None:
        page_sources = list((REPO_ROOT / "apps/mobile/src/pages").rglob("*.ts"))
        page_sources.extend((REPO_ROOT / "apps/mobile/src/pages").rglob("*.tsx"))
        page_sources.append(
            REPO_ROOT / "apps/mobile/src/runtimes/socialProjectionRuntime.ts"
        )
        forbidden = ("createMomentsGateway", "MomentsGateway", "privateMomentsRuntime")
        hits = [
            f"{path.relative_to(REPO_ROOT)}:{symbol}"
            for path in page_sources
            for symbol in forbidden
            if symbol in path.read_text(encoding="utf-8")
        ]
        if hits:
            raise GateError(
                "Retired Mobile Social ownership remains: " + ", ".join(hits)
            )

        facade = self._read("apps/mobile/src/features/social/mobileSocialFacade.ts")
        projection = self._read(
            "apps/mobile/src/features/social/socialExperienceProjection.ts"
        )
        facade_test = self._read(
            "apps/mobile/src/features/social/mobileSocialFacade.test.ts"
        )
        acceptance_actions = self._read("apps/mobile/src/acceptance/actions.ts")
        acceptance_test = self._read(
            "apps/mobile/src/acceptance/actions.social.test.ts"
        )
        native_adapter = self._read(
            "apps/mobile/src/services/socialNativeAdapter.ts"
        )
        rust_adapter = self._read(
            "apps/mobile/src-tauri/src/social/adapter.rs"
        )
        station_transport = self._read(
            "apps/mobile/src-tauri/src/runtime/station_transport/mod.rs"
        )
        gateway_types = self._read(
            "apps/mobile/src/services/gateways/gatewayTypes.ts"
        )
        moments_gateway = self._read(
            "apps/mobile/src/services/gateways/momentsGateway.ts"
        )

        self._require_markers(
            facade,
            (
                "MobileSocialFacadeController",
                "SocialIntentPort",
                "completeCurrent",
                "subscribePrivateMomentsRuntime",
                "activeFacade === controller",
                "feed.teardown()",
                "momentsProjection.teardown()",
            ),
            "Mobile Social facade",
        )
        if "readonly gateway:" in facade:
            raise GateError("Mobile Social facade exposes a gateway escape hatch")
        if "runtime.gateway" in acceptance_actions:
            raise GateError(
                "Mobile Acceptance Social actions bypass the Social intent port"
            )
        self._require_markers(
            facade,
            (
                "refreshPublicFeed",
                "setPublicReaction",
                "createPublicComment",
                "readPublicComments",
                "createDeepImmutableSocialProjection",
            ),
            "Mobile Social intent owner",
        )
        self._require_markers(
            projection,
            (
                "stationPeerId",
                "actorPtid",
                "deviceId",
                "lifecycleGeneration",
                "PrivateMomentsRuntimeSnapshot | null",
                "ImmutableMapSnapshot",
                "immutableSnapshot",
            ),
            "Social experience projection",
        )
        self._require_markers(
            facade_test,
            (
                "rejects nested projection mutation",
                "postIndex as Map<string, number>).set",
                "toThrow(TypeError)",
            ),
            "Mobile Social deep immutability tests",
        )
        self._require_markers(
            acceptance_actions,
            (
                "runtime.intents.publishMoment",
                "runtime.intents.setPublicReaction",
                "runtime.intents.createPublicComment",
                "runtime.intents.readPublicComments",
            ),
            "Mobile Acceptance Social intent dispatch",
        )
        self._require_markers(
            acceptance_test,
            ("through the facade intent port",),
            "Mobile Acceptance Social intent tests",
        )
        self._require_markers(
            native_adapter,
            ("SocialNativeOperation", "'social_adapter_execute'"),
            "TypeScript Social Native adapter",
        )
        self._require_markers(
            rust_adapter,
            ("social_adapter_execute", "station_transport_execute"),
            "Rust Social adapter",
        )
        if "reqwest" in rust_adapter or "AUTHORIZATION" in rust_adapter:
            raise GateError(
                "Rust Social adapter duplicated authenticated transport ownership"
            )
        if (
            "executeSocialNativeOperation" not in moments_gateway
            or "executeStationOperation" in moments_gateway
        ):
            raise GateError(
                "Moments gateway does not exclusively use the Social Native adapter"
            )
        if any(
            token in facade
            for token in ("Authorization", "Bearer ", "rootKey", "privateKey")
        ):
            raise GateError("Web facade exposes credential or key material")
        if (
            '["api", "v1", "social", "posts"]' in station_transport
            or "social\\/posts" in gateway_types
        ):
            raise GateError("Mobile Social still targets the retired /posts route family")
        self._require_markers(
            station_transport,
            ('["api", "v1", "social", "moments"]',),
            "Authenticated Station transport",
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
            raise GateError(
                f"Mobile Social facade contract command failed "
                f"({command[0]}): {detail}"
            )


def main() -> int:
    return MobileSocialFacadeContractGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
