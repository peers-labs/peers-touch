#!/usr/bin/env python3
"""Two-actor Mobile Messaging journeys on simulator runtime cells."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import signal
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    DriverError,
    EphemeralGateClient,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeError,
    SuiteRuntimeLedger,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.fixtures.chat_native_actors import ACTOR_PASSWORD
from tooling.acceptance.gates.mobile.messaging_journey import (
    MobileMessagingJourney,
    MessagingActor,
)
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorCallbackRoutingGate,
    SimulatorGateBlocked,
    _redacted_markup,
    _validate_runtime_identity,
    _validate_source_identity,
)


ENVIRONMENT_ID = "mobile-direct-simulator"
IOS_SOCIAL_ENVIRONMENT_ID = "mobile-social-ios-simulator"
SCENARIO_GATES = {
    "ios-social-parity": "mobile-social-ios-native",
    "social-convergence": "mobile-simulator-social-convergence-e2e",
    "chat-contacts": "mobile-simulator-chat-contacts-e2e",
    "recovery": "mobile-simulator-recovery-e2e",
    "recovery-ui": "mobile-simulator-recovery-ui-e2e",
    "moments": "mobile-simulator-moments-e2e",
    "storage-cache-cleanup": "chat-storage-cache-clear-e2e",
    "storage-batch-clear": "chat-storage-mobile-batch-clear-e2e",
    "storage-conversation-clear": "chat-storage-delete-reclaim-e2e",
    "storage-retention": "chat-storage-retention-e2e",
}
IOS_SOCIAL_PARITY_SCENARIOS = (
    "rc01-home-explore",
    "rc01-search-profile",
    "rc01-thread-reaction",
    "rc01-circles-publish",
    "rc01-recovery-lifecycle",
    "rc01-native-quality",
)
IOS_SOCIAL_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "mps-ios-functional",
        "scenarioIds": list(IOS_SOCIAL_PARITY_SCENARIOS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 2,
        "minWarmReuseRate": 0.8,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
CLIENT_ASSIGNMENTS = {
    "sim-ios": ("station", "alice"),
    "sim-ios-peer": ("station", "bob"),
}
SCENARIO_METADATA = {
    "ios-social-parity": {
        "phase": "MPS-09 iOS Social Parity",
        "bom": ["MPS-09", "MPS-RC01"],
        "spec": [
            "MPS-PA01",
            "MPS-PA02",
            "MPS-PA03",
            "MPS-PA04",
            "MPS-PA05",
            "MPS-PA07",
            "MPS-PA08",
            "MPS-PA09",
            "MPS-PA14",
            "MPS-PA15",
            "MPS-PA18",
            "MPS-PA19",
        ],
    },
    "social-convergence": {
        "phase": "W5 Simulator Social Convergence",
        "bom": ["W5", "W5-OWNER"],
        "spec": ["MS-AG06"],
    },
    "chat-contacts": {
        "phase": "W6A Simulator Chat Contacts And Groups",
        "bom": ["W5", "W5-OWNER", "W6A"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG09"],
    },
    "recovery": {
        "phase": "W4 Simulator Command And Draft Recovery",
        "bom": ["W4"],
        "spec": ["MS-AG04", "MS-AG09", "MS-AG10"],
    },
    "recovery-ui": {
        "phase": "W6D Simulator Recovery UI",
        "bom": ["W4", "W6D"],
        "spec": ["MS-AG04", "MS-AG08", "MS-AG09", "MS-AG10", "MS-AG11"],
    },
    "moments": {
        "phase": "W6B Simulator Moments Participation",
        "bom": ["W5", "W5-OWNER", "W6B"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG10"],
    },
    "storage-cache-cleanup": {
        "phase": "CSG-02 Mobile Cache Cleanup",
        "bom": ["CSG-G02"],
        "spec": ["chat-storage-cache-cleanup"],
    },
    "storage-batch-clear": {
        "phase": "CSG-BATCH Mobile Batch Clear",
        "bom": ["CSG-G07"],
        "spec": ["chat-storage-batch-clear"],
    },
    "storage-conversation-clear": {
        "phase": "CSG-05 Mobile Conversation Clear",
        "bom": ["CSG-G04"],
        "spec": ["chat-storage-conversation-clear"],
    },
    "storage-retention": {
        "phase": "CSG-03 Mobile Retention",
        "bom": ["CSG-G03"],
        "spec": ["chat-storage-retention"],
    },
}
OPTIONAL_DIAGNOSTIC_SCOPE = (
    "physical-device hardware behavior",
    "live provider browser authorization",
    "physical Keychain or AndroidKeyStore characteristics",
    "VoiceOver or TalkBack traversal",
    "OEM scheduler, picker, and pinned-hardware performance",
)
RECOVERY_RELAUNCH_ACTIONS = (
    "build.identity",
    "lifecycle.waitReady",
    "lifecycle.scope.read",
    "messaging.projection.read",
    "reliability.draft.read",
    "station.route.snapshot",
)
MOBILE_STATION_OUTAGE_CAPABILITY_ID = "mobile.station-outage"
ROUTE_RENEWAL_TIMEOUT_SECONDS = 420.0
STATION_RESTART_TIMEOUT_SECONDS = 180.0


class SimulatorSocialGate(SimulatorCallbackRoutingGate):
    client_assignments = CLIENT_ASSIGNMENTS
    scenario_gates = SCENARIO_GATES
    scenario_metadata = SCENARIO_METADATA

    def __init__(
        self,
        scenario: str,
        **kwargs: Any,
    ) -> None:
        if scenario not in self.scenario_gates:
            raise ValueError(f"unsupported Mobile social scenario: {scenario}")
        self.gate_id = self.scenario_gates[scenario]
        super().__init__(**kwargs)
        self.scenario = scenario
        self.environment_id = (
            IOS_SOCIAL_ENVIRONMENT_ID
            if scenario == "ios-social-parity"
            else ENVIRONMENT_ID
        )
        self.suite_runtime_ledger: SuiteRuntimeLedger | None = None
        self.capability_client: EphemeralGateClient | None = None

    def execute(self) -> int:
        with ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
        ) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result: dict[str, Any]
            try:
                manifest = self._load_social_manifest()
                result = self._run_social_journey(artifacts, manifest)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except SimulatorGateBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result = self._result_base("BLOCKED")
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError, ProvisioningError) as error:
                result = self._result_base("FAIL")
                result.update(
                    {
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
                result["runtimeDiagnostics"] = self._capture_runtime_failure(
                    artifacts,
                )
            finally:
                self._cleanup_sessions(artifacts)
                if self.capability_client is not None:
                    try:
                        self.capability_client.close()
                    except Exception as error:
                        self.cleanup.append(
                            {
                                "resource": "ephemeral-capability-client",
                                "status": "failed",
                                "errorType": type(error).__name__,
                            }
                        )
                    else:
                        self.cleanup.append(
                            {
                                "resource": "ephemeral-capability-client",
                                "status": "passed",
                            }
                        )
                    self.capability_client = None

            cleanup_failed = any(
                item["status"] == "failed" for item in self.cleanup
            )
            suite_report, suite_cleanup_error = (
                self._finalize_suite_runtime(
                    cleanup_failed=cleanup_failed,
                )
            )
            if suite_report is not None:
                suite_report_ref = artifacts.write_json(
                    f"mobile-simulator-social/{self.scenario}/suite-runtime.json",
                    suite_report,
                    role=("mobile-social-ios-suite-runtime"
                          if self.scenario == "ios-social-parity"
                          else f"mobile-{self.scenario}-suite-runtime"),
                )
                result["suiteRuntime"] = {
                    "report": (
                        suite_report_ref.to_dict()
                        if isinstance(suite_report_ref, ArtifactRef)
                        else None
                    ),
                    "result": suite_report["result"],
                    "proofState": suite_report["proofState"],
                    "reportDigest": suite_report["reportDigest"],
                }
                if suite_cleanup_error:
                    result["suiteRuntime"]["cleanupError"] = (
                        suite_cleanup_error
                    )
                if suite_cleanup_error or suite_report["result"] != "PASS":
                    cleanup_failed = True

            if cleanup_failed:
                journey_succeeded = exit_code == 0
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["cleanupReason"] = (
                    "simulator social cleanup was incomplete"
                )
                if journey_succeeded:
                    result["reason"] = result["cleanupReason"]
            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "cleanup": list(self.cleanup),
                }
            )
            artifacts.write_json(
                f"mobile-simulator-social/{self.scenario}/lifecycle.json",
                {
                    "artifactKind": "mobile-simulator-social-lifecycle",
                    "gateId": self.gate_id,
                    "events": self.lifecycle,
                },
                role="mobile-simulator-social-lifecycle",
            )
            artifacts.write_json(
                f"mobile-simulator-social/{self.scenario}/result.json",
                result,
                role="mobile-simulator-social-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": self.environment_id,
                    "runtimeCell": self.gate_id,
                    "clients": sorted(
                        {
                            event["clientId"]
                            for event in self.lifecycle
                            if event.get("clientId")
                        }
                    ),
                    "physicalDeviceClaimed": False,
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _capture_runtime_failure(
        self,
        artifacts: ArtifactSession,
    ) -> list[dict[str, Any]]:
        diagnostics: list[dict[str, Any]] = []
        for session in self.sessions:
            client_id = session.client_id
            try:
                lifecycle = self._mapping(
                    session.call_action(
                        "lifecycle.waitReady",
                        {"includeDiagnostics": True},
                    ),
                    f"{client_id} failed lifecycle",
                )
                social = self._mapping(
                    session.call_action("social.projection.read"),
                    f"{client_id} failed Social projection",
                )
                private_social = self._mapping(
                    session.call_action("moments.private.snapshot"),
                    f"{client_id} failed private Social projection",
                )
                ingress = social.get("ingress")
                public_ingress = (
                    {
                        key: ingress.get(key)
                        for key in (
                            "lifecycle",
                            "writeAdmissionOpen",
                            "staleDomains",
                            "dataQueueDepth",
                            "controlQueueDepth",
                        )
                    }
                    if isinstance(ingress, Mapping)
                    else None
                )
                value = {
                    "clientId": client_id,
                    "lifecycle": {
                        key: lifecycle.get(key)
                        for key in (
                            "phase",
                            "launchState",
                            "generation",
                            "errorKey",
                            "runtimes",
                            "runtimeErrors",
                        )
                    },
                    "social": {
                        "active": social.get("active"),
                        "lastReconcileAt": social.get("lastReconcileAt"),
                        "ingress": public_ingress,
                    },
                    "privateSocial": {
                        "publish": [
                            {
                                key: item.get(key)
                                for key in (
                                    "audienceKind",
                                    "state",
                                    "errorCode",
                                )
                                if item.get(key) is not None
                            }
                            for item in private_social.get("publish", [])
                            if isinstance(item, Mapping)
                        ],
                        "publishStateHistory": private_social.get(
                            "publishStateHistory",
                        ),
                        "report": private_social.get("report"),
                        "errorPresent": private_social.get("errorPresent"),
                    },
                }
                reference = artifacts.write_json(
                    f"mobile-simulator-social/{self.scenario}/"
                    f"{client_id}/failure-runtime.json",
                    json.loads(redact_text(json.dumps(value))),
                    role=f"mobile-simulator-social-failure-runtime:{client_id}",
                )
                diagnostics.append(
                    {
                        "clientId": client_id,
                        "artifact": reference.to_dict(),
                    }
                )
            except Exception as error:
                diagnostics.append(
                    {
                        "clientId": client_id,
                        "captureErrorType": type(error).__name__,
                    }
                )
        return diagnostics

    def _finalize_suite_runtime(
        self,
        *,
        cleanup_failed: bool,
    ) -> tuple[dict[str, Any] | None, str]:
        ledger = self.suite_runtime_ledger
        if ledger is None:
            return None, ""
        cleanup_error = ""
        if not cleanup_failed:
            try:
                ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
            except SuiteRuntimeError as error:
                cleanup_error = redact_text(str(error))
        return ledger.report(), cleanup_error

    def _load_social_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise SimulatorGateBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                f"{self.environment_id}:manifest",
            )
        try:
            manifest = load_runtime_manifest(
                Path(manifest_path),
                self.gate_id,
            )
            require_runtime_service(manifest, "station", "station")
        except ProvisioningError as error:
            raise SimulatorGateBlocked(
                str(error),
                f"{self.environment_id}:manifest",
            ) from error
        if manifest.get("environmentId") != self.environment_id:
            raise SimulatorGateBlocked(
                "RuntimeManifest environment must be "
                f"{self.environment_id}",
                f"{self.environment_id}:environment",
            )
        return manifest

    def _run_social_journey(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        source_identity = _validate_source_identity(manifest)
        resources = self._required_object(
            manifest,
            "mobileSimulator",
            "RuntimeManifest",
        )
        self._reject_credentials(manifest, resources)
        runtime_identity = _validate_runtime_identity(resources)
        applications = self._required_object(
            resources,
            "applications",
            f"{self.environment_id} resources",
        )
        ios_application = self._required_object(
            applications,
            "ios",
            f"{self.environment_id} iOS application",
        )
        expected_build_identity = self._required_object(
            ios_application,
            "buildIdentity",
            f"{self.environment_id} iOS application",
        )
        appium = self._required_object(
            resources,
            "appium",
            f"{self.environment_id} resources",
        )
        server_url = self._required_text(
            appium,
            "serverUrl",
            f"{self.environment_id} Appium",
        )
        specs = self._client_specs(resources)
        sessions = {
            spec.client_id: self._start_social_session(
                artifacts,
                server_url,
                spec,
            )
            for spec in specs
        }
        build_identity = (
            {
                client_id: self._verify_build_identity(
                    session,
                    expected_build_identity,
                    f"{client_id} initial build identity",
                )
                for client_id, session in sessions.items()
            }
            if self.scenario == "recovery"
            else {}
        )
        actors = self._load_actors(artifacts, manifest)
        actor_identity_preparation = {
            client_id: self._prepare_fresh_actor_identity(
                sessions[client_id],
                actor,
            )
            for client_id, actor in actors.items()
            if client_id in sessions
        }
        journey = MobileMessagingJourney(timeout_seconds=30)
        if self.scenario == "ios-social-parity":
            for client_id, session in sessions.items():
                self._prepare_actor_identity(session, actors[client_id].role)
        authentication = {
            client_id: journey.authenticate(
                sessions[client_id],
                actor,
                password=ACTOR_PASSWORD,
            )
            for client_id, actor in actors.items()
            if client_id in sessions
        }
        sender = actors["sim-ios"]
        receiver = actors["sim-ios-peer"]
        if self.scenario == "ios-social-parity":
            journey_result = self._run_ios_social_parity_suite(
                manifest=manifest,
                source_identity=source_identity,
                sessions=sessions,
                actors=actors,
                journey=journey,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "social-convergence":
            journey_result = journey.run_social_convergence(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey=journey,
                journey_id=artifacts.run_id[-12:],
                expected_build_identity=expected_build_identity,
            )
        elif self.scenario == "chat-contacts":
            journey_result = journey.run_chat_contacts(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "recovery":
            journey_result = self._run_recovery_journey(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey=journey,
                journey_id=artifacts.run_id[-12:],
                expected_build_identity=expected_build_identity,
            )
        elif self.scenario == "recovery-ui":
            journey_result = self._run_recovery_ui_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "moments":
            journey_result = self._run_moments_journey(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-ios-peer"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-cache-cleanup":
            journey_result = self._run_storage_cache_cleanup_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-batch-clear":
            journey_result = self._run_storage_batch_clear_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-conversation-clear":
            journey_result = self._run_storage_conversation_clear_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        elif self.scenario == "storage-retention":
            journey_result = self._run_storage_retention_journey(
                session=sessions["sim-ios"],
                journey_id=artifacts.run_id[-12:],
            )
        else:
            raise GateError(
                f"unsupported Mobile simulator scenario: {self.scenario}"
            )
        captures = {
            client_id: self._capture_client(
                artifacts,
                session,
                client_id,
            )
            for client_id, session in sessions.items()
        }
        return {
            **self._result_base("PASS"),
            "source": source_identity,
            "runtime": runtime_identity,
            "buildIdentity": build_identity,
            "actorIdentityPreparation": actor_identity_preparation,
            "authentication": authentication,
            "journey": journey_result,
            "captures": captures,
        }

    @staticmethod
    def _prepare_fresh_actor_identity(
        session: Any,
        actor: MessagingActor,
        *,
        seed: bytearray | None = None,
    ) -> dict[str, Any]:
        if (
            not actor.station_peer_id.strip()
            or not actor.ptid.startswith("ptid:")
        ):
            raise GateError(
                f"{actor.client_id} fresh Actor identity scope is invalid"
            )
        user_scope = f"{actor.station_peer_id}|{actor.ptid}"
        digest = hashlib.sha256(
            user_scope.encode("utf-8")
            + b"\x1f"
            + actor.ptid.encode("utf-8")
        ).digest()[:16].hex()
        identity_seed = bytearray(secrets.token_bytes(32) if seed is None else seed)
        if len(identity_seed) != 32:
            identity_seed[:] = b"\x00" * len(identity_seed)
            raise GateError("fresh Actor identity seed must contain 32 bytes")
        seed_base64 = base64.b64encode(identity_seed).decode("ascii")
        try:
            prepared = session.call_action(
                "runtime.prepareActorIdentity",
                {
                    "storageKey": (
                        f"mobile-crypto-identity.v1.identity.{digest}"
                    ),
                    "seedBase64": seed_base64,
                },
            )
        finally:
            identity_seed[:] = b"\x00" * len(identity_seed)
            seed_base64 = ""
        if prepared != {"prepared": True}:
            raise GateError(
                f"{actor.client_id} fresh Actor identity was not prepared"
            )
        return {
            "clientId": actor.client_id,
            "devicePolicy": "fresh",
            "prepared": True,
        }

    def _start_social_session(
        self,
        artifacts: ArtifactSession,
        server_url: str,
        spec: Any,
    ) -> Any:
        session = self._create_session(server_url, spec)
        self.sessions.append(session)
        session.start()
        self._record(spec.client_id, "session-created")
        if spec.platform == "ios":
            self._preflight_ios(artifacts, session, spec)
        else:
            session.wait_for_ready()
            session.switch_to_app_webview()
            session.require_harness(list(spec.required_harness_actions))
        self._record(spec.client_id, "messaging-harness-ready")
        return session

    def _load_actors(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, MessagingActor]:
        raw_reference = manifest.get("actorManifest")
        if not isinstance(raw_reference, Mapping):
            raise SimulatorGateBlocked(
                "Mobile direct simulator actor manifest is missing",
                f"{self.environment_id}:actor-manifest",
            )
        try:
            reference = ArtifactRef.from_dict(raw_reference)
            if (
                reference.workspace_id != artifacts.store.workspace_id
                or reference.gate_id != self.gate_id
                or reference.run_id != artifacts.run_id
            ):
                raise ValueError("actor manifest identity mismatch")
            payload = artifacts.store.read_json(reference)
        except Exception as error:
            raise SimulatorGateBlocked(
                "Mobile direct simulator actor manifest is invalid",
                f"{self.environment_id}:actor-manifest",
            ) from error
        stations = self._required_object(
            payload,
            "stations",
            "Mobile social actor manifest",
        )
        actors: dict[str, MessagingActor] = {}
        for client_id, (service_id, role) in self.client_assignments.items():
            service = require_runtime_service(manifest, service_id, "station")
            station = self._required_object(
                stations,
                service_id,
                f"Mobile social actor manifest {service_id}",
            )
            entries = station.get("actors")
            if not isinstance(entries, list):
                raise SimulatorGateBlocked(
                    f"Mobile direct actor manifest {service_id} has no actors",
                    f"{self.environment_id}:actor-manifest",
                )
            actor = next(
                (
                    item
                    for item in entries
                    if isinstance(item, Mapping) and item.get("role") == role
                ),
                None,
            )
            if not isinstance(actor, Mapping):
                raise SimulatorGateBlocked(
                    f"Mobile direct actor manifest has no {role}",
                    f"{self.environment_id}:actor-manifest",
                )
            actors[client_id] = MessagingActor(
                client_id=client_id,
                role=role,
                station_url=self._required_text(
                    service,
                    "endpoint",
                    f"Mobile social service {service_id}",
                ),
                station_peer_id=self._required_text(
                    service,
                    "runtimeIdentity",
                    f"Mobile social service {service_id}",
                ),
                ptid=self._required_text(
                    actor,
                    "ptid",
                    f"Mobile social actor {role}",
                ),
                account_ref=self._required_text(
                    actor,
                    "accountRef",
                    f"Mobile social actor {role}",
                ),
                federated_handle=self._required_text(
                    actor,
                    "federatedHandle",
                    f"Mobile social actor {role}",
                ),
                federation_id=self._required_text(
                    actor,
                    "federationId",
                    f"Mobile social actor {role}",
                ),
            )
        if self.scenario == "ios-social-parity":
            service = require_runtime_service(manifest, "station", "station")
            station = self._required_object(
                stations,
                "station",
                "Mobile Social parity actor manifest station",
            )
            entries = station.get("actors")
            eve = next(
                (
                    item
                    for item in entries
                    if isinstance(item, Mapping)
                    and item.get("role") == "eve"
                ),
                None,
            ) if isinstance(entries, list) else None
            if not isinstance(eve, Mapping):
                raise SimulatorGateBlocked(
                    "Mobile Social parity actor manifest has no eve",
                    f"{self.environment_id}:actor-manifest",
                )
            actors["fixture-eve"] = MessagingActor(
                client_id="sim-ios",
                role="eve",
                station_url=self._required_text(
                    service,
                    "endpoint",
                    "Mobile Social parity service station",
                ),
                station_peer_id=self._required_text(
                    service,
                    "runtimeIdentity",
                    "Mobile Social parity service station",
                ),
                ptid=self._required_text(
                    eve,
                    "ptid",
                    "Mobile Social parity actor eve",
                ),
                account_ref=self._required_text(
                    eve,
                    "accountRef",
                    "Mobile Social parity actor eve",
                ),
                federated_handle=self._required_text(
                    eve,
                    "federatedHandle",
                    "Mobile Social parity actor eve",
                ),
                federation_id=self._required_text(
                    eve,
                    "federationId",
                    "Mobile Social parity actor eve",
                ),
            )
        return actors

    def _run_ios_social_parity_suite(
        self,
        *,
        manifest: Mapping[str, Any],
        source_identity: Mapping[str, str],
        sessions: Mapping[str, Any],
        actors: Mapping[str, MessagingActor],
        journey: MobileMessagingJourney,
        journey_id: str,
    ) -> dict[str, Any]:
        sender_session = sessions["sim-ios"]
        receiver_session = sessions["sim-ios-peer"]
        sender = actors["sim-ios"]
        receiver = actors["sim-ios-peer"]
        eve = actors["fixture-eve"]
        fixture_epoch = self._required_text(
            manifest,
            "runId",
            "Mobile Social parity RuntimeManifest",
        )
        ledger = SuiteRuntimeLedger(
            IOS_SOCIAL_RUNTIME_REUSE,
            suite_runtime_id=f"mps-09-{journey_id}",
            source_digest=source_identity["commit"],
            fixture_epoch=fixture_epoch,
        )
        self.suite_runtime_ledger = ledger
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id=f"{self.environment_id}:{fixture_epoch}",
        )
        ledger.record(
            SuiteRuntimeAction.ACCOUNT_PROVISION,
            resource_id="actors:alice,bob,eve",
        )
        for client_id in ("sim-ios", "sim-ios-peer"):
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{client_id}",
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"login:{client_id}",
            )
        private_key_inventories = {
            client_id: self._prepare_private_keys(sessions[client_id])
            for client_id in ("sim-ios", "sim-ios-peer")
        }

        state: dict[str, Any] = {}
        scenario_runners = (
            (
                "rc01-home-explore",
                lambda: self._run_ios_home_explore(
                    sender_session,
                    receiver_session,
                    sender,
                    journey_id,
                    state,
                ),
            ),
            (
                "rc01-search-profile",
                lambda: self._run_ios_search_profile(
                    sender_session,
                    receiver,
                ),
            ),
            (
                "rc01-thread-reaction",
                lambda: self._run_ios_thread_reaction(
                    receiver_session,
                    journey_id,
                    state,
                ),
            ),
            (
                "rc01-circles-publish",
                lambda: self._run_ios_circles_publish(
                    sender_session,
                    receiver_session,
                    receiver,
                    journey_id,
                    state,
                ),
            ),
            (
                "rc01-recovery-lifecycle",
                lambda: self._run_ios_recovery_lifecycle(
                    sender_session,
                    eve,
                    journey,
                    journey_id,
                    state,
                ),
            ),
            (
                "rc01-native-quality",
                lambda: self._run_ios_native_quality(
                    receiver_session,
                ),
            ),
        )
        results: list[dict[str, Any]] = []
        for scenario_id, run_scenario in scenario_runners:
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            started_at = time.monotonic()
            scenario_result = run_scenario()
            duration_seconds = time.monotonic() - started_at
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id=scenario_id,
                resource_id=scenario_result["uiAction"],
                duration_seconds=duration_seconds,
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id=scenario_id,
                resource_id=scenario_result["receiverAssertion"],
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id=scenario_id,
                resource_id=scenario_result["supportingObservation"],
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id=scenario_id,
            )
            results.append({
                "scenarioId": scenario_id,
                **scenario_result,
            })
        return {
            "scenario": "ios-social-parity",
            "runtimeCell": "MPS-RC01",
            "actors": {
                "alice": sender.ptid,
                "bob": receiver.ptid,
                "eve": eve.ptid,
            },
            "privateKeyInventories": private_key_inventories,
            "scenarios": results,
            "unprovenScope": [
                "Android",
                "cross-Station delivery",
                "Desktop interoperability",
                "full SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN",
            ],
        }

    def _run_ios_home_explore(
        self,
        sender_session: Any,
        receiver_session: Any,
        sender: MessagingActor,
        journey_id: str,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        text = f"mps09-public-{journey_id}"
        published = self._mapping(
            sender_session.call_action(
                "moments.publish",
                {"text": text, "audienceKind": 1},
            ),
            "MPS-09 public seed Moment",
        )
        post_id = self._text(
            published.get("postId"),
            "MPS-09 public seed post ID",
        )
        state["publicPostId"] = post_id
        state["publicPostText"] = text

        receiver_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            receiver_session,
            '[data-acceptance-id="social-moments-page"]',
            "Moments page",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-feed-scope-explore"]',
            "Explore tab",
        )
        self._wait_ui_attribute(
            receiver_session,
            '[data-acceptance-id="social-moments-page"]',
            "data-feed-scope",
            "explore",
            "Explore scope",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-explore-sort-open"]',
            "Explore sort sheet",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-explore-sort-hot"]',
            "Explore hot sort",
        )
        self._click_ui(
            receiver_session,
            '[data-acceptance-id="social-feed-scope-home"]',
            "Home tab",
        )
        self._wait_ui_attribute(
            receiver_session,
            '[data-acceptance-id="social-moments-page"]',
            "data-feed-scope",
            "home",
            "Home scope",
        )
        receiver_post = self._wait_for_moment(
            receiver_session,
            post_id,
            text,
        )
        self._wait_post_visible(receiver_session, post_id, text)
        return {
            "uiAction": "moments:home-explore-switch",
            "receiverAssertion": f"receiver-post:{post_id}",
            "supportingObservation": f"timeline-author:{sender.ptid}",
            "post": receiver_post,
        }

    def _run_ios_search_profile(
        self,
        session: Any,
        receiver: MessagingActor,
    ) -> dict[str, Any]:
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            session,
            '[data-acceptance-id="social-moments-page"]',
            "Moments page before Search",
        )
        self._click_ui(
            session,
            '[data-acceptance-id="social-search-open"]',
            "Social Search",
        )
        self._wait_ui(
            session,
            '[data-acceptance-id="social-search-page"]',
            "Social Search page",
        )
        federation_selector = (
            '[data-acceptance-id="social-search-page"] '
            f'input[type="radio"][value="{receiver.federation_id}"]'
        )
        federation_control_selector = (
            '[data-acceptance-id="social-search-page"] '
            "label.ant-radio-wrapper:has("
            f'input[type="radio"][value="{receiver.federation_id}"])'
        )
        self._select_radio(
            session,
            federation_control_selector,
            federation_selector,
            '[data-acceptance-id="social-search-input"] '
            ".ant-input-search-btn",
            "Social Search Federation",
        )
        self._set_ui_value(
            session,
            '[data-acceptance-id="social-search-input"] input',
            receiver.role,
            "Social Search query",
        )
        self._click_ui(
            session,
            '[data-acceptance-id="social-search-input"] '
            ".ant-input-search-btn",
            "Social Search submit",
        )
        result_selector = (
            '[data-acceptance-id="social-search-result"]'
            f'[data-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(session, result_selector, "Social Search result")
        self._click_ui(session, result_selector, "Social Search result")
        profile_selector = (
            '[data-acceptance-id="social-profile-page"]'
            f'[data-profile-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(session, profile_selector, "Social Profile page")
        self._wait_ui(
            session,
            '[data-acceptance-id="social-profile-authored-posts"]',
            "Social Profile authored posts",
        )
        return {
            "uiAction": f"search-open-profile:{receiver.ptid}",
            "receiverAssertion": f"profile-visible:{receiver.ptid}",
            "supportingObservation": (
                f"federation:{receiver.federation_id}"
            ),
        }

    def _run_ios_circles_publish(
        self,
        sender_session: Any,
        receiver_session: Any,
        receiver: MessagingActor,
        journey_id: str,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        sender_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            sender_session,
            '[data-acceptance-id="social-moments-page"]',
            "Moments page before Circles",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circles-open"]',
            "Social Circles",
        )
        self._wait_ui(
            sender_session,
            '[data-acceptance-id="social-circles-page"]',
            "Social Circles page",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-create-open"]',
            "Create Circle",
        )
        circle_name = f"MPS09 {journey_id}"
        renamed_circle = f"{circle_name} renamed"
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-create-name"]',
            circle_name,
            "Circle name",
        )
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-create-description"]',
            "MPS-09 iOS same-Station audience",
            "Circle description",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-create-submit"]',
            "Create Circle submit",
        )
        circle_id = self._wait_ui_attribute_value(
            sender_session,
            '[data-acceptance-id="social-circle-detail"]',
            "data-circle-id",
            "Circle detail",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-add-members"]',
            "Add Circle members",
        )
        self._wait_ui(
            sender_session,
            '[data-acceptance-id="social-circle-member-picker"]',
            "Circle member picker",
        )
        self._select_antd_option(
            sender_session,
            '[data-acceptance-id="social-circle-member-picker"] .ant-select',
            0,
            "Circle member Federation",
        )
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-member-search"] input',
            receiver.role,
            "Circle member search",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-member-search"] '
            ".ant-input-search-btn",
            "Circle member search submit",
        )
        candidate_selector = (
            '[data-acceptance-id="social-circle-member-candidate"]'
            f'[data-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(
            sender_session,
            candidate_selector,
            "Circle member candidate",
        )
        self._click_ui(
            sender_session,
            candidate_selector,
            "Circle member candidate",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-members-submit"]',
            "Circle member submit",
        )
        member_selector = (
            '[data-acceptance-id="social-circle-member"]'
            f'[data-actor-ptid="{receiver.ptid}"]'
        )
        self._wait_ui(sender_session, member_selector, "Circle member")
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-circle-name"]',
            renamed_circle,
            "Renamed Circle",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-circle-save"]',
            "Save Circle",
        )
        self._wait_ui_text(
            sender_session,
            '[data-acceptance-id="social-circle-detail"] .header-title',
            renamed_circle,
            "Renamed Circle heading",
        )

        before = self._mapping(
            sender_session.call_action("moments.private.snapshot"),
            "Private Moment snapshot before publish",
        )
        before_ids = {
            item.get("postId")
            for item in before.get("publish", [])
            if isinstance(item, Mapping) and item.get("postId")
        }
        sender_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-composer-open"]',
            "Open Moment composer",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-audience-select"]',
            "Audience sheet",
        )
        self._click_ui(
            sender_session,
            '[data-audience-option="CIRCLE"]',
            "Circle audience",
        )
        self._click_ui(
            sender_session,
            (
                '[data-acceptance-id="social-audience-circle"]'
                f'[data-circle-id="{circle_id}"]'
            ),
            "Circle target",
        )
        self._wait_ui_attribute(
            sender_session,
            '[data-acceptance-id="social-composer"]',
            "data-audience-choice",
            "CIRCLE",
            "Circle audience selection",
        )
        private_text = f"mps09-circle-{journey_id}"
        self._set_ui_value(
            sender_session,
            '[data-acceptance-id="social-composer-text"]',
            private_text,
            "Private Moment text",
        )
        self._click_ui(
            sender_session,
            '[data-acceptance-id="social-composer-publish"]',
            "Publish private Moment",
        )
        private_post = self._wait_new_private_post(
            sender_session,
            before_ids,
        )
        private_post_id = self._text(
            private_post.get("postId"),
            "Private Moment post ID",
        )
        state.update({
            "privatePostId": private_post_id,
            "privatePostText": private_text,
            "circleId": circle_id,
        })
        receiver_session.call_action("moments.private.reconcile")
        receiver_read = self._mapping(
            receiver_session.call_action(
                "moments.private.read",
                {"postId": private_post_id},
            ),
            "Receiver private Moment readback",
        )
        if receiver_read.get("state") != "CONTENT_READY":
            raise GateError(
                "Receiver private Moment did not reach CONTENT_READY"
            )
        receiver_session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_post_visible(
            receiver_session,
            private_post_id,
            "",
        )
        return {
            "uiAction": f"circle-create-publish:{circle_id}",
            "receiverAssertion": f"private-post:{private_post_id}",
            "supportingObservation": f"circle-member:{receiver.ptid}",
            "circleId": circle_id,
            "privatePostId": private_post_id,
            "receiverState": receiver_read["state"],
        }

    def _run_ios_thread_reaction(
        self,
        session: Any,
        journey_id: str,
        state: Mapping[str, Any],
    ) -> dict[str, Any]:
        post_id = self._text(
            state.get("publicPostId"),
            "MPS-09 public post state",
        )
        for index in range(11):
            session.call_action(
                "moments.comment",
                {
                    "postId": post_id,
                    "content": f"MPS09 comment {index}",
                },
            )
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_post_visible(session, post_id, "")
        self._click_ui_for_post(
            session,
            post_id,
            "social-thread-open",
            "Moment thread",
        )
        thread_selector = (
            '[data-acceptance-id="social-moment-thread"]'
            f'[data-post-id="{post_id}"]'
        )
        try:
            self._wait_ui(session, thread_selector, "Moment thread")
        except GateError as error:
            thread_state = self._moment_thread_state(session, post_id)
            navigation = self._mapping(
                session.call_action("navigation.snapshot"),
                "Moment thread navigation",
            )
            raise GateError(
                "Moment thread did not converge "
                f"(momentsPages={thread_state['momentsPages']}, "
                f"cards={thread_state['cards']}, "
                f"actions={thread_state['actions']}, "
                f"threads={thread_state['threads']}, "
                f"primaryRoute={navigation.get('primaryRouteId')}, "
                f"detailCount={len(navigation.get('detailKeys', []))}, "
                f"rootError={thread_state['rootError'] or 'none'})"
            ) from error
        self._wait_ui_attribute(
            session,
            f"{thread_selector} [data-comment-total]",
            "data-comment-visible",
            "10",
            "Default ten comments",
        )
        self._set_ui_value(
            session,
            f'{thread_selector} [data-acceptance-id="social-comment-input"]',
            f"MPS09 UI comment {journey_id}",
            "Inline comment",
        )
        self._click_ui(
            session,
            f'{thread_selector} [data-acceptance-id="social-comment-send"]',
            "Inline comment submit",
        )
        self._wait_ui_text(
            session,
            thread_selector,
            f"MPS09 UI comment {journey_id}",
            "Inline comment readback",
        )
        self._click_ui_for_post(
            session,
            post_id,
            "social-reaction-open",
            "Reaction picker",
        )
        for reaction_kind in range(1, 6):
            self._click_ui(
                session,
                (
                    '[data-reaction-picker] '
                    '[data-reaction-picker-item]'
                    f':nth-child({reaction_kind})'
                ),
                f"Reaction kind {reaction_kind}",
            )
        return {
            "uiAction": f"thread-comment-reactions:{post_id}",
            "receiverAssertion": f"inline-comment-visible:{post_id}",
            "supportingObservation": "comments-default-visible:10",
            "postId": post_id,
            "reactionKinds": [1, 2, 3, 4, 5],
        }

    def _run_ios_recovery_lifecycle(
        self,
        session: Any,
        eve: MessagingActor,
        journey: MobileMessagingJourney,
        journey_id: str,
        state: Mapping[str, Any],
    ) -> dict[str, Any]:
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._click_ui(
            session,
            '[data-acceptance-id="social-composer-open"]',
            "Open composer for recovery",
        )
        draft_text = f"MPS09 recovery draft {journey_id}"
        self._set_ui_value(
            session,
            '[data-acceptance-id="social-composer-text"]',
            draft_text,
            "Recovery draft",
        )
        self._wait_ui_attribute(
            session,
            '[data-acceptance-id="social-composer"]',
            "data-draft-persisted",
            "true",
            "Persisted Recovery draft",
        )
        restart = self._mapping(
            session.call_action("lifecycle.restart"),
            "MPS-09 lifecycle restart",
        )
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("MPS-09 lifecycle restart was not acknowledged")
        self._click_ui(
            session,
            '[data-acceptance-id="recovery-draft-restore-action"]',
            "Restore persisted Moment draft",
        )
        self._wait_ui_absent(
            session,
            '[data-acceptance-id="recovery-draft-restore"]',
            "Dismiss restored Moment draft prompt",
        )
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            session,
            '[data-acceptance-id="social-moments-page"]',
            "Return to Moments after draft restoration",
        )
        self._click_ui(
            session,
            '[data-acceptance-id="social-composer-open"]',
            "Reopen composer after draft restoration",
        )
        self._wait_ui_text(
            session,
            '[data-acceptance-id="social-composer"]',
            draft_text,
            "Restored Moment draft",
        )
        session.call_action(
            "session.logout",
            {"draftDisposition": "discard"},
        )
        self._prepare_actor_identity(session, eve.role)
        journey.authenticate(
            session,
            eve,
            password=ACTOR_PASSWORD,
        )
        scope = self._mapping(
            session.call_action("lifecycle.scope.read"),
            "Eve lifecycle scope",
        )
        if scope.get("activeActorPtid") != eve.ptid:
            raise GateError("Account switch did not activate Eve")
        old_post_id = self._text(
            state.get("privatePostId"),
            "MPS-09 private post state",
        )
        private_snapshot = self._mapping(
            session.call_action("moments.private.snapshot"),
            "Eve private Moment snapshot",
        )
        snapshot_text = json.dumps(private_snapshot, sort_keys=True)
        if old_post_id in snapshot_text or draft_text in snapshot_text:
            raise GateError(
                "Account switch exposed old-scope Social state"
            )
        return {
            "uiAction": "composer-draft-restart-account-switch",
            "receiverAssertion": f"new-scope:{eve.ptid}",
            "supportingObservation": "old-scope-plaintext-absent",
            "activeActorPtid": eve.ptid,
            "draftRestored": True,
        }

    def _run_ios_native_quality(
        self,
        session: Any,
    ) -> dict[str, Any]:
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:moments"},
        )
        self._wait_ui(
            session,
            '[data-acceptance-id="social-moments-page"]',
            "Moments page for native quality",
        )
        metrics = session.execute_script(
            """
