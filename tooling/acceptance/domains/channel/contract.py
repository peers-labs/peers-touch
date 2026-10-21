"""Strict contracts for the live Lark Channel Acceptance journeys."""

from __future__ import annotations

import dataclasses
import json
import os
import re
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import BlockedError, GateError, REPO_ROOT
from tooling.acceptance.core.attestation import (
    source_proto_digest,
    source_workspace_digest,
)


MANIFEST_KIND = "lark-channel-suite-runtime-manifest"
MANIFEST_VERSION = 2
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40,64}$")
SHA256_PATTERN = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$")


@dataclasses.dataclass(frozen=True)
class JourneyContract:
    journey_id: str
    gate_id: str
    outcome: str
    risk: str
    required_capabilities: tuple[str, ...]
    required_resources: tuple[str, ...]
    max_provisioning_runs: int = 1

    @property
    def scenario_ids(self) -> tuple[str, str]:
        return (
            f"{self.journey_id}-OUTCOME",
            f"{self.journey_id}-RISK",
        )

    @property
    def runtime_reuse(self) -> dict[str, Any]:
        suffix = self.journey_id.removeprefix("LARK-J")
        return {
            "scope": "suite",
            "entryCheckId": f"journey-{suffix}",
            "scenarioIds": list(self.scenario_ids),
            "maxProvisioningRuns": self.max_provisioning_runs,
            "maxClientLaunches": 1,
            "minWarmReuseRate": 0.5,
            "requireAttachOnlyScenarios": True,
            "requireReceiverVisibleProof": True,
            "allowClientReplacement": False,
        }


def _journey(
    suffix: str,
    *,
    outcome: str,
    risk: str,
    capabilities: tuple[str, ...],
    resources: tuple[str, ...],
    provisioning_runs: int = 1,
) -> JourneyContract:
    journey_id = f"LARK-J{suffix}"
    return JourneyContract(
        journey_id=journey_id,
        gate_id=f"lark-{suffix.lower()}-e2e",
        outcome=outcome,
        risk=risk,
        required_capabilities=capabilities,
        required_resources=resources,
        max_provisioning_runs=provisioning_runs,
    )


COMMON_LIVE_CAPABILITIES = (
    "station-channel-api",
    "lark-sender",
    "lark-receiver",
    "journey-control",
)
CONTROL_CAPABILITIES = frozenset(
    {
        "journey-control",
        "fault-control",
        "provider-admin",
        "card-action-control",
        "automation-clock",
        "plugin-control",
    }
)
DESKTOP_LIVE_CAPABILITIES = COMMON_LIVE_CAPABILITIES + ("desktop-native",)
PROVISIONING_CAPABILITIES = DESKTOP_LIVE_CAPABILITIES + ("provider-admin",)
WORKSPACE_CAPABILITIES = COMMON_LIVE_CAPABILITIES + ("lark-workspace",)


