#!/usr/bin/env python3
"""Verify the source-bound Mobile native iOS Simulator build."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
)


GATE_ID = "mobile-native-build"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def validate_mobile_native_build(
    manifest: Mapping[str, Any],
) -> dict[str, object]:
    if (
        manifest.get("artifactKind") != "acceptance-runtime-manifest"
        or manifest.get("environmentId") != "mobile-simulator"
        or manifest.get("state") != "FIXTURE_READY"
    ):
        raise GateError("Mobile native build runtime manifest is invalid")
    source = manifest.get("source")
    if (
        not isinstance(source, Mapping)
        or source.get("workspaceDigest") != "clean"
        or not source.get("commit")
    ):
        raise GateError("Mobile native build source identity is not clean")
    mobile = manifest.get("mobileSimulator")
    applications = (
        mobile.get("applications")
        if isinstance(mobile, Mapping)
        else None
    )
    ios = applications.get("ios") if isinstance(applications, Mapping) else None
    if not isinstance(ios, Mapping):
        raise GateError("Mobile native iOS application evidence is missing")
    artifact = Path(str(ios.get("artifact") or ""))
    digest = str(ios.get("sha256") or "")
    if (
        not artifact.is_dir()
        or not artifact.name.endswith(".app")
        or not SHA256_PATTERN.fullmatch(digest)
    ):
        raise GateError("Mobile native iOS application artifact is invalid")
    clients = manifest.get("clients")
    if (
        not isinstance(clients, list)
        or not any(
            isinstance(client, Mapping)
            and client.get("runtime") == "tauri-ios-simulator"
            for client in clients
        )
    ):
        raise GateError("Mobile native iOS Simulator runtime is missing")
    return {
        "artifact": artifact.name,
        "artifactSha256": digest,
        "runtime": "tauri-ios-simulator",
        "sourceCommit": source["commit"],
    }


class MobileNativeBuildGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-03"
    bom = ("SAL-G04",)
    spec = ("SAL-C06",)

    def __init__(self, *, manifest: Mapping[str, Any] | None = None) -> None:
        super().__init__()
        self.manifest = (
            dict(manifest)
            if manifest is not None
            else load_runtime_manifest(
                Path(
                    os.environ.get(
                        "PT_ACCEPTANCE_RUNTIME_MANIFEST",
                        "",
                    )
                ),
                self.gate_id,
            )
        )
        self.report.manifest = dict(self.manifest)

    def run(self) -> dict[str, object]:
        result = validate_mobile_native_build(self.manifest)
        self.assert_condition(
            "mobile_native_ios_simulator_build",
            True,
            f"{result['artifact']} sha256={result['artifactSha256']}",
        )
        self.assert_condition(
            "mobile_native_build_source_bound",
            bool(result["sourceCommit"]),
            str(result["sourceCommit"]),
        )
        return result


def main() -> int:
    return MobileNativeBuildGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