const page = document.querySelector(
  '[data-acceptance-id="social-moments-page"]'
);
const tablist = page?.querySelector('[role="tablist"]');
const cards = page?.querySelectorAll(
  '[data-acceptance-id="social-moment-card"]'
) || [];
const pageRect = page?.getBoundingClientRect();
const scopeRect = page?.querySelector('[role="tablist"]')?.getBoundingClientRect();
const firstCardStyle = cards[0] ? getComputedStyle(cards[0]) : null;
return {
  viewportWidth: window.visualViewport?.width || window.innerWidth,
  viewportHeight: window.visualViewport?.height || window.innerHeight,
  tabCount: tablist?.querySelectorAll('[role="tab"]').length || 0,
  cardCount: cards.length,
  searchLabelled: Boolean(
    page?.querySelector('[data-acceptance-id="social-search-open"][aria-label]')
  ),
  circlesLabelled: Boolean(
    page?.querySelector('[data-acceptance-id="social-circles-open"][aria-label]')
  ),
  composerLabelled: Boolean(
    page?.querySelector('[data-acceptance-id="social-composer-open"][aria-label]')
  ),
  scopeWidth: Number(scopeRect?.width || 0),
  pageWidth: Number(pageRect?.width || 0),
  flatFeed: !firstCardStyle || (
    Number.parseFloat(firstCardStyle.borderTopLeftRadius || '0') <= 1
    && firstCardStyle.boxShadow === 'none'
  ),
};
"""
        )
        if (
            not isinstance(metrics, Mapping)
            or int(metrics.get("viewportWidth", 0)) < 320
            or int(metrics.get("viewportHeight", 0)) < 480
            or metrics.get("tabCount") != 2
            or int(metrics.get("cardCount", 101)) > 100
            or metrics.get("searchLabelled") is not True
            or metrics.get("circlesLabelled") is not True
            or metrics.get("composerLabelled") is not True
            or float(metrics.get("scopeWidth", 0))
            < float(metrics.get("pageWidth", 0)) - 40
            or metrics.get("flatFeed") is not True
        ):
            raise GateError("MPS-09 native quality metrics are invalid")
        session.switch_to_native()
        native_source = session.get_page_source()
        screenshot = session.screenshot_bytes()
        if not native_source.strip() or len(screenshot) < 1024:
            raise GateError("MPS-09 native accessibility evidence is empty")
        session.switch_to_app_webview()
        return {
            "uiAction": "native-moments-layout-observation",
            "receiverAssertion": "native-ax-and-screenshot-nonempty",
            "supportingObservation": "bounded-feed-card-count",
            "metrics": dict(metrics),
            "nativeAxBytes": len(native_source.encode("utf-8")),
            "screenshotBytes": len(screenshot),
        }

    def _prepare_actor_identity(self, session: Any, role: str) -> None:
        if self.capability_client is None:
            self.capability_client = EphemeralGateClient.from_environment()
        client = self.capability_client
        if client is None:
            raise SimulatorGateBlocked(
                "iOS Social Actor Identity capability is unavailable",
                "mobile.social.actor-identity",
            )
        result = client.invoke(
            "mobile.social.actor-identity",
            "prepare",
            {
                "clientId": session.client_id,
                "sessionId": session.session_id,
                "role": role,
            },
            timeout_seconds=180,
        )
        if result != {"prepared": True}:
            raise GateError("iOS Social Actor Identity was not prepared")

    @staticmethod
    def _prepare_private_keys(session: Any) -> dict[str, int]:
        prepared = SimulatorSocialGate._mapping(
            session.call_action("moments.private.acceptance.prepareKeys"),
            f"{session.client_id} private Content PreKey preparation",
        )
        reconciled = SimulatorSocialGate._mapping(
            session.call_action("moments.private.reconcile"),
            f"{session.client_id} private Content PreKey reconciliation",
        )
        report = reconciled.get("report")
        if not isinstance(report, Mapping):
            raise GateError(
                f"{session.client_id} private Content PreKey report is missing"
            )
        inventory: dict[str, int] = {}
        for key in (
            "endpointPrekeysAvailable",
            "recoveryPrekeysAvailable",
        ):
            prepared_value = prepared.get(key)
            reconciled_value = report.get(key)
            if (
                not isinstance(prepared_value, int)
                or isinstance(prepared_value, bool)
                or prepared_value <= 0
                or not isinstance(reconciled_value, int)
                or isinstance(reconciled_value, bool)
                or reconciled_value <= 0
            ):
                raise GateError(
                    f"{session.client_id} private Content PreKey inventory "
                    "is unavailable"
                )
            inventory[key] = reconciled_value
        return inventory

    @staticmethod
    def _wait_ui(
        session: Any,
        selector: str,
        label: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            value = session.execute_script(
                """