JOURNEY_CONTRACTS = {
    contract.journey_id: contract
    for contract in (
        _journey(
            "01",
            outcome="one provider event maps to one admission and one receiver result",
            risk="concurrent replay and plugin restart do not create a second turn",
            capabilities=COMMON_LIVE_CAPABILITIES + ("fault-control",),
            resources=("primary_binding", "direct_chat"),
        ),
        _journey(
            "02",
            outcome="delivery retry reuses the completed turn result",
            risk="unknown provider outcome does not blindly redeliver or rerun tools",
            capabilities=COMMON_LIVE_CAPABILITIES + ("fault-control",),
            resources=("primary_binding", "direct_chat"),
        ),
        _journey(
            "03",
            outcome="provisioning confirmation creates one owner-bound connection",
            risk="failed and repeated confirmation preserves one app and binding identity",
            capabilities=PROVISIONING_CAPABILITIES,
            resources=("primary_agent",),
            provisioning_runs=2,
        ),
        _journey(
            "04",
            outcome="non-blocking provisioning progress survives closing and reopening",
            risk="cancel and resume do not create a second provider application",
            capabilities=PROVISIONING_CAPABILITIES,
            resources=("primary_agent",),
            provisioning_runs=2,
        ),
        _journey(
            "05",
            outcome="the requested bot name, description, and avatar are visible in Lark",
            risk="provider profile failure remains visible and is not reported as success",
            capabilities=PROVISIONING_CAPABILITIES,
            resources=("primary_binding", "avatar_image"),
            provisioning_runs=2,
        ),
        _journey(
            "06",
            outcome="capability scopes project ready, waiting, and repair states",
            risk="repair and degraded-scope decisions do not duplicate the application",
            capabilities=PROVISIONING_CAPABILITIES,
            resources=("primary_binding",),
            provisioning_runs=2,
        ),
        _journey(
            "07",
            outcome="a real international account and a custom app both send and receive",
            risk="Feishu region state cannot satisfy the Lark international assertion",
            capabilities=PROVISIONING_CAPABILITIES + ("lark-international",),
            resources=(
                "primary_agent",
                "international_binding",
                "international_chat",
            ),
            provisioning_runs=2,
        ),
        _journey(
            "08",
            outcome="multiple bindings keep independent Agent, route, health, and lifecycle state",
            risk="selection changes and asynchronous completion cannot cross-write bindings",
            capabilities=DESKTOP_LIVE_CAPABILITIES,
            resources=(
                "primary_binding",
                "secondary_binding",
                "primary_agent",
                "secondary_agent",
            ),
        ),
        _journey(
            "09",
            outcome="a real screenshot reaches attachment admission and the answer names its fact",
            risk="an image key or empty attachment cannot satisfy image understanding",
            capabilities=COMMON_LIVE_CAPABILITIES,
            resources=("primary_binding", "direct_chat", "fact_image"),
        ),
        _journey(
            "10",
            outcome="file, post, quote, merge-forward, and outbound artifact results are readable",
            risk="unsupported media is reported explicitly and source message identity is preserved",
            capabilities=COMMON_LIVE_CAPABILITIES,
            resources=("primary_binding", "direct_chat", "fact_file"),
        ),
        _journey(
            "11",
            outcome="streaming card revisions converge to one receiver-visible terminal state",
            risk="stale updates and text fallback cannot overwrite or rerun the terminal result",
            capabilities=COMMON_LIVE_CAPABILITIES + ("fault-control",),
            resources=("primary_binding", "direct_chat"),
        ),
        _journey(
            "12",
            outcome="ask, approve, reject, cancel, retry, and feedback continue the same turn",
            risk="duplicate, expired, and revoked card actions execute no second side effect",
            capabilities=COMMON_LIVE_CAPABILITIES + ("card-action-control",),
            resources=("primary_binding", "direct_chat"),
        ),
        _journey(
            "13",
            outcome="owner, approval, allowlist, and open access map real provider identities",
            risk="an unauthorized member cannot borrow owner or requester identity",
            capabilities=COMMON_LIVE_CAPABILITIES + ("secondary-lark-user",),
            resources=("primary_binding", "direct_chat"),
        ),
        _journey(
            "14",
            outcome="mentions, groups, routes, and two threads remain isolated",
            risk="non-mentioned and bot-authored group messages do not trigger loops",
            capabilities=COMMON_LIVE_CAPABILITIES + ("secondary-lark-user",),
            resources=(
                "primary_binding",
                "group_a_chat",
                "group_b_chat",
            ),
        ),
        _journey(
            "15",
            outcome="authorized bounded context backfill and advanced response policy are visible",
            risk="removed membership, expired windows, and unrelated threads cannot leak context",
            capabilities=COMMON_LIVE_CAPABILITIES + ("secondary-lark-user",),
            resources=(
                "primary_binding",
                "group_a_chat",
                "group_b_chat",
            ),
        ),
        _journey(
            "16",
            outcome="two requesters independently refresh, extend, and revoke OAuth grants",
            risk="bot or another requester token cannot satisfy a requester operation",
            capabilities=WORKSPACE_CAPABILITIES + ("secondary-lark-user",),
            resources=("primary_binding",),
        ),
        _journey(
            "17",
            outcome="documents, Drive, Wiki, and contacts return requester-visible real data",
            risk="a second requester cannot read the first requester's private resource",
            capabilities=WORKSPACE_CAPABILITIES + ("secondary-lark-user",),
            resources=(
                "primary_binding",
                "private_document",
                "wiki_node",
                "drive_resource",
                "contact_user",
            ),
        ),
        _journey(
            "18A",
            outcome="approved document creation and edit are readable by the receiver",
            risk="rejected document writes leave no provider-side resource or mutation",
            capabilities=WORKSPACE_CAPABILITIES + ("card-action-control",),
            resources=("primary_binding", "drive_folder"),
        ),
        _journey(
            "18B",
            outcome="approved Drive create, upload, and move operations have readable results",
            risk="rejected or revoked Drive operations leave no side effect",
            capabilities=WORKSPACE_CAPABILITIES + ("card-action-control",),
            resources=("primary_binding", "drive_folder", "fact_file"),
        ),
        _journey(
            "18C",
            outcome="every required reference extension has an independent receiver result",
            risk="installed commands or scopes without an executed user action remain unproven",
            capabilities=WORKSPACE_CAPABILITIES + ("extension-inventory",),
            resources=("primary_binding", "extension_inventory"),
        ),
        _journey(
            "19",
            outcome="event, document, schedule, and manual automation triggers deliver once",
            risk="cancelled, expired, failed, and revoked automations do not rerun or borrow identity",
            capabilities=WORKSPACE_CAPABILITIES + ("automation-clock",),
            resources=("primary_binding", "direct_chat"),
        ),
        _journey(
            "20",
            outcome="activity, delivery, plugin recovery, and redacted export agree",
            risk="legacy consumers, credentials, provider IDs, and private content do not leak",
            capabilities=DESKTOP_LIVE_CAPABILITIES + ("plugin-control",),
            resources=("primary_binding",),
        ),
    )
}

