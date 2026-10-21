"""Physical Host Suite entry through the existing parent Appium authority.

Only actual native observations are persisted. Missing scenario drivers block
the Suite and cannot publish a successful result generation.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    BlockedError,
    EphemeralGateClient,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
    source_identity,
)
from tooling.acceptance.gates.mobile.appium import AppiumSession
from tooling.acceptance.gates.mobile.proof_contracts import validate_contract_payload


def observe_host_runtime(platform: str) -> dict[str, Any]:
    gate_id = f"unified-client-{platform}-host-e2e"
    raw_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
    if not raw_path:
        raise BlockedError(
            reason="Host Suite has no parent-owned runtime manifest",
            resource=f"mobile-{platform}-native",
        )
    manifest = load_runtime_manifest(Path(raw_path), gate_id)
    source = source_identity(REPO_ROOT)
    if (
        manifest["sourceCommit"] != source["commit"]
        or manifest["workspaceDigest"] != source["workspaceDigest"]
    ):
        raise GateError("Host Suite runtime source is stale")
    resources = manifest["mobileNative"]
    client_id = f"alice-{platform}"
    if (
        resources.get("scenario") != f"uca-{platform}-host"
        or set(resources["clients"]) != {client_id}
        or resources["clients"][client_id]["platform"] != platform
    ):
        raise GateError("Host Suite physical client allocation differs")
    capability = EphemeralGateClient.from_environment()
    if capability is None:
        raise BlockedError(
            reason="Host Suite requires the parent-owned Appium capability",
            resource="mobile.native.appium-session",
        )
    with capability, ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as artifacts:
        projection = resources["sourceArtifacts"]
        build_ref = ArtifactRef.from_dict(
            projection["applications"][platform]["buildAttestation"]
        )
        lease_ref = ArtifactRef.from_dict(
            projection["clients"][client_id]["physicalDeviceLease"]
        )
        build = artifacts.store.read_json(build_ref)
        if build.get("artifactKind") != "mobile-native-scenario-build-attestation":
            raise GateError("Host entry requires its source-bound scenario build")
        validate_contract_payload(
            {**build, "artifactKind": "mobile-application-build-attestation"},
            expected_kind="mobile-application-build-attestation",
            expected_run_id=artifacts.run_id,
            expected_gate_id=gate_id,
            expected_workspace_id=artifacts.store.workspace_id,
        )
        validate_contract_payload(
            artifacts.store.read_json(lease_ref),
            expected_kind="physical-device-lease",
            expected_run_id=artifacts.run_id,
            expected_gate_id=gate_id,
            expected_workspace_id=artifacts.store.workspace_id,
        )
        session = AppiumSession(
            capability,
            client_id=client_id,
            platform=platform,
            physical_device_lease=lease_ref,
            build_attestation=build_ref,
            callback_scheme=resources["applications"][platform]["callbackScheme"],
            gate_id=gate_id,
        )
        try:
            session.start()
            session.wait_for_ready()
            installed = session.verify_installed_build_identity(session.fresh_install_trace)
            session.switch_to_native()
            accessibility = session.capture_native_accessibility()
            screenshot = session.capture_screenshot("host-entry")
            session.switch_to_app_webview()
            session.require_harness(resources["harness"]["requiredActions"])
            lifecycle = session.call_action("lifecycle.snapshot")
            navigation = session.call_action("navigation.snapshot")
            dom = session.capture_web_dom("host-entry")
            return {
                "artifactKind": "unified-client-host-entry-observation",
                "gateId": gate_id,
                "runId": artifacts.run_id,
                "source": source,
                "platform": platform,
                "clientId": client_id,
                "buildAttestation": build_ref.to_dict(),
                "physicalDeviceLease": lease_ref.to_dict(),
                "installedBuildIdentity": installed.to_dict(),
                "installationTrace": session.fresh_install_trace.to_dict(),
                "accessibility": accessibility.to_dict(),
                "screenshot": screenshot.to_dict(),
                "dom": dom.to_dict(),
                "lifecycle": lifecycle,
                "navigation": navigation,
                "proofState": "SUPPORTING",
            }
        finally:
            session.stop()