const node = document.querySelector(arguments[0]);
if (!node) return null;
return {
  text: node.textContent || '',
  acceptanceId: node.getAttribute('data-acceptance-id') || '',
};
""",
                selector,
            )
            return dict(value) if isinstance(value, Mapping) else None

        return SimulatorSocialGate._wait_for_value(read, label)

    @staticmethod
    def _wait_ui_absent(
        session: Any,
        selector: str,
        label: str,
    ) -> None:
        SimulatorSocialGate._wait_for_value(
            lambda: True
            if session.execute_script(
                "return document.querySelector(arguments[0]) === null;",
                selector,
            ) is True
            else None,
            label,
        )

    @staticmethod
    def _click_ui(
        session: Any,
        selector: str,
        label: str,
    ) -> None:
        def click() -> bool | None:
            value = session.execute_script(
                """
const node = document.querySelector(arguments[0]);
if (!node || node.disabled) return null;
node.scrollIntoView({block: 'center', inline: 'nearest'});
node.click();
return true;
""",
                selector,
            )
            return True if value is True else None

        SimulatorSocialGate._wait_for_value(click, label)

    @staticmethod
    def _select_radio(
        session: Any,
        control_selector: str,
        selector: str,
        enabled_selector: str,
        label: str,
    ) -> int:
        element_ref = session.find_element("css selector", control_selector)
        session.click_element(element_ref)

        def selected() -> Mapping[str, object] | None:
            value = session.execute_script(
                """
const input = document.querySelector(arguments[0]);
const enabled = document.querySelector(arguments[1]);
if (input?.checked !== true || enabled?.disabled !== false) return null;
const inputs = Array.from(document.querySelectorAll(
  '[data-acceptance-id="social-search-page"] input[type="radio"]'
));
const index = inputs.indexOf(input);
return index >= 0 ? {index} : null;
""",
                selector,
                enabled_selector,
            )
            return value if isinstance(value, Mapping) else None

        result = SimulatorSocialGate._wait_for_value(selected, label)
        index = result.get("index") if isinstance(result, Mapping) else None
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise GateError(f"{label} returned an invalid option index")
        return index

    @staticmethod
    def _click_ui_for_post(
        session: Any,
        post_id: str,
        acceptance_id: str,
        label: str,
    ) -> None:
        if any(
            character in post_id or character in acceptance_id
            for character in ('"', "\\")
        ):
            raise GateError(f"{label} has an invalid selector identity")
        selector = (
            '[data-acceptance-id="social-moment-card"]'
            f'[data-post-id="{post_id}"] '
            f'[data-acceptance-id="{acceptance_id}"]'
        )

        def click() -> bool | None:
            try:
                element_ref = session.find_element("css selector", selector)
                session.click_element(element_ref)
                return True
            except DriverError:
                return None

        SimulatorSocialGate._wait_for_value(click, label)

    @staticmethod
    def _moment_thread_state(
        session: Any,
        post_id: str,
    ) -> dict[str, int | str]:
        value = session.execute_script(
            """
const postId = arguments[0];
const cards = Array.from(document.querySelectorAll(
  '[data-acceptance-id="social-moment-card"]'
)).filter((node) => node.getAttribute('data-post-id') === postId);
return {
  momentsPages: document.querySelectorAll(
    '[data-acceptance-id="social-moments-page"]'
  ).length,
  cards: cards.length,
  actions: cards.reduce(
    (count, card) => count + card.querySelectorAll(
      '[data-acceptance-id="social-thread-open"]'
    ).length,
    0
  ),
  threads: document.querySelectorAll(
    `[data-acceptance-id="social-moment-thread"][data-post-id="${postId}"]`
  ).length,
  rootError: (
    document.querySelector('[data-acceptance-root-error-stack]')
      ?.textContent || ''
  ).split('\\n')[0].slice(0, 256),
};
""",
            post_id,
        )
        if not isinstance(value, Mapping) or any(
            not isinstance(value.get(key), int)
            or isinstance(value.get(key), bool)
            or int(value[key]) < 0
            for key in ("momentsPages", "cards", "actions", "threads")
        ):
            raise GateError("Moment thread diagnostic is invalid")
        root_error = value.get("rootError")
        if not isinstance(root_error, str):
            raise GateError("Moment thread error diagnostic is invalid")
        return {
            **{
                key: int(value[key])
                for key in ("momentsPages", "cards", "actions", "threads")
            },
            "rootError": redact_text(root_error),
        }

    @staticmethod
    def _set_ui_value(
        session: Any,
        selector: str,
        value: str,
        label: str,
    ) -> None:
        def set_value() -> bool | None:
            changed = session.execute_script(
                """
const node = document.querySelector(arguments[0]);
if (!node) return null;
const value = arguments[1];
const prototype = node.tagName === 'TEXTAREA'
  ? HTMLTextAreaElement.prototype
  : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
