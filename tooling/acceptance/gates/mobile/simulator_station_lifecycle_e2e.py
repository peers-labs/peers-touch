#!/usr/bin/env python3
"""Station-bound Mobile simulator proof for AS-04 and AS-10."""

from __future__ import annotations

import sys
import time
from collections.abc import Callable, Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    DriverError,
    EphemeralCapabilityBlocked,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    MobileSimulatorBindingActivation,
    MobileSimulatorBindingSelection,
    MobileSimulatorRuntimeBinding,
)


GATE_ID = "mobile-simulator-station-lifecycle-e2e"
ENVIRONMENT_ID = "mobile-station-lifecycle-simulator"
IOS_CLIENT = "sim-ios"
ANDROID_CLIENT = "sim-android"
PRIMARY_BINDING = "station-primary"
SECONDARY_BINDING = "station-secondary"
SWITCH_COUNT = 10
PROVEN_SCOPE = (
    "AS-04 simulator valid-session restore and same-account revocation",
    (
        "AS-10 simulator Station switching, generation fencing, "
        "old-scope absence, and logout"
    ),
)
UNPROVEN_SCOPE = (
    "physical-device lifecycle behavior",
    "physical Keychain or Keystore deletion failure",
    "W4 command and draft recovery",
    "W5 event-ingress projection convergence",
    "physical MS-AG05",
)


class SimulatorStationLifecycleGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(
        self,
        *,
        binding_factory: Callable[[], MobileSimulatorRuntimeBinding] | None = None,
    ) -> None:
        super().__init__()
        self.binding_factory = (
            binding_factory or MobileSimulatorRuntimeBinding.from_environment
        )
        self.events: list[dict[str, Any]] = []
        self.cleanup: list[dict[str, Any]] = []
        self._activated_clients: list[str] = []
        self._product_cleaned: set[str] = set()

    def run(self) -> dict[str, Any]:
        raise GateError(
            "SimulatorStationLifecycleGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(repo_root=REPO_ROOT, gate_id=self.gate_id) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result = self._result_base(status)
            binding: MobileSimulatorRuntimeBinding | None = None
            try:
                binding = self.binding_factory()
                journey_result = self._run_journey(binding)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
                result = self._result_base(status)
                result.update(journey_result)
            except EphemeralCapabilityBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError) as error:
                result.update(
                    {
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
            except Exception as error:
                result.update(
                    {
                        "reason": (
                            "unexpected Mobile Station lifecycle Gate failure: "
                            f"{type(error).__name__}"
                        ),
                        "errorType": type(error).__name__,
                    }
                )
            finally:
                cleanup_error = self._cleanup(binding)

            if cleanup_error is not None:
                journey_succeeded = exit_code == 0
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result["cleanupReason"] = cleanup_error
                if journey_succeeded:
                    result["reason"] = cleanup_error
            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "cleanup": list(self.cleanup),
                }
            )
            artifacts.write_json(
                "mobile-station-lifecycle/events.json",
                {
                    "artifactKind": "mobile-station-lifecycle-events",
                    "gateId": self.gate_id,
                    "events": list(self.events),
                },
                role="mobile-station-lifecycle-events",
            )
            artifacts.write_json(
                "mobile-station-lifecycle/result.json",
                result,
                role="mobile-station-lifecycle-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "runtimeCell": "ios-simulator-and-android-emulator",
                    "physicalDeviceClaimed": False,
                    "declaredScenarios": ["AS-04", "AS-10"],
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _run_journey(
        self,
        binding: MobileSimulatorRuntimeBinding,
    ) -> dict[str, Any]:
        ios_primary = self._launch(
            binding,
            IOS_CLIENT,
        )
        self._require_launch_bindings(
            ios_primary,
            active_binding_role=PRIMARY_BINDING,
            required_binding_roles={PRIMARY_BINDING, SECONDARY_BINDING},
        )
        alice_ptid = self._authenticate(
            binding,
            IOS_CLIENT,
            expected_station_peer_id=str(
                ios_primary.scope["activeStationPeerId"]
            ),
        )
        ios_authenticated = self._wait_for_scope(
            binding,
            IOS_CLIENT,
            lambda scope: scope["activeActorPtid"] == alice_ptid,
        )
        self._assert_authenticated_scope(
            ios_authenticated,
            expected_station_peer_id=str(
                ios_primary.scope["activeStationPeerId"]
            ),
            expected_actor_ptid=alice_ptid,
        )

        restart_result = binding.call_action(
            IOS_CLIENT,
            "lifecycle.restart",
        )
        if restart_result != {"requested": True, "scope": "webview"}:
            raise GateError("iOS lifecycle.restart response is invalid")
        binding.refresh_webview(IOS_CLIENT)
        restored_scope = self._wait_for_scope(
            binding,
            IOS_CLIENT,
            lambda scope: (
                scope["activeActorPtid"] == alice_ptid
                and int(scope["generation"])
                > int(ios_authenticated["generation"])
            ),
        )
        self._assert_authenticated_scope(
            restored_scope,
            expected_station_peer_id=str(
                ios_primary.scope["activeStationPeerId"]
            ),
            expected_actor_ptid=alice_ptid,
        )
        self._record(
            "valid-session-restored",
            IOS_CLIENT,
            generation=int(restored_scope["generation"]),
        )

        android_primary = self._launch(
            binding,
            ANDROID_CLIENT,
        )
        self._require_launch_bindings(
            android_primary,
            active_binding_role=PRIMARY_BINDING,
            required_binding_roles={PRIMARY_BINDING},
        )
        android_alice_ptid = self._authenticate(
            binding,
            ANDROID_CLIENT,
            expected_station_peer_id=str(
                android_primary.scope["activeStationPeerId"]
            ),
        )
        if android_alice_ptid != alice_ptid:
            raise GateError(
                "same-account Android login resolved a different Alice PTID"
            )
        self._record(
            "same-account-session-replaced",
            ANDROID_CLIENT,
            generation=int(android_primary.scope["generation"]),
        )

        binding.call_action(IOS_CLIENT, "lifecycle.suspend")
        binding.call_action(IOS_CLIENT, "lifecycle.resume")
        revoked_scope = self._wait_for_scope(
            binding,
            IOS_CLIENT,
            self._scope_is_cleared,
        )
        if revoked_scope["launchState"] == "station-selection":
            access = binding.begin_access_gate(IOS_CLIENT)
            revoked_scope = _mapping(
                access.get("scope"),
                "revoked iOS access-gate scope",
            )
        self._assert_cleared_scope(
            revoked_scope,
            expected_station_peer_id=str(
                ios_primary.scope["activeStationPeerId"]
            ),
            require_access_gate=True,
        )
        if int(revoked_scope["generation"]) <= int(
            restored_scope["generation"]
        ):
            raise GateError(
                "revoked iOS resume did not advance the lifecycle generation"
            )
        self._record(
            "revoked-session-cleared",
            IOS_CLIENT,
            generation=int(revoked_scope["generation"]),
        )

        ios_secondary = self._select(
            binding,
            IOS_CLIENT,
            SECONDARY_BINDING,
        )
        if ios_secondary.remote_revocation != "not-required":
            raise GateError(
                "revoked session switch unexpectedly retained revocation work"
            )
        self._assert_cleared_scope(
            ios_secondary.scope,
            expected_station_peer_id=str(
                ios_secondary.scope["activeStationPeerId"]
            ),
        )
        if int(ios_secondary.scope["generation"]) <= int(
            revoked_scope["generation"]
        ):
            raise GateError(
                "secondary Station binding did not advance generation"
            )
        secondary_alice_ptid = self._authenticate(
            binding,
            IOS_CLIENT,
            expected_station_peer_id=str(
                ios_secondary.scope["activeStationPeerId"]
            ),
        )
        current_scope = self._wait_for_scope(
            binding,
            IOS_CLIENT,
            lambda scope: scope["activeActorPtid"] == secondary_alice_ptid,
        )
        self._assert_authenticated_scope(
            current_scope,
            expected_station_peer_id=str(
                ios_secondary.scope["activeStationPeerId"]
            ),
            expected_actor_ptid=secondary_alice_ptid,
        )

        switch_evidence: list[dict[str, Any]] = []
        launch_generation = ios_primary.launch_generation
        for index in range(SWITCH_COUNT):
            binding_role = (
                PRIMARY_BINDING
                if index % 2 == 0
                else SECONDARY_BINDING
            )
            previous_generation = int(current_scope["generation"])
            activation = self._select(
                binding,
                IOS_CLIENT,
                binding_role,
            )
            if activation.launch_generation != launch_generation:
                raise GateError(
                    "Station selection changed the Runtime Binding launch generation"
                )
            if activation.remote_revocation != "confirmed":
                raise GateError(
                    "Station switch did not confirm remote session revocation"
                )
            if int(activation.scope["generation"]) <= previous_generation:
                raise GateError(
                    "Station switch did not advance lifecycle generation"
                )
            station_peer_id = str(
                activation.scope["activeStationPeerId"]
            )
            self._assert_cleared_scope(
                activation.scope,
                expected_station_peer_id=station_peer_id,
            )
            self._authenticate(
                binding,
                IOS_CLIENT,
                expected_station_peer_id=station_peer_id,
                expected_actor_ptid=(
                    alice_ptid
                    if binding_role == PRIMARY_BINDING
                    else secondary_alice_ptid
                ),
            )
            current_scope = self._wait_for_scope(
                binding,
                IOS_CLIENT,
                lambda scope: scope["activeActorPtid"]
                == (
                    alice_ptid
                    if binding_role == PRIMARY_BINDING
                    else secondary_alice_ptid
                ),
            )
            self._assert_authenticated_scope(
                current_scope,
                expected_station_peer_id=station_peer_id,
                expected_actor_ptid=(
                    alice_ptid
                    if binding_role == PRIMARY_BINDING
                    else secondary_alice_ptid
                ),
            )
            switch_evidence.append(
                {
                    "ordinal": index + 1,
                    "bindingRole": binding_role,
                    "launchGeneration": activation.launch_generation,
                    "lifecycleGeneration": int(
                        activation.scope["generation"]
                    ),
                    "bindingProof": activation.binding_proof.to_dict(),
                    "remoteRevocation": activation.remote_revocation,
                    "oldScopeAbsent": True,
                    "authenticated": True,
                }
            )

        logout_result = _mapping(
            binding.call_action(IOS_CLIENT, "session.logout"),
            "iOS logout",
        )
        logout = _mapping(
            logout_result.get("logout"),
            "iOS logout revocation",
        )
        if logout.get("remoteRevocation") != "confirmed":
            raise GateError(
                "logout did not confirm Station session revocation"
            )
        logout_scope = self._wait_for_scope(
            binding,
            IOS_CLIENT,
            self._scope_is_cleared,
        )
        self._assert_cleared_scope(
            logout_scope,
            expected_station_peer_id=str(
                current_scope["activeStationPeerId"]
            ),
            require_access_gate=True,
        )
        if int(logout_scope["generation"]) <= int(
            current_scope["generation"]
        ):
            raise GateError("logout did not advance lifecycle generation")
        self._record(
            "logout-cleared",
            IOS_CLIENT,
            generation=int(logout_scope["generation"]),
        )

        for client_id in (ANDROID_CLIENT, IOS_CLIENT):
            cleanup_result = binding.call_action(client_id, "cleanup")
            if not isinstance(cleanup_result, Mapping):
                raise GateError(
                    f"{client_id} cleanup response is invalid"
                )
            self._product_cleaned.add(client_id)
            self.cleanup.append(
                {
                    "clientId": client_id,
                    "resource": "product-harness",
                    "status": "passed",
                }
            )

        return {
            "restored": {
                "clientId": IOS_CLIENT,
                "generationAdvanced": True,
                "actorIdentityMatched": True,
                "bindingProof": ios_primary.binding_proofs[
                    PRIMARY_BINDING
                ].to_dict(),
            },
            "revocation": {
                "revokedClientId": IOS_CLIENT,
                "replacementClientId": ANDROID_CLIENT,
                "authCleared": True,
                "accessGateVisible": True,
                "oldScopeAbsent": True,
                "bindingProof": android_primary.binding_proofs[
                    PRIMARY_BINDING
                ].to_dict(),
            },
            "secondaryBinding": {
                "clientId": IOS_CLIENT,
                "bindingRole": SECONDARY_BINDING,
                "bindingProof": ios_secondary.binding_proof.to_dict(),
            },
            "switches": switch_evidence,
            "logout": {
                "generationAdvanced": True,
                "remoteRevocationConfirmed": True,
                "authCleared": True,
                "accessGateVisible": True,
                "oldScopeAbsent": True,
            },
        }

    def _launch(
        self,
        binding: MobileSimulatorRuntimeBinding,
        client_id: str,
    ) -> MobileSimulatorBindingActivation:
        activation = binding.create_bound_session(client_id)
        if client_id not in self._activated_clients:
            self._activated_clients.append(client_id)
        self._record(
            "client-launched",
            client_id,
            launchGeneration=activation.launch_generation,
            lifecycleGeneration=int(activation.scope["generation"]),
            activeBindingRole=activation.active_binding_role,
            bindingProofs={
                role: proof.to_dict()
                for role, proof in activation.binding_proofs.items()
            },
        )
        return activation

    def _select(
        self,
        binding: MobileSimulatorRuntimeBinding,
        client_id: str,
        binding_role: str,
    ) -> MobileSimulatorBindingSelection:
        selection = binding.select_binding(client_id, binding_role)
        self._record(
            "binding-selected",
            client_id,
            bindingRole=binding_role,
            launchGeneration=selection.launch_generation,
            lifecycleGeneration=int(selection.scope["generation"]),
            bindingProof=selection.binding_proof.to_dict(),
        )
        return selection

    @staticmethod
    def _require_launch_bindings(
        activation: MobileSimulatorBindingActivation,
        *,
        active_binding_role: str,
        required_binding_roles: set[str],
    ) -> None:
        if (
            activation.active_binding_role != active_binding_role
            or set(activation.binding_proofs) != required_binding_roles
        ):
            raise GateError(
                "Mobile Runtime Binding launch proof closure is incomplete"
            )

    def _authenticate(
        self,
        binding: MobileSimulatorRuntimeBinding,
        client_id: str,
        *,
        expected_station_peer_id: str,
        expected_actor_ptid: str | None = None,
    ) -> str:
        fixture_authentication = _mapping(
            binding.authenticate_fixture_actor(client_id),
            f"{client_id} Fixture authentication",
        )
        gate_scope = _mapping(
            fixture_authentication.get("preAuthenticationScope"),
            f"{client_id} pre-authentication scope",
        )
        self._assert_cleared_scope(
            gate_scope,
            expected_station_peer_id=expected_station_peer_id,
            require_access_gate=True,
        )
        authenticated = _mapping(
            fixture_authentication.get("login"),
            f"{client_id} login",
        )
        session = _mapping(
            authenticated.get("session"),
            f"{client_id} login session",
        )
        actor_ptid = session.get("actorPtid")
        station_peer_id = session.get("stationPeerId")
        if (
            not isinstance(actor_ptid, str)
            or not actor_ptid.startswith("ptid:")
            or station_peer_id != expected_station_peer_id
        ):
            raise GateError(
                f"{client_id} login returned the wrong actor or Station scope"
            )
        if expected_actor_ptid is not None and actor_ptid != expected_actor_ptid:
            raise GateError(
                f"{client_id} login did not preserve Alice identity"
            )
        self._record(
            "authenticated",
            client_id,
            actorIdentityMatched=True,
        )
        return actor_ptid

    def _wait_for_scope(
        self,
        binding: MobileSimulatorRuntimeBinding,
        client_id: str,
        predicate: Callable[[Mapping[str, Any]], bool],
        *,
        timeout_seconds: float = 30.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        latest: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            value = binding.call_action(
                client_id,
                "lifecycle.scope.read",
            )
            if not isinstance(value, dict):
                raise GateError(
                    f"{client_id} lifecycle scope response is invalid"
                )
            latest = value
            if predicate(value):
                return value
            time.sleep(0.25)
        raise GateError(
            f"{client_id} lifecycle scope did not converge: "
            f"launchState={latest.get('launchState') if latest else None!r}"
        )

    @staticmethod
    def _assert_authenticated_scope(
        scope: Mapping[str, Any],
        *,
        expected_station_peer_id: str,
        expected_actor_ptid: str,
    ) -> None:
        if (
            scope.get("launchState") != "shell"
            or scope.get("activeStationPeerId") != expected_station_peer_id
            or scope.get("runtimeStationPeerId")
            != expected_station_peer_id
            or scope.get("activeActorPtid") != expected_actor_ptid
        ):
            raise GateError(
                "Mobile authenticated lifecycle scope is inconsistent"
            )

    @classmethod
    def _assert_cleared_scope(
        cls,
        scope: Mapping[str, Any],
        *,
        expected_station_peer_id: str,
        require_access_gate: bool = False,
    ) -> None:
        if scope.get("activeStationPeerId") != expected_station_peer_id:
            raise GateError("Mobile cleared scope changed Station identity")
        if require_access_gate and scope.get("launchState") != (
            "access-gate-chain"
        ):
            raise GateError("Mobile cleared scope did not expose Access Gate")
        if not cls._scope_is_cleared(scope):
            raise GateError("Mobile old actor scope remains visible")

    @staticmethod
    def _scope_is_cleared(scope: Mapping[str, Any]) -> bool:
        social = scope.get("social")
        group = scope.get("group")
        navigation = scope.get("navigation")
        return (
            scope.get("activeActorPtid") is None
            and scope.get("runtimeStationPeerId") is None
            and isinstance(social, Mapping)
            and social.get("stationPeerId") is None
            and social.get("actorPtid") is None
            and social.get("sessionCount") == 0
            and social.get("requestCount") == 0
            and social.get("messageThreadCount") == 0
            and isinstance(group, Mapping)
            and group.get("stationPeerId") is None
            and group.get("actorPtid") is None
            and group.get("groupCount") == 0
            and group.get("messageThreadCount") == 0
            and isinstance(navigation, Mapping)
            and navigation.get("detailKeys") == []
        )

    def _cleanup(
        self,
        binding: MobileSimulatorRuntimeBinding | None,
    ) -> str | None:
        if binding is None:
            return None
        failures: list[str] = []
        for client_id in reversed(tuple(self._activated_clients)):
            if client_id in self._product_cleaned:
                continue
            try:
                result = binding.call_action(client_id, "cleanup")
                if not isinstance(result, Mapping):
                    raise GateError("cleanup response is invalid")
            except Exception as error:
                failures.append(
                    f"{client_id} product cleanup: {type(error).__name__}"
                )
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "product-harness",
                        "status": "failed",
                        "errorType": type(error).__name__,
                    }
                )
            else:
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "product-harness",
                        "status": "passed",
                    }
                )
        try:
            stopped = binding.close()
        except Exception as error:
            failures.append(
                f"Runtime Binding cleanup: {type(error).__name__}"
            )
            self.cleanup.append(
                {
                    "resource": "runtime-binding",
                    "status": "failed",
                    "errorType": type(error).__name__,
                }
            )
        else:
            self.cleanup.append(
                {
                    "resource": "runtime-binding",
                    "status": "passed",
                    "stoppedClients": list(stopped),
                }
            )
        return "; ".join(failures) if failures else None

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "ios-simulator-and-android-emulator",
            "status": status,
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "phase": "W3 Station Lifecycle",
            "bom": ["W3", "W6D", "W9-C"],
            "spec": ["AS-04", "AS-10", "MS-AG02", "MS-AG05"],
            "observedScope": (
                list(PROVEN_SCOPE) if status == "PASS" else []
            ),
            "unprovenScope": list(UNPROVEN_SCOPE),
            "physicalDeviceClaimed": False,
            "stationMocksUsed": False,
            "switchCount": SWITCH_COUNT,
            "sampleEmissionAllowed": status == "PASS",
        }

    def _record(
        self,
        event: str,
        client_id: str,
        **detail: Any,
    ) -> None:
        self.events.append(
            {
                "event": event,
                "clientId": client_id,
                "atUnixMs": int(time.time() * 1000),
                **detail,
            }
        )


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{label} response is invalid")
    return dict(value)


def main() -> int:
    return SimulatorStationLifecycleGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
