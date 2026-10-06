#!/usr/bin/env python3
"""Deterministic Mobile Social Audience composer and publish source Gate."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileSocialAudienceComposerNativeGate(AcceptanceGate):
    gate_id = "mobile-social-audience-composer-native"
    phase = "MPS-05 canonical Audience composer and publish"
    bom = ("MPS-05-COMPOSER-PUBLISH",)
    spec = ("MPS-D03", "MPS-D04", "MPS-D05", "MPS-D09", "MPS-D12")

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
                "src/features/social/socialAudience.test.ts",
                "src/features/social/useMomentsDraft.test.ts",
                "src/features/social/mobileSocialFacade.test.ts",
                "src/pages/moments/MomentComposer.test.ts",
                "src/runtimes/privateMomentsRuntime.test.ts",
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
                "all eight generated Audience kinds plus the Direct UI preset",
                "exact Circle, Group, allow-list, and deny-list draft restoration",
                "one facade publish intent routes PUBLIC to typed gateway and private kinds to Native",
                "private media retains opaque staged handles until Native encryption and submit",
                "public media uploads only after the Audience route is fixed",
                "persist-before-send and authoritative public/private success checks",
            ],
            "unproven_scope": [
                "native iOS visual and interaction journey",
                "physical Android behavior",
                "two-Station recipient and device readiness convergence",
            ],
        }

    def _assert_source_contract(self) -> None:
        audience = self._read(
            "apps/mobile/src/features/social/socialAudience.ts"
        )
        draft = self._read(
            "apps/mobile/src/features/social/useMomentsDraft.ts"
        )
        intents = self._read(
            "apps/mobile/src/features/social/socialIntents.ts"
        )
        facade = self._read(
            "apps/mobile/src/features/social/mobileSocialFacade.ts"
        )
        composer = self._read(
            "apps/mobile/src/pages/moments/MomentComposer.tsx"
        )

        self._require_markers(
            audience,
            (
                "Audience_Kind.PUBLIC",
                "Audience_Kind.FOLLOWERS",
                "Audience_Kind.FRIENDS",
                "Audience_Kind.CIRCLE",
                "Audience_Kind.GROUP",
                "Audience_Kind.CUSTOM_ALLOW",
                "Audience_Kind.CUSTOM_DENY",
                "Audience_Kind.SELF",
                "'DIRECT'",
                "baseKind: Audience_Kind.FOLLOWERS",
                "toPrivateSocialAudience",
            ),
            "Audience adapter",
        )
        self._require_markers(
            draft,
            (
                "readonly audience: Audience",
                "audience: normalizeSocialAudience(draft.audience)",
                "payload.audience",
            ),
            "Moment draft owner",
        )
        self._require_markers(
            intents,
            (
                "publishMoment(intent: SocialMomentPublishIntent)",
                "readonly draft: MobileMomentDraft",
                "readonly privateFiles?",
            ),
            "Social intent port",
        )
        self._require_markers(
            facade,
            (
                "publishMoment: async (intent)",
                "isPublicSocialAudience(audience)",
                "toPrivateSocialAudience(audience)",
                "publishPrivateTextMoment(base)",
                "publishPrivateMoment({",
            ),
            "Social facade",
        )
        self._require_markers(
            composer,
            (
                "SOCIAL_AUDIENCE_CHOICES.map",
                "persistDraftNow(text, audience,",
                "uploadPublicImage(item)",
                "privateFiles: privateFiles.filter",
                "await intents.publishMoment({",
                "result.projection.state === 'PUBLISHED'",
            ),
            "Moment composer",
        )
        forbidden = (
            "AUDIENCE_OPTIONS",
            "intents.publishPublic",
            "intents.publishPrivate",
        )
        present = [marker for marker in forbidden if marker in composer]
        if present:
            raise GateError(f"Moment composer retains old publish paths: {present}")

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
            timeout=2100,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stdout + completed.stderr)[-6000:]
            raise GateError(
                f"Mobile Social Audience composer command failed: {detail}"
            )


def main() -> int:
    return MobileSocialAudienceComposerNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