if (!setter) return null;
setter.call(node, value);
node.dispatchEvent(new Event('input', {bubbles: true}));
node.dispatchEvent(new Event('change', {bubbles: true}));
return node.value === value;
""",
                selector,
                value,
            )
            return True if changed is True else None

        SimulatorSocialGate._wait_for_value(set_value, label)

    @staticmethod
    def _select_antd_option(
        session: Any,
        selector: str,
        option_index: int,
        label: str,
    ) -> None:
        element_ref = session.find_element("css selector", selector)
        session.click_element(element_ref)

        def select() -> bool | None:
            selected = session.execute_script(
                """
const index = arguments[0];
const dropdowns = Array.from(document.querySelectorAll(
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)'
));
const dropdown = dropdowns.at(-1);
const options = dropdown
  ? Array.from(dropdown.querySelectorAll('.ant-select-item-option'))
  : [];
const option = options[index];
if (!option) return null;
option.click();
return true;
""",
                option_index,
            )
            return True if selected is True else None

        SimulatorSocialGate._wait_for_value(select, label)

    @staticmethod
    def _wait_ui_attribute(
        session: Any,
        selector: str,
        attribute: str,
        expected: str,
        label: str,
    ) -> None:
        SimulatorSocialGate._wait_for_value(
            lambda: True
            if session.execute_script(
                """
const node = document.querySelector(arguments[0]);
return node?.getAttribute(arguments[1]) || null;
""",
                selector,
                attribute,
            ) == expected
            else None,
            label,
        )

    @staticmethod
    def _wait_ui_attribute_value(
        session: Any,
        selector: str,
        attribute: str,
        label: str,
    ) -> str:
        return str(SimulatorSocialGate._wait_for_value(
            lambda: session.execute_script(
                """
const node = document.querySelector(arguments[0]);
return node?.getAttribute(arguments[1]) || null;
""",
                selector,
                attribute,
            ),
            label,
        ))

    @staticmethod
    def _wait_ui_text(
        session: Any,
        selector: str,
        expected: str,
        label: str,
    ) -> None:
        SimulatorSocialGate._wait_for_value(
            lambda: True
            if expected in str(session.execute_script(
                """
const node = document.querySelector(arguments[0]);
return node?.textContent || null;
""",
                selector,
            ) or "")
            else None,
            label,
        )

    @staticmethod
    def _wait_post_visible(
        session: Any,
        post_id: str,
        expected_text: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            value = session.execute_script(
                """
const postId = arguments[0];
const expectedText = arguments[1];
const card = Array.from(document.querySelectorAll(
  '[data-acceptance-id="social-moment-card"]'
)).find((node) => node.getAttribute('data-post-id') === postId);
if (!card) return null;
const text = card.textContent || '';
if (expectedText && !text.includes(expectedText)) return null;
return {
  postId,
  textVisible: !expectedText || text.includes(expectedText),
  contentKind: card.getAttribute('data-moment-content-kind') || '',
};
""",
                post_id,
                expected_text,
            )
            return dict(value) if isinstance(value, Mapping) else None

        return SimulatorSocialGate._wait_for_value(
            read,
            f"receiver-visible Moment {post_id}",
        )

    @staticmethod
    def _wait_new_private_post(
        session: Any,
        before_ids: set[Any],
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            snapshot = session.call_action("moments.private.snapshot")
            if not isinstance(snapshot, Mapping):
                return None
            publish = snapshot.get("publish")
            if not isinstance(publish, list):
                return None
            return next(
                (
                    dict(item)
                    for item in publish
                    if isinstance(item, Mapping)
                    and item.get("state") == "PUBLISHED"
                    and item.get("postId")
                    and item.get("postId") not in before_ids
                ),
                None,
            )

        return SimulatorSocialGate._wait_for_value(
            read,
            "published private Moment",
        )

    def _run_storage_cache_cleanup_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        seeded = self._mapping(
            session.call_action(
                "storage.cache.seed",
                {"sizeBytes": fixture_size},
            ),
            "storage cache fixture",
        )
        if seeded.get("sizeBytes") != fixture_size:
            raise GateError("storage cache fixture size changed")

        draft = session.call_action(
            "reliability.draft.write",
            {
                "kind": "chat",
                "targetId": f"storage-{journey_id}-draft",
                "text": f"storage-{journey_id}-protected-draft",
            },
        )
        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before cache cleanup",
        )
        if not identity_before.get("active"):
            raise GateError("messaging runtime is inactive before cache cleanup")

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        def click_storage_refresh() -> bool | None:
            clicked = session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            return True if clicked is True else None

        self._wait_for_value(
            click_storage_refresh,
            "storage refresh action",
        )
        before = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("cacheBytes") or 0) >= fixture_size,
            "seeded Mobile Chat cache measurement",
        )

        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-clear-cache]');
if (!button) throw new Error('storage clear action missing');
button.click();
return true;
"""
        )
        self._wait_for_storage_snapshot(
            session,
            lambda value: bool(value.get("confirmVisible")),
            "Mobile Chat cache confirmation",
        )
        session.execute_script(
            """
const button = document.querySelector(
  '[data-chat-storage-clear-confirm-apply]'
);
if (!button) throw new Error('storage clear confirmation action missing');
button.click();
return true;
"""
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: value.get("resultState") == "succeeded"
            and int(value.get("releasedBytes") or 0) > 0,
            "Mobile Chat cache cleanup result",
        )

        released_bytes = int(after.get("releasedBytes") or 0)
        if (
            int(after.get("physicalTotalBytes") or 0)
            >= int(before.get("physicalTotalBytes") or 0)
            or int(after.get("cacheBytes") or 0)
            >= int(before.get("cacheBytes") or 0)
        ):
            raise GateError("Mobile Chat cache cleanup did not reclaim physical bytes")

        retained = session.call_action("reliability.draft.read", {})
        self._require_drafts({"drafts": retained}, (draft,))
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after cache cleanup",
        )
        if identity_after != identity_before:
            raise GateError("cache cleanup changed the active messaging identity")
        session.call_action(
            "reliability.draft.action",
            {"action": "discard"},
        )
        return {
            "scenario": "storage-cache-cleanup",
            "fixtureBytes": fixture_size,
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "cacheBytesBefore": int(before["cacheBytes"]),
            "cacheBytesAfter": int(after["cacheBytes"]),
            "releasedBytes": released_bytes,
            "draftPreserved": True,
            "messagingIdentityPreserved": True,
            "confirmationObserved": True,
        }

    def _run_storage_retention_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        fixture = self._mapping(
            session.call_action(
                "storage.retention.seed",
                {"oldPlaintextBytes": fixture_size},
            ),
            "storage retention fixture",
        )
        conversation_id = self._required_text(
            fixture,
            "conversationId",
            "storage retention fixture",
        )
        pruned_message_id = self._required_text(
            fixture,
            "prunedMessageId",
            "storage retention fixture",
        )
        protected_message_id = self._required_text(
            fixture,
            "protectedMessageId",
            "storage retention fixture",
        )
        recent_message_id = self._required_text(
            fixture,
            "recentMessageId",
            "storage retention fixture",
        )
        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before retention",
        )
        if not identity_before.get("active"):
            raise GateError("messaging runtime is inactive before retention")

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh action",
        )
        before = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("messageBytes") or 0) >= fixture_size
            and conversation_id in value.get("conversationIds", []),
            "seeded Mobile Chat retention measurement",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const select = document.querySelector('[data-chat-storage-retention-select]');
if (!select) return false;
select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
select.click();
return true;
"""
            )
            or None,
            "retention selector",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const label = document.querySelector(
  '[data-chat-storage-retention-option="30"]'
);
const option = label?.closest('[role="option"], .ant-select-item-option') || label;
if (!option) return false;
option.click();
return true;
"""
            )
            or None,
            "30 day retention option",
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: value.get("retentionPreset") == "4"
            and value.get("retentionResultState") == "succeeded"
            and int(value.get("retentionReleasedBytes") or 0) > 0,
            "completed Mobile Chat retention",
        )
        projection = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "messaging projection after retention",
        )
        messages_by_conversation = self._mapping(
            projection.get("messages"),
            "retention message projection map",
        )
        messages = messages_by_conversation.get(conversation_id)
        if not isinstance(messages, list):
            raise GateError("retention conversation messages are unavailable")
        message_ids = {
            str(message.get("messageId") or "")
            for message in messages
            if isinstance(message, Mapping)
        }
        if pruned_message_id in message_ids:
            raise GateError("retention left pruned plaintext visible")
        if protected_message_id not in message_ids or recent_message_id not in message_ids:
            raise GateError("retention removed protected or recent message state")

        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("retention restart was not acknowledged")
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_storage_snapshot(
            session,
            lambda value: value.get("retentionPreset") == "4",
            "restart-stable Mobile Chat retention policy",
        )
        restored_projection = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "messaging projection after retention restart",
        )
        restored_messages = self._mapping(
            restored_projection.get("messages"),
            "retention restart message projection map",
        ).get(conversation_id)
        if not isinstance(restored_messages, list):
            raise GateError("retention restart messages are unavailable")
        restored_ids = {
            str(message.get("messageId") or "")
            for message in restored_messages
            if isinstance(message, Mapping)
        }
        if pruned_message_id in restored_ids:
            raise GateError("retention-pruned plaintext returned after restart")
        if protected_message_id not in restored_ids or recent_message_id not in restored_ids:
            raise GateError("retention protection changed after restart")
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after retention",
        )
        if identity_after != identity_before:
            raise GateError("retention changed the active messaging identity")
        return {
            "scenario": "storage-retention",
            "journeyId": journey_id,
            "conversationId": conversation_id,
            "retentionPreset": after["retentionPreset"],
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "releasedBytes": int(after["retentionReleasedBytes"]),
            "prunedMessageAbsent": True,
            "protectedMessagePreserved": True,
            "recentMessagePreserved": True,
            "restartStable": True,
            "messagingIdentityPreserved": True,
        }

    def _run_storage_conversation_clear_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        fixture = self._mapping(
            session.call_action(
                "storage.conversation-clear.seed",
                {"plaintextBytes": fixture_size},
            ),
            "storage conversation clear fixture",
        )
        conversation_id = self._required_text(
            fixture,
            "conversationId",
            "storage conversation clear fixture",
        )
        message_id = self._required_text(
            fixture,
            "messageId",
            "storage conversation clear fixture",
        )
        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before conversation clear",
        )
        if not identity_before.get("active"):
            raise GateError(
                "messaging runtime is inactive before conversation clear"
            )

        session.call_action("messaging.reconcile")
        projection_before = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "conversation projection before clear",
        )
        messages_before = self._mapping(
            projection_before.get("messages"),
            "conversation message projection before clear",
        ).get(conversation_id)
        if not isinstance(messages_before, list) or not any(
            isinstance(message, Mapping)
            and message.get("messageId") == message_id
            for message in messages_before
        ):
            raise GateError("conversation clear fixture message is not visible")

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh before conversation clear",
        )
        before = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("messageBytes") or 0) >= fixture_size
            and conversation_id in value.get("conversationIds", []),
            "seeded Mobile conversation clear measurement",
        )

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:chat"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:chat-conversation",
                    "sessionUlid": conversation_id,
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-actions-open]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "conversation actions",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector(
  '[data-chat-history-action="clear"]'
);
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "conversation clear action",
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = Array.from(document.querySelectorAll(
  '.ant-modal-confirm .ant-btn-primary'
)).find((candidate) => candidate.offsetParent !== null);
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "conversation clear confirmation",
        )
        clear_result = self._wait_for_value(
            lambda: session.execute_script(
                """
const result = document.querySelector(
  '[data-chat-conversation-clear-result="succeeded"]'
);
if (!result) return null;
return {
  releasedBytes: Number(
    result.getAttribute('data-chat-storage-released-bytes') || '0'
  ),
};
"""
            ),
            "conversation clear result",
            timeout_seconds=60,
        )
        released_bytes = int(clear_result.get("releasedBytes") or 0)
        if released_bytes <= 0:
            raise GateError(
                "conversation clear did not report released physical bytes"
            )
        session.execute_script(
            """
const button = Array.from(document.querySelectorAll(
  '.ant-modal-confirm .ant-btn-primary'
)).find((candidate) => candidate.offsetParent !== null);
button?.click();
"""
        )

        session.call_action("messaging.reconcile")
        projection_after = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "conversation projection after clear",
        )
        messages_after = self._mapping(
            projection_after.get("messages"),
            "conversation message projection after clear",
        ).get(conversation_id)
        if not isinstance(messages_after, list) or messages_after:
            raise GateError("conversation clear left plaintext projections")
        search_after = session.call_action(
            "messaging.search",
            {
                "conversationId": conversation_id,
                "query": "cccccccc",
                "limit": 20,
            },
        )
        if not isinstance(search_after, list) or search_after:
            raise GateError("conversation clear left searchable plaintext")

        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("conversation clear restart was not acknowledged")
        session.call_action("messaging.reconcile")
        projection_restarted = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            "conversation projection after clear restart",
        )
        messages_restarted = self._mapping(
            projection_restarted.get("messages"),
            "conversation message projection after clear restart",
        ).get(conversation_id)
        if not isinstance(messages_restarted, list) or messages_restarted:
            raise GateError(
                "conversation clear plaintext returned after restart"
            )

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh after conversation clear",
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("physicalTotalBytes") or 0)
            < int(before.get("physicalTotalBytes") or 0),
            "Mobile conversation clear physical reclamation",
        )
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after conversation clear",
        )
        if identity_after != identity_before:
            raise GateError(
                "conversation clear changed the active messaging identity"
            )
        return {
            "scenario": "storage-conversation-clear",
            "journeyId": journey_id,
            "conversationId": conversation_id,
            "messageId": message_id,
            "fixtureBytes": fixture_size,
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "releasedBytes": released_bytes,
            "plaintextAbsent": True,
            "searchEntryAbsent": True,
            "restartStable": True,
            "messagingIdentityPreserved": True,
        }

    def _seed_storage_batch(
        self,
        session: Any,
        count: int = 2,
    ) -> tuple[list[str], list[str]]:
        fixtures = [
            self._mapping(
                session.call_action(
                    "storage.conversation-clear.seed",
                    {"plaintextBytes": 2 * 1024 * 1024},
                ),
                "storage batch clear fixture",
            )
            for _ in range(count)
        ]
        conversation_ids = [
            self._required_text(
                fixture,
                "conversationId",
                "storage batch clear fixture",
            )
            for fixture in fixtures
        ]
        message_ids = [
            self._required_text(
                fixture,
                "messageId",
                "storage batch clear fixture",
            )
            for fixture in fixtures
        ]
        if len(set(conversation_ids)) != count:
            raise GateError("storage batch fixtures are not distinct")
        return conversation_ids, message_ids

    def _refresh_mobile_storage_rows(
        self,
        session: Any,
        conversation_ids: list[str],
    ) -> dict[str, Any]:
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "Mobile storage refresh",
        )
        return self._wait_for_storage_snapshot(
            session,
            lambda value: set(conversation_ids).issubset(
                set(value.get("conversationIds", []))
            ),
            "seeded Mobile storage conversations",
        )

    def _select_mobile_storage_rows(
        self,
        session: Any,
        conversation_ids: list[str],
    ) -> list[str]:
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-manage]');
if (!button) throw new Error('batch manage action missing');
button.click();
"""
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
return Boolean(document.querySelector(
  '[data-chat-storage-batch-actions]'
));
"""
            )
            or None,
            "Mobile batch selection controls",
        )
        for conversation_id in conversation_ids:
            selected = session.execute_script(
                """
const row = Array.from(document.querySelectorAll(
  '[data-chat-storage-conversation]'
)).find((candidate) => (
  candidate.getAttribute('data-chat-storage-conversation') === arguments[0]
));
const control = row?.querySelector(
  '[data-chat-storage-conversation-select]'
);
const checkbox = control?.matches('input')
  ? control
  : control?.querySelector('input');
if (!checkbox) return false;
checkbox.click();
return true;
""",
                conversation_id,
            )
            if selected is not True:
                raise GateError(
                    f"storage batch row is not selectable: {conversation_id}"
                )
            self._wait_for_value(
                lambda conversation_id=conversation_id: (
                    session.execute_script(
                        """
const row = Array.from(document.querySelectorAll(
  '[data-chat-storage-conversation]'
)).find((candidate) => (
  candidate.getAttribute('data-chat-storage-conversation') === arguments[0]
));
return row?.getAttribute('data-chat-storage-selected') === 'true';
""",
                        conversation_id,
                    )
                    or None
                ),
                f"selected Mobile storage row {conversation_id}",
            )
        return self._wait_for_value(
            lambda: (
                value
                if (
                    isinstance(
                        value := session.execute_script(
                            """
return Array.from(document.querySelectorAll(
  '[data-chat-storage-selected="true"]'
)).map((row) => (
  row.getAttribute('data-chat-storage-conversation') || ''
));
"""
                        ),
                        list,
                    )
                    and set(value) == set(conversation_ids)
                )
                else None
            ),
            "selected Mobile storage rows",
        )

    def _select_mobile_storage_rows_from_filter(
        self,
        session: Any,
        *,
        filtered_id: str,
        additional_id: str,
        control_id: str,
    ) -> dict[str, Any]:
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-manage]');
if (!button) throw new Error('batch manage action missing');
button.click();
"""
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
return Boolean(document.querySelector(
  '[data-chat-storage-batch-actions]'
));
"""
            )
            or None,
            "Mobile batch selection controls",
        )

        def set_search(query: str) -> None:
            updated = session.execute_script(
                """
const marker = document.querySelector('[data-chat-storage-search]');
const input = marker?.matches('input')
  ? marker
  : marker?.querySelector('input');
if (!input) return false;
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value'
)?.set;
if (!setter) return false;
setter.call(input, arguments[0]);
input.dispatchEvent(new Event('input', { bubbles: true }));
return true;
""",
                query,
            )
            if updated is not True:
                raise GateError("Mobile storage search input is unavailable")

        def selection_state() -> dict[str, Any]:
            return self._mapping(
                session.execute_script(
                    """
const rows = Array.from(document.querySelectorAll(
  '[data-chat-storage-conversation]'
));
const selectedIds = rows
  .filter((row) => (
    row.getAttribute('data-chat-storage-selected') === 'true'
  ))
  .map((row) => (
    row.getAttribute('data-chat-storage-conversation') || ''
  ));
const selected = (conversationId) => rows.some((row) => (
  row.getAttribute('data-chat-storage-conversation') === conversationId
  && row.getAttribute('data-chat-storage-selected') === 'true'
));
return {
  visibleIds: rows.map((row) => (
    row.getAttribute('data-chat-storage-conversation') || ''
  )),
  selectedIds,
  additionalSelected: selected(arguments[0]),
  controlSelected: selected(arguments[1]),
  clearEnabled: !document.querySelector(
    '[data-chat-storage-batch-clear]'
  )?.disabled,
};
""",
                    additional_id,
                    control_id,
                ),
                "Mobile filtered batch selection state",
            )

        set_search(filtered_id)
        filtered = self._wait_for_value(
            lambda: (
                value
                if (
                    (value := selection_state()).get("visibleIds")
                    == [filtered_id]
                    and value.get("selectedIds") == []
                )
                else None
            ),
            "Mobile filtered storage row",
        )
        selected_all = session.execute_script(
            """
const control = document.querySelector(
  '[data-chat-storage-batch-select-all]'
);
const checkbox = control?.matches('input')
  ? control
  : control?.querySelector('input');
if (!checkbox || checkbox.disabled) return false;
checkbox.click();
return true;
"""
        )
        if selected_all is not True:
            raise GateError("Mobile filtered select-all is unavailable")
        filtered_selected = self._wait_for_value(
            lambda: (
                value
                if (
                    (value := selection_state()).get("visibleIds")
                    == [filtered_id]
                    and value.get("selectedIds") == [filtered_id]
                )
                else None
            ),
            "Mobile filtered select-all result",
        )

        set_search("")
        selection_after_clear = self._wait_for_value(
            lambda: (
                value
                if (
                    set(
                        (value := selection_state()).get("visibleIds") or []
                    )
                    == {filtered_id, additional_id, control_id}
                    and value.get("selectedIds") == [filtered_id]
                    and value.get("additionalSelected") is False
                    and value.get("controlSelected") is False
                )
                else None
            ),
            "Mobile filtered-out rows remain unselected",
        )
        selected = session.execute_script(
            """
const row = Array.from(document.querySelectorAll(
  '[data-chat-storage-conversation]'
)).find((candidate) => (
  candidate.getAttribute('data-chat-storage-conversation') === arguments[0]
));
const control = row?.querySelector(
  '[data-chat-storage-conversation-select]'
);
const checkbox = control?.matches('input')
  ? control
  : control?.querySelector('input');
if (!checkbox) return false;
checkbox.click();
return true;
""",
            additional_id,
        )
        if selected is not True:
            raise GateError(
                f"storage batch row is not selectable: {additional_id}"
            )
        final = self._wait_for_value(
            lambda: (
                value
                if (
                    isinstance(value := selection_state(), Mapping)
                    and set(value.get("selectedIds") or [])
                    == {filtered_id, additional_id}
                    and value.get("additionalSelected") is True
                    and value.get("controlSelected") is False
                    and value.get("clearEnabled") is True
                )
                else None
            ),
            "Mobile filtered and explicit batch selection",
        )
        return {
            "query": filtered_id,
            "filteredVisibleIds": filtered.get("visibleIds"),
            "filteredSelectedIds": filtered_selected.get("selectedIds"),
            "selectedAfterQueryClear": selection_after_clear.get(
                "selectedIds"
            ),
            "selectedIds": final.get("selectedIds"),
            "controlConversationId": control_id,
            "controlSelected": final.get("controlSelected"),
        }

    def _require_mobile_message_visible(
        self,
        session: Any,
        *,
        conversation_id: str,
        message_id: str,
        description: str,
    ) -> dict[str, Any]:
        projection = self._mapping(
            session.call_action(
                "messaging.projection.read",
                {"conversationId": conversation_id},
            ),
            description,
        )
        messages = self._mapping(
            projection.get("messages"),
            f"{description} messages",
        ).get(conversation_id)
        message_visible = isinstance(messages, list) and any(
            isinstance(message, Mapping)
            and message.get("messageId") == message_id
            for message in messages
        )
        if not message_visible:
            raise GateError(f"{description} is not preserved")
        return {
            "conversationId": conversation_id,
            "messageId": message_id,
            "messageCount": len(messages),
            "projectionVisible": True,
        }

    def _mobile_batch_confirmation(self, session: Any) -> dict[str, Any]:
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-clear]');
if (!button || button.disabled) {
  throw new Error('batch clear action unavailable');
}
button.click();
"""
        )
        return self._mapping(
            self._wait_for_value(
                lambda: session.execute_script(
                    """
