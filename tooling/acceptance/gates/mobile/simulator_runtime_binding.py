from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    DriverError,
    EphemeralGateClient,
    EvidenceError,
)
from tooling.acceptance.gates.mobile.simulator_harness_contract import (
    STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS,
    child_callable_harness_actions,
)


CAPABILITY_ID = "mobile.simulator.appium-session"
DEFAULT_GATE_ID = "mobile-simulator-station-lifecycle-e2e"
DEFAULT_TIMEOUT_SECONDS = 60.0
CALLABLE_HARNESS_ACTIONS = STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS


@dataclass(frozen=True)
class MobileSimulatorLaunchOptions:
    def to_payload(self) -> dict[str, object]:
        return {}


@dataclass(frozen=True)
class MobileSimulatorBindingActivation:
    client_id: str
    launch_generation: int
    identity: dict[str, str]
    scope: dict[str, Any]
    active_binding_role: str
    binding_proofs: dict[str, ArtifactRef]


@dataclass(frozen=True)
class MobileSimulatorBindingSelection:
    client_id: str
    binding_role: str
    launch_generation: int
    scope: dict[str, Any]
    binding_proof: ArtifactRef
    remote_revocation: str


class MobileSimulatorRuntimeBinding:
    """Child facade for parent-owned simulator/Appium binding operations."""

    def __init__(
        self,
        client: EphemeralGateClient,
        *,
        gate_id: str = DEFAULT_GATE_ID,
    ) -> None:
        if not isinstance(client, EphemeralGateClient) and not hasattr(
            client,
            "invoke",
        ):
            raise DriverError(
                "Mobile simulator Runtime Binding requires an ephemeral client"
            )
        self._require_identifier(gate_id, "Gate")
        self._client = client
        self._gate_id = gate_id
        self._callable_harness_actions = child_callable_harness_actions(gate_id)
        self._active_clients: list[str] = []

    @classmethod
    def from_environment(
        cls,
        *,
        gate_id: str = DEFAULT_GATE_ID,
    ) -> "MobileSimulatorRuntimeBinding":
        client = EphemeralGateClient.from_environment()
        if client is None:
            raise DriverError(
                "Mobile simulator Runtime Binding capability is unavailable"
            )
        return cls(client, gate_id=gate_id)

    def create_bound_session(
        self,
        client_id: str,
        launch_options: MobileSimulatorLaunchOptions | None = None,
    ) -> MobileSimulatorBindingActivation:
        self._require_identifier(client_id, "client")
        options = launch_options or MobileSimulatorLaunchOptions()
        response = self._client.invoke(
            CAPABILITY_ID,
            "create_bound_session",
            {
                "clientId": client_id,
                "launchOptions": options.to_payload(),
            },
            timeout_seconds=180.0,
        )
        if set(response) != {
            "clientId",
            "launchGeneration",
            "identity",
            "scope",
            "activeBindingRole",
            "bindingProofs",
        }:
            raise DriverError(
                "Mobile simulator binding response has an invalid shape"
            )
        if response.get("clientId") != client_id:
            raise DriverError(
                "Mobile simulator binding response identity does not match"
            )
        launch_generation = response.get("launchGeneration")
        if (
            isinstance(launch_generation, bool)
            or not isinstance(launch_generation, int)
            or launch_generation <= 0
        ):
            raise DriverError(
                "Mobile simulator binding generation is invalid"
            )
        identity = _runtime_identity(response.get("identity"))
        scope = validate_scope_projection(response.get("scope"))
        active_binding_role = response.get("activeBindingRole")
        if not isinstance(active_binding_role, str) or not active_binding_role:
            raise DriverError(
                "Mobile simulator active binding role is invalid"
            )
        raw_binding_proofs = _mapping(
            response.get("bindingProofs"),
            "binding proofs",
        )
        if not raw_binding_proofs or active_binding_role not in raw_binding_proofs:
            raise DriverError(
                "Mobile simulator binding proof closure is incomplete"
            )
        binding_proofs: dict[str, ArtifactRef] = {}
        try:
            for binding_role, raw_proof in raw_binding_proofs.items():
                self._require_identifier(binding_role, "binding role")
                proof = ArtifactRef.from_dict(
                    _mapping(raw_proof, "binding proof")
                )
                if proof.gate_id != self._gate_id:
                    raise DriverError(
                        "Mobile simulator binding proof targets the wrong Gate"
                    )
                binding_proofs[binding_role] = proof
        except (EvidenceError, TypeError, ValueError) as error:
            raise DriverError(
                "Mobile simulator binding proof is invalid"
            ) from error
        if client_id not in self._active_clients:
            self._active_clients.append(client_id)
        return MobileSimulatorBindingActivation(
            client_id=client_id,
            launch_generation=launch_generation,
            identity=identity,
            scope=scope,
            active_binding_role=active_binding_role,
            binding_proofs=binding_proofs,
        )

    def select_binding(
        self,
        client_id: str,
        binding_role: str,
    ) -> MobileSimulatorBindingSelection:
        self._require_identifier(client_id, "client")
        self._require_identifier(binding_role, "binding role")
        response = self._client.invoke(
            CAPABILITY_ID,
            "select_binding",
            {
                "clientId": client_id,
                "bindingRole": binding_role,
            },
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        )
        if set(response) != {
            "clientId",
            "bindingRole",
            "launchGeneration",
            "scope",
            "bindingProof",
            "remoteRevocation",
        }:
            raise DriverError(
                "Mobile simulator binding selection response has an invalid shape"
            )
        if (
            response.get("clientId") != client_id
            or response.get("bindingRole") != binding_role
        ):
            raise DriverError(
                "Mobile simulator binding selection identity does not match"
            )
        launch_generation = response.get("launchGeneration")
        if (
            isinstance(launch_generation, bool)
            or not isinstance(launch_generation, int)
            or launch_generation <= 0
        ):
            raise DriverError(
                "Mobile simulator binding selection generation is invalid"
            )
        try:
            binding_proof = ArtifactRef.from_dict(
                _mapping(response.get("bindingProof"), "binding proof")
            )
        except (EvidenceError, TypeError, ValueError) as error:
            raise DriverError(
                "Mobile simulator binding proof is invalid"
            ) from error
        if binding_proof.gate_id != self._gate_id:
            raise DriverError(
                "Mobile simulator binding proof targets the wrong Gate"
            )
        remote_revocation = response.get("remoteRevocation")
        if remote_revocation not in {
            "confirmed",
            "unconfirmed",
            "not-required",
        }:
            raise DriverError(
                "Mobile simulator binding revocation state is invalid"
            )
        return MobileSimulatorBindingSelection(
            client_id=client_id,
            binding_role=binding_role,
            launch_generation=launch_generation,
            scope=validate_scope_projection(response.get("scope")),
            binding_proof=binding_proof,
            remote_revocation=remote_revocation,
        )

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        if action not in self._callable_harness_actions:
            raise DriverError(
                f"Mobile simulator Harness action is not callable: {action!r}"
            )
        response = self._client.invoke(
            CAPABILITY_ID,
            "harness_action",
            {
                "clientId": client_id,
                "action": action,
                "actionPayload": dict(payload or {}),
            },
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        )
        if set(response) != {"clientId", "value"}:
            raise DriverError(
                "Mobile simulator Harness response has an invalid shape"
            )
        if response.get("clientId") != client_id:
            raise DriverError(
                "Mobile simulator Harness response client does not match"
            )
        value = response.get("value")
        if action == "lifecycle.scope.read":
            return validate_scope_projection(value)
        return value

    def authenticate_fixture_actor(
        self,
        client_id: str,
    ) -> dict[str, Any]:
        self._require_identifier(client_id, "client")
        response = self._client.invoke(
            CAPABILITY_ID,
            "authenticate_fixture_actor",
            {"clientId": client_id},
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        )
        if set(response) != {"clientId", "value"}:
            raise DriverError(
                "Mobile simulator fixture authentication response "
                "has an invalid shape"
            )
        if response.get("clientId") != client_id:
            raise DriverError(
                "Mobile simulator fixture authentication client does not match"
            )
        value = _mapping(
            response.get("value"),
            "fixture authentication",
        )
        if set(value) != {"preAuthenticationScope", "login"}:
            raise DriverError(
                "Mobile simulator fixture authentication result "
                "has an invalid shape"
            )
        return {
            "preAuthenticationScope": validate_scope_projection(
                value.get("preAuthenticationScope")
            ),
            "login": _mapping(value.get("login"), "fixture login"),
        }

    def begin_access_gate(self, client_id: str) -> dict[str, Any]:
        self._require_identifier(client_id, "client")
        response = self._client.invoke(
            CAPABILITY_ID,
            "begin_access_gate",
            {"clientId": client_id},
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        )
        if set(response) != {"clientId", "value"}:
            raise DriverError(
                "Mobile simulator access-gate response has an invalid shape"
            )
        if response.get("clientId") != client_id:
            raise DriverError(
                "Mobile simulator access-gate client does not match"
            )
        value = _mapping(response.get("value"), "access gate")
        if set(value) != {"decision", "scope"}:
            raise DriverError(
                "Mobile simulator access-gate result has an invalid shape"
            )
        return {
            "decision": _mapping(
                value.get("decision"),
                "access-gate decision",
            ),
            "scope": validate_scope_projection(value.get("scope")),
        }

    def stop(self, client_id: str) -> None:
        if client_id not in self._active_clients:
            return
        response = self._client.invoke(
            CAPABILITY_ID,
            "stop",
            {"clientId": client_id},
            timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        )
        if response != {"clientId": client_id, "stopped": True}:
            raise DriverError("Mobile simulator stop response is invalid")
        self._active_clients.remove(client_id)

    def cleanup(self) -> tuple[str, ...]:
        stopped: list[str] = []
        failures: list[str] = []
        for client_id in reversed(tuple(self._active_clients)):
            try:
                self.stop(client_id)
            except Exception as error:
                failures.append(f"{client_id}: {type(error).__name__}")
            else:
                stopped.append(client_id)
        if failures:
            raise DriverError(
                "Mobile simulator Runtime Binding cleanup failed: "
                + "; ".join(failures)
            )
        return tuple(stopped)

    def close(self) -> tuple[str, ...]:
        cleanup_error: Exception | None = None
        stopped: tuple[str, ...] = ()
        try:
            stopped = self.cleanup()
        except Exception as error:
            cleanup_error = error
        try:
            self._client.close()
        except Exception as error:
            if cleanup_error is None:
                cleanup_error = error
        if cleanup_error is not None:
            raise cleanup_error
        return stopped

    @staticmethod
    def _require_identifier(value: str, label: str) -> None:
        if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value) is None:
            raise DriverError(
                f"Mobile simulator {label} identity is invalid"
            )


