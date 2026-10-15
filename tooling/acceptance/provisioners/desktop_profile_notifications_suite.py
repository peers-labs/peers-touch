"""Suite-owned Native Desktop resources and atomic Journey result publication."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    EphemeralCapabilityHandler,
    EphemeralHandlerCleanup,
    GateError,
    call_async_harness,
)
from tooling.acceptance.core.errors import EphemeralCapabilityBlocked
from tooling.acceptance.core.evidence_store import RunHandle
from tooling.acceptance.core.suite_runtime import (
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.drivers.native import NativeLaunchOptions
from tooling.acceptance.drivers.native.runtime import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.tauri import EXPECTED_URL, TauriSession
from tooling.acceptance.fixtures.desktop_profile_accounts import PROFILE_ACCOUNT_PASSWORD
from tooling.acceptance.fixtures.desktop_profile_contract import CAPABILITY_ID, RUNTIME_REUSE, SCENARIO_IDS
from tooling.acceptance.gates.desktop.profile_notifications_journey import (
    read_profile,
    run_notifications_journey,
    run_profile_journey,
)


def read_native_source_identity(
    session: TauriSession,
    binding: NativeDesktopRuntimeBinding,
    source_commit: str,
) -> dict[str, Any]:
    """Bind the live Native process and embedded renderer to the Suite source."""
    source = call_async_harness(
        session, "sourceIdentity", {}, namespace="runtime", script_timeout=30,
    )
    binary = binding.binary_identity()
    executable_digests = (
        {instance["sha256"] for instance in json.loads(binary["instances"])}
        if "instances" in binary else {binary["sha256"]}
    )
    process_id = source.get("processId")
    checks = {
        "embeddedRenderer": session.execute_script(
            "return location.href",
        ) == EXPECTED_URL,
        "processId": type(process_id) is int and process_id > 0 and process_id == session.process_id,
        "sourceCommit": source.get("sourceCommit") == source_commit,
        "driverSourceCommit": binary["sourceCommit"] == source_commit,
        "executableSha256": source.get("executableSha256") in executable_digests,
        "artifactDigests": all(
            re.fullmatch(r"[0-9a-f]{64}", str(source.get(field, ""))) is not None
            for field in ("executableSha256", "rendererArtifactSha256")
        ),
    }
    mismatches = [field for field, matches in checks.items() if not matches]
    if mismatches:
        raise GateError(
            "Native source identity does not match the Suite process and binary: "
            + ", ".join(mismatches),
        )
    return source


class DesktopProfileNotificationsSuite:
    def __init__(
        self,
        manifest: dict[str, Any],
        binding: NativeDesktopRuntimeBinding,
        evidence_run: RunHandle,
    ) -> None:
        self.manifest = manifest
        self.binding = binding
        self.evidence_run = evidence_run
        self.sessions: dict[str, TauriSession] = {}
        self.actor_manifest_ref: dict[str, Any] | None = None
        self.artifacts = Path(tempfile.mkdtemp(prefix="pt-desktop-profile-suite-"))
        self._lock = threading.RLock()
        self._cleaned = False
        self._result: dict[str, Any] | None = None
        self.ledger = SuiteRuntimeLedger(
            RUNTIME_REUSE,
            suite_runtime_id=str(manifest["runId"]),
            source_digest=str(manifest["source"]["commit"]),
            fixture_epoch=str(manifest["runId"]),
        )
        self.ledger.record(SuiteRuntimeAction.PROVISION, resource_id=str(manifest["runId"]))
        self.binding.set_runtime_manifest(manifest)

    def prepare(self, accounts: Mapping[str, str]) -> dict[str, Any]:
        actors: dict[str, Any] = {}
        for slot, role in enumerate(("receiver", "sender")):
            self.ledger.record(SuiteRuntimeAction.ACCOUNT_PROVISION, resource_id=accounts[role])
            session = self.binding.create_bound_session(
                role, NativeLaunchOptions(window_slot=slot, window_count=2),
            )
            self.sessions[role] = session
            self.ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=role)
            login = call_async_harness(session, "loginWithPassword", {
                "account": accounts[role], "password": PROFILE_ACCOUNT_PASSWORD,
            }, namespace="chat", script_timeout=90)
            if login.get("authenticated") is not True:
                raise GateError(f"Native {role} did not authenticate")
            device = WebDriverWait(session.driver, 60, poll_frequency=0.5).until(
                lambda _: (state if (state := call_async_harness(
                    session, "getRealtimeDevice", {}, namespace="chat",
                ))["active"] else None),
                f"{role} production Device enrollment",
            )
            profile = read_profile(session)
            source = read_native_source_identity(
                session, self.binding, self.manifest["source"]["commit"],
            )
            actors[role] = {
                "accountRef": f"station-account:{accounts[role]}",
                "ptid": profile["peers_touch"]["network_id"],
                "homeStationPeerId": profile["home_station_peer_id"],
                "deviceId": device["deviceId"],
                "sourceIdentity": source,
            }
            self.ledger.record(SuiteRuntimeAction.LOGIN, resource_id=role)
        if actors["receiver"]["ptid"] == actors["sender"]["ptid"]:
            raise GateError("Native fixture roles resolved to the same Actor")
        self.binding.binding_proof_evidence()
        return {"actors": actors, "fixtureEpoch": self.manifest["runId"]}

    def run(self, deadline: float, cancellation: threading.Event) -> dict[str, Any]:
        with self._lock:
            if self._result is not None:
                return self._result
            if self._cleaned or set(self.sessions) != {"receiver", "sender"} or not self.actor_manifest_ref:
                raise GateError("Native Suite is not prepared")
            children: dict[str, Any] = {}
            try:
                for scenario_id in SCENARIO_IDS:
                    if cancellation.is_set() or time.monotonic() >= deadline:
                        raise GateError("Native Suite execution cancelled or timed out")
                    self.ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=scenario_id)
                    artifacts = self.artifacts / scenario_id
                    artifacts.mkdir()
                    if scenario_id == SCENARIO_IDS[0]:
                        child = run_profile_journey(
                            self.sessions["receiver"], self.binding, artifacts,
                        )
                        required = tuple(f"C{index}" for index in range(1, 7))
                    else:
                        child = run_notifications_journey(
                            self.sessions["receiver"], self.sessions["sender"],
                            artifacts, self.binding,
                        )
                        required = ("C7", "C8", "C9")
                    if any(child["assertions"].get(key) is not True for key in required):
                        raise GateError(f"{scenario_id} has incomplete visible assertions")
                    children[scenario_id] = child
                    self.ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=scenario_id)
                    self.ledger.record(SuiteRuntimeAction.RECEIVER_ASSERTION, scenario_id=scenario_id)
                    self.ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario_id)
                proofs = self.binding.binding_proof_evidence()
            finally:
                self.cleanup()
            self.ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
            runtime_report = self.ledger.require_valid()
            runtime_reference = self.evidence_run.write_json(
                "suite/runtime.json", runtime_report, role="suite-runtime",
            )
            evidence: dict[str, Any] = {}
            for path in sorted(self.artifacts.rglob("*.png")):
                relative = path.relative_to(self.artifacts).as_posix()
                evidence[relative] = self.evidence_run.write_bytes(
                    f"suite/screenshots/{relative}", path.read_bytes(), media_type="image/png",
                ).to_dict()
            payload = {
                "artifactKind": "desktop-profile-notifications-suite-result",
                "source": self.manifest["source"],
                "actorManifest": self.actor_manifest_ref,
                "scenarios": children,
                "suiteRuntime": runtime_report,
                "suiteRuntimeRef": runtime_reference.to_dict(),
                "clientBindingProofs": proofs,
                "cleanup": self._cleanup_result,
                "screenshots": evidence,
                "result": "PASS",
            }
            reference = self.evidence_run.write_json(
                "suite/result.json", payload, role="desktop-profile-notifications-suite",
            )
            shutil.rmtree(self.artifacts)
            self._result = {
                "result": "PASS", "suiteResult": reference.to_dict(),
                "scenarioIds": list(SCENARIO_IDS),
            }
            return self._result

    def cleanup(self) -> None:
        with self._lock:
            if self._cleaned:
                return
            sessions = tuple(self.sessions.values())
            process_ids = [session.process_id for session in sessions if session.process_id]
            errors = []
            for session in reversed(sessions):
                try:
                    session.stop()
                except Exception as error:
                    errors.append(f"client stop: {type(error).__name__}: {error}")
            clients = {client["id"]: client for client in self.manifest["clients"]}
            try:
                result = self.binding.finalize_cleanup(sessions, clients)
            except Exception as error:
                errors.append(f"runtime cleanup: {type(error).__name__}: {error}")
                result = {}
            alive = []
            for process_id in process_ids:
                try:
                    os.kill(process_id, 0)
                    alive.append(process_id)
                except ProcessLookupError:
                    continue
            result["originalProcessIdsReleased"] = not alive
            result["cleanupErrors"] = [*result.get("cleanupErrors", []), *errors]
            self._cleanup_result = result
            if alive or result["cleanupErrors"]:
                raise GateError("Native Suite resource cleanup failed")
            self._cleaned = True

    def close(self) -> None:
        self.cleanup()
        if self.artifacts.exists():
            shutil.rmtree(self.artifacts)

    def quarantine(self) -> bool:
        if not self._lock.acquire(blocking=False):
            return False
        try:
            self.close()
            return True
        finally:
            self._lock.release()


class DesktopProfileNotificationsHandler(EphemeralCapabilityHandler):
    def __init__(self, suite: DesktopProfileNotificationsSuite) -> None:
        self.suite = suite

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("run-suite",)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return (PROFILE_ACCOUNT_PASSWORD,)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if operation != "run-suite" or payload:
            raise EphemeralCapabilityBlocked(
                "Native Suite accepts only its declared run operation", resource=CAPABILITY_ID,
            )
        return self.suite.run(deadline_monotonic, cancellation)

    def project_response(
        self, operation: str, response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason, deadline_monotonic
        return self.suite.quarantine()

    def close(self) -> EphemeralHandlerCleanup:
        self.suite.close()
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)
