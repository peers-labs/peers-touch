from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path

from tooling.acceptance.core import (
    AcceptanceGate,
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateClient,
    EphemeralHandlerCleanup,
    GateError,
    REPO_ROOT,
    current_artifact_ref,
    load_runtime_manifest,
)
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
)
from tooling.acceptance.transports.ssh import SshTransport, SshTunnel


GATE_ID = "relay-endpoint-discovery-contract"
CAPABILITY_ID = "station-access.endpoint-discovery-probe"
RUN_OPERATION = "verify-endpoints"
_PROBE_MARKER = "PT_ENDPOINT_DISCOVERY_PROBE="


def validate_discovery_source_contract() -> None:
    required_tokens = {
        "model/domain/peer/access_endpoint.proto": (
            "message AccessEndpointRequest",
            "message AccessEndpointResponse",
            "message StationRouteAttestation",
            "message StationConnectionGrant",
            "message IssueStationConnectionMaterialRequest",
            "message IssueStationConnectionMaterialResponse",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/bootstrap/"
            "access_endpoint.go"
        ): (
            "ACCESS_ENDPOINT_ROLE_DIRECT_STATION",
            "accessEndpointDomain",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/bootstrap/"
            "route_attestation.go"
        ): (
            "SignStationRouteAttestation",
            "SignStationConnectionGrant",
            "StationRouteDomain",
            "ConnectionGrantDomain",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/"
            "application/discovery.go"
        ): (
            "ACCESS_ENDPOINT_ROLE_RELAY",
            "domain.VerifyStationRouteAttestation",
            "RegisterConnectionGrant",
            "GRANT_REPLAYED",
            "GRANT_WRONG_RELAY",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay-client/"
            "connection_material.go"
        ): (
            "connectionMaterialReady",
            "ErrConnectionMaterialUnavailable",
            "IssueConnectionMaterial",
            "RegisterStationConnectionGrantRequest",
            "connectionCodePrefix = \"ptc1:\"",
            "proto.MarshalOptions{Deterministic: true}",
        ),
        "apps/station/app/subserver/dashboard/handler.go": (
            'routeRelayConnectionMaterial = "/dashboard/api/relay/connection-material"',
            "NewStrictTypedHandler",
            "handleIssueRelayConnectionMaterial",
            "h.connectionMaterialResponseWrapper()",
        ),
        "apps/station/app/subserver/dashboard/handler_middleware.go": (
            'resp.SetHeader("Cache-Control", "no-store")',
            'resp.SetHeader("Referrer-Policy", "no-referrer")',
        ),
        "apps/station/app/subserver/dashboard/subserver.go": (
            "relayclient.ConnectionMaterialIssuer",
            "resolveConnectionMaterialIssuer",
        ),
        (
            "docs/architecture/engineering/api-governance/"
            "station-api-capabilities.yaml"
        ): (
            "/dashboard/api/relay",
            "access.connection_material.issue",
            "/dashboard/api/relay/connection-material",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/handler.go"
        ): (
            "routePublishJWT := h.sub.routePublishJWTWrapper",
            "h.handlePublishStationRoute",
            "h.handleRegisterConnectionGrant",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/relay.go"
        ): (
            "routePublishJWTWrapper = mountAuthenticationWrapper",
            "domain.ScopeRoutePublish",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/bootstrap/"
            "accessendpoint/handler.go"
        ): (
            "/.well-known/peers-touch/access",
            "NewCanonicalProtobufHandler",
        ),
    }
    for relative_path, tokens in required_tokens.items():
        source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        missing = [token for token in tokens if token not in source]
        if missing:
            raise GateError(
                f"{relative_path} is missing: {', '.join(missing)}"
            )

    generated = (
        "apps/station/frame/touch/model/peer/access_endpoint.pb.go",
        "apps/desktop/src/gen/proto/domain/peer/access_endpoint_pb.ts",
        "apps/mobile/src/gen/proto/domain/peer/access_endpoint_pb.ts",
    )
    missing_generated = [
        path for path in generated if not (REPO_ROOT / path).is_file()
    ]
    if missing_generated:
        raise GateError(
            "endpoint discovery generated bindings are missing: "
            + ", ".join(missing_generated)
        )


class RelayEndpointDiscoveryCapabilityHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        station_transport: SshTransport,
        relay_transport: SshTransport,
        station_config: PosixServiceRuntimeConfig,
        relay_config: PosixServiceRuntimeConfig,
    ) -> None:
        self._closed = False
        self._tunnels: list[SshTunnel] = []
        self._temporary = tempfile.TemporaryDirectory(
            prefix="peers-touch-endpoint-discovery-"
        )
        self._probe_binary = Path(self._temporary.name) / "probe"
        try:
            station = station_transport.start_local_forward(
                remote_port=station_config.http_port
            )
            self._tunnels.append(station)
            relay = relay_transport.start_local_forward(
                remote_port=relay_config.http_port
            )
            self._tunnels.append(relay)
        except Exception:
            self.close()
            raise
        self._station_url = f"http://127.0.0.1:{station.local_port}"
        self._relay_url = f"http://127.0.0.1:{relay.local_port}"

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (RUN_OPERATION,)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return (self._station_url, self._relay_url)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        del payload
        if (
            self._closed
            or operation != RUN_OPERATION
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Endpoint discovery probe is unavailable",
                resource=CAPABILITY_ID,
            )
        self._build_probe(deadline_monotonic)
        remaining = max(1.0, deadline_monotonic - time.monotonic())
        completed = subprocess.run(
            [str(self._probe_binary)],
            input=json.dumps(
                {
                    "station_url": self._station_url,
                    "relay_url": self._relay_url,
                },
                separators=(",", ":"),
            ),
            capture_output=True,
            text=True,
            timeout=min(remaining, 45.0),
            check=False,
        )
        if completed.returncode != 0:
            raise GateError("Endpoint discovery probe failed")
        encoded = next(
            (
                line[len(_PROBE_MARKER):]
                for line in completed.stdout.splitlines()
                if line.startswith(_PROBE_MARKER)
            ),
            "",
        )
        try:
            result = json.loads(encoded)
        except json.JSONDecodeError as error:
            raise GateError(
                "Endpoint discovery probe returned invalid evidence"
            ) from error
        if not isinstance(result, dict):
            raise GateError("Endpoint discovery probe result must be an object")
        return result

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason, deadline_monotonic
        self.close()
        return True

    def close(self) -> EphemeralHandlerCleanup:
        if self._closed:
            return EphemeralHandlerCleanup(
                closed=True,
                secrets_zeroized=True,
            )
        errors: list[str] = []
        for tunnel in reversed(self._tunnels):
            try:
                tunnel.stop()
            except Exception as error:
                errors.append(str(error))
        self._tunnels.clear()
        self._temporary.cleanup()
        self._closed = True
        return EphemeralHandlerCleanup(
            closed=not errors,
            secrets_zeroized=True,
        )

    def _build_probe(self, deadline_monotonic: float) -> None:
        if self._probe_binary.exists():
            return
        remaining = max(1.0, deadline_monotonic - time.monotonic())
        completed = subprocess.run(
            [
                "go",
                "build",
                "-o",
                str(self._probe_binary),
                "./subserver/bootstrap/accessendpoint/cmd/discovery-probe",
            ],
            cwd=REPO_ROOT / "apps/station/frame/core/plugin/native",
            capture_output=True,
            text=True,
            timeout=min(remaining, 120.0),
            check=False,
        )
        if completed.returncode != 0:
            raise GateError("Endpoint discovery probe build failed")


class RelayEndpointDiscoveryGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-03"
    bom = ("SAL-REL-03-ENDPOINT-DISCOVERY",)
    spec = ("SAL-J01", "SAL-J06", "SAL-J07", "SAL-D07")

    def __init__(self, capability_client: EphemeralGateClient) -> None:
        super().__init__()
        self.capability_client = capability_client
        manifest_path = Path(
            _required_environment("PT_ACCEPTANCE_RUNTIME_MANIFEST")
        )
        self.manifest = dict(
            load_runtime_manifest(manifest_path, self.gate_id)
        )
        self.manifest["_manifest_ref"] = current_artifact_ref(
            "runtime/environment-manifest.json",
            repo_root=REPO_ROOT,
        ).to_dict()
        self.report.manifest = self.manifest

    def run(self) -> dict[str, object]:
        validate_discovery_source_contract()
        contract = subprocess.run(
            [
                "go",
                "test",
                "./frame/core/plugin/native/subserver/bootstrap",
                "./frame/core/plugin/native/subserver/relay/...",
                "./frame/core/plugin/native/subserver/relay-client/...",
                "-run",
                (
                    "TestSignAccessEndpoint|TestStationSignsRoute|"
                    "TestRelayDiscovery|TestIssueConnectionMaterial|"
                    "TestRegisterConnectionGrantRetry|"
                    "TestDiscoveryControlRoutesUseRoutePublishCredential"
                ),
                "-count=1",
            ],
            cwd=REPO_ROOT / "apps/station",
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
            env={**os.environ, "HOME": str(Path.home())},
        )
        result = dict(
            self.capability_client.invoke(
                CAPABILITY_ID,
                RUN_OPERATION,
                {},
                timeout_seconds=180,
            )
        )
        assertions = {
            "canonical_contract_tests_pass": contract.returncode == 0,
            "station_role_is_signed_and_challenge_bound": (
                result.get("station_role_bound") is True
            ),
            "relay_role_is_signed_and_challenge_bound": (
                result.get("relay_role_bound") is True
            ),
            "independent_challenges_are_bound": (
                result.get("challenges_bound") is True
            ),
            "relay_has_typed_empty_directory": (
                result.get("relay_no_candidates") is True
            ),
            "dashboard_connection_material_requires_auth": (
                result.get("dashboard_auth_required") is True
            ),
            "dashboard_connection_material_is_non_cacheable": (
                result.get("dashboard_sensitive_headers") is True
            ),
        }
        for name, passed in assertions.items():
            self.assert_condition(name, passed)
        return {
            "runtimeCell": "one-linux-relay",
            "assertions": assertions,
        }


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise GateError(f"missing required environment: {name}")
    return value


def main() -> int:
    capability_client = EphemeralGateClient.from_environment()
    if capability_client is None:
        raise GateError("Endpoint discovery probe capability is required")
    with capability_client:
        return RelayEndpointDiscoveryGate(capability_client).execute()


if __name__ == "__main__":
    raise SystemExit(main())