def validate_scope_projection(value: object) -> dict[str, Any]:
    scope = _mapping(value, "lifecycle scope")
    projected_scope = dict(scope)
    projected_scope.pop("deviceId", None)
    _assert_no_raw_authority(projected_scope)
    if set(scope) != {
        "generation",
        "phase",
        "launchState",
        "activeStationPeerId",
        "activeActorPtid",
        "runtimeStationPeerId",
        "deviceId",
        "social",
        "group",
        "navigation",
    }:
        raise DriverError("Mobile lifecycle scope has an invalid shape")
    generation = scope.get("generation")
    if (
        isinstance(generation, bool)
        or not isinstance(generation, int)
        or generation < 0
    ):
        raise DriverError("Mobile lifecycle scope generation is invalid")
    for field in ("phase", "launchState", "activeStationPeerId"):
        value = scope.get(field)
        if not isinstance(value, str):
            raise DriverError(
                f"Mobile lifecycle scope {field} is invalid"
            )
    for field in ("activeActorPtid", "runtimeStationPeerId", "deviceId"):
        _optional_text(scope.get(field), field)

    social = _mapping(scope.get("social"), "social scope")
    if set(social) != {
        "stationPeerId",
        "actorPtid",
        "sessionCount",
        "requestCount",
        "messageThreadCount",
    }:
        raise DriverError("Mobile social scope has an invalid shape")
    group = _mapping(scope.get("group"), "group scope")
    if set(group) != {
        "stationPeerId",
        "actorPtid",
        "groupCount",
        "messageThreadCount",
    }:
        raise DriverError("Mobile group scope has an invalid shape")
    for owner, fields in (
        (social, ("stationPeerId", "actorPtid")),
        (group, ("stationPeerId", "actorPtid")),
    ):
        for field in fields:
            _optional_text(owner.get(field), field)
    for owner, fields in (
        (
            social,
            ("sessionCount", "requestCount", "messageThreadCount"),
        ),
        (group, ("groupCount", "messageThreadCount")),
    ):
        for field in fields:
            item = owner.get(field)
            if (
                isinstance(item, bool)
                or not isinstance(item, int)
                or item < 0
            ):
                raise DriverError(
                    f"Mobile lifecycle scope {field} is invalid"
                )

    navigation = _mapping(scope.get("navigation"), "navigation scope")
    if set(navigation) != {
        "primaryRouteId",
        "detailKeys",
        "overlayRouteId",
    }:
        raise DriverError("Mobile navigation scope has an invalid shape")
    if not isinstance(navigation.get("primaryRouteId"), str):
        raise DriverError("Mobile primary route identity is invalid")
    detail_keys = navigation.get("detailKeys")
    if not isinstance(detail_keys, list) or any(
        not isinstance(item, str) for item in detail_keys
    ):
        raise DriverError("Mobile detail scope keys are invalid")
    _optional_text(navigation.get("overlayRouteId"), "overlayRouteId")
    return dict(scope)


