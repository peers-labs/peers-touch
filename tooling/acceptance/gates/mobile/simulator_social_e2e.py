#!/usr/bin/env python3
"""Two-actor Mobile Messaging journeys on simulator runtime cells."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    DriverError,
    GateError,
    ProvisioningError,
    REPO_ROOT,
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


ENVIRONMENT_ID = "mobile-social-simulator"
SCENARIO_GATES = {
    "social-convergence": "mobile-simulator-social-convergence-e2e",
    "chat-contacts": "mobile-simulator-chat-contacts-e2e",
}
CLIENT_ASSIGNMENTS = {
    "sim-ios": ("station-primary", "alice"),
    "sim-android": ("station-secondary", "bob"),
}
UNPROVEN_SCOPE = (
    "physical-device behavior",
    "authoritative Station history readback",
    "forced event-loss recovery",
    "native background and foreground lifecycle",
    "tab-remount interaction timing",
    "full MS-AG04 and MS-AG06",
)


class SimulatorSocialGate(SimulatorCallbackRoutingGate):
    def __init__(
        self,
        scenario: str,
        **kwargs: Any,
    ) -> None:
        if scenario not in SCENARIO_GATES:
            raise ValueError(f"unsupported Mobile social scenario: {scenario}")
        super().__init__(**kwargs)
        self.scenario = scenario
        self.gate_id = SCENARIO_GATES[scenario]

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
            finally:
                self._cleanup_sessions(artifacts)

            if any(item["status"] == "failed" for item in self.cleanup):
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
                    "environment": ENVIRONMENT_ID,
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

    def _load_social_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise SimulatorGateBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                "mobile-social-simulator:manifest",
            )
        try:
            manifest = load_runtime_manifest(
                Path(manifest_path),
                self.gate_id,
            )
            require_runtime_service(manifest, "station-primary", "station")
            require_runtime_service(manifest, "station-secondary", "station")
            require_runtime_service(manifest, "relay", "relay")
        except ProvisioningError as error:
            raise SimulatorGateBlocked(
                str(error),
                "mobile-social-simulator:manifest",
            ) from error
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise SimulatorGateBlocked(
                "RuntimeManifest environment must be mobile-social-simulator",
                "mobile-social-simulator:environment",
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
        appium = self._required_object(
            resources,
            "appium",
            "mobile-social-simulator resources",
        )
        server_url = self._required_text(
            appium,
            "serverUrl",
            "mobile-social-simulator Appium",
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
        actors = self._load_actors(artifacts, manifest)
        journey = MobileMessagingJourney(timeout_seconds=30)
        authentication = {
            client_id: journey.authenticate(
                sessions[client_id],
                actor,
                password=ACTOR_PASSWORD,
            )
            for client_id, actor in actors.items()
        }
        sender = actors["sim-ios"]
        receiver = actors["sim-android"]
        if self.scenario == "social-convergence":
            journey_result = journey.run_social_convergence(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-android"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
            )
        else:
            journey_result = journey.run_chat_contacts(
                sender_session=sessions["sim-ios"],
                receiver_session=sessions["sim-android"],
                sender=sender,
                receiver=receiver,
                journey_id=artifacts.run_id[-12:],
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
            "authentication": authentication,
            "journey": journey_result,
            "captures": captures,
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
                "Mobile social simulator actor manifest is missing",
                "mobile-social-simulator:actor-manifest",
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
                "Mobile social simulator actor manifest is invalid",
                "mobile-social-simulator:actor-manifest",
            ) from error
        stations = self._required_object(
            payload,
            "stations",
            "Mobile social actor manifest",
        )
        actors: dict[str, MessagingActor] = {}
        for client_id, (service_id, role) in CLIENT_ASSIGNMENTS.items():
            service = require_runtime_service(manifest, service_id, "station")
            station = self._required_object(
                stations,
                service_id,
                f"Mobile social actor manifest {service_id}",
            )
            entries = station.get("actors")
            if not isinstance(entries, list):
                raise SimulatorGateBlocked(
                    f"Mobile social actor manifest {service_id} has no actors",
                    "mobile-social-simulator:actor-manifest",
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
                    f"Mobile social actor manifest has no {role}",
                    "mobile-social-simulator:actor-manifest",
                )
            home_station_peer_id = self._required_text(
                actor,
                "homeStationPeerId",
                f"Mobile social actor {role}",
            )
            service_station_peer_id = self._required_text(
                service,
                "runtimeIdentity",
                f"Mobile social service {service_id}",
            )
            if home_station_peer_id != service_station_peer_id:
                raise SimulatorGateBlocked(
                    f"Mobile social actor {role} Home Station identity mismatch",
                    "mobile-social-simulator:actor-manifest",
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
                    actor,
                    "homeStationPeerId",
                    f"Mobile social actor {role}",
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
        return actors

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
        dom = artifacts.write_bytes(
            f"mobile-simulator-social/{self.scenario}/{client_id}/web-dom.html",
            _redacted_markup(session.get_page_source()),
            media_type="text/html",
            role=f"mobile-simulator-social-dom/{client_id}",
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
                f"mobile-social-simulator:{name}",
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
                f"mobile-social-simulator:{name}",
            )
        return value.strip()

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": self.gate_id,
            "scenario": self.scenario,
            "status": status,
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "phase": "W9-D Social",
            "bom": ["W5", "W6A", "W9-D"],
            "spec": ["MS-AG04", "MS-AG06"],
            "observedScope": [
                "two isolated simulator clients",
                "two Station bindings",
                "production Mobile Harness actions",
            ],
            "unprovenScope": list(UNPROVEN_SCOPE),
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
    return SimulatorSocialGate(args.scenario).execute()


if __name__ == "__main__":
    raise SystemExit(main())