GATE_TO_JOURNEY = {
    contract.gate_id: contract.journey_id
    for contract in JOURNEY_CONTRACTS.values()
}


def journey_contract(journey_id: str) -> JourneyContract:
    try:
        return JOURNEY_CONTRACTS[journey_id]
    except KeyError as error:
        expected = ", ".join(JOURNEY_CONTRACTS)
        raise GateError(
            f"unsupported Lark journey {journey_id!r}; expected one of {expected}"
        ) from error


def gate_journey(gate_id: str) -> str:
    try:
        return GATE_TO_JOURNEY[gate_id]
    except KeyError as error:
        raise GateError(f"unsupported Lark Gate {gate_id!r}") from error


def _mapping(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{field} must be an object")
    return dict(value)


def _closed_mapping(
    value: object,
    field: str,
    expected_fields: set[str],
) -> dict[str, Any]:
    result = _mapping(value, field)
    if set(result) != expected_fields:
        missing = sorted(expected_fields - set(result))
        unknown = sorted(set(result) - expected_fields)
        raise GateError(
            f"{field} has an invalid shape; missing={missing} unknown={unknown}"
        )
    return result


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GateError(f"{field} must be a non-empty string")
    return value.strip()


def _identifier(value: object, field: str) -> str:
    result = _text(value, field)
    if not IDENTIFIER_PATTERN.fullmatch(result):
        raise GateError(f"{field} is not a valid identifier")
    return result


def _commit(value: object, field: str) -> str:
    result = _text(value, field).lower()
    if not COMMIT_PATTERN.fullmatch(result):
        raise GateError(f"{field} must be a full lowercase Git commit")
    return result


def _digest(value: object, field: str, *, clean_allowed: bool = False) -> str:
    result = _text(value, field).lower()
    if clean_allowed and result == "clean":
        return result
    if not SHA256_PATTERN.fullmatch(result):
        raise GateError(f"{field} must be a SHA-256 digest")
    return result


def _env_ref(value: object, field: str) -> str:
    result = _text(value, field)
    if not result.startswith("env:"):
        raise GateError(f"{field} must be an env: reference")
    name = result.removeprefix("env:")
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,127}", name):
        raise GateError(f"{field} has an invalid environment variable name")
    return result


def resolve_env_ref(reference: str, field: str) -> str:
    name = _env_ref(reference, field).removeprefix("env:")
    value = os.environ.get(name, "").strip()
    if not value:
        raise GateError(f"{field} credential/resource reference {name} is unavailable")
    return value


@dataclasses.dataclass(frozen=True)
class SourceIdentity:
    worktree: Path
    commit: str
    workspace_digest: str
    protocol_digest: str

    @classmethod
    def from_dict(cls, value: object) -> "SourceIdentity":
        data = _closed_mapping(
            value,
            "source",
            {"worktree", "commit", "workspaceDigest", "protocolDigest"},
        )
        worktree = Path(_text(data["worktree"], "source.worktree")).resolve()
        if worktree != REPO_ROOT.resolve():
            raise GateError(
                "source.worktree does not identify the selected repository"
            )
        return cls(
            worktree=worktree,
            commit=_commit(data["commit"], "source.commit"),
            workspace_digest=_digest(
                data["workspaceDigest"],
                "source.workspaceDigest",
                clean_allowed=True,
            ),
            protocol_digest=_digest(
                data["protocolDigest"],
                "source.protocolDigest",
            ).removeprefix("sha256:"),
        )

    def validate_current_source(self) -> None:
        current_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if current_commit != self.commit:
            raise GateError(
                f"Suite source commit {self.commit} does not match current {current_commit}"
            )
        current_workspace_digest = source_workspace_digest(REPO_ROOT)
        if current_workspace_digest != self.workspace_digest:
            raise GateError(
                "Suite workspace digest does not match the current source"
            )
        current_protocol_digest = source_proto_digest(REPO_ROOT)
        if current_protocol_digest != self.protocol_digest:
            raise GateError(
                "Suite protocol digest does not match the current source"
            )