def _runtime_identity(value: object) -> dict[str, str]:
    identity = _mapping(value, "runtime identity")
    if set(identity) != {"runtime", "instanceId", "identityDigest"}:
        raise DriverError("Mobile simulator runtime identity has an invalid shape")
    for field in ("runtime", "instanceId"):
        item = identity.get(field)
        if not isinstance(item, str) or not item:
            raise DriverError(
                f"Mobile simulator runtime identity {field} is invalid"
            )
    digest = identity.get("identityDigest")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise DriverError(
            "Mobile simulator runtime identity digest is invalid"
        )
    _assert_no_raw_authority(identity)
    return {
        "runtime": str(identity["runtime"]),
        "instanceId": str(identity["instanceId"]),
        "identityDigest": digest,
    }


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise DriverError(f"Mobile simulator {label} must be an object")
    return dict(value)


def _optional_text(value: object, field: str) -> None:
    if value is not None and not isinstance(value, str):
        raise DriverError(f"Mobile lifecycle scope {field} is invalid")


def _assert_no_raw_authority(value: object) -> None:
    forbidden_fields = {
        "artifact",
        "device",
        "deviceid",
        "endpoint",
        "serverurl",
        "serial",
        "udid",
        "url",
    }
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if normalized in forbidden_fields:
                raise DriverError(
                    "Mobile simulator response exposes raw runtime authority"
                )
            _assert_no_raw_authority(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _assert_no_raw_authority(item)
