"""Social Suite composition of reviewed Relay equipment and attachment owners."""
from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from tooling.acceptance.core.attestation import read_service_runtime_identity, source_proto_digest
from tooling.acceptance.core.errors import BlockedError, EphemeralLaunchCleanupFailed, EphemeralLaunchError
from tooling.acceptance.core.evidence_store import current_artifact_ref, write_current_artifact
from tooling.acceptance.core.execution_budget import positive_seconds
from tooling.acceptance.core.launch_context import GateLaunchSpec, GateProcessLauncher
from tooling.acceptance.core.provisioner import resolve_reviewed_profile_environment
from tooling.acceptance.core.provisioning import RuntimeManifest, ServiceAttestation
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig, audit_posix_relay_security, inspect_posix_runtime,
    resolve_posix_relay_trust_anchor,
)
from tooling.acceptance.provisioners.relay_attachment import RelayAttachmentFixture
from tooling.acceptance.provisioners.remote_source_identity import resolve_remote_source_identity
from tooling.acceptance.provisioners.station_access_relay_role import (
    _persist_relay_attestation, _relay_peer_identity, _station_runtime_config,
    _validate_runtime_status,
)


class SocialRelayFixture:
    """The original parent retains leases and cleanup; no second provisioner."""

    def __init__(
        self, *, profile: str, repo_root: Path,
        register_cleanup: Callable[[str, Callable[[], None]], None],
        acquire_profile_lease: Callable[[str, str], None],
        acquire_source_lease: Callable[[str, str], None],
    ) -> None:
        self.profile = profile
        self.repo_root = repo_root
        self._acquire_profile = acquire_profile_lease
        self._acquire_source = acquire_source_lease
        self.attachments = RelayAttachmentFixture(register_cleanup=register_cleanup)
        self.config: PosixServiceRuntimeConfig | None = None
        self.relay_health = ""
        self.inventory: dict[str, object] | None = None

    def equip(self, manifest: RuntimeManifest, *, timeout_seconds: float = 600) -> None:
        """Canonical deployment owns acquisition, before any retained Suite lease."""
        timeout_seconds = positive_seconds(timeout_seconds, "Social Relay equipment timeout")
        _, profile_env = resolve_reviewed_profile_environment(self.profile, repo_root=self.repo_root)
        deployment = profile_env.get("PT_RELAY_DEPLOY_ENV", "")
        if (profile_env.get("PT_RELAY_MODE") != "remote"
                or self.profile.lower().endswith("stable")
                or deployment.lower().endswith("stable")):
            raise BlockedError(reason="Social Relay requires a reviewed non-stable remote Profile",
                               resource="social-relay-profile")
        config = PosixServiceRuntimeConfig.load(deployment, expected_role="relay")
        health = profile_env.get("PT_RELAY_HEALTH_URL", "")
        origin, probe = urlparse(config.public_base_url), urlparse(health)
        if (profile_env.get("PT_RELAY_URL", "").rstrip("/") != config.public_base_url
                or probe.scheme != "https" or not probe.hostname
                or probe.hostname != origin.hostname
                or (probe.port or 443) != (origin.port or 443)
                or probe.username is not None or probe.password is not None):
            raise BlockedError(reason="Social Relay Profile and deployment origins differ",
                               resource="social-relay-profile")
        if (not re.fullmatch(r"[0-9a-f]{40}", manifest.source_commit)
                or subprocess.check_output(
                    ["git", "rev-parse", "HEAD"], cwd=self.repo_root, text=True, timeout=30,
                ).strip() != manifest.source_commit):
            raise BlockedError(reason="Social Relay equipment source changed",
                               resource="social-relay-source")
        branch = subprocess.check_output(
            ["git", "branch", "--show-current"], cwd=self.repo_root, text=True, timeout=30,
        ).strip()
        if not branch:
            raise BlockedError(reason="Social Relay deployment requires the current source branch",
                               resource="social-relay-source")
        self.config = config
        self.relay_health = health
        environment = dict(os.environ)
        # A child must acquire its own deployment/source leases. Evidence and
        # Station/Agent runtime variants remain with their original parent.
        for field in tuple(environment):
            if field.startswith(("PT_MACHINE_LEASE_", "PT_SOCIAL_ACCEPTANCE_")) or field in {
                "SRV", "ENV", "PT_PROFILE_LEASE_HELD", "PT_SOURCE_LEASE_HELD",
                "PT_ACCEPTANCE_ENVIRONMENT", "PT_ACCEPTANCE_RUN_ID",
                "PT_AGENT_CAPABILITY_SCENARIO_CONTROL", "PT_AGENT_EXTERNAL_RUNTIME_ROOT",
                "PT_AGENT_EXTERNAL_START_ARGV_JSON", "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON",
                "PT_AGENT_EXTERNAL_RESET_ARGV_JSON", "PT_DEV_PROFILE_FILE",
                "PT_DEV_PROFILE_FILE_AUTHORITY", "PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT",
                "PT_STATION_RECREATE_RUNTIME", "PT_ACCEPTANCE_SSH_CONNECTIONS",
            }:
                environment.pop(field, None)
        environment.update(
            BRANCH=branch, PT_DEV_TARGET_PROFILE=self.profile,
            PT_STATION_LEASE_BUDGET_SECONDS=str(max(1, int(timeout_seconds))),
        )
        observation: dict[str, object] = {
            "profile": self.profile, "deployment": deployment,
            "commit": manifest.source_commit, "timeoutSeconds": timeout_seconds,
        }
        log = f"runtime/relay-equipment/{self.profile}/{uuid4().hex}.log"

        def capture(stdout: str, stderr: str) -> None:
            write_current_artifact(log, (stdout + stderr).encode(), repo_root=self.repo_root)
            observation["log"] = current_artifact_ref(log, repo_root=self.repo_root).to_dict()

        try:
            completed = GateProcessLauncher(
                cwd=str(self.repo_root), environment=environment, termination_timeout_seconds=1,
            ).run(GateLaunchSpec((
                "/bin/bash", str(self.repo_root / "tooling/scripts/deploy/deploy.sh"), deployment,
            ), timeout_seconds, ()), None, capture_output=capture)
            observation["exitCode"] = completed.returncode
            if completed.returncode == 0:
                return
        except EphemeralLaunchCleanupFailed:
            raise
        except (OSError, subprocess.TimeoutExpired, EphemeralLaunchError) as error:
            observation["errorType"] = type(error).__name__
        raise BlockedError(
            reason="Canonical Social Relay equipment failed",
            resource=f"relay-equipment:{self.profile}",
            diagnostic=ResourceDiagnostic.observed(
                owner="tooling/acceptance/provisioners/social_relay.py",
                recovery_action="Repair the recorded canonical deployment failure and repeat the same source-bound Suite.",
                resource=f"relay-equipment:{self.profile}",
                expected={"ready": True, "commit": manifest.source_commit}, observed=observation,
            ),
        )

    def attach(
        self, manifest: RuntimeManifest, stations: Mapping[str, ServiceAttestation],
    ) -> ServiceAttestation:
        """Attach both existing Stations under the parent-owned retained leases."""
        config = self.config
        if config is None or len(stations) != 2 or any(
            service.service_kind != "station" for service in stations.values()
        ) or len({service.runtime_identity for service in stations.values()}) != 2:
            raise BlockedError(reason="Social Relay requires its equipped runtime and two distinct Stations",
                               resource="social-relay-binding")
        owner = f"acceptance:{manifest.gate_id}:{manifest.run_id}"
        self._acquire_profile(config.environment_name, owner)
        self._acquire_source(config.environment_name, owner)
        identity = resolve_remote_source_identity(config.environment_name)
        protocol = source_proto_digest(self.repo_root)
        if identity != (manifest.source_commit, "clean", protocol):
            raise BlockedError(reason="Social Relay source/protocol changed after equipment",
                               resource="social-relay-source")
        relay_runtime = _validate_runtime_status(
            inspect_posix_runtime(config), config=config, source_commit=manifest.source_commit,
        )
        if relay_runtime["buildCommit"] != manifest.source_commit:
            raise BlockedError(reason="Social Relay executable differs from the prepared source",
                               resource="social-relay-source")
        trust, trust_digest = resolve_posix_relay_trust_anchor(config.environment_name)
        peer_id = _relay_peer_identity(config.public_base_url, self.relay_health, trust)
        station_records = {}
        for service_id, station in stations.items():
            if (station.live_commit != manifest.source_commit
                    or station.protocol_digest != protocol or station.workspace_digest != "clean"
                    or station.deployment_environment == config.environment_name):
                raise BlockedError(reason="Social Relay Station binding differs from the prepared source",
                                   resource=f"social-relay-binding:{service_id}")
            station_config = _station_runtime_config(
                station.deployment_environment, station_url=station.endpoint, allow_profile_managed=True,
            )
            before = _validate_runtime_status(
                inspect_posix_runtime(station_config), config=station_config,
                source_commit=manifest.source_commit,
            )
            if (before["runtimeOwner"] == relay_runtime["runtimeOwner"]
                    or before["dataOwner"] == relay_runtime["dataOwner"]
                    or read_service_runtime_identity(station.endpoint) != station.runtime_identity):
                raise BlockedError(reason="Social Relay Station runtime ownership changed",
                                   resource=f"social-relay-binding:{service_id}")
            attachment = self.attachments.prepare(
                manifest=manifest, station_config=station_config, station_url=station.endpoint,
                relay_url=config.public_base_url, relay_peer_id=peer_id,
                relay_config=config, trust_anchor=trust,
            )
            after = _validate_runtime_status(
                inspect_posix_runtime(station_config), config=station_config,
                source_commit=manifest.source_commit,
            )
            generation = attachment.get("route_generation")
            if (before["containerId"] != after["containerId"]
                    or read_service_runtime_identity(station.endpoint) != station.runtime_identity
                    or type(generation) is not int or generation < 1):
                raise BlockedError(reason="Social Relay Station identity or joined route changed during attachment",
                                   resource=f"social-relay-binding:{service_id}")
            station_records[service_id] = {
                "stationPeerId": station.runtime_identity,
                "serviceAttestationRef": station.artifact_ref, "runtime": after,
                "attachment": {key: attachment.get(key) for key in (
                    "relay_peer_id", "control_origin", "state", "enabled", "route_generation",
                    "route_expires_at", "dial_addresses",
                )},
            }
        first_runtime = next(iter(station_records.values()))["runtime"]
        security = audit_posix_relay_security(
            config, station_runtime=first_runtime, relay_runtime=relay_runtime,
        )
        self.inventory = {
            "artifactKind": "social-relay-preparation", "runId": manifest.run_id,
            "sourceCommit": manifest.source_commit, "profile": self.profile,
            "relayPeerId": peer_id, "relayRuntime": relay_runtime, "stations": station_records,
        }
        return _persist_relay_attestation(
            environment_id=manifest.environment_id, relay_url=config.public_base_url,
            relay_deployment=config.environment_name, relay_identity=identity,
            station_runtime=first_runtime, relay_runtime=relay_runtime,
            runtime_security=security, trust_anchor=trust, trust_anchor_digest=trust_digest,
            relay_peer_id=peer_id,
        )