@dataclasses.dataclass(frozen=True)
class ServiceIdentity:
    service_id: str
    kind: str
    endpoint: str
    live_commit: str
    workspace_digest: str
    protocol_digest: str
    runtime_identity: str

    @classmethod
    def from_dict(cls, service_id: str, value: object) -> "ServiceIdentity":
        data = _closed_mapping(
            value,
            f"services.{service_id}",
            {
                "kind",
                "endpoint",
                "liveCommit",
                "workspaceDigest",
                "protocolDigest",
                "runtimeIdentity",
            },
        )
        endpoint = _text(data["endpoint"], f"services.{service_id}.endpoint")
        if not endpoint.startswith(("http://127.0.0.1:", "https://")):
            raise GateError(
                f"services.{service_id}.endpoint must be HTTPS or loopback HTTP"
            )
        return cls(
            service_id=_identifier(service_id, f"services.{service_id}.id"),
            kind=_identifier(data["kind"], f"services.{service_id}.kind"),
            endpoint=endpoint.rstrip("/"),
            live_commit=_commit(
                data["liveCommit"],
                f"services.{service_id}.liveCommit",
            ),
            workspace_digest=_digest(
                data["workspaceDigest"],
                f"services.{service_id}.workspaceDigest",
                clean_allowed=True,
            ),
            protocol_digest=_digest(
                data["protocolDigest"],
                f"services.{service_id}.protocolDigest",
            ).removeprefix("sha256:"),
            runtime_identity=_identifier(
                data["runtimeIdentity"],
                f"services.{service_id}.runtimeIdentity",
            ),
        )

    def validate_source(self, source: SourceIdentity) -> None:
        if (
            self.live_commit != source.commit
            or self.workspace_digest != source.workspace_digest
            or self.protocol_digest != source.protocol_digest
        ):
            raise GateError(
                f"service {self.service_id} is not running the Suite source"
            )


@dataclasses.dataclass(frozen=True)
class Actor:
    actor_id: str
    kind: str
    config: dict[str, Any]

    @classmethod
    def from_dict(cls, actor_id: str, value: object) -> "Actor":
        data = _mapping(value, f"actors.{actor_id}")
        kind = _identifier(data.pop("kind", None), f"actors.{actor_id}.kind")
        allowed_fields = {
            "station-operator": set(),
            "lark-user": {
                "executableRef",
                "configDirRef",
                "dataDirRef",
                "profile",
            },
            "desktop-native": {"webdriverHost", "webdriverPort"},
        }
        if kind not in allowed_fields:
            raise GateError(f"actors.{actor_id}.kind {kind!r} is unsupported")
        if set(data) != allowed_fields[kind]:
            raise GateError(
                f"actors.{actor_id} has an invalid {kind} configuration"
            )
        if kind == "lark-user":
            for name in ("executableRef", "configDirRef", "dataDirRef"):
                _env_ref(data[name], f"actors.{actor_id}.{name}")
            _identifier(data["profile"], f"actors.{actor_id}.profile")
        elif kind == "desktop-native":
            host = _text(data["webdriverHost"], f"actors.{actor_id}.webdriverHost")
            if host not in {"127.0.0.1", "::1", "localhost"}:
                raise GateError("Desktop WebDriver must remain loopback")
            port = data["webdriverPort"]
            if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
                raise GateError(f"actors.{actor_id}.webdriverPort is invalid")
        return cls(
            actor_id=_identifier(actor_id, f"actors.{actor_id}.id"),
            kind=kind,
            config=data,
        )