const confirmation = document.querySelector(
  '[data-chat-storage-batch-confirm]'
);
const button = confirmation?.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
);
if (!button || button.disabled) return null;
return {
  estimatedBytes: Number(
    confirmation.getAttribute(
      'data-chat-storage-batch-estimated-bytes'
    ) || '0'
  ),
  selectedCount: Number(
    confirmation.getAttribute(
      'data-chat-storage-batch-selected-count'
    ) || '0'
  ),
  scope: confirmation.getAttribute(
    'data-chat-storage-batch-scope'
  ) || '',
  text: confirmation.innerText || '',
};
"""
                ),
                "Mobile batch confirmation",
            ),
            "Mobile batch confirmation",
        )

    @staticmethod
    def _install_mobile_batch_progress_probe(session: Any) -> None:
        session.execute_script(
            """
window.__PT_CHAT_STORAGE_BATCH_PROGRESS__ = [];
window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__?.disconnect();
const record = () => {
  const progress = document.querySelector(
    '[data-chat-storage-batch-progress]'
  );
  if (!progress) return;
  const value = {
    completed: Number(progress.getAttribute(
      'data-chat-storage-batch-completed'
    ) || '0'),
    total: Number(progress.getAttribute(
      'data-chat-storage-batch-total'
    ) || '0'),
    text: progress.innerText || '',
  };
  const values = window.__PT_CHAT_STORAGE_BATCH_PROGRESS__;
  const previous = values[values.length - 1];
  if (!previous
    || previous.completed !== value.completed
    || previous.total !== value.total) {
    values.push(value);
  }
};
const observer = new MutationObserver(record);
observer.observe(document.body, {
  attributes: true,
  childList: true,
  characterData: true,
  subtree: true,
});
window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__ = observer;
record();
"""
        )

    @staticmethod
    def _mobile_batch_progress(session: Any) -> list[dict[str, Any]]:
        value = session.execute_script(
            """
window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__?.disconnect();
return window.__PT_CHAT_STORAGE_BATCH_PROGRESS__ || [];
"""
        )
        return value if isinstance(value, list) else []

    def _wait_mobile_batch_result(
        self,
        session: Any,
        status: str,
    ) -> dict[str, Any]:
        return self._mapping(
            self._wait_for_value(
                lambda: session.execute_script(
                    """
const result = document.querySelector(
  `[data-chat-storage-batch-result="${arguments[0]}"]`
);
if (!result) return null;
return {
  succeeded: Number(
    result.getAttribute('data-chat-storage-batch-succeeded') || '0'
  ),
  failed: Number(
    result.getAttribute('data-chat-storage-batch-failed') || '0'
  ),
  releasedBytes: Number(
    result.getAttribute('data-chat-storage-released-bytes') || '0'
  ),
  retryVisible: Boolean(document.querySelector(
    '[data-chat-storage-batch-retry]'
  )),
  selected: Array.from(document.querySelectorAll(
    '[data-chat-storage-selected="true"]'
  )).map((row) => (
    row.getAttribute('data-chat-storage-conversation') || ''
  )),
};
""",
                    status,
                ),
                f"Mobile batch clear {status} result",
                timeout_seconds=120,
            ),
            f"Mobile batch clear {status} result",
        )

    def _run_storage_batch_clear_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        fixture_size = 2 * 1024 * 1024
        conversation_ids, message_ids = self._seed_storage_batch(
            session,
            count=3,
        )
        selected_conversation_ids = conversation_ids[:2]
        selected_message_ids = message_ids[:2]
        control_conversation_id = conversation_ids[2]
        control_message_id = message_ids[2]

        identity_before = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity before storage batch clear",
        )
        if not identity_before.get("active"):
            raise GateError(
                "messaging runtime is inactive before storage batch clear"
            )
        session.call_action("messaging.reconcile")
        control_before = self._require_mobile_message_visible(
            session,
            conversation_id=control_conversation_id,
            message_id=control_message_id,
            description="unselected Mobile control before batch clear",
        )
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        before = self._refresh_mobile_storage_rows(session, conversation_ids)
        if int(before.get("messageBytes") or 0) < fixture_size * 3:
            raise GateError("Mobile batch fixture bytes are incomplete")
        session.call_action("storage.batch.scenario", {"delayMs": 400})
        filtered_selection = self._select_mobile_storage_rows_from_filter(
            session,
            filtered_id=selected_conversation_ids[0],
            additional_id=selected_conversation_ids[1],
            control_id=control_conversation_id,
        )
        selected_ids = filtered_selection.get("selectedIds") or []
        estimated_reclaimable_bytes = sum(
            int(before.get("conversationReclaimableBytes", {}).get(
                conversation_id,
                0,
            ))
            for conversation_id in selected_conversation_ids
        )

        confirmation = self._mobile_batch_confirmation(session)
        if (
            estimated_reclaimable_bytes <= 0
            or confirmation.get("estimatedBytes") != estimated_reclaimable_bytes
            or confirmation.get("selectedCount") != 2
            or confirmation.get("scope") != "current-device"
            or not str(confirmation.get("text") or "").strip()
        ):
            raise GateError("Mobile batch clear confirmation is incomplete")
        self._install_mobile_batch_progress_probe(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        batch_result = self._wait_mobile_batch_result(session, "succeeded")
        progress = self._mobile_batch_progress(session)
        if (
            set(selected_ids) != set(selected_conversation_ids)
            or filtered_selection.get("filteredVisibleIds")
            != [selected_conversation_ids[0]]
            or filtered_selection.get("filteredSelectedIds")
            != [selected_conversation_ids[0]]
            or filtered_selection.get("selectedAfterQueryClear")
            != [selected_conversation_ids[0]]
            or filtered_selection.get("controlSelected") is not False
            or batch_result.get("succeeded") != 2
            or batch_result.get("failed") != 0
            or int(batch_result.get("releasedBytes") or 0) <= 0
            or not isinstance(progress, list)
            or not any(
                isinstance(item, Mapping)
                and item.get("total") == 2
                and item.get("completed") in {0, 1}
                and bool(str(item.get("text") or "").strip())
                for item in progress
            )
        ):
            raise GateError("Mobile batch clear result is incomplete")

        partial_ids, partial_message_ids = self._seed_storage_batch(session)
        partial_snapshot = self._refresh_mobile_storage_rows(
            session,
            partial_ids,
        )
        partial_order = [
            conversation_id
            for conversation_id in partial_snapshot.get("conversationIds", [])
            if conversation_id in partial_ids
        ]
        if len(partial_order) != 2:
            raise GateError("Mobile partial-failure batch order is incomplete")
        session.call_action(
            "storage.batch.scenario",
            {
                "delayMs": 400,
                "failureConversationId": partial_order[1],
            },
        )
        self._select_mobile_storage_rows(session, partial_ids)
        partial_confirmation = self._mobile_batch_confirmation(session)
        self._install_mobile_batch_progress_probe(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        partial_result = self._wait_mobile_batch_result(
            session,
            "partial_failure",
        )
        partial_progress = self._mobile_batch_progress(session)
        if (
            partial_confirmation.get("selectedCount") != 2
            or partial_confirmation.get("scope") != "current-device"
            or partial_result.get("succeeded") != 1
            or partial_result.get("failed") != 1
            or partial_result.get("retryVisible") is not True
            or set(partial_result.get("selected") or [])
            != {partial_order[1]}
            or not any(
                isinstance(item, Mapping)
                and item.get("completed") == 1
                and item.get("total") == 2
                for item in partial_progress
            )
        ):
            raise GateError("Mobile batch partial-failure UI is incomplete")
        session.execute_script(
            """