@dataclasses.dataclass(frozen=True)
class Capability:
    capability_id: str
    kind: str
    subject_kind: str
    subject_id: str
    token_ref: str

    @classmethod
    def from_dict(
        cls,
        capability_id: str,
        value: object,
    ) -> "Capability":
        data = _closed_mapping(
            value,
            f"capabilities.{capability_id}",
            {"kind", "subjectKind", "subjectId", "tokenRef"},
        )
        token_ref_value = data["tokenRef"]
        if not isinstance(token_ref_value, str):
            raise GateError(
                f"capabilities.{capability_id}.tokenRef must be a string"
            )
        token_ref = token_ref_value.strip()
        if token_ref:
            _env_ref(token_ref, f"capabilities.{capability_id}.tokenRef")
        return cls(
            capability_id=_identifier(
                capability_id,
                f"capabilities.{capability_id}.id",
            ),
            kind=_identifier(
                data["kind"],
                f"capabilities.{capability_id}.kind",
            ),
            subject_kind=_identifier(
                data["subjectKind"],
                f"capabilities.{capability_id}.subjectKind",
            ),
            subject_id=_identifier(
                data["subjectId"],
                f"capabilities.{capability_id}.subjectId",
            ),
            token_ref=token_ref,
        )


@dataclasses.dataclass(frozen=True)
class SuiteManifest:
    path: Path
    suite_runtime_id: str
    fixture_epoch: str
    source: SourceIdentity
    services: dict[str, ServiceIdentity]
    actors: dict[str, Actor]
    resources: dict[str, str]
    capabilities: dict[str, Capability]
    cleanup: dict[str, Any]

    @classmethod
    def load(cls, path: str | Path) -> "SuiteManifest":
        manifest_path = Path(path).expanduser().resolve()
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise GateError(f"Lark Suite Manifest is unavailable: {error}") from error
        data = _closed_mapping(
            raw,
            "manifest",
            {
                "artifactKind",
                "schemaVersion",
                "suiteRuntimeId",
                "fixtureEpoch",
                "source",
                "services",
                "actors",
                "resources",
                "capabilities",
                "cleanup",
            },
        )
        if data["artifactKind"] != MANIFEST_KIND:
            raise GateError("Lark Suite Manifest has the wrong artifactKind")
        if data["schemaVersion"] != MANIFEST_VERSION:
            raise GateError("Lark Suite Manifest has an unsupported schemaVersion")
        services_data = _mapping(data["services"], "services")
        services = {
            key: ServiceIdentity.from_dict(key, value)
            for key, value in services_data.items()
        }
        station_services = [
            service for service in services.values() if service.kind == "station"
        ]
        if len(station_services) != 1:
            raise GateError("Lark Suite Manifest requires exactly one Station service")
        actors_data = _mapping(data["actors"], "actors")
        actors = {
            key: Actor.from_dict(key, value)
            for key, value in actors_data.items()
        }
        resources_data = _mapping(data["resources"], "resources")
        resources = {
            _identifier(key, f"resources.{key}.id"): _env_ref(
                value,
                f"resources.{key}",
            )
            for key, value in resources_data.items()
        }
        capabilities_data = _mapping(data["capabilities"], "capabilities")
        capabilities = {
            key: Capability.from_dict(key, value)
            for key, value in capabilities_data.items()
        }
        for capability in capabilities.values():
            subjects = (
                services
                if capability.subject_kind == "service"
                else actors
                if capability.subject_kind == "actor"
                else None
            )
            if subjects is None:
                raise GateError(
                    f"capability {capability.capability_id} has unsupported "
                    f"subject kind {capability.subject_kind!r}"
                )
            if capability.subject_id not in subjects:
                raise GateError(
                    f"capability {capability.capability_id} references an "
                    f"unknown {capability.subject_kind}"
                )
        cleanup = _closed_mapping(
            data["cleanup"],
            "cleanup",
            {"policy", "ownedResourcePrefix", "releaseRequired"},
        )
        if cleanup["policy"] != "namespaced":
            raise GateError("Lark Suite cleanup policy must be namespaced")
        _identifier(cleanup["ownedResourcePrefix"], "cleanup.ownedResourcePrefix")
        if cleanup["releaseRequired"] is not True:
            raise GateError("Lark Suite cleanup must be required")
        manifest = cls(
            path=manifest_path,
            suite_runtime_id=_identifier(
                data["suiteRuntimeId"],
                "suiteRuntimeId",
            ),
            fixture_epoch=_identifier(data["fixtureEpoch"], "fixtureEpoch"),
            source=SourceIdentity.from_dict(data["source"]),
            services=services,
            actors=actors,
            resources=resources,
            capabilities=capabilities,
            cleanup=cleanup,
        )
        manifest.validate_source_identity()
        return manifest

    @property
    def station(self) -> ServiceIdentity:
        return next(
            service
            for service in self.services.values()
            if service.kind == "station"
        )

    def validate_source_identity(self) -> None:
        self.source.validate_current_source()
        for service in self.services.values():
            service.validate_source(self.source)
        if self.station.workspace_digest != "clean":
            raise GateError(
                "live Lark Acceptance requires a clean source-addressable Station"
            )

    def require_for(self, contract: JourneyContract) -> None:
        missing_capabilities = sorted(
            set(contract.required_capabilities) - set(self.capabilities)
        )
        missing_resources = sorted(
            set(contract.required_resources) - set(self.resources)
        )
        if missing_capabilities or missing_resources:
            blocked_items = [
                *missing_capabilities,
                *(f"resource:{resource_id}" for resource_id in missing_resources),
            ]
            unavailable = ",".join(blocked_items)
            blocked_status = "; ".join(
                f"{item} BLOCKED"
                for item in blocked_items
            )
            raise BlockedError(
                (
                    f"{blocked_status}: {contract.journey_id} requires "
                    "real source-bound capabilities that the Suite did not "
                    "provision"
                ),
                resource=f"lark-capabilities:{unavailable}",
            )
        for capability_id in contract.required_capabilities:
            capability = self.capabilities[capability_id]
            if capability.kind != capability_id:
                raise GateError(
                    f"capability {capability_id} has kind {capability.kind!r}"
                )
        station_capability = self.capabilities["station-channel-api"]
        if (
            station_capability.subject_kind != "service"
            or station_capability.subject_id != self.station.service_id
        ):
            raise GateError(
                "station-channel-api must reference the Suite Station service"
            )
        if not station_capability.token_ref:
            raise GateError(
                "station-channel-api requires a source-bound tokenRef"
            )
        control_capabilities = (
            set(contract.required_capabilities) & CONTROL_CAPABILITIES
        )
        control_service_id = (
            self.capabilities["journey-control"].subject_id
            if "journey-control" in control_capabilities
            else ""
        )
        for capability_id in sorted(control_capabilities):
            capability = self.capabilities[capability_id]
            if capability.subject_kind != "service":
                raise GateError(
                    f"{capability_id} must reference a service subject"
                )
            service = self.services[capability.subject_id]
            if service.kind != "lark-journey-control":
                raise GateError(
                    f"{capability_id} must reference a lark-journey-control service"
                )
            if not capability.token_ref:
                raise GateError(
                    f"{capability_id} requires a source-bound tokenRef"
                )
            if control_service_id and capability.subject_id != control_service_id:
                raise GateError(
                    f"{capability_id} must share the Suite journey-control service"
                )

    def actor(self, actor_id: str, kind: str) -> Actor:
        actor = self.actors.get(actor_id)
        if actor is None or actor.kind != kind:
            raise GateError(
                f"Lark Suite actor {actor_id!r} with kind {kind!r} is required"
            )
        return actor

    def resource(self, resource_id: str) -> str:
        try:
            reference = self.resources[resource_id]
        except KeyError as error:
            raise GateError(
                f"Lark Suite resource {resource_id!r} is required"
            ) from error
        return resolve_env_ref(reference, f"resources.{resource_id}")

    def capability_token(self, capability_id: str) -> str:
        capability = self.capabilities[capability_id]
        if not capability.token_ref:
            return ""
        return resolve_env_ref(
            capability.token_ref,
            f"capabilities.{capability_id}.tokenRef",
        )

    def evidence_projection(self) -> dict[str, Any]:
        return {
            "artifactKind": MANIFEST_KIND,
            "schemaVersion": MANIFEST_VERSION,
            "suiteRuntimeId": self.suite_runtime_id,
            "fixtureEpoch": self.fixture_epoch,
            "source": {
                "worktree": str(self.source.worktree),
                "commit": self.source.commit,
                "workspaceDigest": self.source.workspace_digest,
                "protocolDigest": self.source.protocol_digest,
            },
            "services": {
                service_id: {
                    "kind": service.kind,
                    "liveCommit": service.live_commit,
                    "workspaceDigest": service.workspace_digest,
                    "protocolDigest": service.protocol_digest,
                    "runtimeIdentity": service.runtime_identity,
                }
                for service_id, service in sorted(self.services.items())
            },
            "actors": {
                actor_id: {"kind": actor.kind}
                for actor_id, actor in sorted(self.actors.items())
            },
            "resources": sorted(self.resources),
            "capabilities": sorted(self.capabilities),
            "cleanup": dict(self.cleanup),
        }