const button = document.querySelector('[data-chat-storage-batch-retry]');
if (!button || button.disabled) {
  throw new Error('batch retry action unavailable');
}
button.click();
"""
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const confirmation = document.querySelector(
  '[data-chat-storage-batch-confirm]'
);
return confirmation?.getAttribute(
  'data-chat-storage-batch-selected-count'
) === '1';
"""
            )
            or None,
            "Mobile failed-only batch retry confirmation",
        )
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        retry_result = self._wait_mobile_batch_result(session, "succeeded")
        if (
            retry_result.get("succeeded") != 1
            or retry_result.get("failed") != 0
        ):
            raise GateError("Mobile failed-only batch retry did not succeed")

        scope_ids, scope_message_ids = self._seed_storage_batch(session)
        scope_snapshot_before = self._refresh_mobile_storage_rows(
            session,
            scope_ids,
        )
        scope_order = [
            conversation_id
            for conversation_id in scope_snapshot_before.get(
                "conversationIds",
                [],
            )
            if conversation_id in scope_ids
        ]
        if len(scope_order) != 2:
            raise GateError("Mobile scope-change batch order is incomplete")
        session.call_action(
            "storage.batch.scenario",
            {
                "delayMs": 400,
                "scopeChangeConversationId": scope_order[1],
            },
        )
        self._select_mobile_storage_rows(session, scope_ids)
        self._mobile_batch_confirmation(session)
        self._install_mobile_batch_progress_probe(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        scope_ui = self._mapping(
            self._wait_for_value(
                lambda: (
                    value
                    if (
                        isinstance(
                            value := session.execute_script(
                                """
return {
  actions: Boolean(document.querySelector(
    '[data-chat-storage-batch-actions]'
  )),
  result: Boolean(document.querySelector(
    '[data-chat-storage-batch-result]'
  )),
  summary: Boolean(document.querySelector(
    '[data-chat-storage-summary]'
  )),
};
"""
                            ),
                            Mapping,
                        )
                        and value == {
                            "actions": False,
                            "result": False,
                            "summary": False,
                        }
                    )
                    else None
                ),
                "Mobile batch scope-change reset",
            ),
            "Mobile batch scope-change reset",
        )
        scope_progress = self._mobile_batch_progress(session)
        scope_completed = max(
            (
                int(item.get("completed") or 0)
                for item in scope_progress
                if isinstance(item, Mapping) and item.get("total") == 2
            ),
            default=0,
        )
        restart_after_scope = session.call_action("lifecycle.restart")
        if restart_after_scope != {"requested": True, "scope": "webview"}:
            raise GateError("Mobile scope recovery restart was not acknowledged")
        session.call_action("messaging.reconcile")
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        scope_snapshot_after = self._refresh_mobile_storage_rows(
            session,
            [],
        )
        scope_conversation_ids = set(
            scope_snapshot_after.get("conversationIds", [])
        )
        scope_reclaimable_bytes = scope_snapshot_after.get(
            "conversationReclaimableBytes",
            {},
        )
        remaining_scope_ids = [
            conversation_id
            for conversation_id in scope_ids
            if (
                conversation_id in scope_conversation_ids
                and isinstance(scope_reclaimable_bytes, Mapping)
                and int(scope_reclaimable_bytes.get(conversation_id) or 0) > 0
            )
        ]
        if (
            scope_ui != {
                "actions": False,
                "result": False,
                "summary": False,
            }
            or scope_completed not in {0, 1}
            or len(remaining_scope_ids) != 2 - scope_completed
        ):
            raise GateError(
                "Mobile batch scope-change isolation is incomplete: "
                + json.dumps(
                    {
                        "completed": scope_completed,
                        "progress": scope_progress,
                        "remainingConversationIds": remaining_scope_ids,
                        "ui": scope_ui,
                    },
                    sort_keys=True,
                )
            )
        self._select_mobile_storage_rows(session, remaining_scope_ids)
        self._mobile_batch_confirmation(session)
        session.execute_script(
            """
document.querySelector(
  '[data-chat-storage-batch-confirm-apply]'
)?.click();
"""
        )
        scope_cleanup = self._wait_mobile_batch_result(session, "succeeded")
        if scope_cleanup.get("succeeded") != len(remaining_scope_ids):
            raise GateError("Mobile scope-change remainder cleanup is incomplete")

        all_conversation_ids = [
            *selected_conversation_ids,
            *partial_ids,
            *scope_ids,
        ]
        all_message_ids = [
            *selected_message_ids,
            *partial_message_ids,
            *scope_message_ids,
        ]

        for conversation_id in all_conversation_ids:
            projection = self._mapping(
                session.call_action(
                    "messaging.projection.read",
                    {"conversationId": conversation_id},
                ),
                "conversation projection after storage batch clear",
            )
            messages = self._mapping(
                projection.get("messages"),
                "conversation messages after storage batch clear",
            ).get(conversation_id)
            if not isinstance(messages, list) or messages:
                raise GateError("storage batch clear left plaintext projections")
            search = session.call_action(
                "messaging.search",
                {
                    "conversationId": conversation_id,
                    "query": "cccccccc",
                    "limit": 20,
                },
            )
            if not isinstance(search, list) or search:
                raise GateError("storage batch clear left searchable plaintext")

        control_after_clear = self._require_mobile_message_visible(
            session,
            conversation_id=control_conversation_id,
            message_id=control_message_id,
            description="unselected Mobile control after batch clear",
        )
        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("storage batch clear restart was not acknowledged")
        session.call_action("messaging.reconcile")
        for conversation_id in all_conversation_ids:
            projection = self._mapping(
                session.call_action(
                    "messaging.projection.read",
                    {"conversationId": conversation_id},
                ),
                "conversation projection after storage batch restart",
            )
            messages = self._mapping(
                projection.get("messages"),
                "conversation messages after storage batch restart",
            ).get(conversation_id)
            if not isinstance(messages, list) or messages:
                raise GateError(
                    "storage batch-cleared plaintext returned after restart"
                )
        control_after_restart = self._require_mobile_message_visible(
            session,
            conversation_id=control_conversation_id,
            message_id=control_message_id,
            description="unselected Mobile control after batch restart",
        )

        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "chat-settings",
                },
            },
        )
        self._wait_for_value(
            lambda: session.execute_script(
                """
const button = document.querySelector('[data-chat-storage-refresh]');
if (!button) return false;
button.click();
return true;
"""
            )
            or None,
            "storage refresh after batch clear",
        )
        after = self._wait_for_storage_snapshot(
            session,
            lambda value: int(value.get("physicalTotalBytes") or 0)
            < int(before.get("physicalTotalBytes") or 0),
            "Mobile batch clear physical reclamation",
        )
        identity_after = self._mapping(
            session.call_action("getRealtimeDevice"),
            "messaging identity after storage batch clear",
        )
        if identity_after != identity_before:
            raise GateError(
                "storage batch clear changed the active messaging identity"
            )
        return {
            "scenario": "storage-batch-clear",
            "journeyId": journey_id,
            "conversationIds": all_conversation_ids,
            "messageIds": all_message_ids,
            "fixtureBytes": fixture_size * (
                len(all_conversation_ids) + 1
            ),
            "estimatedReclaimableBytes": estimated_reclaimable_bytes,
            "physicalBytesBefore": int(before["physicalTotalBytes"]),
            "physicalBytesAfter": int(after["physicalTotalBytes"]),
            "releasedBytes": int(batch_result["releasedBytes"]),
            "succeeded": int(batch_result["succeeded"]),
            "failed": int(batch_result["failed"]),
            "confirmation": confirmation,
            "progress": progress,
            "partialFailure": partial_result,
            "partialRetry": retry_result,
            "scopeChange": {
                "completed": scope_completed,
                "progress": scope_progress,
                "remainingConversationIds": remaining_scope_ids,
            },
            "filteredSelection": filtered_selection,
            "unselectedControl": {
                "before": control_before,
                "afterClear": control_after_clear,
                "afterRestart": control_after_restart,
            },
            "unselectedPreserved": True,
            "plaintextAbsent": True,
            "searchEntryAbsent": True,
            "restartStable": True,
            "messagingIdentityPreserved": True,
        }

    @classmethod
    def _wait_for_storage_snapshot(
        cls,
        session: Any,
        predicate: Any,
        description: str,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + 60
        last: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            value = session.execute_script(
                """
const summary = document.querySelector('[data-chat-storage-summary]');
if (!summary) return null;
const categories = {};
for (const item of document.querySelectorAll('[data-chat-storage-category]')) {
  categories[item.getAttribute('data-chat-storage-category')] = Number(
    item.getAttribute('data-chat-storage-category-bytes') || '0'
  );
}
const result = document.querySelector('[data-chat-storage-clear-result]');
const retention = document.querySelector('[data-chat-storage-retention-preset]');
const retentionResult = document.querySelector('[data-chat-storage-retention-result]');
return {
  physicalTotalBytes: Number(
    summary.getAttribute('data-chat-storage-physical-bytes') || '0'
  ),
  measuredAtUnixMs: Number(
    summary.getAttribute('data-chat-storage-measured-at') || '0'
  ),
  messageBytes: Number(categories.message || 0),
  cacheBytes: Number(categories.cache || 0),
  conversationIds: Array.from(document.querySelectorAll(
    '[data-chat-storage-conversation]'
  )).map((item) => item.getAttribute('data-chat-storage-conversation') || ''),
  conversationReclaimableBytes: Object.fromEntries(
    Array.from(document.querySelectorAll(
      '[data-chat-storage-conversation]'
    )).map((item) => [
      item.getAttribute('data-chat-storage-conversation') || '',
      Number(
        item.getAttribute('data-chat-storage-reclaimable-bytes') || '0'
      ),
    ])
  ),
  retentionPreset: retention?.getAttribute('data-chat-storage-retention-preset') || '',
  retentionResultState: retentionResult?.getAttribute(
    'data-chat-storage-retention-result'
  ) || '',
  retentionReleasedBytes: Number(
    retentionResult?.getAttribute('data-chat-storage-retention-released-bytes') || '0'
  ),
  confirmVisible: Boolean(
    document.querySelector('[data-chat-storage-clear-confirm]')
  ),
  resultState: result?.getAttribute('data-chat-storage-clear-result') || '',
  releasedBytes: Number(
    result?.getAttribute('data-chat-storage-released-bytes') || '0'
  ),
};
"""
            )
            if isinstance(value, Mapping):
                last = dict(value)
                if predicate(last):
                    return last
            time.sleep(0.25)
        raise GateError(
            f"timed out waiting for {description}: {redact_text(str(last))}"
        )

    def _run_recovery_journey(
        self,
        *,
        sender_session: Any,
        receiver_session: Any,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey: MobileMessagingJourney,
        journey_id: str,
        expected_build_identity: Mapping[str, Any],
    ) -> dict[str, Any]:
        initial_device = self._wait_for_enrolled_device(
            sender_session,
            sender,
            "initial recovery device enrollment",
        )
        initial_receiver_device = self._wait_for_enrolled_device(
            receiver_session,
            receiver,
            "initial recovery receiver device enrollment",
        )
        moment_draft = sender_session.call_action(
            "reliability.draft.write",
            {
                "kind": "moment",
                "targetId": f"recovery-{journey_id}-moment",
                "text": f"recovery-{journey_id}-moment-draft",
                "audienceKind": 1,
            },
        )

        sender_session.call_action(
            "reliability.fixture.configure",
            {"mode": "lose-dispatch-response-and-readback"},
        )
        try:
            submission = self._mapping(
                sender_session.call_action(
                    "reliability.friendRequest.submit",
                    {
                        "receiverPtid": receiver.ptid,
                        "receiverHomeStationPeerId": (
                            receiver.station_peer_id
                        ),
                        "federationId": sender.federation_id,
                        "message": f"recovery-{journey_id}",
                    },
                ),
                "recovery submission",
            )
            command = self._mapping(
                submission.get("command"),
                "recovery command",
            )
            command_id = self._text(
                command.get("commandId"),
                "recovery command ID",
            )
            request_id = self._text(
                command.get("requestId"),
                "recovery request ID",
            )
            payload_sha256 = self._sha256(
                command.get("payloadSha256"),
                "recovery payload digest",
            )
            if command.get("state") not in {
                "unknown-outcome",
                "reconciling",
            }:
                raise GateError(
                    "response-loss fixture did not preserve unknown outcome"
                )
            unresolved = self._reliability_snapshot(
                sender_session.call_action("reliability.snapshot"),
                "unresolved recovery snapshot",
            )
            self._require_command(
                unresolved,
                command_id,
                payload_sha256,
                {"unknown-outcome", "reconciling"},
            )
            normal_restart = self._restart_ios_application(
                sender_session,
                force_kill=False,
            )
            normal_restart_readiness = self._require_runtime_graph_ready(
                sender_session,
                "normal process restart",
            )
            normal_restart_build_identity = self._verify_build_identity(
                sender_session,
                expected_build_identity,
                "normal process restart build identity",
            )
            journey.wait_for_authenticated_runtime(
                sender_session,
                sender,
            )
            self._wait_for_enrolled_device(
                sender_session,
                sender,
                "normal restart device enrollment",
            )
            restored_unresolved = self._wait_for_reliability_snapshot(
                sender_session,
                "unresolved recovery snapshot after normal process restart",
            )
            self._require_drafts(restored_unresolved, (moment_draft,))
            restored_command = next(
                (
                    item
                    for item in restored_unresolved["commands"]
                    if isinstance(item, Mapping)
                    and item.get("commandId") == command_id
                ),
                None,
            )
            if restored_command is None:
                command_recovery_mode = "automatic"
                recovery_ui = {"automaticRecovery": True}
            else:
                self._require_command(
                    restored_unresolved,
                    command_id,
                    payload_sha256,
                    {"unknown-outcome", "reconciling"},
                )
                command_recovery_mode = "manual"
                recovery_ui = self._wait_for_recovery_kind(
                    sender_session,
                    "command-recovery",
                )
        finally:
            sender_session.call_action(
                "reliability.fixture.configure",
                {"mode": "none"},
            )

        reconciled = self._mapping(
            sender_session.call_action("reliability.reconcile"),
            "recovery reconcile",
        )
        commands = reconciled.get("commands")
        applied_checkpoints = reconciled.get("appliedCheckpoints")
        if not isinstance(commands, list) or not isinstance(
            applied_checkpoints,
            int,
        ):
            raise GateError("recovery reconciliation result is incomplete")
        if command_recovery_mode == "manual" and (
            not any(
                isinstance(item, Mapping)
                and item.get("commandId") == command_id
                and item.get("payloadSha256") == payload_sha256
                and item.get("checkpointReady") is True
                for item in commands
            )
            or applied_checkpoints < 1
        ):
            raise GateError("recovery checkpoint was not applied")
        relationship = self._wait_for_friend_request(
            receiver_session,
            request_id=request_id,
            sender_ptid=sender.ptid,
            receiver_ptid=receiver.ptid,
        )
        receiver_session.call_action(
            "social.request.accept",
            {"requestId": request_id},
        )
        self._wait_for_accepted_relationship(
            sender_session,
            request_id=request_id,
            sender_ptid=sender.ptid,
            receiver_ptid=receiver.ptid,
        )
        normal_restart_write_admission = self._wait_for_write_admission(
            sender_session,
            "normal process restart write admission",
        )
        conversation = self._mapping(
            sender_session.call_action(
                "social.contact.open",
                {
                    "peerPtid": receiver.ptid,
                    "federationId": sender.federation_id,
                },
            ),
            "recovery Direct conversation",
        )
        conversation_id = self._text(
            conversation.get("conversationId"),
            "recovery Direct conversation ID",
        )
        journey.wait_for_conversation(
            sender_session,
            conversation_id,
            kind=1,
        )
        journey.wait_for_conversation(
            receiver_session,
            conversation_id,
            kind=1,
        )

        baseline_text = f"recovery-history-{journey_id}"
        baseline_submission = self._mapping(
            sender_session.call_action(
                "messaging.send",
                {
                    "conversationId": conversation_id,
                    "plaintext": baseline_text,
                },
            ),
            "recovery baseline message",
        )
        baseline_message_id = self._text(
            baseline_submission.get("messageId"),
            "recovery baseline message ID",
        )
        journey.wait_for_message(
            receiver_session,
            conversation_id,
            baseline_message_id,
            lambda message: message.get("plaintext") == baseline_text,
            "recovery baseline receiver delivery",
        )

        self._open_chat_conversation(sender_session, conversation_id)
        chat_draft_text = f"recovery-composer-{journey_id}"
        self._write_chat_composer_draft(
            sender_session,
            chat_draft_text,
        )
        chat_drafts = self._wait_for_value(
            lambda: self._read_chat_drafts(
                sender_session,
                conversation_id,
            ),
            "persisted Chat composer draft",
        )
        chat_draft = chat_drafts[0]

        forced_restart = self._restart_ios_application(
            sender_session,
            force_kill=True,
        )
        forced_restart_readiness = self._require_runtime_graph_ready(
            sender_session,
            "SIGKILL process restart",
        )
        forced_restart_build_identity = self._verify_build_identity(
            sender_session,
            expected_build_identity,
            "SIGKILL process restart build identity",
        )
        journey.wait_for_authenticated_runtime(
            sender_session,
            sender,
        )
        self._wait_for_enrolled_device(
            sender_session,
            sender,
            "SIGKILL device enrollment",
        )
        forced_restart_write_admission = self._wait_for_write_admission(
            sender_session,
            "SIGKILL write admission",
        )
        self._open_chat_conversation(sender_session, conversation_id)
        forced_restart_ui = self._wait_for_chat_ui_state(
            sender_session,
            message_id=baseline_message_id,
            message_text=baseline_text,
            draft_text=chat_draft_text,
            label="Chat UI after SIGKILL",
        )
        forced_restart_snapshot = self._wait_for_reliability_snapshot(
            sender_session,
            "reliability snapshot after SIGKILL",
        )
        self._require_drafts(
            forced_restart_snapshot,
            (chat_draft, moment_draft),
        )

        route_renewal = self._await_route_attestation_renewal(
            sender_session,
            keepalive_session=receiver_session,
            keepalive_actor=receiver,
        )
        outage_ui: dict[str, Any] = {}

        def observe_outage() -> None:
            try:
                sender_session.call_action("messaging.reconcile")
            except DriverError:
                pass
            outage_ui.update(
                self._wait_for_route_retry_surface(sender_session)
            )

        station_restart = self._restart_source_bound_station(
            during_outage=observe_outage,
        )
        retry_element = self._wait_for_value(
            lambda: self._find_element_or_none(
                sender_session,
                '[data-acceptance-id="mobile-route-retry"]',
            ),
            "Mobile route Retry control",
        )
        sender_session.click_element(retry_element)
        journey.wait_for_authenticated_runtime(
            sender_session,
            sender,
        )
        self._wait_for_enrolled_device(
            sender_session,
            sender,
            "Station restart device enrollment",
        )
        station_restart_write_admission = self._wait_for_write_admission(
            sender_session,
            "Station restart write admission",
        )
        self._open_chat_conversation(sender_session, conversation_id)
        station_restart_ui = self._wait_for_chat_ui_state(
            sender_session,
            message_id=baseline_message_id,
            message_text=baseline_text,
            draft_text=chat_draft_text,
            label="Chat UI after Station restart",
        )
        station_restart_snapshot = self._wait_for_reliability_snapshot(
            sender_session,
            "reliability snapshot after Station restart",
        )
        self._require_drafts(
            station_restart_snapshot,
            (chat_draft, moment_draft),
        )

        recovered_text = f"recovery-receiver-{journey_id}"
        recovered_submission = self._mapping(
            sender_session.call_action(
                "messaging.send",
                {
                    "conversationId": conversation_id,
                    "plaintext": recovered_text,
                },
            ),
            "post-recovery message",
        )
        recovered_message_id = self._text(
            recovered_submission.get("messageId"),
            "post-recovery message ID",
        )
        receiver_message, receiver_elapsed_ms = journey.wait_for_message(
            receiver_session,
            conversation_id,
            recovered_message_id,
            lambda message: message.get("plaintext") == recovered_text,
            "post-recovery receiver delivery",
        )

        discarded = self._reliability_snapshot(
            sender_session.call_action(
                "reliability.draft.action",
                {"action": "discard"},
            ),
            "discarded draft snapshot",
        )
        if discarded["drafts"]:
            raise GateError("recovery draft discard did not remove all rows")
        return {
            "scenario": "recovery",
            "commandId": command_id,
            "requestId": request_id,
            "payloadSha256": payload_sha256,
            "checkpointApplied": True,
            "commandRecoveryMode": command_recovery_mode,
            "receiverReadback": relationship,
            "conversationId": conversation_id,
            "baselineMessageId": baseline_message_id,
            "postRecoveryMessageId": recovered_message_id,
            "postRecoveryReceiverReadback": receiver_message,
            "postRecoveryReceiverElapsedMs": receiver_elapsed_ms,
            "initialDevice": initial_device,
            "initialReceiverDevice": initial_receiver_device,
            "normalProcessRestart": normal_restart,
            "normalProcessRestartReadiness": normal_restart_readiness,
            "normalProcessRestartWriteAdmission": (
                normal_restart_write_admission
            ),
            "normalProcessRestartBuildIdentity": (
                normal_restart_build_identity
            ),
            "forcedProcessRestart": forced_restart,
            "forcedProcessRestartReadiness": forced_restart_readiness,
            "forcedProcessRestartWriteAdmission": (
                forced_restart_write_admission
            ),
            "forcedProcessRestartBuildIdentity": (
                forced_restart_build_identity
            ),
            "forcedProcessRestartUi": forced_restart_ui,
            "routeAttestationRenewal": route_renewal,
            "stationOutageUi": outage_ui,
            "stationRestart": station_restart,
            "stationRestartWriteAdmission": station_restart_write_admission,
            "stationRestartUi": station_restart_ui,
            "draftRestartReadback": True,
            "historyRestartReadback": True,
            "draftDiscarded": True,
            "recoveryProjection": recovery_ui,
        }

    @staticmethod
    def _verify_build_identity(
        session: Any,
        expected: Mapping[str, Any],
        label: str,
    ) -> dict[str, Any]:
        value = SimulatorSocialGate._mapping(
            session.call_action("build.identity"),
            label,
        )
        identity = SimulatorSocialGate._mapping(
            value.get("identity"),
            f"{label} payload",
        )
        digest = value.get("embeddedIdentitySha256")
        if identity != dict(expected) or not (
            isinstance(digest, str)
            and len(digest) == 71
            and digest.startswith("sha256:")
            and all(character in "0123456789abcdef" for character in digest[7:])
        ):
            raise GateError(f"{label} does not match the provisioned build")
        return value

    @staticmethod
    def _restart_ios_application(
        session: Any,
        *,
        force_kill: bool,
    ) -> dict[str, Any]:
        if session.platform != "ios":
            raise GateError("Mobile process recovery requires an iOS Simulator")
        session.switch_to_native()
        before = SimulatorSocialGate._mapping(
            session.execute_script("mobile: activeAppInfo"),
            "iOS process identity before restart",
        )
        before_pid = before.get("pid")
        if not isinstance(before_pid, int) or before_pid <= 0:
            raise GateError("iOS process identity before restart is unavailable")
        if force_kill:
            try:
                os.kill(before_pid, signal.SIGKILL)
            except OSError as error:
                raise GateError(
                    f"iOS Simulator SIGKILL failed: "
                    f"{redact_text(str(error))}"
                ) from error
        else:
            session.execute_script(
                "mobile: terminateApp",
                {"bundleId": session.build.application_id},
            )
        time.sleep(1)
        session.execute_script(
            "mobile: activateApp",
            {"bundleId": session.build.application_id},
        )
        session.reconnect_after_runtime_relaunch()
        session.wait_for_ready()
        session.switch_to_native()
        after = SimulatorSocialGate._mapping(
            session.execute_script("mobile: activeAppInfo"),
            "iOS process identity after restart",
        )
        after_pid = after.get("pid")
        if (
            not isinstance(after_pid, int)
            or after_pid <= 0
            or after_pid == before_pid
        ):
            raise GateError("iOS process identity did not change after restart")
        session.switch_to_app_webview()
        session.require_harness(list(RECOVERY_RELAUNCH_ACTIONS))
        return {
            "mode": "sigkill" if force_kill else "terminate",
            "signal": "SIGKILL" if force_kill else None,
            "beforePid": before_pid,
            "afterPid": after_pid,
            "restored": True,
        }

    @staticmethod
    def _open_chat_conversation(
        session: Any,
        conversation_id: str,
    ) -> None:
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:chat"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:chat-conversation",
                    "sessionUlid": conversation_id,
                },
            },
        )

    def _write_chat_composer_draft(
        self,
        session: Any,
        text: str,
    ) -> None:
        result = self._wait_for_value(
            lambda: session.execute_script(
                """
const input = document.querySelector('input.message-composer-input');
if (!(input instanceof HTMLInputElement)) return null;
const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value'
)?.set;
if (!setter) return null;
setter.call(input, arguments[0]);
input.dispatchEvent(new Event('input', { bubbles: true }));
return input.value;
""",
                text,
            ),
            "Chat composer input",
        )
        if result != text:
            raise GateError("Chat composer did not retain the entered draft")

    @staticmethod
    def _read_chat_drafts(
        session: Any,
        conversation_id: str,
    ) -> list[dict[str, Any]] | None:
        value = session.call_action(
            "reliability.draft.read",
            {"kind": "chat", "targetId": conversation_id},
        )
        if not isinstance(value, list):
            raise GateError("Chat draft readback must return a list")
        drafts = [
            dict(item) for item in value if isinstance(item, Mapping)
        ]
        return drafts if len(drafts) == 1 else None

    def _wait_for_chat_ui_state(
        self,
        session: Any,
        *,
        message_id: str,
        message_text: str,
        draft_text: str,
        label: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            value = session.execute_script(
                """
const message = document.querySelector(
  `[data-message-ulid="${CSS.escape(arguments[0])}"] .message-text`
);
const composer = document.querySelector('input.message-composer-input');
return {
  messageVisible: Boolean(message && message.textContent === arguments[1]),
  draftVisible: Boolean(
    composer instanceof HTMLInputElement
      && composer.value === arguments[2]
  ),
};
""",
                message_id,
                message_text,
                draft_text,
            )
            if (
                isinstance(value, Mapping)
                and value.get("messageVisible") is True
                and value.get("draftVisible") is True
            ):
                return dict(value)
            return None

        return self._wait_for_value(read, label)

    def _await_route_attestation_renewal(
        self,
        session: Any,
        *,
        keepalive_session: Any | None = None,
        keepalive_actor: MessagingActor | None = None,
    ) -> dict[str, Any]:
        if (keepalive_session is None) != (keepalive_actor is None):
            raise GateError(
                "route renewal keepalive requires both session and Actor"
            )
        before = self._active_route_identity(
            session.call_action("station.route.snapshot"),
        )
        initial_expiry = before["attestationExpiresAtUnixMs"]
        if initial_expiry <= int(time.time() * 1000):
            raise GateError("active Station route attestation is already expired")
        started = time.monotonic()
        deadline = started + ROUTE_RENEWAL_TIMEOUT_SECONDS
        next_keepalive = started + 60.0
        latest = before
        while time.monotonic() < deadline:
            if (
                keepalive_session is not None
                and keepalive_actor is not None
                and time.monotonic() >= next_keepalive
            ):
                keepalive = self._mapping(
                    keepalive_session.call_action("getRealtimeDevice"),
                    "route renewal receiver keepalive",
                )
                if (
                    keepalive.get("active") is not True
                    or keepalive.get("actorPtid") != keepalive_actor.ptid
                ):
                    raise GateError(
                        "route renewal receiver runtime became unavailable"
                    )
                next_keepalive = time.monotonic() + 60.0
            latest = self._active_route_identity(
                session.call_action("station.route.snapshot"),
            )
            if (
                latest["stationPeerId"] != before["stationPeerId"]
                or latest["routeId"] != before["routeId"]
                or latest["routeGeneration"] != before["routeGeneration"]
            ):
                raise GateError(
                    "Station route identity changed during attestation renewal"
                )
            now_ms = int(time.time() * 1000)
            if (
                now_ms > initial_expiry
                and latest["attestationExpiresAtUnixMs"] > initial_expiry
                and latest["routeRevision"] > before["routeRevision"]
                and latest["health"] == "available"
            ):
                return {
                    "stationPeerId": before["stationPeerId"],
                    "routeId": before["routeId"],
                    "routeGeneration": before["routeGeneration"],
                    "beforeRouteRevision": before["routeRevision"],
                    "afterRouteRevision": latest["routeRevision"],
                    "beforeExpiresAtUnixMs": initial_expiry,
                    "afterExpiresAtUnixMs": (
                        latest["attestationExpiresAtUnixMs"]
                    ),
                    "elapsedMs": int((time.monotonic() - started) * 1000),
                    "crossedPriorExpiry": True,
                }
            time.sleep(1)
        raise GateError(
            "Station route attestation did not renew across its prior expiry"
        )

    @staticmethod
    def _active_route_identity(value: Any) -> dict[str, Any]:
        snapshot = SimulatorSocialGate._mapping(
            value,
            "Station route snapshot",
        )
        station_peer_id = SimulatorSocialGate._text(
            snapshot.get("activeStationPeerId"),
            "active Station peer ID",
        )
        entries = snapshot.get("entries")
        entry = next(
            (
                item
                for item in entries
                if isinstance(item, Mapping)
                and item.get("stationPeerId") == station_peer_id
            ),
            None,
        ) if isinstance(entries, list) else None
        if not isinstance(entry, Mapping):
            raise GateError("active Station route entry is unavailable")
        route_id = SimulatorSocialGate._text(
            entry.get("activeRouteId"),
            "active Station route ID",
        )
        routes = entry.get("routes")
        route = next(
            (
                item
                for item in routes
                if isinstance(item, Mapping)
                and item.get("routeId") == route_id
            ),
            None,
        ) if isinstance(routes, list) else None
        if not isinstance(route, Mapping):
            raise GateError("active Station route is unavailable")
        route_generation = route.get("routeGeneration")
        route_revision = entry.get("routeRevision")
        expiry = route.get("attestationExpiresAtUnixMs")
        if (
            not isinstance(route_generation, int)
            or route_generation <= 0
            or not isinstance(route_revision, int)
            or route_revision <= 0
            or not isinstance(expiry, int)
            or expiry <= 0
        ):
            raise GateError("active Station route identity is incomplete")
        return {
            "stationPeerId": station_peer_id,
            "routeId": route_id,
            "routeGeneration": route_generation,
            "routeRevision": route_revision,
            "attestationExpiresAtUnixMs": expiry,
            "health": route.get("health"),
        }

    def _wait_for_route_retry_surface(
        self,
        session: Any,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + 30.0
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            value = session.execute_script(
                """
const unavailable = document.querySelector(
  '[data-acceptance-id="mobile-route-unavailable"]'
);
const retry = document.querySelector(
  '[data-acceptance-id="mobile-route-retry"]'
);
return {
  unavailable: Boolean(unavailable),
  retryVisible: Boolean(retry),
  routeState: unavailable?.getAttribute('data-route-state') || '',
  runtimeStatus: unavailable?.getAttribute('data-runtime-status') || '',
};
"""
            )
            last = dict(value) if isinstance(value, Mapping) else {}
            if (
                last.get("unavailable") is True
                and last.get("retryVisible") is True
            ):
                return last
            time.sleep(0.25)
        runtime_states: list[str] = []
        phase = "<unavailable>"
        try:
            readiness = self._mapping(
                session.call_action(
                    "lifecycle.waitReady",
                    {"includeDiagnostics": True},
                ),
                "Station outage lifecycle readiness",
            )
            phase = str(readiness.get("phase") or "<missing>")
            runtimes = readiness.get("runtimes")
            if isinstance(runtimes, list):
                runtime_states = sorted(
                    f"{runtime.get('id')}={runtime.get('status')}"
                    for runtime in runtimes
                    if isinstance(runtime, Mapping)
                    and isinstance(runtime.get("id"), str)
                )
        except (DriverError, GateError):
            pass
        raise GateError(
            "Mobile route recovery surface during Station outage did not "
            "converge: "
            f"unavailable={last.get('unavailable')}, "
            f"retryVisible={last.get('retryVisible')}, "
            f"routeState={last.get('routeState')}, "
            f"runtimeStatus={last.get('runtimeStatus')}, "
            f"phase={phase}, "
            f"runtimes={','.join(runtime_states) or '<none>'}"
        )

    @staticmethod
    def _find_element_or_none(
        session: Any,
        selector: str,
    ) -> str | None:
        try:
            return session.find_element("css selector", selector)
        except DriverError:
            return None

    @staticmethod
    def _restart_source_bound_station(
        *,
        during_outage: Callable[[], None],
        capability_client: EphemeralGateClient | None = None,
    ) -> dict[str, Any]:
        client = capability_client or EphemeralGateClient.from_environment()
        if client is None:
            raise GateError(
                "Mobile Station outage capability is unavailable"
            )
        callback_error: BaseException | None = None
        try:
            stopped = client.invoke(
                MOBILE_STATION_OUTAGE_CAPABILITY_ID,
                "stop",
                {},
                timeout_seconds=30,
            )
            try:
                during_outage()
            except BaseException as error:
                callback_error = error
            restored = client.invoke(
                MOBILE_STATION_OUTAGE_CAPABILITY_ID,
                "start",
                {},
                timeout_seconds=STATION_RESTART_TIMEOUT_SECONDS,
            )
        except (ProvisioningError, OSError) as error:
            raise GateError(
                f"Station outage capability failed: "
                f"{redact_text(str(error))}"
            ) from error
        finally:
            if capability_client is None:
                client.close()
        if (
            stopped.get("stopped") is not True
            or restored.get("restored") is not True
            or stopped.get("containerId") != restored.get("containerId")
            or stopped.get("sourceCommit") != restored.get("sourceCommit")
            or stopped.get("buildCommit") != restored.get("buildCommit")
        ):
            raise GateError(
                "Station outage capability returned inconsistent evidence"
            )
        if callback_error is not None:
            raise callback_error
        return {
            **dict(restored),
            "outageObserved": True,
            "stopped": True,
        }

    def _wait_for_accepted_relationship(
        self,
        session: Any,
        *,
        request_id: str,
        sender_ptid: str,
        receiver_ptid: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            projection = self._mapping(
                session.call_action("social.reconcile"),
                "accepted relationship projection",
            )
            requests = projection.get("friendRequests")
            if not isinstance(requests, list):
                return None
            return next(
                (
                    dict(item)
                    for item in requests
                    if isinstance(item, Mapping)
                    and item.get("requestId") == request_id
                    and item.get("senderPtid") == sender_ptid
                    and item.get("receiverPtid") == receiver_ptid
                    and item.get("status") == 2
                ),
                None,
            )

        return self._wait_for_value(
            read,
            "accepted recovery relationship",
        )

    def _run_recovery_ui_journey(
        self,
        *,
        session: Any,
        journey_id: str,
    ) -> dict[str, Any]:
        draft = session.call_action(
            "reliability.draft.write",
            {
                "kind": "chat",
                "targetId": f"recovery-ui-{journey_id}",
                "text": f"recovery-ui-{journey_id}-draft",
            },
        )
        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("recovery UI restart was not acknowledged")
        snapshot = self._wait_for_recovery_kind(
            session,
            "draft-restore-pending",
        )
        self._require_drafts(
            self._reliability_snapshot(
                session.call_action("reliability.snapshot"),
                "recovery UI reliability snapshot",
            ),
            (draft,),
        )
        return {
            "scenario": "recovery-ui",
            "visibleState": "draft-restore-pending",
            "actions": ["restore", "discard"],
            "snapshot": snapshot,
        }

    def _run_moments_journey(
        self,
        *,
        sender_session: Any,
        receiver_session: Any,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey_id: str,
    ) -> dict[str, Any]:
        text = f"mobile-moment-{journey_id}"
        published = self._mapping(
            sender_session.call_action(
                "moments.publish",
                {"text": text, "audienceKind": 1},
            ),
            "published Moment",
        )
        post_id = self._text(published.get("postId"), "published Moment ID")
        if (
            published.get("authorPtid") != sender.ptid
            or published.get("text") != text
        ):
            raise GateError("published Moment identity or content changed")

        receiver_post = self._wait_for_moment(
            receiver_session,
            post_id,
            text,
        )
        reactions = receiver_session.call_action(
            "moments.react",
            {"postId": post_id, "reactionKind": 1, "active": True},
        )
        if not self._reaction_active(reactions, 1):
            raise GateError("Moment reaction readback is incomplete")
        comment = self._mapping(
            receiver_session.call_action(
                "moments.comment",
                {
                    "postId": post_id,
                    "content": f"comment-{journey_id}",
                },
            ),
            "Moment comment",
        )
        comment_id = self._text(
            comment.get("commentId"),
            "Moment comment ID",
        )
        reply = self._mapping(
            sender_session.call_action(
                "moments.comment",
                {
                    "postId": post_id,
                    "content": f"reply-{journey_id}",
                    "replyToCommentId": comment_id,
                },
            ),
            "Moment reply",
        )
        reply_id = self._text(reply.get("commentId"), "Moment reply ID")
        comments = self._wait_for_comments(
            receiver_session,
            post_id,
            {comment_id, reply_id},
        )
        unreacted = receiver_session.call_action(
            "moments.react",
            {"postId": post_id, "reactionKind": 1, "active": False},
        )
        if self._reaction_active(unreacted, 1):
            raise GateError("Moment reaction rollback did not converge")

        draft = sender_session.call_action(
            "reliability.draft.write",
            {
                "kind": "moment",
                "targetId": f"moment-compose-{journey_id}",
                "text": f"moment-draft-{journey_id}",
                "audienceKind": 1,
            },
        )
        sender_session.call_action("lifecycle.restart")
        self._require_drafts(
            {
                "drafts": sender_session.call_action(
                    "reliability.draft.read",
                    {"kind": "moment"},
                )
            },
            (draft,),
        )
        sender_session.call_action(
            "reliability.draft.action",
            {"kind": "moment", "action": "discard"},
        )
        return {
            "scenario": "moments",
            "post": receiver_post,
            "reactionCommitted": True,
            "reactionRolledBack": True,
            "commentId": comment_id,
            "replyId": reply_id,
            "commentCount": len(comments),
            "draftRestartReadback": True,
            "senderPtid": sender.ptid,
            "receiverPtid": receiver.ptid,
        }

    def _wait_for_friend_request(
        self,
        session: Any,
        *,
        request_id: str,
        sender_ptid: str,
        receiver_ptid: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            projection = self._mapping(
                session.call_action("social.reconcile"),
                "receiver Social projection",
            )
            requests = projection.get("friendRequests")
            if not isinstance(requests, list):
                return None
            return next(
                (
                    dict(item)
                    for item in requests
                    if isinstance(item, Mapping)
                    and item.get("requestId") == request_id
                    and item.get("senderPtid") == sender_ptid
                    and item.get("receiverPtid") == receiver_ptid
                ),
                None,
            )

        return self._wait_for_value(read, "receiver Friend Request")

    def _wait_for_moment(
        self,
        session: Any,
        post_id: str,
        text: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            feed = self._mapping(
                session.call_action("moments.feed.read"),
                "receiver Moments feed",
            )
            posts = feed.get("posts")
            if not isinstance(posts, list):
                return None
            return next(
                (
                    dict(item)
                    for item in posts
                    if isinstance(item, Mapping)
                    and item.get("postId") == post_id
                    and item.get("text") == text
                ),
                None,
            )

        return self._wait_for_value(read, "receiver Moment")

    def _wait_for_comments(
        self,
        session: Any,
        post_id: str,
        expected_ids: set[str],
    ) -> list[dict[str, Any]]:
        def read() -> list[dict[str, Any]] | None:
            raw = session.call_action(
                "moments.comments.read",
                {"postId": post_id},
            )
            if not isinstance(raw, list):
                return None
            comments = [
                dict(item) for item in raw if isinstance(item, Mapping)
            ]
            actual = {
                str(item.get("commentId", "")) for item in comments
            }
            return comments if expected_ids.issubset(actual) else None

        return self._wait_for_value(read, "Moment comments")

    def _wait_for_recovery_kind(
        self,
        session: Any,
        kind: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            snapshot = self._mapping(
                session.call_action("recovery.snapshot"),
                "recovery projection",
            )
            states = snapshot.get("states")
            if not isinstance(states, list):
                return None
            return snapshot if any(
                isinstance(item, Mapping) and item.get("kind") == kind
                for item in states
            ) else None

        return self._wait_for_value(read, f"recovery state {kind}")

    @staticmethod
    def _wait_for_value(
        read: Any,
        label: str,
        timeout_seconds: float = 30.0,
    ) -> Any:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            value = read()
            if value is not None:
                return value
            time.sleep(0.25)
        raise GateError(f"{label} did not converge")

    @staticmethod
    def _reliability_snapshot(
        value: Any,
        label: str,
    ) -> dict[str, Any]:
        snapshot = SimulatorSocialGate._mapping(value, label)
        if (
            not isinstance(snapshot.get("runtime"), Mapping)
            or not isinstance(snapshot.get("commands"), list)
            or not isinstance(snapshot.get("drafts"), list)
            or not isinstance(snapshot.get("checkpoints"), list)
        ):
            raise GateError(f"{label} is incomplete")
        return snapshot

    def _wait_for_reliability_snapshot(
        self,
        session: Any,
        label: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            try:
                value = session.call_action("reliability.snapshot")
            except DriverError as error:
                if "reliabilityScopeUnavailable" in str(error):
                    return None
                raise
            return self._reliability_snapshot(value, label)

        return self._wait_for_value(read, label)

    def _wait_for_write_admission(
        self,
        session: Any,
        label: str,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any] | None:
            snapshot = self._mapping(
                session.call_action("recovery.snapshot"),
                label,
            )
            admission = snapshot.get("writeAdmission")
            return (
                dict(admission)
                if isinstance(admission, Mapping)
                and admission.get("open") is True
                and admission.get("reason") is None
                else None
            )

        return self._wait_for_value(read, label)

    def _require_runtime_graph_ready(
        self,
        session: Any,
        label: str,
    ) -> dict[str, Any]:
        readiness = self._mapping(
            session.call_action(
                "lifecycle.waitReady",
                {"includeDiagnostics": True},
            ),
            f"{label} lifecycle readiness",
        )
        runtimes = readiness.get("runtimes")
        if readiness.get("phase") != "ACTIVE" or not isinstance(
            runtimes,
            list,
        ):
            raise GateError(f"{label} runtime graph did not become active")
        raw_runtime_errors = readiness.get("runtimeErrors")
        runtime_errors = {
            str(error["runtimeId"]): redact_text(
                str(error.get("error") or "")
            )[-500:]
            for error in raw_runtime_errors
            if isinstance(error, Mapping)
            and isinstance(error.get("runtimeId"), str)
        } if isinstance(raw_runtime_errors, list) else {}
        failed = sorted(
            (
                str(runtime["id"]),
                str(runtime.get("errorKey") or ""),
                runtime_errors.get(str(runtime["id"]), ""),
            )
            for runtime in runtimes
            if isinstance(runtime, Mapping)
            and runtime.get("status") != "ready"
            and isinstance(runtime.get("id"), str)
        )
        if failed:
            details = ",".join(
                runtime_id
                + (f"[{error_key}]" if error_key else "")
                + (f":{error}" if error else "")
                for runtime_id, error_key, error in failed
            )
            raise GateError(
                f"{label} runtime graph failed: {details}"
            )
        return {
            "generation": readiness.get("generation"),
            "phase": readiness.get("phase"),
            "readyRuntimeIds": sorted(
                str(runtime["id"])
                for runtime in runtimes
                if isinstance(runtime, Mapping)
                and runtime.get("status") == "ready"
                and isinstance(runtime.get("id"), str)
            ),
        }

    def _wait_for_enrolled_device(
        self,
        session: Any,
        actor: MessagingActor,
        label: str,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + 30.0
        last = {
            "active": False,
            "actorMatch": False,
            "devicePresent": False,
        }
        while time.monotonic() < deadline:
            try:
                value = self._mapping(
                    session.call_action("getRealtimeDevice"),
                    label,
                )
            except DriverError as error:
                if "getRealtimeDevice" in str(error):
                    time.sleep(0.25)
                    continue
                raise
            last = {
                "active": value.get("active") is True,
                "actorMatch": value.get("actorPtid") == actor.ptid,
                "devicePresent": (
                    isinstance(value.get("deviceId"), str)
                    and bool(value["deviceId"].strip())
                ),
            }
            if all(last.values()):
                return value
            time.sleep(0.25)
        recovery_states: list[str] = []
        try:
            recovery = self._mapping(
                session.call_action("recovery.snapshot"),
                f"{label} recovery projection",
            )
            states = recovery.get("states")
            if isinstance(states, list):
                for item in states:
                    if not isinstance(item, Mapping) or not isinstance(
                        item.get("kind"),
                        str,
                    ):
                        continue
                    kind = str(item["kind"])
                    detail = item.get("detail")
                    runtime_ids = (
                        detail.get("runtimeIds")
                        if isinstance(detail, Mapping)
                        else None
                    )
                    if isinstance(runtime_ids, list):
                        safe_runtime_ids = sorted(
                            str(runtime_id)
                            for runtime_id in runtime_ids
                            if isinstance(runtime_id, str)
                            and runtime_id.strip()
                        )
                        if safe_runtime_ids:
                            kind += f"({','.join(safe_runtime_ids)})"
                    recovery_states.append(kind)
                recovery_states.sort()
        except (DriverError, GateError):
            pass
        raise GateError(
            f"{label} did not converge: "
            f"active={last['active']}, "
            f"actorMatch={last['actorMatch']}, "
            f"devicePresent={last['devicePresent']}, "
            f"recoveryStates={','.join(recovery_states) or '<none>'}"
        )

    @staticmethod
    def _require_drafts(
        snapshot: Mapping[str, Any],
        expected: tuple[Any, ...],
    ) -> None:
        drafts = snapshot.get("drafts")
        if not isinstance(drafts, list):
            raise GateError("reliability draft projection is unavailable")
        expected_rows = {
            (
                item.get("kind"),
                item.get("targetId"),
                item.get("payloadSha256"),
            )
            for item in expected
            if isinstance(item, Mapping)
        }
        actual_rows = {
            (
                item.get("kind"),
                item.get("targetId"),
                item.get("payloadSha256"),
            )
            for item in drafts
            if isinstance(item, Mapping)
        }
        if len(expected_rows) != len(expected) or not expected_rows.issubset(
            actual_rows
        ):
            raise GateError("reliability drafts changed identity")

    @staticmethod
    def _require_command(
        snapshot: Mapping[str, Any],
        command_id: str,
        payload_sha256: str,
        allowed_states: set[str],
    ) -> None:
        commands = snapshot.get("commands")
        if not isinstance(commands, list):
            raise GateError("recovery command projection is unavailable")
        matching_id = [
            item
            for item in commands
            if isinstance(item, Mapping)
            and item.get("commandId") == command_id
        ]
        if not matching_id:
            raise GateError("recovery command is missing from durable snapshot")
        matching_payload = [
            item
            for item in matching_id
            if item.get("payloadSha256") == payload_sha256
        ]
        if not matching_payload:
            raise GateError("recovery command payload identity changed")
        observed_states = sorted({
            str(item.get("state"))
            for item in matching_payload
            if isinstance(item.get("state"), str)
        })
        if not any(
            item.get("state") in allowed_states
            for item in matching_payload
        ):
            raise GateError(
                "recovery command state left the expected recovery set: "
                + ",".join(observed_states or ["<missing>"])
            )

    @staticmethod
    def _reaction_active(
        value: Any,
        reaction_kind: int,
    ) -> bool:
        if not isinstance(value, list):
            return False
        matched = next(
            (
                item
                for item in value
                if isinstance(item, Mapping)
                and item.get("kind") == reaction_kind
            ),
            None,
        )
        return bool(
            matched
            and matched.get("reactedByViewer") is True
            and int(str(matched.get("count", "0"))) >= 1
        )

    @staticmethod
    def _mapping(value: Any, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)

    @staticmethod
    def _text(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be non-empty")
        return value

    @staticmethod
    def _sha256(value: Any, label: str) -> str:
        if (
            not isinstance(value, str)
            or len(value) != 64
            or any(character not in "0123456789abcdef" for character in value)
        ):
            raise GateError(f"{label} must be lowercase SHA-256")
        return value

    def _capture_client(
        self,
        artifacts: ArtifactSession,
        session: Any,
        client_id: str,
    ) -> dict[str, Any]:
        session.switch_to_native()
        screenshot = artifacts.write_bytes(
            f"mobile-simulator-social/{self.scenario}/{client_id}/screenshot.png",
            session.screenshot_bytes(),
            media_type="image/png",
            role=f"mobile-simulator-social-screenshot/{client_id}",
        )
        session.switch_to_app_webview()
        markup = _redacted_markup(session.get_page_source())
        dom = artifacts.write_bytes(
            f"mobile-simulator-social/{self.scenario}/{client_id}/web-dom.html",
            markup,
            media_type="text/html",
            role=f"mobile-simulator-social-dom/{client_id}",
        )
        if (
            b'data-testid="chat-render-error"' in markup
            or b"Chat could not be displayed." in markup
        ):
            raise GateError(
                f"{client_id} rendered the Mobile Chat error boundary"
            )
        return {
            "clientId": client_id,
            "screenshot": screenshot.to_dict(),
            "dom": dom.to_dict(),
        }

    @staticmethod
    def _required_object(
        owner: Mapping[str, Any],
        name: str,
        resource: str,
    ) -> dict[str, Any]:
        value = owner.get(name)
        if not isinstance(value, dict):
            raise SimulatorGateBlocked(
                f"{resource} requires object {name}",
                f"{ENVIRONMENT_ID}:{name}",
            )
        return value

    @staticmethod
    def _required_text(
        owner: Mapping[str, Any],
        name: str,
        resource: str,
    ) -> str:
        value = owner.get(name)
        if not isinstance(value, str) or not value.strip():
            raise SimulatorGateBlocked(
                f"{resource} requires {name}",
                f"{ENVIRONMENT_ID}:{name}",
            )
        return value.strip()

    def _result_base(self, status: str) -> dict[str, Any]:
        metadata = self.scenario_metadata[self.scenario]
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": self.environment_id,
            "runtimeCell": self.gate_id,
            "scenario": self.scenario,
            "status": status,
            "completionStatus": (
                "DONE"
                if status == "PASS"
                else "BLOCKED"
                if status == "BLOCKED"
                else "PARTIAL"
            ),
            "proofStatus": "PROVEN" if status == "PASS" else "UNPROVEN",
            "phase": metadata["phase"],
            "bom": list(metadata["bom"]),
            "spec": list(metadata["spec"]),
            "observedScope": [
                "two isolated simulator clients",
                "two actors bound to one source-attested Station",
                "production Mobile Harness actions",
            ],
            "unprovenScope": list(OPTIONAL_DIAGNOSTIC_SCOPE),
            "physicalDeviceClaimed": False,
            "stationMocksUsed": False,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIO_GATES),
        required=True,
    )
    args = parser.parse_args()
    gate: AcceptanceGate = SimulatorSocialGate(args.scenario)
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
