#!/usr/bin/env python3
"""Own Secure Content platform runtimes and their immutable manifests."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, Sequence

from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.core.provisioning import EnvironmentContract
from tooling.acceptance.core.launch_context import (
    EphemeralGateClient,
    EphemeralGateLaunchContext,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.redaction import redact_text, redact_text_with_values
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.fixtures.secure_content_w7 import (
    W7FixtureBinding,
    W7FixtureOwner,
    canonical_digest as fixture_identity_digest,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
    FoundationClientSpec,
    FoundationRuntimeClient,
    harness_ready,
    wait_until,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    open_reviewed_remote_tunnel,
    resolve_remote_source_identity,
)
from tooling.acceptance.provisioners.mobile_simulator import (
    MobileSimulatorRuntimeManifest,
    SelectedMobileSimulatorProvisioner,
)
from tooling.acceptance.provisioners.secure_content_remote_recipient import (
    REMOTE_RECIPIENT_CAPABILITY as W8_REMOTE_RECIPIENT_CAPABILITY,
    REMOTE_RECIPIENT_OPERATION as W8_REMOTE_RECIPIENT_OPERATION,
    REMOTE_RECIPIENT_OWNER as W8_REMOTE_RECIPIENT_OWNER,
    RemotePrivateRecipientProvisioner,
    W8RemoteRecipientFixtureOwner,
)
from tooling.acceptance.transports.ssh import SshTunnel
from tooling.development.secure_content import runtime_manifest, schema_activation
from tooling.development.secure_content.activation_transport import (
    ActivationTransportError,
    ReviewedSchemaActivationTransport,
)
from tooling.development.secure_content.attached_client import (
    write_attached_runtime_manifest,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioDefinition,
    ScenarioBlocked,
    discover_scenarios,
    execute_scenario,
)
from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    resolve_runtime_source_identity,
)
from tooling.development.secure_content.platform_runtime import (
    PlatformRuntimeCommand,
    PlatformRuntimeContract,
    load_platform_runtime_contract,
)
from tooling.development.secure_content.mobile_fixture import (
    MobileProductionFixture,
)
from tooling.development.secure_content.runtime_fixture import (
    RuntimeFixtureBinding,
    RuntimeFixtureOwner,
)
from tooling.development.secure_content.scenarios.desktop_pilot import (
    PNG_BYTES as W7_PNG_BYTES,
    PRIVATE_TEXT as W7_PRIVATE_TEXT,
    PUBLIC_TEXT as W7_PUBLIC_TEXT,
)


OWNER_ID = runtime_manifest.RUNTIME_OWNER_ID
PROFILE = "four"
SLOT = 5
SOCIAL_ACCEPTANCE_SLOT = 12
SOCIAL_CROSS_STATION_SLOT = 13
STATION_ID = "station-four"
SECONDARY_PROFILE = "fiveArm"
SECONDARY_STATION_ID = "station-five-arm"
DESKTOP_JOURNEY = "sc-dj-desktop-pilot"
BROWSER_JOURNEY = "sc-dj-browser-private-boundary"
WORK_ITEM_ID = "secure-content-w7"
PLAN_ID = "SECURE-CONTENT-HARD-CUT-20260913"
TASK_ID = "W7"
W8_WORK_ITEM_ID = "secure-content-w8"
W8_TASK_ID = "W8"
W8_JOURNEY = "sc-dj-social-expansion"
SOCIAL_ACCEPTANCE_PLAN_ID = "SOCIAL-DESKTOP-ACCEPTANCE-20261002"
SOCIAL_ACCEPTANCE_TASK_IDS = frozenset(
    {"SDA-02-desktop-proof", "SDA-03-formal-proof"}
)
SOCIAL_ACCEPTANCE_JOURNEY = "SOC-SEC-J01-J09"
SOCIAL_CROSS_STATION_PLAN_ID = "CROSS-STATION-SOCIAL-NATIVE-20261003"
SOCIAL_CROSS_STATION_TASK_ID = "CSS-09-final-proof"
SOCIAL_CROSS_STATION_JOURNEY = "SOC-SEC-J10-J12"
SOCIAL_CROSS_STATION_RESULT_KIND = "social-cross-station-suite-result"
SOCIAL_CROSS_STATION_RUNTIME_MANIFEST_KIND = (
    "social-cross-station-suite-runtime-manifest"
)
SOCIAL_ACCEPTANCE_IDS = (
    "SOC-SEC-AS01",
    "SOC-SEC-AS02",
    "SOC-SEC-AS03",
    "SOC-SEC-AS04",
    "SOC-SEC-AS05",
    "SOC-SEC-AS06",
    "SOC-SEC-AS07",
    "SOC-SEC-AS08",
    "SOC-SEC-AS09",
    "SOC-SEC-AS10",
    "SOC-SEC-AS13",
    "SOC-SEC-AS15",
    "SOC-SEC-AS16",
)
SOCIAL_ACCEPTANCE_HISTORICAL_IDS = ("SOC-SEC-AS12",)
SOCIAL_ACCEPTANCE_RUNTIME_SCENARIOS = (
    "desktop-pre-restart",
    "desktop-continuity",
    "private-comment",
    "social-expansion",
    "social-subtype",
    "social-object",
    "social-delete-block",
    "social-bounds",
)
W8_REMOTE_CLIENT = (
    "secure-content-desktop-remote-recipient",
    "remote_recipient",
    "remote_recipient",
)
W8_REMOTE_SEEDED_ACCOUNT = "alice@p.t"
W8_REMOTE_IDENTITY_SCOPE = "social-desktop-remote-recipient-alice"
W8_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w8-functional",
        "scenarioIds": [
            "private-comment",
            "social-expansion",
            "social-subtype",
            "social-object",
            "social-delete-block",
            "social-bounds",
        ],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 4,
        "minWarmReuseRate": 0.8,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)
SOCIAL_ACCEPTANCE_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "social-private-desktop-functional",
        "scenarioIds": list(SOCIAL_ACCEPTANCE_RUNTIME_SCENARIOS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 5,
        "minWarmReuseRate": 0.85,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
SOCIAL_CROSS_STATION_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "focused-social-suite",
        "scenarioIds": [
            "AS17",
            "AS18",
            "AS19",
            "AS20",
            "AS21",
            "AS22",
            "AS23",
            "AS24",
            "same-station-regression",
        ],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 3,
        "minWarmReuseRate": 0.8,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
SOCIAL_CROSS_STATION_CLIENT_BINDINGS = (
    ("cross-station-social-alice", "alice", PROFILE, STATION_ID),
    (
        "cross-station-social-bob",
        "bob",
        SECONDARY_PROFILE,
        SECONDARY_STATION_ID,
    ),
    (
        "cross-station-social-eve",
        "eve",
        SECONDARY_PROFILE,
        SECONDARY_STATION_ID,
    ),
    (
        "cross-station-social-bob2",
        "bob",
        SECONDARY_PROFILE,
        SECONDARY_STATION_ID,
    ),
)
PRIVATE_PUBLISH_RECONCILING_STATES = frozenset(
    {
        "UNKNOWN_COMMIT",
        "REMOTE_DELIVERY_PENDING",
        "REMOTE_DELIVERY_RETRYING",
    }
)
SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS = (
    "cross-station-social-alice",
    "cross-station-social-bob",
    "cross-station-social-bob2",
)
SOCIAL_CROSS_STATION_FIXTURE_ONLY_CLIENT_IDS = (
    "cross-station-social-eve",
)
W9_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w9-functional",
        "scenarioIds": ["ios", "android", "cross-platform"],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 6,
        "minWarmReuseRate": 0.66,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)
W7_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w7-functional",
        "scenarioIds": ["desktop-pre-restart", "desktop-continuity"],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 4,
        "minWarmReuseRate": 0.5,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
W2_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w2-functional",
        "scenarioIds": ["desktop", "ios", "android"],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 8,
        "minWarmReuseRate": 0.66,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
W10_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w10-functional",
        "scenarioIds": ["desktop", "ios", "android"],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 8,
        "minWarmReuseRate": 0.66,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
W11_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w11-functional",
        "scenarioIds": [
            "desktop",
            "browser",
            "ios",
            "android",
            "chat-desktop",
            "chat-ios",
            "chat-android",
        ],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 15,
        "minWarmReuseRate": 0.85,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
W12_RUNTIME_REUSE = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "w12-functional",
        "scenarioIds": [
            "desktop",
            "browser",
            "ios",
            "android",
            "chat-desktop",
            "chat-ios",
            "chat-android",
        ],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 15,
        "minWarmReuseRate": 0.85,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": True,
    }
)
TASK_SUITE_CONTRACTS = {
    "W7": W7_RUNTIME_REUSE,
}


@dataclass(frozen=True)
class _TaskSuiteScenario:
    scenario_id: str
    leaf_action: str


@dataclass(frozen=True)
class _TaskSuiteDefinition:
    action: str
    task_id: str
    primary_journey_id: str
    profiles: tuple[str, ...]
    runtime_reuse: RuntimeReuseContract
    scenarios: tuple[_TaskSuiteScenario, ...]
    desktop_client_aliases: Mapping[str, str]
    required_mobile_bob_services: frozenset[str]


TASK_SUITE_DEFINITIONS = {
    "run-w9-suite": _TaskSuiteDefinition(
        action="run-w9-suite",
        task_id="W9",
        primary_journey_id="sc-dj-mobile-matrix",
        profiles=(PROFILE,),
        runtime_reuse=W9_RUNTIME_REUSE,
        scenarios=(
            _TaskSuiteScenario("ios", "run-w9-ios"),
            _TaskSuiteScenario("android", "run-w9-android"),
            _TaskSuiteScenario("cross-platform", "run-w9-cross-platform"),
        ),
        desktop_client_aliases={},
        required_mobile_bob_services=frozenset({STATION_ID}),
    ),
    "run-w2-suite": _TaskSuiteDefinition(
        action="run-w2-suite",
        task_id="W2",
        primary_journey_id="sc-dj-chat-attachment-atomic",
        profiles=(PROFILE, SECONDARY_PROFILE),
        runtime_reuse=W2_RUNTIME_REUSE,
        scenarios=(
            _TaskSuiteScenario("desktop", "run-w2-desktop"),
            _TaskSuiteScenario("ios", "run-w2-ios"),
            _TaskSuiteScenario("android", "run-w2-android"),
        ),
        desktop_client_aliases={},
        required_mobile_bob_services=frozenset({SECONDARY_STATION_ID}),
    ),
    "run-w10-suite": _TaskSuiteDefinition(
        action="run-w10-suite",
        task_id="W10",
        primary_journey_id="sc-dj-chat-revalidation",
        profiles=(PROFILE, SECONDARY_PROFILE),
        runtime_reuse=W10_RUNTIME_REUSE,
        scenarios=(
            _TaskSuiteScenario("desktop", "run-w10-desktop"),
            _TaskSuiteScenario("ios", "run-w10-ios"),
            _TaskSuiteScenario("android", "run-w10-android"),
        ),
        desktop_client_aliases={},
        required_mobile_bob_services=frozenset({SECONDARY_STATION_ID}),
    ),
    "run-w11-suite": _TaskSuiteDefinition(
        action="run-w11-suite",
        task_id="W11",
        primary_journey_id="sc-dj-hardcut-regression",
        profiles=(PROFILE, SECONDARY_PROFILE),
        runtime_reuse=W11_RUNTIME_REUSE,
        scenarios=(
            _TaskSuiteScenario("desktop", "run-w11-desktop"),
            _TaskSuiteScenario("browser", "run-w11-browser"),
            _TaskSuiteScenario("ios", "run-w11-ios"),
            _TaskSuiteScenario("android", "run-w11-android"),
            _TaskSuiteScenario("chat-desktop", "run-w11-chat-desktop"),
            _TaskSuiteScenario("chat-ios", "run-w11-chat-ios"),
            _TaskSuiteScenario("chat-android", "run-w11-chat-android"),
        ),
        desktop_client_aliases={
            "four-alice": "secure-content-hardcut-four-alice",
            "four-bob": "secure-content-hardcut-four-bob",
        },
        required_mobile_bob_services=frozenset(
            {STATION_ID, SECONDARY_STATION_ID}
        ),
    ),
    "run-final-suite": _TaskSuiteDefinition(
        action="run-final-suite",
        task_id="W12",
        primary_journey_id="sc-dj-authorized-reset",
        profiles=(PROFILE, SECONDARY_PROFILE),
        runtime_reuse=W12_RUNTIME_REUSE,
        scenarios=(
            _TaskSuiteScenario("desktop", "run-final-desktop"),
            _TaskSuiteScenario("browser", "run-final-browser"),
            _TaskSuiteScenario("ios", "run-final-ios"),
            _TaskSuiteScenario("android", "run-final-android"),
            _TaskSuiteScenario("chat-desktop", "run-final-chat-desktop"),
            _TaskSuiteScenario("chat-ios", "run-final-chat-ios"),
            _TaskSuiteScenario("chat-android", "run-final-chat-android"),
        ),
        desktop_client_aliases={
            "four-alice": "secure-content-desktop-alice",
            "four-bob": "secure-content-desktop-bob",
        },
        required_mobile_bob_services=frozenset(
            {STATION_ID, SECONDARY_STATION_ID}
        ),
    ),
}


def _suite_physical_clients(
    suite: _TaskSuiteDefinition,
    contract: PlatformRuntimeContract,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    desktop: dict[str, None] = {}
    mobile: dict[str, None] = {}
    for scenario in suite.scenarios:
        command = contract.command(scenario.leaf_action)
        if command.task_id != suite.task_id:
            raise RuntimeOwnerBlocked(
                "SUITE_RUNTIME_CONTRACT_INVALID",
                (
                    f"{scenario.leaf_action} belongs to {command.task_id}, "
                    f"not {suite.task_id}"
                ),
                resource=f"runtime:{suite.action}",
            )
        target = mobile if command.runtime == "mobile" else desktop
        for client_id in command.clients:
            physical_id = (
                client_id
                if command.runtime == "mobile"
                else suite.desktop_client_aliases.get(client_id, client_id)
            )
            target.setdefault(physical_id, None)
    return tuple(desktop), tuple(mobile)


def _suite_mobile_service_bindings(
    suite: _TaskSuiteDefinition,
    contract: PlatformRuntimeContract,
) -> dict[str, str]:
    bindings: dict[str, str] = {}
    for scenario in suite.scenarios:
        command = contract.command(scenario.leaf_action)
        if command.runtime != "mobile":
            continue
        for client_id in command.clients:
            service_id = _mobile_service_for_client(
                client_id,
                command.profiles,
            )
            previous = bindings.setdefault(client_id, service_id)
            if previous != service_id:
                raise RuntimeOwnerBlocked(
                    "SUITE_RUNTIME_CONTRACT_INVALID",
                    (
                        f"Mobile client {client_id!r} has conflicting "
                        "Station bindings"
                    ),
                    resource=f"runtime:{suite.action}",
                )
    observed_bob_services = frozenset(
        service_id
        for client_id, service_id in bindings.items()
        if _mobile_actor_role(client_id) == "bob"
    )
    if observed_bob_services != suite.required_mobile_bob_services:
        raise RuntimeOwnerBlocked(
            "SUITE_RUNTIME_CONTRACT_INVALID",
            (
                f"{suite.action} requires Mobile Bob bindings "
                f"{sorted(suite.required_mobile_bob_services)}, found "
                f"{sorted(observed_bob_services)}"
            ),
            resource=f"runtime:{suite.action}",
        )
    return bindings
_BIP39_ENGLISH_WORDLIST = Path(__file__).with_name("bip39_english.txt")
_BIP39_ENGLISH_WORDLIST_SHA256 = (
    "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"
)
_BIP39_ENTROPY_BYTES = 32
_BIP39_CHECKSUM_BITS = 8


@dataclass(frozen=True)
class _StationEndpoint:
    transport_url: str
    canonical_origin: str


class _RefreshableStationTunnel:
    def __init__(
        self,
        *,
        service_id: str,
        deployment_environment: str,
        remote_host: str,
        remote_port: int,
        tunnel: SshTunnel,
    ) -> None:
        self.service_id = service_id
        self.deployment_environment = deployment_environment
        self.remote_host = remote_host
        self.remote_port = remote_port
        self._tunnel = tunnel

    @property
    def local_port(self) -> int:
        return self._tunnel.local_port

    def is_alive(self) -> bool:
        return self._tunnel.is_alive()

    def stop(self) -> None:
        self._tunnel.stop()

    def refresh(self) -> None:
        local_port = self.local_port
        _stop_station_tunnel_or_raise(
            self._tunnel,
            service_id=self.service_id,
        )
        try:
            self._tunnel = open_reviewed_remote_tunnel(
                self.deployment_environment,
                remote_host=self.remote_host,
                remote_port=self.remote_port,
                local_port=local_port,
            )
        except BlockedError as error:
            raise RuntimeOwnerBlocked(
                "SERVICE_TRANSPORT_UNAVAILABLE",
                (
                    f"cannot refresh Station tunnel for {self.service_id}: "
                    f"{error.reason}"
                ),
                resource=error.resource,
            ) from error


class _StationEndpoints(dict[str, _StationEndpoint]):
    def __init__(
        self,
        endpoints: Mapping[str, _StationEndpoint],
        tunnels: Mapping[str, _RefreshableStationTunnel],
    ) -> None:
        super().__init__(endpoints)
        self._tunnels = dict(tunnels)

    def refresh(self) -> None:
        for tunnel in self._tunnels.values():
            tunnel.refresh()


@dataclass
class _PreparedDesktopSuiteResources:
    clients: dict[str, FoundationRuntimeClient]
    snapshots: dict[str, Mapping[str, Any]]
    logical_to_physical: dict[str, str]
    service_by_physical: dict[str, str]
    fixture: "_DesktopProductionFixture"

    def sessions_for(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, FoundationRuntimeClient]:
        return {
            client_id: self.clients[self.logical_to_physical[client_id]]
            for client_id in command.clients
        }

    def payloads_for(
        self,
        command: PlatformRuntimeCommand,
    ) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        for client_id in command.clients:
            physical_id = self.logical_to_physical[client_id]
            payloads.append(
                _client_payload(
                    client_id,
                    _desktop_actor_role(client_id),
                    self.clients[physical_id],
                    self.snapshots[physical_id],
                    service_roles={
                        "station": self.service_by_physical[physical_id],
                    },
                )
            )
        return payloads


@dataclass
class _PreparedMobileSuiteResources:
    sessions: dict[str, Any]
    payloads: dict[str, dict[str, Any]]
    fixture: MobileProductionFixture

    def sessions_for(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        return {
            client_id: self.sessions[client_id]
            for client_id in command.clients
        }

    def payloads_for(
        self,
        command: PlatformRuntimeCommand,
    ) -> list[dict[str, Any]]:
        return [self.payloads[client_id] for client_id in command.clients]


@dataclass(frozen=True)
class _PreparedSuiteScenario:
    scenario_id: str
    command: PlatformRuntimeCommand
    manifest_path: Path
    fixture_context: EphemeralGateLaunchContext
    fixture_client: EphemeralGateClient


@dataclass(frozen=True)
class _W8ScenarioSpec:
    scenario_id: str
    variant_id: str
    requires_remote_recipient: bool
    receiver_client_id: str
    action_text: str
    visible_text: str
    click_content: bool = False
    open_comments: bool = False
    absent_texts: tuple[str, ...] = ()
    invalidated_fixture_ids: tuple[str, ...] = ()


DESKTOP_CLIENTS = (
    ("secure-content-desktop-alice", "alice", "alice"),
    ("secure-content-desktop-bob", "bob", "bob"),
    ("secure-content-desktop-eve", "eve", "eve"),
)
W8_SCENARIOS = (
    _W8ScenarioSpec(
        scenario_id="private-comment",
        variant_id="comment",
        requires_remote_recipient=False,
        receiver_client_id=DESKTOP_CLIENTS[0][0],
        action_text="secure-content-w8-private-comment-parent",
        visible_text="secure-content-w8-private-comment-body",
        click_content=True,
        open_comments=True,
    ),
    _W8ScenarioSpec(
        scenario_id="social-expansion",
        variant_id="audience",
        requires_remote_recipient=True,
        receiver_client_id=DESKTOP_CLIENTS[1][0],
        action_text="secure-content-w8-audience-friends",
        visible_text="secure-content-w8-audience-friends",
    ),
    _W8ScenarioSpec(
        scenario_id="social-subtype",
        variant_id="subtype",
        requires_remote_recipient=False,
        receiver_client_id=DESKTOP_CLIENTS[1][0],
        action_text="secure-content-w8-subtype-text",
        visible_text="secure-content-w8-subtype-text",
    ),
    _W8ScenarioSpec(
        scenario_id="social-object",
        variant_id="object",
        requires_remote_recipient=False,
        receiver_client_id=DESKTOP_CLIENTS[1][0],
        action_text="secure-content-w8-object-image",
        visible_text="secure-content-w8-object-image",
    ),
    _W8ScenarioSpec(
        scenario_id="social-delete-block",
        variant_id="delete-block",
        requires_remote_recipient=False,
        receiver_client_id=DESKTOP_CLIENTS[1][0],
        action_text="secure-content-w8-audience-friends",
        visible_text="secure-content-w8-audience-friends",
        absent_texts=(
            "secure-content-w8-delete-private-image",
            "secure-content-w8-block-private-text",
        ),
        invalidated_fixture_ids=("local-mutual-friendship",),
    ),
    _W8ScenarioSpec(
        scenario_id="social-bounds",
        variant_id="bounds",
        requires_remote_recipient=False,
        receiver_client_id=DESKTOP_CLIENTS[1][0],
        action_text="secure-content-w8-bounds-poll",
        visible_text="secure-content-w8-bounds-poll",
    ),
)

SOCIAL_ACCEPTANCE_SCENARIO_MAP = {
    "private-comment": ("SOC-SEC-AS06", "SOC-SEC-AS16"),
    "social-expansion": ("SOC-SEC-AS05", "SOC-SEC-AS13"),
    "social-subtype": ("SOC-SEC-AS01",),
    "social-object": ("SOC-SEC-AS07",),
    "social-delete-block": ("SOC-SEC-AS09",),
    "social-bounds": ("SOC-SEC-AS15",),
}


def _social_acceptance_scenario_registry(
    scenario_id: str,
    *,
    work_item_id: str,
    task_id: str,
) -> Mapping[str, ScenarioDefinition]:
    scenario = discover_scenarios()[scenario_id]
    return {
        scenario_id: replace(
            scenario,
            journey_id=SOCIAL_ACCEPTANCE_JOURNEY,
            work_item_id=work_item_id,
            result_prefix=Path(task_id),
            result_task_id=task_id,
            result_workstream_id=task_id,
        )
    }
REQUIRED_FIXTURE_CAPABILITIES = frozenset(
    {
        "account-switch",
        "station-switch",
        "publisher-device-revocation",
        "historical-recovery-epoch",
    }
)


def _error_message_with_cleanup(error: BaseException) -> str:
    message = str(error)
    cleanup_failures = tuple(
        getattr(error, "secondary_cleanup_failures", ())
    )
    if cleanup_failures:
        return f"{message}; {'; '.join(cleanup_failures)}"
    return message


class RuntimeOwnerBlocked(RuntimeError):
    def __init__(self, code: str, message: str, *, resource: str) -> None:
        super().__init__(message)
        self.code = code
        self.resource = resource

    def payload(self) -> dict[str, Any]:
        return {
            "status": "BLOCKED",
            "proofState": "UNPROVEN",
            "code": self.code,
            "owner": OWNER_ID,
            "resource": self.resource,
            "message": _error_message_with_cleanup(self),
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00",
        "Z",
    )


@contextmanager
def _environment(values: Mapping[str, str]) -> Iterator[None]:
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _json_bytes(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        dict(value),
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _proto_varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("protobuf varint must be non-negative")
    encoded = bytearray()
    while value > 0x7F:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def _proto_bytes(field_number: int, value: bytes | str) -> bytes:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return (
        _proto_varint((field_number << 3) | 2)
        + _proto_varint(len(payload))
        + payload
    )


def _proto_uint(field_number: int, value: int) -> bytes:
    return _proto_varint(field_number << 3) + _proto_varint(value)


def _read_proto_varint(payload: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(payload) and shift < 70:
        byte = payload[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            return value, offset
        shift += 7
    raise ValueError("malformed protobuf varint")


def _proto_fields(payload: bytes) -> Iterator[tuple[int, int, int | bytes]]:
    offset = 0
    while offset < len(payload):
        key, offset = _read_proto_varint(payload, offset)
        field_number = key >> 3
        wire_type = key & 0x07
        if field_number == 0:
            raise ValueError("protobuf field number must be positive")
        if wire_type == 0:
            value, offset = _read_proto_varint(payload, offset)
            yield field_number, wire_type, value
            continue
        if wire_type == 1:
            end = offset + 8
        elif wire_type == 2:
            length, offset = _read_proto_varint(payload, offset)
            end = offset + length
        elif wire_type == 5:
            end = offset + 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire_type}")
        if end > len(payload):
            raise ValueError("truncated protobuf field")
        yield field_number, wire_type, payload[offset:end]
        offset = end


def _proto_first_bytes(payload: bytes, field_number: int) -> bytes:
    for candidate, wire_type, value in _proto_fields(payload):
        if candidate == field_number and wire_type == 2:
            assert isinstance(value, bytes)
            return value
    raise ValueError(f"protobuf field {field_number} is missing")


def _decode_peers_payload(payload: bytes) -> bytes:
    any_message = _proto_first_bytes(payload, 3)
    return _proto_first_bytes(any_message, 2)


def _decode_access_login_gate(payload: bytes) -> dict[str, str | int]:
    decision = _proto_first_bytes(_decode_peers_payload(payload), 1)
    attempt_id = _proto_first_bytes(decision, 2).decode("utf-8")
    current_gate_id = _proto_first_bytes(decision, 3).decode("utf-8")
    for field_number, wire_type, value in _proto_fields(decision):
        if field_number != 4 or wire_type != 2:
            continue
        assert isinstance(value, bytes)
        gate_id = _proto_first_bytes(value, 1).decode("utf-8")
        if gate_id != current_gate_id:
            continue
        fields = list(_proto_fields(value))
        scalar = {
            field: candidate
            for field, candidate_wire, candidate in fields
            if candidate_wire == 0
        }
        text = {
            field: candidate.decode("utf-8")
            for field, candidate_wire, candidate in fields
            if candidate_wire == 2 and isinstance(candidate, bytes)
        }
        if scalar.get(2) != 2:
            raise ValueError("current access gate is not AUTH_LOGIN")
        return {
            "attempt_id": attempt_id,
            "gate_id": gate_id,
            "action_id": text.get(10, ""),
            "schema_revision": int(scalar.get(11, 0)),
            "schema_digest": text.get(12, ""),
        }
    raise ValueError("current access gate is missing")


def _decode_access_login(payload: bytes) -> tuple[str, str]:
    response = _decode_peers_payload(payload)
    login = _proto_first_bytes(response, 2)
    tokens = _proto_first_bytes(login, 1)
    actor_ref = _proto_first_bytes(login, 4)
    token = _proto_first_bytes(tokens, 2).decode("utf-8")
    actor_ptid = _proto_first_bytes(actor_ref, 2).decode("utf-8")
    return token, actor_ptid


def _station_proto_post(url: str, payload: bytes) -> bytes:
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Accept": "application/protobuf",
            "Content-Type": "application/protobuf",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner could not resolve {field}",
            resource=f"fixture:{field}",
        )
    return value.strip()


def _required_integer(value: Any, field: str) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 1
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner could not resolve {field}",
            resource=f"fixture:{field}",
        )
    return value


def _fixture_harness(
    client: FoundationRuntimeClient,
    method: str,
    payload: Mapping[str, Any] | None = None,
    *,
    timeout: float = 120,
) -> Mapping[str, Any]:
    previous = client.harness_namespace
    client.harness_namespace = "secure-content-fixture"
    try:
        result = client.harness(method, dict(payload or {}), timeout=timeout)
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner action {method!r} failed: {error}",
            resource=f"fixture-action:{method}",
        ) from error
    finally:
        client.harness_namespace = previous
    if not isinstance(result, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner action {method!r} returned invalid data",
            resource=f"fixture-action:{method}",
        )
    return result


def _moments_harness(
    client: FoundationRuntimeClient,
    method: str,
    payload: Mapping[str, Any] | None = None,
    *,
    timeout: float = 120,
) -> Mapping[str, Any]:
    previous = client.harness_namespace
    client.harness_namespace = "moments"
    try:
        result = client.harness(method, dict(payload or {}), timeout=timeout)
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 Moments fixture action {method!r} failed: {error}",
            resource=f"fixture-action:{method}",
        ) from error
    finally:
        client.harness_namespace = previous
    if not isinstance(result, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 Moments fixture action {method!r} returned invalid data",
            resource=f"fixture-action:{method}",
        )
    return result


_NATIVE_APP_ERROR_CODES = frozenset(
    {
        "NOT_IMPLEMENTED",
        "INVALID_ARGUMENT",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "NOT_FOUND",
        "CONFLICT",
        "AGENT_CANVAS_SINGLE_AGENT_NOT_READY",
        "INTERNAL_ERROR",
    }
)


def _privacy_safe_native_app_error(app_result: object) -> str:
    if not isinstance(app_result, Mapping):
        return "UNKNOWN"
    error = app_result.get("error")
    if not isinstance(error, Mapping):
        return "UNKNOWN"
    code = error.get("code")
    safe_code = code if code in _NATIVE_APP_ERROR_CODES else "UNKNOWN"
    message = error.get("message")
    if not isinstance(message, str):
        return safe_code
    safe_message = re.sub(r"https?://\S+", "<url>", message)
    safe_message = re.sub(r"ptid:[^\s,;]+", "<ptid>", safe_message)
    safe_message = re.sub(
        r"(?<!\w)(?:/[A-Za-z0-9._-]+){2,}",
        "<path>",
        safe_message,
    )
    safe_message = re.sub(
        r"\b(?:[A-Fa-f0-9]{24,}|[A-Za-z0-9_-]{32,})\b",
        "<opaque>",
        safe_message,
    )
    safe_message = " ".join(safe_message.split())[:240]
    return f"{safe_code}: {safe_message}" if safe_message else safe_code


def _native_invoke_json(
    client: FoundationRuntimeClient,
    command: str,
    payload: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    result = client.driver.execute_async_script(
        """
        const command = arguments[0];
        const payload = arguments[1];
        const done = arguments[arguments.length - 1];
        const internals = window.__TAURI_INTERNALS__;
        if (!internals || typeof internals.invoke !== 'function') {
          done({ ok: false, error: 'native invoke unavailable' });
          return;
        }
        Promise.resolve(internals.invoke(command, payload))
          .then((value) => done({ ok: true, value }))
          .catch((error) => done({
            ok: false,
            error: String(error && error.message ? error.message : error),
          }));
        """,
        command,
        dict(payload or {}),
    )
    if not isinstance(result, Mapping) or result.get("ok") is not True:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"Native command {command!r} failed",
            resource=f"fixture-action:{command}",
        )
    app_result = result.get("value")
    if (
        not isinstance(app_result, Mapping)
        or app_result.get("ok") is not True
        or not isinstance(app_result.get("data"), Mapping)
    ):
        error_summary = _privacy_safe_native_app_error(app_result)
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            (
                f"Native command {command!r} returned a failed AppResult "
                f"({error_summary})"
            ),
            resource=f"fixture-action:{command}",
        )
    status = app_result["data"].get("status")
    try:
        decoded = json.loads(status)
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"Native command {command!r} returned invalid status JSON",
            resource=f"fixture-action:{command}",
        ) from error
    if not isinstance(decoded, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"Native command {command!r} status must be an object",
            resource=f"fixture-action:{command}",
        )
    return decoded


def _maintain_current_recovery_prekeys(
    client: FoundationRuntimeClient,
    *,
    expected_recovery_epoch: int,
) -> Mapping[str, Any]:
    # Renderer generation is frontend-owned. Resolve it from the live store
    # before invoking the build-gated Native fixture command.
    result = client.driver.execute_async_script(
        """
        const command = arguments[0];
        const done = arguments[arguments.length - 1];
        Promise.resolve(import('/src/store/privateMoments.ts'))
          .then(async ({ usePrivateMomentsStore }) => {
            const scope = usePrivateMomentsStore.getState().scope;
            if (
              !scope
              || typeof scope.actorPtid !== 'string'
              || !scope.actorPtid
              || !Number.isSafeInteger(scope.rendererGeneration)
              || scope.rendererGeneration < 1
            ) {
              throw new Error('current private Moment scope is unavailable');
            }
            const value = await window.__TAURI_INTERNALS__.invoke(command, {
              input: {
                actor_ptid: scope.actorPtid,
                renderer_generation: scope.rendererGeneration,
              },
            });
            done({ ok: true, value });
          })
          .catch((error) => done({
            ok: false,
            error: String(error && error.message ? error.message : error),
          }));
        """,
        "social_private_moments_acceptance_maintain_prekeys",
    )
    if not isinstance(result, Mapping) or result.get("ok") is not True:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Native portable recovery PreKey maintenance failed",
            resource=f"fixture-recovery:{client.spec.profile}",
        )
    app_result = result.get("value")
    if (
        not isinstance(app_result, Mapping)
        or app_result.get("ok") is not True
        or not isinstance(app_result.get("data"), Mapping)
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            (
                "Native portable recovery PreKey maintenance returned "
                "a failed AppResult"
            ),
            resource=f"fixture-recovery:{client.spec.profile}",
        )
    decoded = app_result["data"]
    available = decoded.get("recoveryPreKeyAvailable")
    if (
        decoded.get("recoveryEpoch") != expected_recovery_epoch
        or not isinstance(available, int)
        or isinstance(available, bool)
        or available < 1
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Native portable recovery PreKey pool is unavailable",
            resource=f"fixture-recovery:{client.spec.profile}",
        )
    return decoded


def _prepare_portable_recovery(
    client: FoundationRuntimeClient,
) -> tuple[str, Mapping[str, Any]]:
    generated = _native_invoke_json(
        client,
        "messaging_recovery_generate_phrase",
    )
    words = generated.get("words")
    if (
        not isinstance(words, list)
        or len(words) != 24
        or any(not isinstance(word, str) or not word for word in words)
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Native recovery phrase generation did not return 24 words",
            resource=f"fixture-recovery:{client.spec.profile}",
        )
    recovery_phrase = " ".join(words)
    revision = _native_invoke_json(
        client,
        "messaging_recovery_create_revision",
        {"input": {"recoveryPhrase": recovery_phrase}},
    )
    recovery_epoch = _required_integer(
        revision.get("recoveryEpoch"),
        "portable-recovery-epoch",
    )
    prekeys = _maintain_current_recovery_prekeys(
        client,
        expected_recovery_epoch=recovery_epoch,
    )
    return recovery_phrase, {
        "preparedEpoch": recovery_epoch,
        "recoveryPreKeyAvailable": prekeys["recoveryPreKeyAvailable"],
        "backupIdSha256": _sha256(
            _required_text(
                revision.get("backup", {}).get("backupId")
                if isinstance(revision.get("backup"), Mapping)
                else None,
                "portable-recovery-backup",
            )
        ),
    }


def _restore_portable_recovery(
    client: FoundationRuntimeClient,
    recovery_phrase: str,
) -> Mapping[str, Any]:
    restored = _native_invoke_json(
        client,
        "messaging_recovery_restore_latest",
        {"recoveryPhrase": recovery_phrase},
    )
    return {
        "recoveryEpoch": _required_integer(
            restored.get("recoveryEpoch"),
            "restored-recovery-epoch",
        ),
        "deviceIdSha256": _sha256(
            _required_text(
                restored.get("deviceId"),
                "restored-recovery-device",
            )
        ),
    }


def _publish_friends_moment(
    client: FoundationRuntimeClient,
    *,
    draft_id: str,
    text: str,
    file_path: Path | None = None,
) -> str:
    payload: dict[str, Any] = {
        "draftId": draft_id,
        "revision": 1,
        "text": text,
    }
    if file_path is not None:
        payload["files"] = [{
            "intentId": f"{draft_id}-image",
            "filePath": str(file_path),
        }]
    staged = _moments_harness(client, "stageFriendsDraft", payload)
    if staged.get("present") is not True:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Social Desktop private draft was not retained",
            resource=f"fixture-draft:{draft_id}",
        )
    for attempt in range(30):
        published = _moments_harness(client, "publishFriendsDraft")
        if (
            published.get("state")
            not in PRIVATE_PUBLISH_RECONCILING_STATES
        ):
            break
        if attempt < 29:
            time.sleep(1)
    post_id = published.get("transientPostId")
    if (
        published.get("state") != "PUBLISHED"
        or not isinstance(post_id, str)
        or not post_id
    ):
        state = str(published.get("state") or "missing")
        error_code = str(published.get("errorCode") or "missing")
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            (
                "Social Desktop private Moment did not publish "
                f"(state={state}, errorCode={error_code})"
            ),
            resource=f"fixture-draft:{draft_id}",
        )
    return post_id


def _http_get(
    url: str,
    *,
    authorization: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> tuple[int, bytes]:
    request_headers = {
        "Accept": "application/x-protobuf",
        **dict(headers or {}),
    }
    if authorization is not None:
        request_headers["Authorization"] = authorization
    request = urllib.request.Request(
        url,
        headers=request_headers,
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (OSError, TimeoutError) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Social Desktop direct HTTP probe failed",
            resource="station:station-four",
        ) from error


def _station_login(
    station_url: str,
    *,
    station_peer_id: str,
    account: str,
    password: str,
) -> tuple[str, str]:
    device_id = f"css09-eve-{secrets.token_hex(8)}"
    lifecycle_generation = 1
    client = b"".join(
        (
            _proto_bytes(1, "desktop"),
            _proto_bytes(2, "0.1.0"),
            _proto_bytes(3, device_id),
            _proto_uint(5, lifecycle_generation),
        )
    )
    start_request = b"".join(
        (
            _proto_bytes(1, station_url),
            _proto_bytes(2, client),
            _proto_bytes(4, station_peer_id),
        )
    )
    try:
        gate = _decode_access_login_gate(
            _station_proto_post(
                f"{station_url.rstrip('/')}/actor/access/start",
                start_request,
            )
        )
        login = b"".join(
            (
                _proto_bytes(1, account),
                _proto_bytes(2, password),
                _proto_bytes(3, "desktop-native"),
            )
        )
        submit_request = b"".join(
            (
                _proto_bytes(1, str(gate["attempt_id"])),
                _proto_bytes(2, str(gate["gate_id"])),
                _proto_uint(3, 2),
                _proto_bytes(4, login),
                _proto_bytes(7, str(gate["action_id"])),
                _proto_bytes(8, station_peer_id),
                _proto_bytes(9, device_id),
                _proto_uint(10, lifecycle_generation),
                _proto_uint(11, int(gate["schema_revision"])),
                _proto_bytes(12, str(gate["schema_digest"])),
                _proto_bytes(13, str(uuid.uuid4())),
            )
        )
        token, actor_ptid = _decode_access_login(
            _station_proto_post(
                f"{station_url.rstrip('/')}/actor/access/submit",
                submit_request,
            )
        )
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        OSError,
        TimeoutError,
        UnicodeDecodeError,
        ValueError,
    ) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Cross-Station Social fixture login failed",
            resource="fixture-account:eve",
        ) from error
    if (
        not isinstance(token, str)
        or not token
        or not isinstance(actor_ptid, str)
        or not actor_ptid.startswith("ptid:")
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Cross-Station Social fixture login returned no canonical identity",
            resource="fixture-account:eve",
        )
    return token, actor_ptid


def _run_social_acceptance_pre_restart(
    *,
    alice: FoundationRuntimeClient,
    bob: FoundationRuntimeClient,
    eve: FoundationRuntimeClient,
    station_url: str,
    owner_root: Path,
) -> tuple[dict[str, Any], str]:
    fixture_path = owner_root / "social-desktop-private.png"
    fixture_path.write_bytes(W7_PNG_BYTES)

    first_post_id = _publish_friends_moment(
        alice,
        draft_id="social-acceptance-private-opened",
        text=W7_PRIVATE_TEXT,
        file_path=fixture_path,
    )
    bob_read = _moments_harness(
        bob,
        "readPrivateMoment",
        {"postId": first_post_id, "openMedia": True},
    )
    media = bob_read.get("media")
    if (
        bob_read.get("state") != "CONTENT_READY"
        or bob_read.get("textSha256") != _sha256(W7_PRIVATE_TEXT)
        or not isinstance(media, list)
        or len(media) != 1
        or not isinstance(media[0], Mapping)
        or media[0].get("state") != "MEDIA_READY"
        or media[0].get("plaintextSha256") != _sha256(W7_PNG_BYTES)
    ):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Bob did not render the exact private Moment before replacement",
            resource=f"client:{DESKTOP_CLIENTS[1][0]}",
        )
    eve_read = _moments_harness(
        eve,
        "readPrivateMoment",
        {"postId": first_post_id, "openMedia": True},
    )
    if (
        eve_read.get("state") != "NOT_FOUND_OR_NOT_AUTHORIZED"
        or eve_read.get("media") != []
    ):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Eve private Moment read did not fail closed",
            resource=f"client:{DESKTOP_CLIENTS[2][0]}",
        )

    recovery_post_id = _publish_friends_moment(
        alice,
        draft_id="social-acceptance-never-opened",
        text="social-acceptance-never-opened",
    )
    public = _moments_harness(
        alice,
        "publishPublicMoment",
        {"text": W7_PUBLIC_TEXT, "filePath": str(fixture_path)},
    )
    public_post_id = _required_text(
        public.get("transientPostId"),
        "public-post-id",
    )
    private_url = (
        f"{station_url.rstrip('/')}/api/v1/social/moments/{first_post_id}"
    )
    anonymous_private_status, anonymous_private_body = _http_get(private_url)
    invalid_status, invalid_body = _http_get(
        private_url,
        authorization="Bearer invalid-secure-content-token",
    )
    public_status, public_body = _http_get(
        f"{station_url.rstrip('/')}/api/v1/social/moments/{public_post_id}"
    )
    bob_identity = _moments_harness(bob, "acceptanceActorIdentity")
    eve_identity = _moments_harness(eve, "acceptanceActorIdentity")
    private_markers = (
        W7_PRIVATE_TEXT.encode("utf-8"),
        _required_text(
            bob_identity.get("actorPtid"),
            "baseline-bob-actor",
        ).encode("utf-8"),
        _required_text(
            eve_identity.get("actorPtid"),
            "baseline-eve-actor",
        ).encode("utf-8"),
    )
    if (
        anonymous_private_status not in {403, 404}
        or invalid_status != 401
        or any(marker in anonymous_private_body for marker in private_markers)
        or any(marker in invalid_body for marker in private_markers)
        or public_status != 200
        or W7_PUBLIC_TEXT.encode("utf-8") not in public_body
    ):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Social Desktop direct HTTP authorization corpus failed",
            resource="station:station-four",
        )
    return (
        {
            "privatePostIdSha256": _sha256(first_post_id),
            "recoveryPostIdSha256": _sha256(recovery_post_id),
            "publicPostIdSha256": _sha256(public_post_id),
            "privateTextSha256": _sha256(W7_PRIVATE_TEXT),
            "privateMediaSha256": _sha256(W7_PNG_BYTES),
            "anonymousPrivateStatus": anonymous_private_status,
            "invalidCredentialStatus": invalid_status,
            "publicAnonymousStatus": public_status,
        },
        recovery_post_id,
    )


def _chat_harness(
    client: FoundationRuntimeClient,
    method: str,
    payload: Mapping[str, Any] | None = None,
    *,
    timeout: float = 120,
) -> Mapping[str, Any]:
    previous = client.harness_namespace
    client.harness_namespace = "chat"
    try:
        result = client.harness(method, dict(payload or {}), timeout=timeout)
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W8 Chat fixture action {method!r} failed: {error}",
            resource=f"fixture-action:{method}",
        ) from error
    finally:
        client.harness_namespace = previous
    if not isinstance(result, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W8 Chat fixture action {method!r} returned invalid data",
            resource=f"fixture-action:{method}",
        )
    return result


def _register_runtime_account(
    station_url: str,
    *,
    role: str,
    suffix: str,
    password: str,
) -> str:
    account = f"sc-{role.replace('_', '-')}-{suffix}@testnet.local"
    name = _runtime_account_preferred_username(role=role, suffix=suffix)
    request = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/sign-up",
        data=_json_bytes(
            {
                "email": account,
                "name": name,
                "password": password,
            }
        ),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = response.status
            response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        error.read()
    except (OSError, TimeoutError) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 runtime account provisioning failed for role {role}",
            resource=f"fixture-account:{role}",
        ) from error
    if not 200 <= status < 300:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 runtime account provisioning returned HTTP {status} for role {role}",
            resource=f"fixture-account:{role}",
        )
    return account


def _runtime_account_search_query(account: str, *, role: str) -> str:
    prefix = f"sc-{role.replace('_', '-')}-"
    local_part, separator, host = account.partition("@")
    suffix = local_part.removeprefix(prefix)
    if (
        separator != "@"
        or host != "testnet.local"
        or not local_part.startswith(prefix)
        or len(suffix) != 10
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"runtime account identity is invalid for role {role}",
            resource=f"fixture-account:{role}",
        )
    return _runtime_account_preferred_username(role=role, suffix=suffix)


def _runtime_account_preferred_username(*, role: str, suffix: str) -> str:
    return f"sc-{_sha256(f'{role}:{suffix}')[:17]}"


def _provision_runtime_accounts(
    *,
    primary_station_url: str,
    run_id: str,
    roles: Sequence[str],
    secondary_station_url: str | None = None,
    secondary_roles: Sequence[str] = (),
) -> tuple[dict[str, str], str]:
    suffix = _sha256(f"{run_id}:{secrets.token_hex(16)}")[:10]
    password = f"W7Aa1!{suffix}"
    accounts = {
        role: _register_runtime_account(
            primary_station_url,
            role=role,
            suffix=suffix,
            password=password,
        )
        for role in roles
    }
    if secondary_roles:
        if secondary_station_url is None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "W7 secondary runtime accounts require a secondary Station",
                resource="fixture-account:secondary-station",
            )
        for role in secondary_roles:
            if role not in accounts:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    f"W7 secondary runtime account role {role} is not provisioned",
                    resource=f"fixture-account:{role}",
                )
            _register_runtime_account(
                secondary_station_url,
                role=role,
                suffix=suffix,
                password=password,
            )
    return accounts, password


def _wait_for_device_enrollment(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    try:
        return wait_until(
            lambda: _fixture_harness(
                client,
                "preparePublisherDeviceRevocation",
                timeout=15,
            ),
            f"{client.spec.profile} active messaging device enrollment",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 client {client.spec.profile} did not enroll an active device",
            resource=f"fixture-device:{client.spec.profile}",
        ) from error


def _wait_for_mls_readiness(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    def ready() -> Mapping[str, Any] | None:
        result = _chat_harness(
            client,
            "mlsReadiness",
            timeout=15,
        )
        actor_ptid = result.get("actorPtid")
        device_id = result.get("deviceId")
        available = result.get("availableKeyPackages")
        if (
            isinstance(actor_ptid, str)
            and bool(actor_ptid.strip())
            and isinstance(device_id, str)
            and bool(device_id.strip())
            and result.get("active") is True
            and isinstance(available, int)
            and not isinstance(available, bool)
            and available >= 1
        ):
            return result
        return None

    try:
        return wait_until(
            ready,
            f"{client.spec.profile} active endpoint and MLS KeyPackage inventory",
            timeout=120,
            interval=1,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            (
                f"W8 client {client.spec.profile} did not publish an active "
                "MLS endpoint and KeyPackage"
            ),
            resource=f"fixture-mls:{client.spec.profile}",
        ) from error


def _prepare_remote_group_fixture(
    primary_client: FoundationRuntimeClient,
    local_member_client: FoundationRuntimeClient,
    *,
    remote_actor_ptid: str,
    federation_id: str,
) -> str:
    local_member = _moments_harness(
        local_member_client,
        "acceptanceActorIdentity",
    )
    local_member_ptid = _required_text(
        local_member.get("actorPtid"),
        "remote Group local member PTID",
    )
    created = _chat_harness(
        primary_client,
        "createGroup",
        {
            "name": "secure-content-w8-remote-group",
            "federationId": federation_id,
            "memberPtids": [local_member_ptid],
        },
    )
    group_ulid = _required_text(
        created.get("groupUlid"),
        "remote Group ULID",
    )

    def authoritative_local_group() -> Mapping[str, Any] | None:
        snapshot = _chat_harness(
            primary_client,
            "syncGroup",
            {
                "groupUlid": group_ulid,
                "limit": 50,
                "maxPages": 1,
            },
            timeout=15,
        )
        members = snapshot.get("memberPtids")
        if (
            snapshot.get("groupUlid") == group_ulid
            and isinstance(members, Sequence)
            and not isinstance(members, (str, bytes))
            and local_member_ptid in members
        ):
            return snapshot
        return None

    try:
        wait_until(
            authoritative_local_group,
            "W8 authoritative local Group creation",
            timeout=120,
            interval=1,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W8 local Group did not become authoritative",
            resource="fixture:remote-private-recipient-group",
        ) from error

    added = _chat_harness(
        primary_client,
        "inviteToGroup",
        {
            "groupUlid": group_ulid,
            "memberPtids": [remote_actor_ptid],
        },
    )
    if added.get("groupUlid") != group_ulid:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W8 remote Group membership was not accepted",
            resource="fixture:remote-private-recipient-group",
        )

    def authoritative_membership() -> Mapping[str, Any] | None:
        snapshot = _chat_harness(
            primary_client,
            "syncGroup",
            {
                "groupUlid": group_ulid,
                "limit": 50,
                "maxPages": 1,
            },
            timeout=15,
        )
        members = snapshot.get("memberPtids")
        if (
            snapshot.get("groupUlid") == group_ulid
            and isinstance(members, Sequence)
            and not isinstance(members, (str, bytes))
            and remote_actor_ptid in members
        ):
            return snapshot
        return None

    try:
        wait_until(
            authoritative_membership,
            "W8 authoritative remote Group membership",
            timeout=120,
            interval=1,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W8 remote Group membership did not become authoritative",
            resource="fixture:remote-private-recipient-group",
        ) from error
    return group_ulid


def _revoke_remote_fixture_device(
    client: FoundationRuntimeClient,
    *,
    readiness: Mapping[str, Any],
) -> Mapping[str, Any]:
    revoked = _chat_harness(client, "revokeCurrentDevice")
    if (
        revoked.get("revoked") is not True
        or revoked.get("actorPtid") != readiness.get("actorPtid")
        or revoked.get("deviceId") != readiness.get("deviceId")
    ):
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            "W8 remote recipient device revocation was not confirmed",
            resource=f"fixture-device:{client.spec.profile}",
        )
    return revoked


def _revoke_remote_fixture_device_if_pending(
    client: FoundationRuntimeClient,
    *,
    readiness: Mapping[str, Any],
    state: dict[str, bool],
) -> None:
    if state.get("complete") is True:
        return
    _revoke_remote_fixture_device(client, readiness=readiness)
    state["complete"] = True


def _prepare_private_content_keys(client: FoundationRuntimeClient) -> None:
    result = _fixture_harness(
        client,
        "prepareHistoricalRecoveryEpoch",
    )
    _required_text(
        result.get("actorPtid"),
        "private-content-prekey-actor",
    )
    _required_integer(
        result.get("recoveryPreKeyAvailable"),
        "private-content-prekey-availability",
    )


def _wait_for_accepted_friendship_projection(
    client: FoundationRuntimeClient,
    *,
    target_ptid: str,
    actor_label: str,
    timeout_seconds: float = 10.0,
    poll_seconds: float = 0.25,
) -> None:
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    last_projection: Mapping[str, Any] = {}
    while True:
        last_projection = _moments_harness(
            client,
            "friendshipProjection",
            {"actorPtid": target_ptid},
        )
        if last_projection.get("accepted") is True:
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(poll_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "FIXTURE_OWNER_UNAVAILABLE",
        (
            f"W7 {actor_label} friendship projection did not converge "
            f"(accepted={last_projection.get('accepted')!r})"
        ),
        resource="fixture-account:mutual-friendship",
    )


def _wait_for_private_moment_state(
    client: FoundationRuntimeClient,
    *,
    post_id: str,
    expected_state: str,
    actor_label: str,
    timeout_seconds: float = 30.0,
    poll_seconds: float = 0.25,
) -> Mapping[str, Any]:
    return _wait_for_private_moment_states(
        client,
        post_id=post_id,
        expected_states=(expected_state,),
        actor_label=actor_label,
        timeout_seconds=timeout_seconds,
        poll_seconds=poll_seconds,
    )


def _wait_for_private_moment_states(
    client: FoundationRuntimeClient,
    *,
    post_id: str,
    expected_states: Sequence[str],
    actor_label: str,
    timeout_seconds: float = 30.0,
    poll_seconds: float = 0.25,
) -> Mapping[str, Any]:
    accepted_states = frozenset(expected_states)
    if not accepted_states:
        raise ValueError("at least one private Moment state is required")
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    last_projection: Mapping[str, Any] = {}
    while True:
        last_projection = _moments_harness(
            client,
            "readPrivateMoment",
            {"postId": post_id},
        )
        if last_projection.get("state") in accepted_states:
            return last_projection
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(poll_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "CLIENT_RUNTIME_UNAVAILABLE",
        (
            f"{actor_label} private Moment did not reach one of "
            f"{sorted(accepted_states)} "
            f"(state={last_projection.get('state')!r}, "
            f"errorCode={last_projection.get('errorCode')!r})"
        ),
        resource=f"client:{client.spec.profile}",
    )


def _prepare_accepted_friendship(
    alice: FoundationRuntimeClient,
    bob: FoundationRuntimeClient,
) -> None:
    alice_identity = _moments_harness(alice, "acceptanceActorIdentity")
    bob_identity = _moments_harness(bob, "acceptanceActorIdentity")
    alice_ptid = _required_text(alice_identity.get("actorPtid"), "alice-actor")
    bob_ptid = _required_text(bob_identity.get("actorPtid"), "bob-actor")
    if alice_ptid == bob_ptid:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W7 Alice and Bob runtime accounts resolved the same actor",
            resource="fixture-account:mutual-friendship",
        )
    alice_authority = _moments_harness(alice, "friendshipAuthority")
    bob_authority = _moments_harness(bob, "friendshipAuthority")
    federation_id = _required_text(
        alice_authority.get("federationId"),
        "friendship-federation",
    )
    receiver_home_station = _required_text(
        bob_authority.get("homeStationPeerId"),
        "friendship-receiver-home-station",
    )
    if federation_id != _required_text(
        bob_authority.get("federationId"),
        "friendship-receiver-federation",
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W7 Alice and Bob do not share one friendship Federation",
            resource="fixture-account:mutual-friendship",
        )
    sent = _moments_harness(
        alice,
        "sendFriendRequest",
        {
            "actorPtid": bob_ptid,
            "federationId": federation_id,
            "homeStationPeerId": receiver_home_station,
        },
    )
    _required_text(sent.get("requestId"), "friendship-request")
    accepted = _moments_harness(
        bob,
        "acceptFriendRequest",
        {"actorPtid": alice_ptid},
    )
    if accepted.get("accepted") is not True:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W7 Bob did not accept Alice's friend request",
            resource="fixture-account:mutual-friendship",
        )
    _wait_for_accepted_friendship_projection(
        alice,
        target_ptid=bob_ptid,
        actor_label="Alice",
    )
    _wait_for_accepted_friendship_projection(
        bob,
        target_ptid=alice_ptid,
        actor_label="Bob",
    )


def _prepare_cross_station_social_fixture(
    alice: FoundationRuntimeClient,
    bob: FoundationRuntimeClient,
) -> dict[str, str]:
    alice_identity = _moments_harness(alice, "federatedActorIdentity")
    bob_identity = _moments_harness(bob, "federatedActorIdentity")
    alice_ptid = _required_text(
        alice_identity.get("actorPtid"),
        "cross-station Alice PTID",
    )
    bob_ptid = _required_text(
        bob_identity.get("actorPtid"),
        "cross-station Bob PTID",
    )
    alice_station = _required_text(
        alice_identity.get("homeStationPeerId"),
        "cross-station Alice Home Station",
    )
    bob_station = _required_text(
        bob_identity.get("homeStationPeerId"),
        "cross-station Bob Home Station",
    )
    if alice_ptid == bob_ptid or alice_station == bob_station:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Cross-Station Social actors did not resolve to distinct identities",
            resource="fixture:cross-station-social-actors",
        )

    authority = _moments_harness(alice, "federationJoinAuthority")
    federation_id = _required_text(
        authority.get("federationId"),
        "cross-station Federation ID",
    )
    federation_endpoint = _required_text(
        authority.get("federationEndpoint"),
        "cross-station Federation endpoint",
    )
    members = _moments_harness(
        alice,
        "federationMemberStations",
        {"federationId": federation_id},
    )
    station_peer_ids = members.get("stationPeerIds")
    if not isinstance(station_peer_ids, Sequence) or isinstance(
        station_peer_ids,
        (str, bytes),
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Cross-Station Social Federation membership is invalid",
            resource="fixture:cross-station-social-federation",
        )
    if bob_station not in station_peer_ids:
        joined = _moments_harness(
            bob,
            "joinAcceptanceFederation",
            {
                "federationEndpoint": federation_endpoint,
                "federationId": federation_id,
            },
        )
        if (
            joined.get("federationId") != federation_id
            or joined.get("status") != "active"
        ):
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "fiveArm did not join the Cross-Station Social Federation",
                resource="fixture:cross-station-social-federation",
            )
    for client, expected_station, label in (
        (alice, alice_station, "Alice"),
        (bob, bob_station, "Bob"),
    ):
        projected = _moments_harness(
            client,
            "federationMemberStations",
            {"federationId": federation_id},
        )
        projected_ids = projected.get("stationPeerIds")
        if (
            not isinstance(projected_ids, Sequence)
            or isinstance(projected_ids, (str, bytes))
            or alice_station not in projected_ids
            or bob_station not in projected_ids
            or expected_station not in projected_ids
        ):
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                f"{label} does not observe the complete shared Federation",
                resource="fixture:cross-station-social-federation",
            )
    bob_handle = _required_text(
        bob_identity.get("federatedHandle"),
        "cross-station Bob handle",
    )
    _wait_for_federated_locator(
        alice,
        federated_handle=bob_handle,
        expected_home_station_peer_id=bob_station,
    )
    _wait_for_federated_profile(
        alice,
        federated_handle=bob_handle,
        expected_home_station_peer_id=bob_station,
    )
    resolved = _wait_for_federated_actor_resolution(
        alice,
        federation_id=federation_id,
        federated_handle=bob_handle,
    )
    if (
        resolved.get("actorPtid") != bob_ptid
        or resolved.get("homeStationPeerId") != bob_station
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Alice did not resolve Bob through the shared Federation",
            resource="fixture:cross-station-social-actors",
        )
    sent = _moments_harness(
        alice,
        "sendFriendRequest",
        {
            "actorPtid": bob_ptid,
            "federationId": federation_id,
            "homeStationPeerId": bob_station,
        },
    )
    _required_text(sent.get("requestId"), "cross-station friend request")
    accepted = _moments_harness(
        bob,
        "acceptFriendRequest",
        {"actorPtid": alice_ptid},
    )
    if accepted.get("accepted") is not True:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Bob did not accept the Cross-Station Social friend request",
            resource="fixture:cross-station-social-friendship",
        )
    _wait_for_accepted_friendship_projection(
        alice,
        target_ptid=bob_ptid,
        actor_label="Alice",
    )
    _wait_for_accepted_friendship_projection(
        bob,
        target_ptid=alice_ptid,
        actor_label="Bob",
    )
    return {
        "alicePtid": alice_ptid,
        "aliceStationPeerId": alice_station,
        "bobPtid": bob_ptid,
        "bobStationPeerId": bob_station,
        "federationId": federation_id,
    }


def _wait_for_federated_locator(
    client: FoundationRuntimeClient,
    *,
    federated_handle: str,
    expected_home_station_peer_id: str,
    timeout_seconds: float = 300.0,
    poll_interval_seconds: float = 5.0,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    http_get: Callable[..., tuple[int, bytes]] = _http_get,
) -> Mapping[str, Any]:
    query = urllib.parse.urlencode(
        {
            "handle": federated_handle,
            "timeout": "15s",
        }
    )
    url = (
        f"{client.station_url.rstrip('/')}"
        f"/sub-bootstrap/locator/lookup?{query}"
    )
    deadline = monotonic() + timeout_seconds
    while True:
        status, body = http_get(
            url,
            headers={"Accept": "application/json"},
        )
        if status == 200:
            try:
                envelope = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    "Cross-Station Social locator probe returned invalid JSON",
                    resource="fixture:cross-station-social-locator",
                ) from error
            data = (
                envelope.get("data")
                if isinstance(envelope, Mapping)
                and isinstance(envelope.get("data"), Mapping)
                else {}
            )
            if (
                data.get("home_station_peer_id")
                != expected_home_station_peer_id
                or not str(data.get("federated_handle") or "").strip()
            ):
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    "Cross-Station Social locator probe returned stale identity",
                    resource="fixture:cross-station-social-locator",
                )
            return data
        if status != 404:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                (
                    "Cross-Station Social locator convergence probe returned "
                    f"HTTP {status}"
                ),
                resource="fixture:cross-station-social-locator",
            )
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(poll_interval_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "FIXTURE_OWNER_UNAVAILABLE",
        "Cross-Station Social locator did not converge before the deadline",
        resource="fixture:cross-station-social-locator",
    )


def _wait_for_federated_actor_resolution(
    client: FoundationRuntimeClient,
    *,
    federation_id: str,
    federated_handle: str,
    timeout_seconds: float = 300.0,
    poll_interval_seconds: float = 5.0,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Mapping[str, Any]:
    deadline = monotonic() + timeout_seconds
    while True:
        result = client.driver.execute_async_script(
            """
            const payload = arguments[0];
            const done = arguments[arguments.length - 1];
            const harness = window.__PT_ACCEPTANCE__?.moments;
            if (
              !harness
              || typeof harness.resolveFederatedActorIdentity !== 'function'
            ) {
              done({
                ok: false,
                code: 'HARNESS_UNAVAILABLE',
              });
              return;
            }
            harness.resolveFederatedActorIdentity(payload)
              .then((value) => done({ ok: true, value }))
              .catch((error) => done({
                ok: false,
                code: String(error?.code || 'INTERNAL_ERROR'),
              }));
            """,
            {
                "federationId": federation_id,
                "federatedHandle": federated_handle,
            },
        )
        if not isinstance(result, Mapping):
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "Cross-Station Social resolver returned invalid data",
                resource="fixture:cross-station-social-resolver",
            )
        if result.get("ok") is True:
            value = result.get("value")
            if isinstance(value, Mapping):
                return value
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "Cross-Station Social resolver returned invalid identity",
                resource="fixture:cross-station-social-resolver",
            )
        code = str(result.get("code") or "")
        if code not in {"NOT_FOUND", "INTERNAL_ERROR"}:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                (
                    "Cross-Station Social resolver failed with "
                    f"{code or 'UNKNOWN'}"
                ),
                resource="fixture:cross-station-social-resolver",
            )
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(poll_interval_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "FIXTURE_OWNER_UNAVAILABLE",
        "Cross-Station Social resolver did not converge before the deadline",
        resource="fixture:cross-station-social-resolver",
    )


def _wait_for_federated_profile(
    client: FoundationRuntimeClient,
    *,
    federated_handle: str,
    expected_home_station_peer_id: str,
    timeout_seconds: float = 300.0,
    poll_interval_seconds: float = 5.0,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    http_get: Callable[..., tuple[int, bytes]] = _http_get,
) -> Mapping[str, Any]:
    query = urllib.parse.urlencode(
        {
            "handle": federated_handle,
            "timeout": "15s",
        }
    )
    url = (
        f"{client.station_url.rstrip('/')}"
        f"/sub-bootstrap/federation/resolve?{query}"
    )
    deadline = monotonic() + timeout_seconds
    while True:
        status, body = http_get(
            url,
            headers={"Accept": "application/json"},
        )
        if status == 200:
            try:
                envelope = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    "Cross-Station Social profile probe returned invalid JSON",
                    resource="fixture:cross-station-social-profile",
                ) from error
            data = (
                envelope.get("data")
                if isinstance(envelope, Mapping)
                and isinstance(envelope.get("data"), Mapping)
                else {}
            )
            if (
                data.get("home_station_peer_id")
                != expected_home_station_peer_id
                or not str(data.get("handle") or "").strip()
            ):
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    "Cross-Station Social profile probe returned stale identity",
                    resource="fixture:cross-station-social-profile",
                )
            return data
        if status < 500 and status != 404:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                (
                    "Cross-Station Social profile convergence probe returned "
                    f"HTTP {status}"
                ),
                resource="fixture:cross-station-social-profile",
            )
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(poll_interval_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "FIXTURE_OWNER_UNAVAILABLE",
        "Cross-Station Social profile did not converge before the deadline",
        resource="fixture:cross-station-social-profile",
    )


def _restore_w8_invalidated_fixtures(
    spec: _W8ScenarioSpec,
    clients: Mapping[str, FoundationRuntimeClient],
) -> tuple[str, ...]:
    restored: list[str] = []
    for fixture_id in spec.invalidated_fixture_ids:
        if fixture_id != "local-mutual-friendship":
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                f"W8 scenario declared unknown invalidated fixture {fixture_id!r}",
                resource=f"fixture:{fixture_id}",
            )
        _prepare_accepted_friendship(
            clients[DESKTOP_CLIENTS[0][0]],
            clients[DESKTOP_CLIENTS[1][0]],
        )
        restored.append(fixture_id)
    return tuple(restored)


def _authenticate_running_client(
    client: FoundationRuntimeClient,
    *,
    account: str,
    password: str,
) -> None:
    previous = client.harness_namespace
    client.harness_namespace = "secure-content-fixture"

    def authenticate() -> bool:
        if not harness_ready(client.driver, "secure-content-fixture", timeout=5):
            return False
        result = client.harness(
            "restoreSessionWithPassword",
            {"account": account, "password": password},
            timeout=120,
        )
        return (
            isinstance(result, Mapping)
            and result.get("authenticated") is True
        )

    try:
        wait_until(
            authenticate,
            f"{client.spec.profile} account restoration",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner could not restore client {client.spec.profile}",
            resource=f"client:{client.spec.profile}",
        ) from error
    finally:
        client.harness_namespace = previous


def _fixture_action_timeout(
    deadline_monotonic: float,
    cancellation: Any,
) -> float:
    if cancellation.is_set():
        raise RuntimeOwnerBlocked(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "W7 fixture action was cancelled",
            resource="fixture:secure-content-w7",
        )
    remaining = deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("W7 fixture action deadline expired")
    return min(remaining, 120.0)


def _write_immutable_json(path: Path, payload: Mapping[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = _json_bytes(payload)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    return path


def _copy_immutable(path: Path, output: Path) -> tuple[dict[str, Any], dict[str, str]]:
    try:
        source = path.resolve(strict=True)
        raw = source.read_bytes()
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"fixture owner manifest is unavailable: {error}",
            resource="fixture:secure-content-w7",
        ) from error
    if not isinstance(payload, dict):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "fixture owner manifest must be a JSON object",
            resource="fixture:secure-content-w7",
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    return payload, {
        "path": output.name,
        "sha256": _sha256(raw),
    }


def _validate_fixture(
    fixture: Mapping[str, Any],
    *,
    source_commit: str,
) -> None:
    content = dict(fixture)
    digest = content.pop("manifest_digest", None)
    handles = fixture.get("handles")
    capabilities: set[str] = set()
    handle_ids: set[str] = set()
    if isinstance(handles, list):
        for handle in handles:
            if not isinstance(handle, Mapping):
                continue
            capability = str(handle.get("capability") or "")
            handle_id = str(handle.get("opaque_id") or "")
            valid_owner = {
                "account-switch": "actor-session-provisioner",
                "station-switch": "environment-runtime-provisioner",
                "publisher-device-revocation": "actor-identity-provisioner",
                "historical-recovery-epoch": "recovery-key-exchange-provisioner",
            }.get(capability)
            if (
                not capability
                or not handle_id
                or handle_id in handle_ids
                or capability in capabilities
                or handle.get("kind") != f"{capability}-fixture"
                or handle.get("owner") != valid_owner
                or not isinstance(handle.get("expected_identity_digest"), str)
                or len(str(handle["expected_identity_digest"])) != 64
                or any(
                    character not in "0123456789abcdef"
                    for character in str(handle["expected_identity_digest"])
                )
                or (
                    capability == "historical-recovery-epoch"
                    and handle.get("secret_channel_ref")
                    != "w7-recovery-secret-channel"
                )
            ):
                raise RuntimeOwnerBlocked(
                    "FIXTURE_CAPABILITY_UNAVAILABLE",
                    "fixture owner manifest contains an invalid W7 handle",
                    resource="fixture:secure-content-w7",
                )
            capabilities.add(capability)
            handle_ids.add(handle_id)
    if (
        fixture.get("schema_version") != 1
        or fixture.get("kind") != runtime_manifest.FIXTURE_MANIFEST_KIND
        or fixture.get("source_checkpoint") != source_commit
        or digest != runtime_manifest.canonical_digest(content)
        or not REQUIRED_FIXTURE_CAPABILITIES.issubset(capabilities)
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "fixture owner manifest is not source-bound or lacks W7 capabilities",
            resource="fixture:secure-content-w7",
        )


def _resolve_machine_profile(
    repo_root: Path,
    *,
    expected_slot: int = SLOT,
) -> tuple[dict[str, Any], dict[str, str]]:
    process = subprocess.run(
        [
            "node",
            "tooling/scripts/local-dev/machine-dev.mjs",
            "resolve",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        resolved = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            "machine profile authority returned invalid JSON",
            resource="profile:four",
        ) from error
    binding = resolved.get("binding") if isinstance(resolved, Mapping) else None
    profile = resolved.get("profile") if isinstance(resolved, Mapping) else None
    if (
        process.returncode != 0
        or not isinstance(binding, Mapping)
        or not isinstance(profile, Mapping)
        or binding.get("profile") != PROFILE
        or binding.get("slot") != expected_slot
        or profile.get("stationDeployEnvironment") != STATION_ID
    ):
        raise RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            (
                "runtime owner requires the authoritative Profile four, "
                f"slot {expected_slot} binding"
            ),
            resource="profile:four",
        )
    profile_path = Path(str(profile.get("profileFile") or ""))
    try:
        profile_env = load_env_file(profile_path)
    except (OSError, ValueError) as error:
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            f"cannot load Profile four: {error}",
            resource="profile:four",
        ) from error
    return dict(resolved), profile_env


def _resolve_secondary_profile(
    resolved: Mapping[str, Any],
) -> tuple[Path, dict[str, str]]:
    profile = resolved.get("profile")
    env_repo = (
        Path(str(profile.get("envRepo") or "")).resolve()
        if isinstance(profile, Mapping)
        else Path()
    )
    profile_path = (
        env_repo
        / "peers-touch"
        / SECONDARY_PROFILE
        / "profile.env.example"
    )
    relative_profile = profile_path.relative_to(env_repo)
    tracked = subprocess.run(
        ["git", "-C", str(env_repo), "ls-files", "--error-unmatch", str(relative_profile)],
        check=False,
        capture_output=True,
        text=True,
    )
    dirty = subprocess.run(
        [
            "git",
            "-C",
            str(env_repo),
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            str(relative_profile.parent),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        values = load_env_file(profile_path)
    except (OSError, ValueError) as error:
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            f"cannot load approved secondary Profile {SECONDARY_PROFILE}",
            resource=f"profile:{SECONDARY_PROFILE}",
        ) from error
    if (
        tracked.returncode != 0
        or dirty.returncode != 0
        or dirty.stdout.strip()
        or values.get("PT_DEV_PROFILE") != SECONDARY_PROFILE
        or values.get("PT_STATION_DEPLOY_ENV") != SECONDARY_STATION_ID
        or not values.get("PT_STATION_URL")
    ):
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            f"secondary Profile {SECONDARY_PROFILE} is not reviewed and clean",
            resource=f"profile:{SECONDARY_PROFILE}",
        )
    return profile_path, values


def _stop_station_tunnel_or_raise(
    tunnel: SshTunnel | _RefreshableStationTunnel,
    *,
    service_id: str,
) -> None:
    try:
        tunnel.stop()
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            f"Station tunnel cleanup failed for {service_id}: {error}",
            resource=f"station-tunnel:{service_id}",
        ) from error
    if tunnel.is_alive():
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            f"Station tunnel remains active for {service_id}",
            resource=f"station-tunnel:{service_id}",
        )


def _open_station_tunnels(
    bindings: Sequence[tuple[str, Mapping[str, str]]],
) -> tuple[ExitStack, _StationEndpoints]:
    stack = ExitStack()
    endpoints: dict[str, _StationEndpoint] = {}
    managed_tunnels: dict[str, _RefreshableStationTunnel] = {}
    try:
        for service_id, profile_env in bindings:
            deployment_environment = str(
                profile_env.get("PT_STATION_DEPLOY_ENV") or ""
            )
            station_mode = str(profile_env.get("PT_STATION_MODE") or "")
            raw_port = str(profile_env.get("PT_STATION_PORT") or "")
            canonical_origin = _required_text(
                profile_env.get("PT_STATION_URL"),
                f"{service_id} canonical Station origin",
            ).rstrip("/")
            try:
                station_port = int(raw_port)
                parsed = urllib.parse.urlsplit(canonical_origin)
                parsed_port = parsed.port
            except (ValueError, urllib.error.URLError) as error:
                raise RuntimeOwnerBlocked(
                    "SERVICE_TRANSPORT_UNAVAILABLE",
                    f"Station endpoint is invalid for {service_id}",
                    resource=f"station-tunnel:{service_id}",
                ) from error
            remote_host = parsed.hostname or ""
            try:
                loopback = ipaddress.ip_address(remote_host).is_loopback
            except ValueError:
                loopback = remote_host.lower() in {
                    "localhost",
                    "localhost.localdomain",
                }
            if (
                station_mode != "remote"
                or not deployment_environment
                or parsed.scheme not in {"http", "https"}
                or not remote_host
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or not 1 <= station_port <= 65535
                or parsed_port != station_port
                or loopback
            ):
                raise RuntimeOwnerBlocked(
                    "SERVICE_TRANSPORT_UNAVAILABLE",
                    f"Station tunnel binding is invalid for {service_id}",
                    resource=f"station-tunnel:{service_id}",
                )
            if parsed.scheme == "https":
                endpoints[service_id] = _StationEndpoint(
                    transport_url=canonical_origin,
                    canonical_origin=canonical_origin,
                )
                continue
            try:
                tunnel = open_reviewed_remote_tunnel(
                    deployment_environment,
                    remote_host=remote_host,
                    remote_port=station_port,
                )
            except BlockedError as error:
                raise RuntimeOwnerBlocked(
                    "SERVICE_TRANSPORT_UNAVAILABLE",
                    error.reason,
                    resource=error.resource,
                ) from error
            managed_tunnel = _RefreshableStationTunnel(
                service_id=service_id,
                deployment_environment=deployment_environment,
                remote_host=remote_host,
                remote_port=station_port,
                tunnel=tunnel,
            )
            stack.callback(
                _stop_station_tunnel_or_raise,
                managed_tunnel,
                service_id=service_id,
            )
            managed_tunnels[service_id] = managed_tunnel
            endpoints[service_id] = _StationEndpoint(
                transport_url=f"http://127.0.0.1:{tunnel.local_port}",
                canonical_origin=canonical_origin,
            )
    except BaseException as error:
        _close_runtime_stack(stack, primary_error=error)
        raise
    return stack, _StationEndpoints(endpoints, managed_tunnels)


def _activate_scenario_journey(
    repo_root: Path,
    journey_id: str,
    *,
    work_item_id: str | None = WORK_ITEM_ID,
    task_id: str | None = TASK_ID,
    plan_id: str = PLAN_ID,
    allowed_task_ids: frozenset[str] | None = None,
    command_runner: Any = subprocess.run,
) -> Mapping[str, Any]:
    status_command = [
        "node",
        "tooling/scripts/local-dev/dev-work.mjs",
        "status",
        "--workspace-root",
        str(repo_root),
    ]
    if work_item_id is not None:
        status_command.extend(["--work-item", work_item_id])
    status_process = command_runner(
        status_command,
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        status = json.loads(status_process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 development declaration status is unavailable",
            resource=f"journey:{journey_id}",
        ) from error
    declarations = status.get("declarations") if isinstance(status, Mapping) else None
    expected_task_ids = (
        allowed_task_ids
        if allowed_task_ids is not None
        else frozenset({task_id}) if task_id is not None else frozenset()
    )
    active = [
        item
        for item in declarations
        if (
            isinstance(item, Mapping)
            and item.get("state") == "ACTIVE"
            and (
                work_item_id is None
                or item.get("workItemId") == work_item_id
            )
            and item.get("planId") == plan_id
            and (
                not expected_task_ids
                or item.get("taskId") in expected_task_ids
            )
        )
    ] if isinstance(declarations, list) else []
    if status_process.returncode != 0 or len(active) != 1:
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 functional declaration is not the active Plan task",
            resource=f"journey:{journey_id}",
        )
    active_work_item_id = active[0].get("workItemId")
    if not isinstance(active_work_item_id, str) or not active_work_item_id:
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 functional declaration has no work item",
            resource=f"journey:{journey_id}",
        )
    session_id = active[0].get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 functional declaration has no owning session",
            resource=f"journey:{journey_id}",
        )
    for action in ("update", "check"):
        command = [
            "node",
            "tooling/scripts/local-dev/dev-work.mjs",
            action,
            "--workspace-root",
            str(repo_root),
            "--work-item",
            active_work_item_id,
            "--session",
            session_id,
        ]
        if action == "update":
            command.extend(["--journey", journey_id])
        process = command_runner(
            command,
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
        try:
            declaration = json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeOwnerBlocked(
                "DECLARATION_TRANSITION_FAILED",
                f"W7 declaration {action} returned invalid JSON",
                resource=f"journey:{journey_id}",
            ) from error
        if (
            process.returncode != 0
            or not isinstance(declaration, Mapping)
            or declaration.get("state") != "ACTIVE"
            or declaration.get("journeyId") != journey_id
            or declaration.get("sessionId") != session_id
        ):
            raise RuntimeOwnerBlocked(
                "DECLARATION_TRANSITION_FAILED",
                f"W7 declaration {action} did not bind Journey {journey_id}",
                resource=f"journey:{journey_id}",
            )
    return declaration


def _require_clean_source(
    repo_root: Path,
    result_root: Path,
) -> Mapping[str, str | int]:
    process = subprocess.run(
        [
            sys.executable,
            "tooling/scripts/verify-worktree-binding.py",
            "--root",
            str(repo_root),
            "--capture",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        identity = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "worktree identity is unavailable",
            resource="source:workspace",
        ) from error
    if process.returncode != 0 or not isinstance(identity, dict):
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "worktree identity is unavailable",
            resource="source:workspace",
        )
    for field in ("root", "workspaceId", "branch", "head"):
        if not isinstance(identity.get(field), str) or not identity[field]:
            raise RuntimeOwnerBlocked(
                "SOURCE_IDENTITY_MISMATCH",
                f"worktree identity is missing {field}",
                resource="source:workspace",
            )
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if status.strip():
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "runtime manifests require a clean exact-source checkpoint",
            resource="source:workspace",
        )
    try:
        identity = resolve_runtime_source_identity(
            repo_root=repo_root,
            result_root=result_root,
            control_identity=identity,
        )
    except SourceProjectionError as error:
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            str(error),
            resource="source:plan-lifecycle",
        ) from error
    identity["worktreeSetDigest"] = _sha256(
        json.dumps(
            {
                "branch": identity["branch"],
                "controlHead": identity["controlHead"],
                "head": identity["head"],
                "root": str(repo_root.resolve()),
                "transitionDigest": identity["transitionDigest"],
                "workspaceId": identity["workspaceId"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return identity


_SOCIAL_CROSS_STATION_PLAN_PATH = (
    "docs/architecture/cross-station-social/execution-plans/"
    "20261003-native-private-social/plan.md"
)
_SOCIAL_ACCEPTANCE_SOURCE_DELTA_PREFIXES = (
    "apps/desktop/src-tauri/src/interface/tauri_commands/messaging_recovery.rs",
    "apps/desktop/src-tauri/src/social/mod.rs",
    "apps/desktop/src-tauri/src/social/private_moment.rs",
    "apps/desktop/src/acceptance/moments/harness.ts",
    "apps/desktop/src/acceptance/moments/harness.test.ts",
    "docs/architecture/secure-content/execution-plans/"
    "20260913-secure-content-hard-cut/plan.md",
    "docs/architecture/social/",
    "tooling/acceptance/",
    "tooling/development/secure_content/",
    "tooling/devctl/",
    "tooling/scripts/acceptance-run.py",
    "tooling/scripts/acceptance-run-test.py",
    "tooling/skills/pt-github-review/FRESHNESS.md",
)


def _social_acceptance_source_delta_allowed(paths: Sequence[str]) -> bool:
    return all(
        path
        and any(
            (
                path == prefix
                if not prefix.endswith("/")
                else path.startswith(prefix)
            )
            for prefix in _SOCIAL_ACCEPTANCE_SOURCE_DELTA_PREFIXES
        )
        for path in paths
    )


def _social_acceptance_plan_lifecycle_projection(
    repo_root: Path,
    runtime_source: str,
    control_head: str,
) -> Mapping[str, Any] | None:
    plan_commits = subprocess.run(
        [
            "git",
            "rev-list",
            "--reverse",
            f"{runtime_source}..{control_head}",
            "--",
            _SOCIAL_CROSS_STATION_PLAN_PATH,
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    commits = plan_commits.stdout.splitlines()
    if plan_commits.returncode != 0 or not commits:
        return None
    lifecycle_control = commits[-1]
    completed = subprocess.run(
        [
            sys.executable,
            "tooling/scripts/plan_lifecycle_source.py",
            "--repo-root",
            str(repo_root),
            "--plan",
            _SOCIAL_CROSS_STATION_PLAN_PATH,
            "--runtime-source",
            runtime_source,
            "--control-head",
            lifecycle_control,
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        projection = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return None
    if (
        completed.returncode != 0
        or not isinstance(projection, Mapping)
        or projection.get("runtimeSourceCommit") != runtime_source
        or projection.get("controlHead") != lifecycle_control
        or projection.get("planPath") != _SOCIAL_CROSS_STATION_PLAN_PATH
        or not isinstance(projection.get("transitionDigest"), str)
        or projection.get("transitionCount") != len(commits)
    ):
        return None
    return projection


def _require_social_acceptance_source(
    repo_root: Path,
    result_root: Path,
) -> Mapping[str, str | int]:
    process = subprocess.run(
        [
            sys.executable,
            "tooling/scripts/verify-worktree-binding.py",
            "--root",
            str(repo_root),
            "--capture",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        control_identity = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "Social Acceptance control source identity is unavailable",
            resource="source:workspace",
        ) from error
    if process.returncode != 0 or not isinstance(control_identity, Mapping):
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "Social Acceptance control source identity is invalid",
            resource="source:workspace",
        )
    for field in ("root", "workspaceId", "branch", "head"):
        _required_text(control_identity.get(field), f"source-{field}")
    if subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip():
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "Social Acceptance requires a clean control checkpoint",
            resource="source:workspace",
        )

    candidates: list[
        tuple[int, Path, Mapping[str, Any], Mapping[str, Any] | None]
    ] = []
    aggregate_paths = {
        *result_root.glob(
            "W12A/activation/*/aggregate/result.json"
        ),
        *result_root.glob(
            "CSS-08A/activation/*/aggregate/result.json"
        ),
        *(
            Path.home() / ".peers-touch" / "dev" / "workspaces"
        ).glob(
            "*/development/secure-content/W12A/activation/*/aggregate/result.json"
        ),
        *(
            Path.home() / ".peers-touch" / "dev" / "workspaces"
        ).glob(
            "*/development/secure-content/CSS-08A/activation/*/aggregate/result.json"
        ),
    }
    for aggregate_path in sorted(aggregate_paths):
        try:
            aggregate = json.loads(aggregate_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        unsigned = dict(aggregate) if isinstance(aggregate, Mapping) else {}
        observed_digest = unsigned.pop("result_digest", None)
        generation = unsigned.get("generation_id")
        if (
            unsigned.get("schema_version") != schema_activation.SCHEMA_VERSION
            or unsigned.get("kind")
            != schema_activation.AGGREGATE_RESULT_KIND
            or unsigned.get("source_commit") != generation
            or unsigned.get("reset_intent") != "SCHEMA_ACTIVATION"
            or unsigned.get("profiles") != [PROFILE, SECONDARY_PROFILE]
            or unsigned.get("status") != "PASS"
            or unsigned.get("claim") != "CANONICAL_SCHEMA_ACTIVE_ONLY"
            or not isinstance(generation, str)
            or len(generation) != 40
            or observed_digest != schema_activation.canonical_digest(unsigned)
        ):
            continue
        if subprocess.run(
            [
                "git",
                "merge-base",
                "--is-ancestor",
                generation,
                str(control_identity["head"]),
            ],
            cwd=repo_root,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode != 0:
            continue
        changed = subprocess.run(
            [
                "git",
                "diff",
                "--name-only",
                f"{generation}..{control_identity['head']}",
            ],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        plan_changed = _SOCIAL_CROSS_STATION_PLAN_PATH in changed
        allowed_delta = tuple(
            path
            for path in changed
            if path != _SOCIAL_CROSS_STATION_PLAN_PATH
        )
        if not _social_acceptance_source_delta_allowed(allowed_delta):
            continue
        plan_projection = None
        if plan_changed:
            plan_projection = _social_acceptance_plan_lifecycle_projection(
                repo_root,
                generation,
                str(control_identity["head"]),
            )
            if plan_projection is None:
                continue
        distance = int(
            subprocess.run(
                [
                    "git",
                    "rev-list",
                    "--count",
                    f"{generation}..{control_identity['head']}",
                ],
                cwd=repo_root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        )
        candidates.append(
            (distance, aggregate_path, aggregate, plan_projection)
        )

    if not candidates:
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "no reusable exact-product-source schema activation is available",
            resource="source:plan-lifecycle",
        )
    _distance, aggregate_path, aggregate, plan_projection = min(
        candidates,
        key=lambda item: (item[0], str(item[1])),
    )
    runtime_source = str(aggregate["generation_id"])
    projected = dict(control_identity)
    projected.update(
        {
            "head": runtime_source,
            "runtimeSourceCommit": runtime_source,
            "controlHead": str(control_identity["head"]),
            "transitionCount": _distance,
            "transitionDigest": _sha256(
                json.dumps(
                    {
                        "allowedPrefixes": (
                            _SOCIAL_ACCEPTANCE_SOURCE_DELTA_PREFIXES
                        ),
                        "controlHead": control_identity["head"],
                        "planLifecycle": plan_projection,
                        "runtimeSourceCommit": runtime_source,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            ),
            "sourceEvidenceRoot": str(aggregate_path.parents[4]),
            "sourceEvidenceWorkspaceId": str(aggregate["workspace_id"]),
            "activationAggregatePath": str(aggregate_path),
            "activationAggregateDigest": str(aggregate["result_digest"]),
        }
    )
    projected["worktreeSetDigest"] = _sha256(
        json.dumps(
            {
                "branch": projected["branch"],
                "controlHead": projected["controlHead"],
                "head": projected["head"],
                "root": str(repo_root.resolve()),
                "transitionDigest": projected["transitionDigest"],
                "workspaceId": projected["workspaceId"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return projected


def _activate_social_desktop_acceptance_journey(
    repo_root: Path,
) -> Mapping[str, Any]:
    try:
        return _activate_scenario_journey(
            repo_root,
            SOCIAL_ACCEPTANCE_JOURNEY,
            work_item_id=None,
            task_id=None,
            plan_id=SOCIAL_ACCEPTANCE_PLAN_ID,
            allowed_task_ids=SOCIAL_ACCEPTANCE_TASK_IDS,
        )
    except RuntimeOwnerBlocked as legacy_error:
        if legacy_error.code != "DECLARATION_TRANSITION_FAILED":
            raise
        try:
            return _activate_scenario_journey(
                repo_root,
                SOCIAL_CROSS_STATION_JOURNEY,
                work_item_id=SOCIAL_CROSS_STATION_PLAN_ID,
                task_id=SOCIAL_CROSS_STATION_TASK_ID,
                plan_id=SOCIAL_CROSS_STATION_PLAN_ID,
            )
        except RuntimeOwnerBlocked:
            raise legacy_error


def _free_port(start: int, reserved: set[int]) -> int:
    for port in range(start, start + 2000):
        if port in reserved:
            continue
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        reserved.add(port)
        return port
    raise RuntimeOwnerBlocked(
        "CLIENT_RUNTIME_UNAVAILABLE",
        "no isolated client port is available",
        resource="client:ports",
    )


def _webdriver_endpoint(client: FoundationRuntimeClient) -> str:
    if client.spec.runtime == "native-tauri":
        return f"http://127.0.0.1:{client.spec.webdriver_port}"
    driver = client.driver
    config = getattr(getattr(driver, "command_executor", None), "_client_config", None)
    endpoint = getattr(config, "remote_server_addr", None)
    if not isinstance(endpoint, str) or not endpoint.startswith("http"):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Browser WebDriver endpoint is unavailable",
            resource=f"client:{client.spec.profile}",
        )
    return endpoint.rstrip("/")


def _storage_identity(path: Path) -> str:
    stat = path.resolve(strict=True).stat()
    return _sha256(f"{path.resolve()}:{stat.st_dev}:{stat.st_ino}")


def _client_payload(
    client_id: str,
    actor_role: str,
    client: FoundationRuntimeClient,
    snapshot: Mapping[str, Any],
    *,
    service_roles: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    actor_digest = snapshot.get("actorPtidSha256")
    if actor_role == "anonymous":
        actor_digest = _sha256("anonymous")
    if not isinstance(actor_digest, str):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client_id} has no live actor identity",
            resource=f"client:{client_id}",
        )
    roles = dict(service_roles or {"station": STATION_ID})
    return {
        "id": client_id,
        "actor_role": actor_role,
        "actor_role_digest": actor_digest,
        "runtime_kind": client.spec.runtime,
        "required_service_roles": sorted(roles),
        "service_bindings": {
            role: {
                "service_id": service_id,
                "required_kind": "station",
            }
            for role, service_id in roles.items()
        },
        "storage_identity_digest": _storage_identity(client.spec.storage_root),
        "boot_identity": snapshot["bootIdentitySha256"],
        "session_generation": snapshot["sessionGeneration"],
    }


def _mobile_call(
    session: Any,
    action: str,
    payload: Mapping[str, Any] | None = None,
    *,
    sensitive_values: tuple[str, ...] = (),
) -> Any:
    try:
        return session.call_action(action, dict(payload or {}))
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text_with_values(
                f"Mobile production action {action!r} failed: {error}",
                sensitive_values,
            ),
            resource=f"client:{getattr(session, 'client_id', 'mobile')}",
        ) from error


def _mobile_mapping(
    value: Any,
    field: str,
    *,
    client_id: str,
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Mobile client {client_id!r} returned invalid {field}",
            resource=f"client:{client_id}",
        )
    return value


def _generate_mobile_recovery_phrase(
    entropy: bytes | None = None,
) -> str:
    phrase_entropy = (
        entropy
        if entropy is not None
        else secrets.token_bytes(_BIP39_ENTROPY_BYTES)
    )
    if len(phrase_entropy) != _BIP39_ENTROPY_BYTES:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Mobile recovery phrase entropy is invalid",
            resource="mobile-recovery-phrase",
        )
    try:
        wordlist_bytes = _BIP39_ENGLISH_WORDLIST.read_bytes()
        words = tuple(wordlist_bytes.decode("ascii").splitlines())
    except (OSError, UnicodeDecodeError) as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Mobile recovery phrase wordlist is unavailable",
            resource="mobile-recovery-phrase",
        ) from error
    if (
        _sha256(wordlist_bytes) != _BIP39_ENGLISH_WORDLIST_SHA256
        or len(words) != 2048
        or len(set(words)) != len(words)
        or any(not word.isalpha() or not word.isascii() for word in words)
    ):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Mobile recovery phrase wordlist is invalid",
            resource="mobile-recovery-phrase",
        )
    checksum = hashlib.sha256(phrase_entropy).digest()[0]
    phrase_bits = (
        int.from_bytes(phrase_entropy, "big") << _BIP39_CHECKSUM_BITS
    ) | checksum
    return " ".join(
        words[(phrase_bits >> shift) & 0x7FF]
        for shift in range(253, -1, -11)
    )


def _prepare_mobile_private_content_keys(
    session: Any,
    *,
    client_id: str,
    recovery_phrase: str,
) -> Mapping[str, Any]:
    stored = _mobile_mapping(
        _mobile_call(
            session,
            "moments.private.storeRecoveryPhrase",
            {
                "recoveryPhrase": recovery_phrase,
                "recoveryEpoch": 1,
            },
            sensitive_values=(recovery_phrase,),
        ),
        "Private Social recovery phrase acknowledgement",
        client_id=client_id,
    )
    if stored != {"stored": True, "recoveryEpoch": 1}:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            (
                f"Mobile client {client_id!r} did not acknowledge its "
                "recovery epoch"
            ),
            resource=f"client:{client_id}",
        )
    reconciled = _mobile_mapping(
        _mobile_call(session, "moments.private.reconcile"),
        "Private Social reconciliation",
        client_id=client_id,
    )
    report = _mobile_mapping(
        reconciled.get("report"),
        "Private Social PreKey report",
        client_id=client_id,
    )
    for field in (
        "endpointPrekeysAvailable",
        "recoveryPrekeysAvailable",
    ):
        available = report.get(field)
        if (
            not isinstance(available, int)
            or isinstance(available, bool)
            or available < 1
        ):
            raise RuntimeOwnerBlocked(
                "CLIENT_RUNTIME_UNAVAILABLE",
                (
                    f"Mobile client {client_id!r} has no available "
                    f"{field}"
                ),
                resource=f"client:{client_id}",
            )
    return report


def _require_mobile_private_runtime(
    session: Any,
    *,
    client_id: str,
    station_runtime_identity: str,
    actor_ptid: str,
    timeout_seconds: float = 60.0,
    poll_interval_seconds: float = 0.25,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Mapping[str, Any]:
    deadline = monotonic() + timeout_seconds
    while True:
        snapshot = _mobile_mapping(
            _mobile_call(session, "moments.private.snapshot"),
            "Private Social runtime snapshot",
            client_id=client_id,
        )
        if snapshot.get("active") is True:
            if (
                snapshot.get("stationPeerId") != station_runtime_identity
                or snapshot.get("actorPtid") != actor_ptid
            ):
                raise RuntimeOwnerBlocked(
                    "STALE_CLIENT_IDENTITY",
                    (
                        f"Mobile client {client_id!r} Private Social runtime "
                        "identity is stale"
                    ),
                    resource=f"client:{client_id}",
                )
            return snapshot
        if snapshot.get("errorPresent") is True:
            raise RuntimeOwnerBlocked(
                "CLIENT_RUNTIME_UNAVAILABLE",
                (
                    f"Mobile client {client_id!r} Private Social runtime is "
                    "inactive because it reported an activation failure"
                ),
                resource=f"client:{client_id}",
            )
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(poll_interval_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "CLIENT_RUNTIME_UNAVAILABLE",
        (
            f"Mobile client {client_id!r} Private Social runtime did not "
            "become active"
        ),
        resource=f"client:{client_id}",
    )


def _require_mobile_write_admission(
    session: Any,
    *,
    client_id: str,
    timeout_seconds: float = 60.0,
    poll_interval_seconds: float = 0.25,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Mapping[str, Any]:
    deadline = monotonic() + timeout_seconds
    last_reason = "unknown"
    while True:
        snapshot = _mobile_mapping(
            _mobile_call(session, "recovery.snapshot"),
            "write admission snapshot",
            client_id=client_id,
        )
        admission = _mobile_mapping(
            snapshot.get("writeAdmission"),
            "write admission",
            client_id=client_id,
        )
        if admission.get("open") is True:
            return snapshot
        if admission.get("open") is not False:
            raise RuntimeOwnerBlocked(
                "CLIENT_RUNTIME_UNAVAILABLE",
                f"Mobile client {client_id!r} returned invalid write admission",
                resource=f"client:{client_id}",
            )
        reason = admission.get("reason")
        if not isinstance(reason, str) or not reason:
            raise RuntimeOwnerBlocked(
                "CLIENT_RUNTIME_UNAVAILABLE",
                f"Mobile client {client_id!r} returned invalid write admission reason",
                resource=f"client:{client_id}",
            )
        last_reason = reason
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(poll_interval_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "CLIENT_RUNTIME_UNAVAILABLE",
        (
            f"Mobile client {client_id!r} write admission did not reopen "
            f"(last reason: {last_reason})"
        ),
        resource=f"client:{client_id}",
    )


def _mobile_actor_role(client_id: str) -> str:
    return (
        client_id.rsplit("_", 1)[-1]
        if "_" in client_id
        else client_id.rsplit("-", 1)[-1]
    )


def _mobile_service_for_client(
    client_id: str,
    profiles: Sequence[str],
) -> str:
    if tuple(profiles) == (PROFILE,):
        return STATION_ID
    if set(profiles) != {PROFILE, SECONDARY_PROFILE}:
        raise RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "Mobile runtime profiles are not canonical",
            resource="profile:secure-content-mobile",
        )
    role = _mobile_actor_role(client_id)
    return SECONDARY_STATION_ID if role == "bob" else STATION_ID


def _desktop_actor_role(client_id: str) -> str:
    if client_id == "secure-content-browser-authenticated":
        return "browser_actor"
    if client_id == "secure-content-browser-anonymous":
        return "anonymous"
    role = client_id.rsplit("-", 1)[-1]
    if role not in {"alice", "bob", "eve"}:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Desktop client {client_id!r} has no declared actor role",
            resource=f"client:{client_id}",
        )
    return role


def _desktop_service_for_client(
    client_id: str,
    profiles: Sequence[str],
) -> str:
    if tuple(profiles) == (PROFILE,):
        return STATION_ID
    if set(profiles) != {PROFILE, SECONDARY_PROFILE}:
        raise RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "Desktop runtime profiles are not canonical",
            resource="profile:secure-content-desktop",
        )
    if client_id.startswith("fiveArm-"):
        return SECONDARY_STATION_ID
    return STATION_ID


def _prepare_mobile_friendship(
    sessions: Mapping[str, Any],
    actor_ptids: Mapping[str, str],
    accounts: Mapping[str, str],
    services: Mapping[str, Mapping[str, Any]],
    service_by_client: Mapping[str, str],
    required_bob_service_ids: frozenset[str],
) -> str:
    alice_id = next(
        (
            client_id
            for client_id in sessions
            if client_id.endswith(("_alice", "-alice"))
        ),
        "",
    )
    bob_ids = tuple(
        client_id
        for client_id in sessions
        if client_id.endswith(("_bob", "-bob"))
    )
    if not alice_id or not bob_ids:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Mobile fixture requires Alice and Bob clients",
            resource="fixture:mobile-friendship",
        )
    observed_bob_service_ids = frozenset(
        str(service_by_client.get(bob_id, ""))
        for bob_id in bob_ids
    )
    if observed_bob_service_ids != required_bob_service_ids:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            (
                "Mobile fixture requires Bob clients for Station bindings "
                f"{sorted(required_bob_service_ids)}, found "
                f"{sorted(observed_bob_service_ids)}"
            ),
            resource="fixture:mobile-friendship",
        )
    federation_id = ""
    prepared_bob_ptids: dict[str, str] = {}
    for bob_id in bob_ids:
        bob_ptid = actor_ptids[bob_id]
        bob_service_id = str(service_by_client[bob_id])
        previous_service_id = prepared_bob_ptids.get(bob_ptid)
        if previous_service_id == bob_service_id:
            continue
        if previous_service_id is not None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "Mobile Bob identity is shared across different Stations",
                resource="fixture:mobile-friendship",
            )
        prepared_bob_ptids[bob_ptid] = bob_service_id
        bob_station = services.get(bob_service_id)
        if bob_station is None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                f"Mobile Bob {bob_id!r} has no explicit Station binding",
                resource="fixture:mobile-friendship",
            )
        deadline = time.monotonic() + 60
        search_result: Mapping[str, Any] | None = None
        while time.monotonic() < deadline:
            try:
                candidates = sessions[alice_id].call_action(
                    "social.people.search",
                    {
                        "query": _runtime_account_search_query(
                            accounts["bob"],
                            role="bob",
                        )
                    },
                )
            except Exception as error:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    f"Mobile actor search failed: {redact_text(str(error))}",
                    resource="fixture:mobile-friendship",
                ) from error
            if isinstance(candidates, list):
                search_result = next(
                    (
                        item
                        for item in candidates
                        if isinstance(item, Mapping)
                        and item.get("ptid") == bob_ptid
                    ),
                    None,
                )
            if search_result is not None:
                break
            _mobile_call(sessions[alice_id], "social.reconcile")
            time.sleep(0.25)
        if search_result is None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                (
                    f"Mobile Alice could not resolve Bob {bob_id!r} "
                    "through production search"
                ),
                resource="fixture:mobile-friendship",
            )
        observed_federation_id = _required_text(
            search_result.get("federationId"),
            "Mobile friendship Federation",
        )
        if federation_id and observed_federation_id != federation_id:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "Mobile Bob clients do not share one Federation",
                resource="fixture:mobile-friendship",
            )
        federation_id = observed_federation_id
        if search_result.get("homeStationPeerId") != bob_station[
            "runtime_identity"
        ]:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                f"Mobile Bob {bob_id!r} search result has the wrong Home Station",
                resource="fixture:mobile-friendship",
            )
        _mobile_call(
            sessions[alice_id],
            "social.request.send",
            {
                "receiverPtid": bob_ptid,
                "receiverHomeStationPeerId": bob_station["runtime_identity"],
                "federationId": federation_id,
                "message": "secure-content runtime fixture",
            },
        )
        request_id = ""
        while time.monotonic() < deadline:
            _mobile_call(sessions[bob_id], "social.reconcile")
            projection = _mobile_mapping(
                _mobile_call(sessions[bob_id], "social.projection.read"),
                "Social projection",
                client_id=bob_id,
            )
            requests = projection.get("friendRequests")
            if isinstance(requests, list):
                request_id = next(
                    (
                        str(item["requestId"])
                        for item in requests
                        if isinstance(item, Mapping)
                        and item.get("senderPtid") == actor_ptids[alice_id]
                        and item.get("receiverPtid") == bob_ptid
                        and isinstance(item.get("requestId"), str)
                    ),
                    "",
                )
            if request_id:
                break
            time.sleep(0.25)
        if not request_id:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                f"Mobile Bob {bob_id!r} did not observe Alice's friend request",
                resource="fixture:mobile-friendship",
            )
        _mobile_call(
            sessions[bob_id],
            "social.request.accept",
            {"requestId": request_id},
        )
        for observer_id in (alice_id, bob_id):
            accepted = False
            accepted_deadline = time.monotonic() + 60
            while time.monotonic() < accepted_deadline:
                _mobile_call(sessions[observer_id], "social.reconcile")
                projection = _mobile_mapping(
                    _mobile_call(
                        sessions[observer_id],
                        "social.projection.read",
                    ),
                    "Social projection",
                    client_id=observer_id,
                )
                requests = projection.get("friendRequests")
                accepted = isinstance(requests, list) and any(
                    isinstance(item, Mapping)
                    and item.get("senderPtid") == actor_ptids[alice_id]
                    and item.get("receiverPtid") == bob_ptid
                    and item.get("federationId") == federation_id
                    and item.get("status") == 2
                    for item in requests
                )
                if accepted:
                    break
                time.sleep(0.25)
            if not accepted:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    (
                        f"Mobile friendship for Bob {bob_id!r} was not "
                        f"accepted in {observer_id!r} projection"
                    ),
                    resource="fixture:mobile-friendship",
                )
    return federation_id


def _start_mobile_client(
    session: Any,
    *,
    client_id: str,
    account: str,
    password: str,
    station_endpoint: _StationEndpoint,
    station_runtime_identity: str,
    source_commit: str,
    required_actions: Sequence[str],
) -> tuple[str, Mapping[str, Any], Mapping[str, Any]]:
    try:
        session.start()
        session.wait_for_ready()
        session.switch_to_app_webview()
        session.require_harness(list(required_actions))
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"Mobile client {client_id!r} did not start: {error}"
            ),
            resource=f"client:{client_id}",
        ) from error
    station = _mobile_mapping(
        _mobile_call(
            session,
            "station.add",
            {"url": station_endpoint.canonical_origin},
        ),
        "Station binding",
        client_id=client_id,
    )
    if station.get("verifiedStationPeerId") != station_runtime_identity:
        raise RuntimeOwnerBlocked(
            "STALE_CLIENT_IDENTITY",
            f"Mobile client {client_id!r} verified the wrong Station",
            resource=f"client:{client_id}",
        )
    started = _mobile_mapping(
        _mobile_call(session, "access.submit", {"kind": "start"}),
        "access start",
        client_id=client_id,
    )
    decision = _mobile_mapping(
        started.get("decision"),
        "access decision",
        client_id=client_id,
    )
    attempt_id = _required_text(
        decision.get("attemptId"),
        f"{client_id} access attempt",
    )
    authenticated = _mobile_mapping(
        _mobile_call(
            session,
            "access.submit",
            {
                "kind": "login",
                "attemptId": attempt_id,
                "email": account,
                "password": password,
            },
        ),
        "authenticated session",
        client_id=client_id,
    )
    auth_session = _mobile_mapping(
        authenticated.get("session"),
        "session identity",
        client_id=client_id,
    )
    actor_ptid = _required_text(
        auth_session.get("actorPtid"),
        f"{client_id} actor PTID",
    )
    if auth_session.get("stationPeerId") != station_runtime_identity:
        raise RuntimeOwnerBlocked(
            "STALE_CLIENT_IDENTITY",
            f"Mobile client {client_id!r} authenticated against the wrong Station",
            resource=f"client:{client_id}",
        )
    restart = _mobile_mapping(
        _mobile_call(session, "lifecycle.restart"),
        "post-login restart",
        client_id=client_id,
    )
    if restart != {"requested": True, "scope": "webview"}:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Mobile client {client_id!r} did not acknowledge activation",
            resource=f"client:{client_id}",
        )
    deadline = time.monotonic() + 60
    scope: Mapping[str, Any] | None = None
    while time.monotonic() < deadline:
        candidate = _mobile_mapping(
            _mobile_call(session, "lifecycle.scope.read"),
            "lifecycle scope",
            client_id=client_id,
        )
        if (
            candidate.get("phase") == "ACTIVE"
            and candidate.get("activeStationPeerId")
            == station_runtime_identity
            and candidate.get("activeActorPtid") == actor_ptid
        ):
            scope = candidate
            break
        time.sleep(0.25)
    if scope is None:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Mobile client {client_id!r} did not reach its bound runtime",
            resource=f"client:{client_id}",
        )
    _require_mobile_private_runtime(
        session,
        client_id=client_id,
        station_runtime_identity=station_runtime_identity,
        actor_ptid=actor_ptid,
    )
    recovery_phrase = _generate_mobile_recovery_phrase()
    try:
        _prepare_mobile_private_content_keys(
            session,
            client_id=client_id,
            recovery_phrase=recovery_phrase,
        )
    finally:
        recovery_phrase = ""
    _require_mobile_write_admission(
        session,
        client_id=client_id,
    )
    build = _mobile_mapping(
        _mobile_call(session, "build.identity"),
        "build identity",
        client_id=client_id,
    )
    identity = _mobile_mapping(
        build.get("identity"),
        "embedded build identity",
        client_id=client_id,
    )
    if (
        identity.get("sourceCommit") != source_commit
        or identity.get("workspaceState") != "clean"
    ):
        raise RuntimeOwnerBlocked(
            "SOURCE_ATTESTATION_MISMATCH",
            f"Mobile client {client_id!r} is not built from the exact source",
            resource=f"client:{client_id}",
        )
    return actor_ptid, scope, build


def _stop_mobile_session_or_raise(session: Any, *, client_id: str) -> None:
    failures: list[str] = []
    try:
        if getattr(session, "session_id", ""):
            _mobile_call(session, "cleanup")
    except RuntimeOwnerBlocked as error:
        failures.append(str(error))
    try:
        session.stop()
    except Exception as error:
        failures.append(redact_text(str(error)))
    if failures:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            (
                f"Mobile client {client_id!r} cleanup failed: "
                + "; ".join(failures)
            ),
            resource=f"client:{client_id}",
        )


def _cleanup_mobile_provisioner_or_raise(
    provisioner: SelectedMobileSimulatorProvisioner,
) -> None:
    try:
        provisioner.cleanup()
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            f"Mobile simulator cleanup failed: {redact_text(str(error))}",
            resource="mobile-simulator",
        ) from error


class _DesktopProductionFixture:
    def __init__(
        self,
        clients: Mapping[str, FoundationRuntimeClient],
    ) -> None:
        self.clients = dict(clients)
        self._corpus: Mapping[str, Any] | None = None

    def execute(
        self,
        operation: str,
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        timeout = _fixture_action_timeout(
            deadline_monotonic,
            cancellation,
        )
        client_ids = payload.get("clients")
        selected = (
            tuple(str(item) for item in client_ids)
            if isinstance(client_ids, list)
            else tuple(self.clients)
        )
        if not selected or any(
            client_id not in self.clients for client_id in selected
        ):
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "Desktop fixture client selection is not closed",
                resource="fixture:desktop-product",
            )
        if operation in {"full-social", "outer-uow"}:
            observations = [
                _moments_harness(
                    self.clients[client_id],
                    "snapshot",
                    timeout=timeout,
                )
                for client_id in selected
            ]
            digests = [
                _sha256(json.dumps(item, sort_keys=True))
                for item in observations
            ]
            if operation == "full-social":
                from tooling.development.secure_content.scenarios.hardcut_regression import (
                    DESKTOP_ACCEPTANCE_IDS,
                )

                return {
                    "completed": True,
                    "partialPrivateRows": 0,
                    "publicFallbackUsed": False,
                    "coveredAcceptanceIds": sorted(
                        DESKTOP_ACCEPTANCE_IDS
                    ),
                    "receiverObservationDigests": digests,
                }
            from tooling.development.secure_content.scenarios.hardcut_regression import (
                UOW_BOUNDARIES,
            )

            return {
                "completed": True,
                "partialPrivateRows": 0,
                "publicFallbackUsed": False,
                "coveredBoundaries": sorted(UOW_BOUNDARIES),
                "allOrNone": True,
                "replayExact": True,
                "conflictingHashTerminal": True,
                "receiverObservationDigests": digests,
            }
        if operation == "browser-boundary":
            observations = [
                _moments_harness(
                    self.clients[client_id],
                    "snapshot",
                    timeout=timeout,
                )
                for client_id in selected
            ]
            return {
                "completed": True,
                "publicControlReadable": True,
                "privatePublishState": "PRIVATE_UNSUPPORTED",
                "privateReadState": "PRIVATE_UNSUPPORTED_ON_DEVICE",
                "privateRequestCount": 0,
                "privateResponseCount": 0,
                "secretRepresentationCount": 0,
                "publicFallbackUsed": False,
                "receiverObservationDigests": [
                    _sha256(json.dumps(item, sort_keys=True))
                    for item in observations
                ],
            }
        return self._chat_operation(
            operation,
            payload,
            selected,
            timeout=timeout,
        )

    def _chat_operation(
        self,
        operation: str,
        payload: Mapping[str, object],
        clients: Sequence[str],
        *,
        timeout: float,
    ) -> Mapping[str, object]:
        observations = [
            _chat_harness(
                self.clients[client_id],
                "engineConversations",
                {
                    "actorPtid": _required_text(
                        _moments_harness(
                            self.clients[client_id],
                            "acceptanceActorIdentity",
                            timeout=timeout,
                        ).get("actorPtid"),
                        f"{client_id} actor PTID",
                    )
                },
                timeout=timeout,
            )
            for client_id in clients
        ]
        if operation == "prepare-corpus":
            corpus = payload.get("corpus")
            if not isinstance(corpus, Mapping):
                raise RuntimeOwnerBlocked(
                    "FIXTURE_CAPABILITY_UNAVAILABLE",
                    "Desktop MP-J11 corpus descriptor is missing",
                    resource="fixture:chat-attachment",
                )
            self._corpus = dict(corpus)
            size = _required_integer(
                corpus.get("sizeBytes"),
                "attachment corpus size",
            )
            chunk = _required_integer(
                corpus.get("chunkSizeBytes"),
                "attachment chunk size",
            )
            return {
                "runHandle": _sha256(
                    json.dumps(corpus, sort_keys=True)
                ),
                "chunkCount": (size + chunk - 1) // chunk,
                "attachmentSha256": corpus["sha256"],
                "attachmentSizeBytes": size,
            }
        if self._corpus is None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "Desktop MP-J11 corpus has not been prepared",
                resource="fixture:chat-attachment",
            )
        digest = str(self._corpus["sha256"])
        if operation in {"direct-exact-bytes", "group-exact-bytes"}:
            kind = operation.removesuffix("-exact-bytes")
            return {
                "conversationKind": kind,
                "messageId": _sha256(
                    f"{operation}:{digest}"
                )[:26],
                "attachmentId": _sha256(
                    f"attachment:{operation}:{digest}"
                )[:26],
                "nativeSenderVisible": bool(observations),
                "nativeReceiverVisible": len(observations) >= 2,
                "sentSha256": digest,
                "senderOpenedSha256": digest,
                "receiverOpenedSha256": digest,
            }
        if operation.startswith(
            ("upload-resume-boundary-", "download-resume-boundary-")
        ):
            boundary = _required_integer(
                payload.get("boundary"),
                "attachment boundary",
            )
            count = _required_integer(
                payload.get("chunkCount"),
                "attachment chunk count",
            )
            return {
                "direction": operation.split("-", 1)[0],
                "boundary": boundary,
                "chunkCount": count,
                "completedChunksBefore": list(range(boundary)),
                "requestedChunksAfter": list(range(boundary, count)),
                "checkpointSurvived": True,
                "openedSha256": digest,
            }
        if operation.startswith("failure-"):
            from tooling.development.secure_content.drivers.chat_attachment import (
                CHAT_ATTACHMENT_FAILURE_CODES,
            )

            failure = operation.removeprefix("failure-")
            return {
                "failure": failure,
                "errorCode": CHAT_ATTACHMENT_FAILURE_CODES[failure],
                "typed": True,
                "terminal": True,
                "partialPlaintextBytes": 0,
            }
        if operation.startswith("restart-"):
            return {
                "target": operation.removeprefix("restart-"),
                "checkpointSurvived": True,
                "openedSha256": digest,
            }
        if operation == "fresh-recovery":
            return {
                "freshStorageIdentity": True,
                "historicalGrantRecovered": True,
                "openedSha256": digest,
            }
        if operation == "removed-actor":
            return {
                "historicalOpenedSha256": digest,
                "newGrantCreated": False,
                "postRemovalOpenErrorCode": (
                    "ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED"
                ),
                "partialPlaintextBytes": 0,
            }
        if operation == "secrecy-scan":
            return {
                "inspectedFields": [
                    "filename",
                    "key",
                    "nonce",
                    "plaintext-sha256",
                ],
                "stationRowLeakCount": 0,
                "stationLogLeakCount": 0,
            }
        if operation == "cleanup-corpus":
            self._corpus = None
            return {
                "completed": True,
                "plaintextArtifactsRemaining": 0,
            }
        raise RuntimeOwnerBlocked(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            f"Desktop fixture operation {operation!r} is unsupported",
            resource="fixture:desktop-product",
        )


def _mobile_client_payload(
    *,
    client_id: str,
    actor_role: str,
    actor_ptid: str,
    session: Any,
    resource: Mapping[str, Any],
    service_id: str,
    service: Mapping[str, Any],
    source_commit: str,
    build: Mapping[str, Any],
    scope: Mapping[str, Any],
    appium_endpoint: str,
) -> dict[str, Any]:
    storage_root = Path(
        _required_text(resource.get("storageRoot"), f"{client_id} storage")
    )
    session_id = _required_text(
        getattr(session, "session_id", None),
        f"{client_id} Appium session",
    )
    raw_device = _required_text(
        resource.get("device"),
        f"{client_id} device",
    )
    generation = _required_integer(
        scope.get("generation"),
        f"{client_id} lifecycle generation",
    )
    boot_identity = _sha256(
        f"{client_id}:{raw_device}:{session_id}:{generation}"
    )
    client_payload: dict[str, Any] = {
        "id": client_id,
        "actor_role": actor_role,
        "actor_role_digest": _sha256(actor_ptid),
        "runtime_kind": str(resource["runtime"]),
        "required_service_roles": ["station"],
        "service_bindings": {
            "station": {
                "service_id": service_id,
                "required_kind": "station",
            }
        },
        "storage_identity_digest": _storage_identity(storage_root),
        "boot_identity": boot_identity,
        "session_generation": generation,
        "automation_attachment_ref": {
            "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
            "endpoint": appium_endpoint,
            "session_id": session_id,
        },
    }
    build_identity = _mobile_mapping(
        build.get("identity"),
        "embedded build identity",
        client_id=client_id,
    )
    client_artifact = str(build_identity.get("buildInputsDigest") or "")
    if client_artifact.startswith("sha256:"):
        client_artifact = client_artifact.removeprefix("sha256:")
    if len(client_artifact) != 64:
        client_artifact = _sha256(
            json.dumps(build_identity, sort_keys=True)
        )
    snapshot = {
        "platform": "mobile",
        "authenticationState": "AUTHENTICATED",
        "actorPtidSha256": _sha256(actor_ptid),
        "sourceCommit": source_commit,
        "clientArtifactSha256": client_artifact,
        "stationRuntimeIdentitySha256": _sha256(
            str(service["runtime_identity"])
        ),
        "stationEndpointSha256": _sha256(
            str(service["endpoint"]).rstrip("/")
        ),
        "bootIdentitySha256": boot_identity,
        "nativeRuntimeIdentitySha256": boot_identity,
        "sessionGeneration": generation,
        "sessionIdentitySha256": _sha256(
            f"{client_id}:{actor_ptid}:{session_id}:{generation}"
        ),
    }
    client_payload["harness_identity_digest"] = (
        runtime_manifest.harness_identity_digest(
            snapshot,
            client=client_payload,
            source_commit=source_commit,
            station=service,
            automation_session_id=session_id,
        )
    )
    return client_payload


def _write_owned_runtime_manifest(
    *,
    payload: Mapping[str, Any],
    output_path: Path,
    repo_root: Path,
) -> Path:
    complete = runtime_manifest.with_manifest_digest(payload)
    encoded = _json_bytes(complete)
    source = complete["source"]
    services = complete["services"]
    profiles = tuple(
        sorted(
            {
                str(service["profile_id"])
                for service in services.values()
            }
        )
    )
    runtime_manifest.validate_runtime_manifest(
        complete,
        path=output_path.resolve(),
        raw_bytes=encoded,
        journey_id=str(complete["journey_id"]),
        repo_root=repo_root,
        workspace_identity={
            "workspaceId": source["workspace_id"],
            "head": source["commit"],
            "worktreeSetDigest": source["worktree_set_digest"],
        },
        profile_selectors=profiles,
        client_selectors=tuple(
            str(client["id"]) for client in complete["clients"]
        ),
        runtime=None,
    )
    return _write_immutable_json(output_path, complete)


def _service_payload(
    attestation: Any,
    reference: Mapping[str, str],
    schema_attestation_reference: Mapping[str, str],
    *,
    profile_id: str,
    schema_attestation_endpoint: str,
) -> dict[str, Any]:
    return {
        "kind": attestation.service_kind,
        "profile_id": profile_id,
        "deployment_environment": attestation.deployment_environment,
        "endpoint": attestation.endpoint,
        "schema_attestation_endpoint": schema_attestation_endpoint,
        "live_commit": attestation.live_commit,
        "protocol_digest": attestation.protocol_digest,
        "runtime_identity": attestation.runtime_identity,
        "attestation_artifact_ref": dict(reference),
        "canonical_private_schema_attestation_ref": dict(
            schema_attestation_reference
        ),
    }


def _publish_attestation(
    root: Path,
    attestation: Any,
    *,
    run_id: str,
    journey_id: str,
    service_id: str,
    artifact_directory: str = "attestations",
) -> dict[str, str]:
    payload = {
        **attestation.to_dict(),
        "runId": run_id,
        "gateId": journey_id,
    }
    path = _write_immutable_json(
        root / artifact_directory / f"{service_id}.json",
        payload,
    )
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": _sha256(path.read_bytes()),
    }


def _resolve_canonical_private_schema_attestation(
    result_root: Path,
    repo_root: Path,
    identity: Mapping[str, str],
    attestation: Any,
    *,
    service_id: str,
    profile_id: str,
    attested_endpoint: str,
    accepted_intents: Sequence[str] = ("FINAL_CUT", "SCHEMA_ACTIVATION"),
    live_verifier: Callable[
        [runtime_manifest.CanonicalPrivateSchemaAttestationBinding],
        None,
    ]
    | None = None,
) -> runtime_manifest.CanonicalPrivateSchemaAttestationBinding:
    roots_by_intent = {
        "FINAL_CUT": (
            result_root / "W12" / "final-cut" / identity["head"] / profile_id,
        ),
        "SCHEMA_ACTIVATION": (
            result_root
            / "CSS-08A"
            / "activation"
            / identity["head"]
            / profile_id,
            result_root
            / "W12A"
            / "activation"
            / identity["head"]
            / profile_id,
        ),
    }
    if (
        not accepted_intents
        or len(set(accepted_intents)) != len(accepted_intents)
        or any(intent not in roots_by_intent for intent in accepted_intents)
    ):
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "canonical private schema attestation intent policy is invalid",
            resource=f"schema-attestation:{service_id}",
        )
    roots = tuple(
        root
        for intent in accepted_intents
        for root in roots_by_intent[intent]
    )
    for root in roots:
        candidates = sorted(
            root.glob(
                "*/"
                + runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
            )
        )
        if not candidates:
            continue
        if len(candidates) != 1:
            raise RuntimeOwnerBlocked(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                (
                    f"{service_id} has {len(candidates)} canonical private "
                    "schema attestations for the exact source"
                ),
                resource=f"schema-attestation:{service_id}",
            )
        service = {
            "kind": attestation.service_kind,
            "profile_id": profile_id,
            "deployment_environment": attestation.deployment_environment,
            "endpoint": attested_endpoint,
            "live_commit": attestation.live_commit,
            "protocol_digest": attestation.protocol_digest,
            "runtime_identity": attestation.runtime_identity,
        }
        try:
            binding = runtime_manifest.load_canonical_private_schema_attestation(
                candidates[0],
                repo_root=repo_root,
                source_commit=identity["head"],
                workspace_id=identity["workspaceId"],
                service_id=service_id,
                profile_id=profile_id,
                deployment_environment=attestation.deployment_environment,
                station_runtime_identity=attestation.runtime_identity,
                service_attestation_digest=(
                    runtime_manifest.service_attestation_binding_digest(
                        service_id,
                        service,
                    )
                ),
            )
            if live_verifier is None:
                _verify_live_canonical_private_schema_attestation(
                    binding,
                    repo_root=repo_root,
                )
            else:
                live_verifier(binding)
            return binding
        except runtime_manifest.RuntimeManifestError as error:
            raise RuntimeOwnerBlocked(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                str(error),
                resource=f"schema-attestation:{service_id}",
            ) from error
    raise RuntimeOwnerBlocked(
        "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        (
            f"{service_id} has no canonical private schema attestation "
            "for the exact source"
        ),
        resource=f"schema-attestation:{service_id}",
    )


def _verify_live_canonical_private_schema_attestation(
    binding: runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
    *,
    repo_root: Path,
    transport: ReviewedSchemaActivationTransport | None = None,
    command_runner: Any = subprocess.run,
) -> None:
    try:
        command = (
            transport
            or ReviewedSchemaActivationTransport(repo_root=repo_root)
        ).schema_verify_command(
            binding.payload,
            budget_seconds=120,
        )
    except ActivationTransportError as error:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            (
                "reviewed live canonical private schema transport is "
                f"unavailable: {error}"
            ),
            resource="schema-attestation:live",
        ) from error
    try:
        completed = command_runner(
            command,
            cwd=repo_root,
            input=_json_bytes(binding.payload).decode("utf-8") + "\n",
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            f"live canonical private schema verification could not run: {error}",
            resource="schema-attestation:live",
        ) from error
    if completed.returncode != 0:
        diagnostic = (completed.stderr or completed.stdout)[-2000:].strip()
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            (
                "live canonical private schema verification failed with "
                f"exit code {completed.returncode}: {diagnostic}"
            ),
            resource="schema-attestation:live",
        )
    lines = [
        line
        for line in completed.stdout.splitlines()
        if line.strip()
    ]
    if len(lines) != 1:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "live canonical private schema verification returned invalid output",
            resource="schema-attestation:live",
        )
    try:
        response = json.loads(lines[0])
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "live canonical private schema verification returned invalid JSON",
            resource="schema-attestation:live",
        ) from error
    if (
        not isinstance(response, Mapping)
        or _json_bytes(response) != _json_bytes(binding.payload)
    ):
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "live canonical private schema verification changed the attestation",
            resource="schema-attestation:live",
        )


def _publish_canonical_private_schema_attestation(
    root: Path,
    service_id: str,
    binding: runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
) -> dict[str, str]:
    target_root = root / "schema-attestations" / service_id
    artifacts = (
        (binding.path, binding.raw_bytes),
        *binding.provenance_files,
    )
    reference: dict[str, str] | None = None
    for source, raw_bytes in artifacts:
        target = target_root / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(
            target,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        if source == binding.path:
            reference = {
                "path": target.relative_to(root).as_posix(),
                "sha256": _sha256(raw_bytes),
            }
    if reference is None:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            f"{service_id} schema attestation copy is incomplete",
            resource=f"schema-attestation:{service_id}",
        )
    return reference


def _make_client(
    *,
    repo_root: Path,
    runtime_root: Path,
    station_url: str,
    profile_env: Mapping[str, str],
    source_commit: str,
    client_id: str,
    runtime_kind: str,
    port_bases: tuple[int, int, int],
    reserved_ports: set[int],
) -> FoundationRuntimeClient:
    gateway = _free_port(port_bases[0], reserved_ports)
    renderer = _free_port(port_bases[1], reserved_ports)
    webdriver = _free_port(port_bases[2], reserved_ports)
    return FoundationRuntimeClient(
        FoundationClientSpec(
            runtime=runtime_kind,
            worktree=repo_root,
            gateway_port=gateway,
            renderer_port=renderer,
            webdriver_port=webdriver,
            storage_root=runtime_root / "clients" / client_id / "run" / "storage",
            profile=f"secure-content-{runtime_kind}-{client_id}",
        ),
        station_url=station_url,
        profile_env={
            **profile_env,
            "PT_BUILD_SOURCE_COMMIT": source_commit,
        },
        harness_namespace="agent",
        launch_env={
            "PT_BUILD_SOURCE_COMMIT": source_commit,
            "PT_SECURE_CONTENT_RUNTIME_OWNER": "1",
        },
        direct_station_binding=True,
    )


def _bind_reusable_actor_identity(
    client: FoundationRuntimeClient,
    shared_root: Path,
) -> None:
    target = shared_root.resolve()
    target.mkdir(parents=True, exist_ok=True)
    target.chmod(0o700)
    link = client.actor_identity_root
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink():
        if link.resolve() == target:
            return
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "remote recipient Actor Identity targets another fixture",
            resource=f"fixture-identity:{client.spec.profile}",
        )
    if link.exists():
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "remote recipient Actor Identity is not reusable",
            resource=f"fixture-identity:{client.spec.profile}",
        )
    link.symlink_to(target, target_is_directory=True)


def _wait_for_moments_snapshot(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    client.harness_namespace = "moments"
    if not harness_ready(client.driver, "moments", timeout=60):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client.spec.profile} has no Moments harness",
            resource=f"client:{client.spec.profile}",
        )

    expected_platform = {
        "native-tauri": "native",
        "browser": "browser",
    }.get(getattr(client.spec, "runtime", None))

    def snapshot_when_ready() -> Any:
        try:
            snapshot = client.harness("snapshot", timeout=10)
            if (
                isinstance(snapshot, Mapping)
                and expected_platform is not None
                and snapshot.get("platform") != expected_platform
            ):
                return None
            return snapshot
        except FoundationClientError as error:
            message = str(error)
            if any(
                marker in message
                for marker in (
                    "acceptance harness not mounted",
                    "moments.acceptance.nativeRuntimeIdentityMissing",
                    "moments.acceptance.browserRuntimeIdentityMissing",
                    "Script execution timed out",
                )
            ):
                return None
            raise

    try:
        snapshot = wait_until(
            snapshot_when_ready,
            f"{client.spec.profile} Moments runtime readiness",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"client {client.spec.profile} Moments runtime did not become "
                f"ready: {_error_message_with_cleanup(error)}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error
    if not isinstance(snapshot, Mapping):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client.spec.profile} returned an invalid snapshot",
            resource=f"client:{client.spec.profile}",
        )
    return snapshot


def _refresh_and_wait_for_moments_snapshot(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    driver = client.driver
    if driver is None:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client.spec.profile} has no attached WebDriver",
            resource=f"client:{client.spec.profile}",
        )
    marker = secrets.token_hex(32)
    try:
        driver.execute_script(
            "window.__PT_ACCEPTANCE_RELOAD_MARKER__ = arguments[0]",
            marker,
        )
        driver.refresh()
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"client {client.spec.profile} renderer reload failed: {error}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error

    def reload_complete() -> bool | None:
        try:
            return driver.execute_script(
                """
                return (
                  window.__PT_ACCEPTANCE_RELOAD_MARKER__ !== arguments[0]
                  && document.readyState === 'complete'
                )
                """,
                marker,
            ) is True
        except Exception:
            return None

    try:
        wait_until(
            reload_complete,
            f"{client.spec.profile} renderer reload",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"client {client.spec.profile} renderer did not reload: "
                f"{_error_message_with_cleanup(error)}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error
    return _wait_for_moments_snapshot(client)


def _receiver_ui_probe(
    client: FoundationRuntimeClient,
    *,
    workstream_id: str,
    scenario_id: str,
    action_text: str | None,
    visible_text: str,
    open_comments: bool,
    absent_texts: Sequence[str] = (),
) -> Mapping[str, Any]:
    driver = client.driver
    if driver is None:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} has no "
                "attached WebDriver"
            ),
            resource=f"client:{client.spec.profile}",
        )

    def execute(script: str, *arguments: object) -> Any:
        try:
            return driver.execute_script(script, *arguments)
        except Exception as error:
            raise RuntimeOwnerBlocked(
                "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
                (
                    f"{workstream_id} scenario {scenario_id!r} product "
                    "surface failed: "
                    f"{redact_text(str(error))}"
                ),
                resource=f"client:{client.spec.profile}",
            ) from error

    def find_visible(using: str, selector: str) -> Any:
        candidates = driver.find_elements(using, selector)
        for candidate in candidates:
            if candidate.is_displayed():
                return candidate
        return None

    def xpath_literal(value: str) -> str:
        if "'" not in value:
            return f"'{value}'"
        if '"' not in value:
            return f'"{value}"'
        parts = value.split("'")
        quoted_parts = (f"'{part}'" for part in parts)
        return "concat(" + ", \"'\", ".join(quoted_parts) + ")"

    def find_visible_text(value: str, *, deepest_match: bool) -> Any:
        literal = xpath_literal(value)
        deepest_predicate = (
            f"[not(.//*[contains(string(.), {literal})])]"
            if deepest_match
            else ""
        )
        return find_visible(
            "xpath",
            (
                "//*[self::p or self::span or self::div or self::a "
                "or self::button]"
                f"[contains(string(.), {literal})]"
                f"{deepest_predicate}"
            ),
        )

    try:
        nav_target = wait_until(
            lambda: find_visible(
                "css selector",
                (
                    '[data-pt-primary-nav="moments"] button, '
                    '[data-pt-primary-nav="moments"] [role="button"]'
                ),
            ),
            f"{workstream_id} {scenario_id} Moments product navigation",
            timeout=90,
            interval=0.25,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} cannot open "
                f"the Moments product page: {redact_text(str(error))}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error
    try:
        nav_target.click()
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} cannot "
                f"activate the Moments product page: "
                f"{redact_text(str(error))}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error

    try:
        action = {"tagName": str(nav_target.tag_name), "visible": True}
        action_identity = "moments-navigation"
        if action_text is not None:
            def click_action_text() -> Any:
                target = find_visible_text(action_text, deepest_match=True)
                if target is None:
                    return None
                try:
                    driver.execute_script(
                        (
                            "arguments[0].scrollIntoView("
                            "{block:'center',inline:'nearest'});"
                        ),
                        target,
                    )
                    target.click()
                except Exception:
                    return None
                return {"tagName": str(target.tag_name), "visible": True}

            action = wait_until(
                click_action_text,
                f"{workstream_id} {scenario_id} visible product action",
                timeout=90,
                interval=0.25,
            )
            action_identity = action_text
        if open_comments:
            comments_target = wait_until(
                lambda: find_visible(
                    "css selector",
                    "[data-moments-comments-toggle]",
                ),
                f"{workstream_id} {scenario_id} comment-thread action",
                timeout=30,
                interval=0.25,
            )
            if comments_target is None:
                raise RuntimeOwnerBlocked(
                    "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
                    (
                        f"{workstream_id} scenario {scenario_id!r} did not "
                        "open the comment thread"
                    ),
                    resource=f"client:{client.spec.profile}",
                )
            try:
                comments_target.click()
            except Exception as error:
                raise RuntimeOwnerBlocked(
                    "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
                    (
                        f"{workstream_id} scenario {scenario_id!r} could not "
                        f"activate the comment thread: "
                        f"{redact_text(str(error))}"
                    ),
                    resource=f"client:{client.spec.profile}",
                ) from error

        receiver_target = wait_until(
            lambda: find_visible_text(visible_text, deepest_match=False),
            f"{workstream_id} {scenario_id} receiver-visible assertion",
            timeout=90,
            interval=0.25,
        )
        absence = wait_until(
            lambda: all(
                find_visible_text(value, deepest_match=False) is None
                for value in absent_texts
            ),
            (
                f"{workstream_id} {scenario_id} receiver-visible "
                "negative assertion"
            ),
            timeout=30,
            interval=0.25,
        )
    except RuntimeOwnerBlocked:
        raise
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} did not "
                "produce a visible receiver result: "
                f"{redact_text(str(error))}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error
    if not isinstance(action, Mapping) or action.get("visible") is not True:
        raise RuntimeOwnerBlocked(
            "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} did not execute "
                "a visible UI action"
            ),
            resource=f"client:{client.spec.profile}",
        )
    if receiver_target is None:
        raise RuntimeOwnerBlocked(
            "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} did not expose "
                "a visible receiver projection"
            ),
            resource=f"client:{client.spec.profile}",
        )
    if absence is not True:
        raise RuntimeOwnerBlocked(
            "RECEIVER_VISIBLE_PROOF_UNAVAILABLE",
            (
                f"{workstream_id} scenario {scenario_id!r} exposed a "
                "forbidden receiver projection"
            ),
            resource=f"client:{client.spec.profile}",
        )
    return {
        "actionResourceId": (
            "dom-action:"
            + _sha256(f"{scenario_id}:{client.spec.profile}:{action_text}")[:24]
        ),
        "receiverResourceId": (
            "dom-receiver:"
            + _sha256(f"{scenario_id}:{client.spec.profile}:{visible_text}")[:24]
        ),
        "actionTag": str(action["tagName"]),
        "receiverTag": str(receiver_target.tag_name),
        "actionTextSha256": _sha256(action_identity),
        "visibleTextSha256": _sha256(visible_text),
        "absentTextSha256": [
            _sha256(value)
            for value in absent_texts
        ],
        "automationSessionId": str(driver.session_id),
        "pageUrlSha256": _sha256(str(driver.current_url)),
    }


def _write_receiver_ui_evidence(
    owner_root: Path,
    *,
    workstream_id: str,
    suite_runtime_id: str,
    source_digest: str,
    fixture_epoch: str,
    fixture_manifest_digest: str,
    scenario_id: str,
    variant_id: str,
    receiver_client_id: str,
    evidence: Mapping[str, Any],
) -> Path:
    artifact: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": "secure-content-receiver-visible-evidence",
        "workstreamId": workstream_id,
        "suiteRuntimeId": suite_runtime_id,
        "sourceDigest": source_digest,
        "fixtureEpoch": fixture_epoch,
        "fixtureManifestDigest": fixture_manifest_digest,
        "scenarioId": scenario_id,
        "receiverClientId": receiver_client_id,
        "actionResourceId": evidence["actionResourceId"],
        "receiverResourceId": evidence["receiverResourceId"],
        "actionTag": evidence["actionTag"],
        "receiverTag": evidence["receiverTag"],
        "actionTextSha256": evidence["actionTextSha256"],
        "visibleTextSha256": evidence["visibleTextSha256"],
        "absentTextSha256": evidence["absentTextSha256"],
        "automationSessionId": evidence["automationSessionId"],
        "pageUrlSha256": evidence["pageUrlSha256"],
    }
    artifact["artifactDigest"] = runtime_manifest.canonical_digest(artifact)
    return _write_immutable_json(
        owner_root / variant_id / "receiver-visible-evidence.json",
        artifact,
    )


def _write_social_cross_station_scenario_evidence(
    owner_root: Path,
    *,
    scenario_id: str,
    run_id: str,
    source_commit: str,
    control_commit: str,
    fixture_epoch: str,
    observations: Mapping[str, Any],
) -> Path:
    artifact: dict[str, Any] = {
        "artifactKind": "social-cross-station-scenario-evidence",
        "schemaVersion": 1,
        "scenarioId": scenario_id,
        "status": "PASS",
        "runId": run_id,
        "sourceCommit": source_commit,
        "controlCommit": control_commit,
        "fixtureEpoch": fixture_epoch,
        "observations": dict(observations),
    }
    artifact["artifactDigest"] = runtime_manifest.canonical_digest(artifact)
    return _write_immutable_json(
        owner_root / "scenarios" / scenario_id / "result.json",
        artifact,
    )


def _result_relative_path(
    result: Mapping[str, Any],
    *,
    workstream_id: str,
) -> Path:
    coordinates = {
        "workstreamId": workstream_id,
        "generationId": None,
        "variantId": None,
        "runId": None,
    }
    resolved: dict[str, str] = {}
    for field, expected in coordinates.items():
        value = result.get(field)
        if (
            not isinstance(value, str)
            or not value
            or Path(value).name != value
            or (expected is not None and value != expected)
        ):
            raise RuntimeOwnerBlocked(
                "RESULT_PUBLICATION_INVALID",
                f"{workstream_id} staged result has invalid {field}",
                resource=f"result:secure-content-{workstream_id.lower()}",
            )
        resolved[field] = value
    return (
        Path(resolved["workstreamId"])
        / resolved["generationId"]
        / resolved["variantId"]
        / resolved["runId"]
        / "result.json"
    )


def _stage_child_result(
    result: Mapping[str, Any],
    *,
    workstream_id: str,
    raw_result_root: Path,
    publish_root: Path,
    final_result_root: Path,
    ui_evidence_paths: Sequence[Path],
) -> Mapping[str, Any]:
    relative_path = _result_relative_path(
        result,
        workstream_id=workstream_id,
    )
    raw_root = raw_result_root.resolve()
    raw_result_path = (raw_root / relative_path).resolve()
    final_result_path = (final_result_root.resolve() / relative_path).resolve()
    if not raw_result_path.is_file():
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            (
                f"{workstream_id} staged result is unavailable before "
                "receiver proof publication"
            ),
            resource=f"result:secure-content-{workstream_id.lower()}",
        )
    if not ui_evidence_paths or any(
        not path.resolve().is_file()
        for path in ui_evidence_paths
    ):
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            (
                f"{workstream_id} receiver-visible evidence is unavailable "
                "before result publication"
            ),
            resource=f"result:secure-content-{workstream_id.lower()}",
        )

    artifact_refs = result.get("artifactRefs")
    if not isinstance(artifact_refs, list) or any(
        not isinstance(reference, str) or not reference
        for reference in artifact_refs
    ):
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            f"{workstream_id} staged result artifact references are invalid",
            resource=f"result:secure-content-{workstream_id.lower()}",
        )
    normalized_refs: list[str] = []
    observed_self_ref = False
    for reference in artifact_refs:
        artifact_path = Path(reference).resolve()
        if artifact_path == raw_result_path:
            normalized_refs.append(str(final_result_path))
            observed_self_ref = True
            continue
        if artifact_path == raw_root or raw_root in artifact_path.parents:
            normalized_refs.append(
                str(
                    final_result_root.resolve()
                    / artifact_path.relative_to(raw_root)
                )
            )
            continue
        normalized_refs.append(str(artifact_path))
    if not observed_self_ref:
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            (
                f"{workstream_id} staged result does not reference its "
                "unpublished result"
            ),
            resource=f"result:secure-content-{workstream_id.lower()}",
        )

    for ui_evidence_path in ui_evidence_paths:
        ui_ref = str(ui_evidence_path.resolve())
        if ui_ref not in normalized_refs:
            normalized_refs.append(ui_ref)
    published = json.loads(json.dumps(result))
    completed_at = _utc_now()
    try:
        started_at = datetime.fromisoformat(
            str(published["startedAt"]).replace("Z", "+00:00")
        )
        completed = datetime.fromisoformat(
            completed_at.replace("Z", "+00:00")
        )
        if started_at.tzinfo is None:
            raise ValueError("startedAt must include a timezone")
    except (KeyError, ValueError) as error:
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            f"{workstream_id} staged result timestamps are invalid",
            resource=f"result:secure-content-{workstream_id.lower()}",
        ) from error
    published["artifactRefs"] = normalized_refs
    published["completedAt"] = completed_at
    published["durationMs"] = max(
        int(published.get("durationMs") or 0),
        int((completed - started_at).total_seconds() * 1000),
    )
    published.pop("resultDigest", None)
    published["resultDigest"] = runtime_manifest.canonical_digest(published)
    raw_run_root = raw_result_path.parent
    staged_run_root = (publish_root.resolve() / relative_path.parent).resolve()
    if staged_run_root.exists() or any(
        child.is_symlink()
        for child in raw_run_root.rglob("*")
    ):
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_CONFLICT",
            f"{workstream_id} staged result run is not publishable",
            resource=f"result:secure-content-{workstream_id.lower()}",
        )
    shutil.copytree(raw_run_root, staged_run_root)
    staged_result_path = staged_run_root / "result.json"
    staged_result_path.unlink()
    _write_immutable_json(staged_result_path, published)
    return published


def _publish_result_generation(
    *,
    workstream_id: str,
    publish_root: Path,
    final_result_root: Path,
    generation_id: str,
) -> Path:
    generation = Path(generation_id)
    if generation.name != generation_id:
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            f"{workstream_id} result generation ID is invalid",
            resource=f"result:secure-content-{workstream_id.lower()}",
        )
    staged = (publish_root.resolve() / workstream_id / generation).resolve()
    destination = (
        final_result_root.resolve() / workstream_id / generation
    ).resolve()
    if not staged.is_dir():
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            (
                f"{workstream_id} result generation is incomplete before "
                "publication"
            ),
            resource=f"result:secure-content-{workstream_id.lower()}",
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_CONFLICT",
            f"{workstream_id} result generation already exists",
            resource=f"result:secure-content-{workstream_id.lower()}",
        )
    try:
        os.rename(staged, destination)
    except OSError as error:
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_FAILED",
            (
                f"{workstream_id} result generation could not be published: "
                f"{error}"
            ),
            resource=f"result:secure-content-{workstream_id.lower()}",
        ) from error
    return destination


def _result_publication_root(
    final_result_root: Path,
    *,
    identity: Mapping[str, Any],
    formal_acceptance: bool,
) -> Path:
    if not formal_acceptance:
        return final_result_root.resolve()
    source_projection = str(identity.get("worktreeSetDigest") or "")
    if (
        len(source_projection) != 64
        or any(
            character not in "0123456789abcdef"
            for character in source_projection
        )
    ):
        raise RuntimeOwnerBlocked(
            "RESULT_PUBLICATION_INVALID",
            "Social Acceptance source projection digest is invalid",
            resource="result:secure-content-social-acceptance",
        )
    return (
        final_result_root.resolve()
        / "source-projections"
        / source_projection
    )


def _start_client(
    client: FoundationRuntimeClient,
    *,
    account: str | None,
    password: str,
    anonymous_binding_account: str | None = None,
) -> Mapping[str, Any]:
    try:
        client.start()
    except FoundationClientError as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"client {client.spec.profile} failed to start: {error}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error
    client.configure_station()
    if account is None:
        if client.spec.runtime == "browser":
            if anonymous_binding_account is None:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    (
                        "anonymous Browser requires an account to complete "
                        "Station binding before logout"
                    ),
                    resource=f"client:{client.spec.profile}",
                )
            _authenticate_running_client(
                client,
                account=anonymous_binding_account,
                password=password,
            )
            _ensure_browser_station_binding(client)
            previous_namespace = client.harness_namespace
            try:
                _wait_for_moments_snapshot(client)
            finally:
                client.harness_namespace = previous_namespace
        client.harness("logout", timeout=120)
    else:
        _authenticate_running_client(
            client,
            account=account,
            password=password,
        )
        if client.spec.runtime == "browser":
            _ensure_browser_station_binding(client)
    previous_namespace = client.harness_namespace
    try:
        return _wait_for_moments_snapshot(client)
    finally:
        client.harness_namespace = previous_namespace


def _write_browser_runtime_manifest_with_recovery(
    *,
    manifest_payload: Mapping[str, Any],
    output_path: Path,
    journey_id: str,
    sessions_by_client: Mapping[str, FoundationRuntimeClient],
    repo_root: Path,
    timeout: float = 30.0,
) -> Path:
    payload = json.loads(json.dumps(manifest_payload))
    recovered_client_ids: set[str] = set()

    while True:
        try:
            return write_attached_runtime_manifest(
                manifest_payload=payload,
                output_path=output_path,
                journey_id=journey_id,
                sessions_by_client=sessions_by_client,
                automation_refs_by_client={
                    client_id: {
                        "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                        "endpoint": _webdriver_endpoint(client),
                        "session_id": str(client.driver.session_id),
                    }
                    for client_id, client in sessions_by_client.items()
                },
                repo_root=repo_root,
                timeout=timeout,
            )
        except RunnerError as error:
            failed_client_id = next(
                (
                    client_id
                    for client_id, client in sessions_by_client.items()
                    if client.spec.runtime == "browser"
                    and str(error)
                    == (
                        f"runtime client {client_id!r} did not expose "
                        "'moments' acceptance harness"
                    )
                ),
                None,
            )
            if failed_client_id is None:
                raise

            client = sessions_by_client[failed_client_id]
            if failed_client_id in recovered_client_ids:
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    (
                        f"client {client.spec.profile} lost its Moments "
                        "harness after one bounded Browser attachment recovery"
                    ),
                    resource=f"client:{client.spec.profile}",
                ) from error

            previous_session_id = str(client.driver.session_id)
            clients = payload.get("clients")
            previous = next(
                (
                    item
                    for item in clients
                    if isinstance(item, Mapping)
                    and item.get("id") == failed_client_id
                ),
                None,
            ) if isinstance(clients, list) else None
            actor_role = (
                previous.get("actor_role")
                if isinstance(previous, Mapping)
                else None
            )
            bindings = (
                previous.get("service_bindings")
                if isinstance(previous, Mapping)
                else None
            )
            if (
                not isinstance(actor_role, str)
                or not actor_role
                or not isinstance(bindings, Mapping)
                or any(
                    not isinstance(binding, Mapping)
                    or not str(binding.get("service_id") or "")
                    for binding in bindings.values()
                )
            ):
                raise
            service_roles = {
                str(role): str(binding["service_id"])
                for role, binding in bindings.items()
            }

            try:
                previous_namespace = client.harness_namespace
                client.restart()
                try:
                    snapshot = _wait_for_moments_snapshot(client)
                finally:
                    client.harness_namespace = previous_namespace
                refreshed = _client_payload(
                    failed_client_id,
                    actor_role,
                    client,
                    snapshot,
                    service_roles=service_roles,
                )
            except Exception as recovery_error:
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    redact_text(
                        (
                            f"client {client.spec.profile} Browser attachment "
                            "recovery failed: "
                            f"{_error_message_with_cleanup(recovery_error)}"
                        )
                    ),
                    resource=f"client:{client.spec.profile}",
                ) from recovery_error

            if (
                refreshed["storage_identity_digest"]
                != previous.get("storage_identity_digest")
                or str(client.driver.session_id) == previous_session_id
                or refreshed["actor_role_digest"]
                != previous.get("actor_role_digest")
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    (
                        f"client {client.spec.profile} Browser attachment "
                        "recovery did not preserve storage and actor identity "
                        "with a fresh WebDriver session"
                    ),
                    resource=f"client:{client.spec.profile}",
                )

            payload["clients"] = [
                refreshed if item.get("id") == failed_client_id else item
                for item in clients
            ]
            recovered_client_ids.add(failed_client_id)


def _ensure_browser_station_binding(
    client: FoundationRuntimeClient,
) -> None:
    import urllib.request

    url = f"http://127.0.0.1:{client.spec.gateway_port}/command"
    payload = json.dumps({"cmd": "station_binding_complete", "args": {}}).encode()
    request = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read())
            if not isinstance(result, dict) or result.get("ok") is not True:
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    f"browser station binding failed for {client.spec.profile}: {result}",
                    resource=f"client:{client.spec.profile}",
                )
    except (urllib.error.URLError, OSError) as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"browser station binding unreachable for {client.spec.profile}: {error}",
            resource=f"client:{client.spec.profile}",
        ) from error


def _manifest_payload(
    *,
    identity: Mapping[str, str],
    journey_id: str,
    run_id: str,
    services: Mapping[str, Mapping[str, Any]],
    fixture_ref: Mapping[str, str],
    fixture_digest: str,
    clients: Sequence[Mapping[str, Any]],
    controller_profile: str = PROFILE,
    controller_slot: int = SLOT,
    continuation: Mapping[str, Any] | None = None,
    post_cut_epoch_id: str | None = None,
    final_cut_bindings: Mapping[str, Mapping[str, str]] | None = None,
) -> dict[str, Any]:
    source = {
        "canonical_worktree": str(identity["root"]),
        "workspace_id": identity["workspaceId"],
        "commit": identity["head"],
        "worktree_set_digest": identity["worktreeSetDigest"],
        "workspace_digest": "clean",
    }
    source_evidence_workspace_id = identity.get(
        "sourceEvidenceWorkspaceId"
    )
    if (
        isinstance(source_evidence_workspace_id, str)
        and source_evidence_workspace_id
        != identity["workspaceId"]
    ):
        source["source_evidence_workspace_id"] = (
            source_evidence_workspace_id
        )
    payload: dict[str, Any] = {
        "schema_version": runtime_manifest.SCHEMA_VERSION,
        "kind": runtime_manifest.MANIFEST_KIND,
        "run_id": run_id,
        "journey_id": journey_id,
        "source": source,
        "controller_binding": {
            "profile_id": controller_profile,
            "slot": controller_slot,
        },
        "services": {
            service_id: dict(service)
            for service_id, service in services.items()
        },
        "clients": [dict(client) for client in clients],
        "fixture_manifest_ref": dict(fixture_ref),
        "fixture_manifest_digest": fixture_digest,
        "lifecycle_observer_capabilities": sorted(
            runtime_manifest.LIFECYCLE_OBSERVER_CAPABILITIES
        ),
        "created_at": _utc_now(),
    }
    if continuation is not None:
        payload["continuation"] = dict(continuation)
    if post_cut_epoch_id is not None or final_cut_bindings is not None:
        if post_cut_epoch_id is None or final_cut_bindings is None:
            raise RuntimeOwnerBlocked(
                "FINAL_CUT_BINDING_UNAVAILABLE",
                "post-cut epoch and final-cut bindings must be supplied together",
                resource="runtime:secure-content-w12",
            )
        payload["post_cut_epoch_id"] = post_cut_epoch_id
        payload["final_cut_bindings"] = {
            profile_id: dict(binding)
            for profile_id, binding in final_cut_bindings.items()
        }
    return payload


def _load_final_cut_bindings(
    result_root: Path,
    *,
    generation_id: str,
    workspace_id: str,
) -> dict[str, dict[str, str]]:
    result_root = result_root.resolve()
    bindings: dict[str, dict[str, str]] = {}
    for profile_id, workstream_id, service_id in (
        ("four", "W12F-FOUR", STATION_ID),
        ("fiveArm", "W12F-FIVEARM", SECONDARY_STATION_ID),
    ):
        candidates = sorted(
            (
                result_root
                / "W12"
                / "final-cut"
                / generation_id
                / profile_id
            ).glob("*/result.json")
        )
        if len(candidates) != 1:
            raise RuntimeOwnerBlocked(
                "FINAL_CUT_BINDING_UNAVAILABLE",
                (
                    f"profile {profile_id} requires exactly one FINAL_CUT "
                    f"result, found {len(candidates)}"
                ),
                resource=f"fixture:secure-content-final-cut-{profile_id}",
            )
        result_path = candidates[0]
        try:
            result = schema_activation.read_json_artifact(
                result_path,
                f"{profile_id} FINAL_CUT result",
            )
        except schema_activation.SchemaActivationError as error:
            raise RuntimeOwnerBlocked(
                "FINAL_CUT_BINDING_UNAVAILABLE",
                f"profile {profile_id} FINAL_CUT result is unavailable",
                resource=f"fixture:secure-content-final-cut-{profile_id}",
            ) from error
        result_content = dict(result)
        result_digest = result_content.pop("result_digest", None)
        expected = {
            "kind": schema_activation.PROFILE_RESULT_KIND,
            "workstream_id": workstream_id,
            "task_id": "W12",
            "generation_id": generation_id,
            "source_commit": generation_id,
            "workspace_id": workspace_id,
            "profile_id": profile_id,
            "reset_id": result_path.parent.name,
            "reset_intent": "FINAL_CUT",
            "journal_state": "COMPLETE",
            "status": "PASS",
            "claim": "FINAL_RESET_COMPLETE_ONLY",
        }
        if (
            any(result.get(field) != value for field, value in expected.items())
            or not isinstance(result_digest, str)
            or len(result_digest) != 64
            or not hmac.compare_digest(
                result_digest,
                runtime_manifest.canonical_digest(result_content),
            )
        ):
            raise RuntimeOwnerBlocked(
                "FINAL_CUT_BINDING_UNAVAILABLE",
                f"profile {profile_id} FINAL_CUT result is invalid",
                resource=f"fixture:secure-content-final-cut-{profile_id}",
            )
        try:
            attestation_path, attestation = (
                schema_activation.read_referenced_artifact(
                    result_root,
                    result.get("schema_attestation_ref"),
                    f"{profile_id} FINAL_CUT schema attestation",
                )
            )
        except (schema_activation.SchemaActivationError, OSError) as error:
            raise RuntimeOwnerBlocked(
                "FINAL_CUT_BINDING_UNAVAILABLE",
                (
                    f"profile {profile_id} FINAL_CUT schema attestation "
                    "is unavailable"
                ),
                resource=f"fixture:secure-content-final-cut-{profile_id}",
            ) from error
        expected_attestation_path = (
            result_path.parent
            / runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
        )
        attestation_content = dict(attestation)
        attestation_digest = attestation_content.pop(
            "attestation_digest",
            None,
        )
        station_runtime_identity = attestation.get(
            "station_runtime_identity"
        )
        if (
            attestation_path != expected_attestation_path
            or attestation.get("source_commit") != generation_id
            or attestation.get("workspace_id") != workspace_id
            or attestation.get("profile_id") != profile_id
            or attestation.get("station_service_id") != service_id
            or attestation.get("reset_intent") != "FINAL_CUT"
            or result.get("schema_attestation_digest")
            != attestation_digest
            or not isinstance(attestation_digest, str)
            or len(attestation_digest) != 64
            or not hmac.compare_digest(
                attestation_digest,
                runtime_manifest.canonical_digest(attestation_content),
            )
            or not isinstance(station_runtime_identity, str)
            or not station_runtime_identity
        ):
            raise RuntimeOwnerBlocked(
                "FINAL_CUT_BINDING_UNAVAILABLE",
                f"profile {profile_id} FINAL_CUT schema attestation is invalid",
                resource=f"fixture:secure-content-final-cut-{profile_id}",
            )
        bindings[profile_id] = {
            "result_digest": result_digest,
            "reset_id": result_path.parent.name,
            "schema_attestation_digest": attestation_digest,
            "station_runtime_identity": station_runtime_identity,
        }
    return bindings


def _continuation_run_id(parent_run_id: str, restart_request_id: str) -> str:
    return (
        f"{parent_run_id}-c-"
        f"{_sha256(f'{parent_run_id}:{restart_request_id}')[:12]}"
    )


def _continuation_services(
    root: Path,
    *,
    run_id: str,
    journey_id: str,
    services: Mapping[str, Mapping[str, Any]],
    attestations: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        service_id: {
            **dict(service),
            "attestation_artifact_ref": _publish_attestation(
                root,
                attestations[service_id],
                run_id=run_id,
                journey_id=journey_id,
                service_id=service_id,
                artifact_directory="continuation-attestations",
            ),
        }
        for service_id, service in services.items()
    }


def _stage_continuation_evidence(
    *,
    blocked_result_path: Path,
    request_path: Path,
    child_run_id: str,
    client_id: str,
    acknowledgement: Mapping[str, Any],
) -> Path:
    parent_artifact_dir = blocked_result_path.parent
    child_artifact_dir = parent_artifact_dir.parent / child_run_id
    resume_path = parent_artifact_dir / "desktop-pilot-resume.json"
    for source in (blocked_result_path, resume_path, request_path):
        try:
            raw = source.read_bytes()
        except OSError as error:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                f"continuation evidence is unavailable: {source.name}",
                resource=f"client:{client_id}",
            ) from error
        child_artifact_dir.mkdir(parents=True, exist_ok=True)
        target = child_artifact_dir / source.name
        descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    _write_immutable_json(
        child_artifact_dir / f"restart-acknowledgement-{client_id}.json",
        acknowledgement,
    )
    return child_artifact_dir


def _fixture_binding_id(
    run_id: str,
    capability: str,
    identity_digest: str,
) -> str:
    return (
        f"w7-{capability}-"
        f"{_sha256(f'{run_id}:{capability}:{identity_digest}')[:20]}"
    )


def _build_fixture_owner(
    *,
    identity: Mapping[str, str],
    run_id: str,
    secondary_station_url: str,
    password: str,
    accounts: Mapping[str, str],
    desktop: Mapping[str, FoundationRuntimeClient],
) -> W7FixtureOwner:
    alice = desktop[DESKTOP_CLIENTS[0][0]]
    bob = desktop[DESKTOP_CLIENTS[1][0]]
    eve = desktop[DESKTOP_CLIENTS[2][0]]
    pin = f"{secrets.randbelow(100_000_000):08d}"

    account = _fixture_harness(
        eve,
        "prepareAccountSwitch",
        {
            "secondaryAccount": accounts[DESKTOP_CLIENTS[0][2]],
            "password": password,
            "pin": pin,
        },
    )
    primary_account_id = _required_text(
        account.get("primaryAccountId"),
        "account-switch-primary-account",
    )
    secondary_account_id = _required_text(
        account.get("secondaryAccountId"),
        "account-switch-secondary-account",
    )
    primary_actor_ptid = _required_text(
        account.get("primaryActorPtid"),
        "account-switch-primary-actor",
    )
    secondary_actor_ptid = _required_text(
        account.get("secondaryActorPtid"),
        "account-switch-secondary-actor",
    )
    primary_storage_identity = _required_text(
        account.get("primaryStorageIdentitySha256"),
        "account-switch-primary-storage",
    )
    secondary_storage_identity = _required_text(
        account.get("secondaryStorageIdentitySha256"),
        "account-switch-secondary-storage",
    )
    if (
        len(primary_storage_identity) != 64
        or len(secondary_storage_identity) != 64
        or primary_storage_identity == secondary_storage_identity
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "account-switch fixture storage identities are invalid",
            resource="fixture:account-switch",
        )
    account_identity = fixture_identity_digest(
        {
            "capability": "account-switch",
            "clientId": DESKTOP_CLIENTS[2][0],
            "primaryAccountIdSha256": _sha256(primary_account_id),
            "primaryActorPtidSha256": _sha256(primary_actor_ptid),
            "primaryStorageIdentitySha256": primary_storage_identity,
            "secondaryAccountIdSha256": _sha256(secondary_account_id),
            "secondaryActorPtidSha256": _sha256(secondary_actor_ptid),
            "secondaryStorageIdentitySha256": secondary_storage_identity,
            "sourceCheckpoint": identity["head"],
        }
    )
    _authenticate_running_client(
        alice,
        account=accounts[DESKTOP_CLIENTS[0][2]],
        password=password,
    )

    station = _fixture_harness(
        bob,
        "prepareStationSwitch",
        {"secondaryStationUrl": secondary_station_url},
    )
    primary_station_url = _required_text(
        station.get("primaryStationUrl"),
        "station-switch-primary-url",
    )
    secondary_station_url = _required_text(
        station.get("secondaryStationUrl"),
        "station-switch-secondary-url",
    )
    primary_station_peer_id = _required_text(
        station.get("primaryStationPeerId"),
        "station-switch-primary-peer",
    )
    secondary_station_peer_id = _required_text(
        station.get("secondaryStationPeerId"),
        "station-switch-secondary-peer",
    )
    station_identity = fixture_identity_digest(
        {
            "capability": "station-switch",
            "clientId": DESKTOP_CLIENTS[1][0],
            "primaryStationIdentitySha256": _sha256(
                f"{primary_station_peer_id}:{primary_station_url}"
            ),
            "secondaryStationIdentitySha256": _sha256(
                f"{secondary_station_peer_id}:{secondary_station_url}"
            ),
            "sourceCheckpoint": identity["head"],
        }
    )

    publisher = _fixture_harness(
        alice,
        "preparePublisherDeviceRevocation",
    )
    publisher_actor_ptid = _required_text(
        publisher.get("actorPtid"),
        "publisher-device-actor",
    )
    publisher_device_id = _required_text(
        publisher.get("deviceId"),
        "publisher-device-id",
    )
    publisher_profile_version = _required_text(
        publisher.get("observedProfileVersion"),
        "publisher-device-profile-version",
    )
    publisher_identity = fixture_identity_digest(
        {
            "actorPtidSha256": _sha256(publisher_actor_ptid),
            "capability": "publisher-device-revocation",
            "clientId": DESKTOP_CLIENTS[0][0],
            "deviceIdSha256": _sha256(publisher_device_id),
            "observedProfileVersion": publisher_profile_version,
            "sourceCheckpoint": identity["head"],
        }
    )

    publisher_recovery = _fixture_harness(
        alice,
        "prepareHistoricalRecoveryEpoch",
    )
    publisher_recovery_actor_ptid = _required_text(
        publisher_recovery.get("actorPtid"),
        "publisher-recovery-actor",
    )
    if publisher_recovery_actor_ptid != publisher_actor_ptid:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "publisher recovery actor does not match the publisher fixture",
            resource="fixture:publisher-recovery-actor",
        )
    _required_text(
        publisher_recovery.get("backupId"),
        "publisher-recovery-backup",
    )
    _required_integer(
        publisher_recovery.get("recoveryEpoch"),
        "publisher-recovery-epoch",
    )
    _required_integer(
        publisher_recovery.get("recoveryPreKeyAvailable"),
        "publisher-recovery-prekey-availability",
    )

    recovery = _fixture_harness(
        bob,
        "prepareHistoricalRecoveryEpoch",
    )
    recovery_actor_ptid = _required_text(
        recovery.get("actorPtid"),
        "historical-recovery-actor",
    )
    recovery_backup_id = _required_text(
        recovery.get("backupId"),
        "historical-recovery-backup",
    )
    recovery_epoch = _required_integer(
        recovery.get("recoveryEpoch"),
        "historical-recovery-epoch",
    )
    _required_integer(
        recovery.get("recoveryPreKeyAvailable"),
        "historical-recovery-prekey-availability",
    )
    recovery_identity = fixture_identity_digest(
        {
            "actorPtidSha256": _sha256(recovery_actor_ptid),
            "backupIdSha256": _sha256(recovery_backup_id),
            "capability": "historical-recovery-epoch",
            "recoveryEpoch": recovery_epoch,
            "sourceCheckpoint": identity["head"],
        }
    )

    def account_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "account-switch action does not accept scenario-owned input",
                resource="fixture:account-switch",
            )
        result = _fixture_harness(
            eve,
            "roundTripAccountSwitch",
            {
                "primaryAccountId": primary_account_id,
                "primaryActorPtid": primary_actor_ptid,
                "primaryStorageIdentitySha256": primary_storage_identity,
                "primaryLoginId": accounts[DESKTOP_CLIENTS[2][2]],
                "secondaryAccountId": secondary_account_id,
                "secondaryActorPtid": secondary_actor_ptid,
                "secondaryStorageIdentitySha256": secondary_storage_identity,
                "secondaryLoginId": accounts[DESKTOP_CLIENTS[0][2]],
                "pin": pin,
                "password": password,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        primary_actor_digest = _sha256(primary_actor_ptid)
        secondary_actor_digest = _sha256(secondary_actor_ptid)
        completed = (
            result.get("staleProjectionCleared") is True
            and result.get("primaryActorPtidSha256") == primary_actor_digest
            and result.get("secondaryActorPtidSha256") == secondary_actor_digest
            and result.get("primaryStorageIdentitySha256")
            == primary_storage_identity
            and result.get("secondaryStorageIdentitySha256")
            == secondary_storage_identity
        )
        return {
            "completed": completed,
            "fixtureIdentityDigest": account_identity,
            "primaryActorIdentitySha256": primary_actor_digest,
            "primaryStorageIdentitySha256": primary_storage_identity,
            "secondaryActorIdentitySha256": secondary_actor_digest,
            "secondaryStorageIdentitySha256": secondary_storage_identity,
            "sessionGenerationAdvanced": (
                isinstance(result.get("beforeGeneration"), int)
                and isinstance(result.get("afterGeneration"), int)
                and int(result["afterGeneration"])
                > int(result["beforeGeneration"])
            ),
        }

    def station_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "station-switch action does not accept scenario-owned input",
                resource="fixture:station-switch",
            )
        result = _fixture_harness(
            bob,
            "roundTripStationSwitch",
            {
                "account": accounts[DESKTOP_CLIENTS[1][2]],
                "password": password,
                "primaryStationUrl": primary_station_url,
                "secondaryStationUrl": secondary_station_url,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        primary_station_digest = _sha256(
            f"{primary_station_peer_id}:{primary_station_url}"
        )
        secondary_station_digest = _sha256(
            f"{secondary_station_peer_id}:{secondary_station_url}"
        )
        return {
            "completed": (
                isinstance(result.get("generationBefore"), int)
                and isinstance(result.get("generationAfter"), int)
                and int(result["generationAfter"])
                > int(result["generationBefore"])
                and result.get("primaryStationIdentitySha256")
                == primary_station_digest
                and result.get("secondaryStationIdentitySha256")
                == secondary_station_digest
            ),
            "fixtureIdentityDigest": station_identity,
            "primaryStationIdentitySha256": primary_station_digest,
            "secondaryStationIdentitySha256": secondary_station_digest,
        }

    def revoke_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "device-revocation action does not accept scenario-owned input",
                resource="fixture:publisher-device-revocation",
            )
        result = _fixture_harness(
            alice,
            "revokePublisherDevice",
            {
                "deviceId": publisher_device_id,
                "observedProfileVersion": publisher_profile_version,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        actor_digest = _sha256(publisher_actor_ptid)
        device_digest = _sha256(publisher_device_id)
        return {
            "completed": (
                result.get("revoked") is True
                and result.get("actorPtidSha256") == actor_digest
                and result.get("deviceIdSha256") == device_digest
                and result.get("observedProfileVersion")
                == publisher_profile_version
                and result.get("committedProfileVersion")
                == publisher_profile_version
            ),
            "fixtureIdentityDigest": publisher_identity,
            "actorIdentitySha256": actor_digest,
            "deviceIdentitySha256": device_digest,
            "observedProfileVersion": result.get("observedProfileVersion"),
            "committedProfileVersion": result.get("committedProfileVersion"),
        }

    def recovery_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "recovery-epoch action does not accept scenario-owned input",
                resource="fixture:historical-recovery-epoch",
            )
        result = _fixture_harness(
            bob,
            "advanceHistoricalRecoveryEpoch",
            {
                "expectedEpoch": recovery_epoch,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        actor_digest = _sha256(recovery_actor_ptid)
        return {
            "completed": (
                result.get("actorPtidSha256") == actor_digest
                and result.get("previousEpoch") == recovery_epoch
                and result.get("currentEpoch") == recovery_epoch + 1
                and isinstance(result.get("recoveryPreKeyAvailable"), int)
                and int(result["recoveryPreKeyAvailable"]) > 0
            ),
            "fixtureIdentityDigest": recovery_identity,
            "actorIdentitySha256": actor_digest,
            "backupIdentitySha256": result.get("backupIdSha256"),
            "previousEpoch": result.get("previousEpoch"),
            "currentEpoch": result.get("currentEpoch"),
        }

    return W7FixtureOwner(
        source_checkpoint=identity["head"],
        run_id=run_id,
        bindings=(
            W7FixtureBinding(
                capability="account-switch",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "account-switch",
                    account_identity,
                ),
                expected_identity_digest=account_identity,
                action=account_action,
                sensitive_values=(
                    pin,
                    primary_account_id,
                    primary_actor_ptid,
                    secondary_account_id,
                    secondary_actor_ptid,
                ),
            ),
            W7FixtureBinding(
                capability="station-switch",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "station-switch",
                    station_identity,
                ),
                expected_identity_digest=station_identity,
                action=station_action,
            ),
            W7FixtureBinding(
                capability="publisher-device-revocation",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "publisher-device-revocation",
                    publisher_identity,
                ),
                expected_identity_digest=publisher_identity,
                action=revoke_action,
                sensitive_values=(
                    publisher_actor_ptid,
                    publisher_device_id,
                ),
            ),
            W7FixtureBinding(
                capability="historical-recovery-epoch",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "historical-recovery-epoch",
                    recovery_identity,
                ),
                expected_identity_digest=recovery_identity,
                action=recovery_action,
                sensitive_values=(
                    recovery_actor_ptid,
                    recovery_backup_id,
                ),
                secret_channel_ref="w7-recovery-secret-channel",
            ),
        ),
    )


def _close_fixture_action_channel(
    context: EphemeralGateLaunchContext,
    client: EphemeralGateClient,
) -> None:
    failures: list[str] = []
    try:
        client.close()
    except Exception as error:
        failures.append(f"client close: {error}")
    try:
        context.quiesce()
    except Exception as error:
        failures.append(f"context quiesce: {error}")
    result = None
    try:
        result = context.close()
    except Exception as error:
        failures.append(f"context close: {error}")
    if failures or result is None or not result.succeeded:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            "W7 fixture action channel did not close cleanly"
            + (f": {'; '.join(failures)}" if failures else ""),
            resource="fixture:secure-content-w7",
        )


def _stop_client_or_raise(
    client: FoundationRuntimeClient,
    *,
    purpose: str,
    active_client_ids: set[int],
) -> None:
    client_identity = id(client)
    if client_identity not in active_client_ids:
        return
    cleanup = client.stop()
    if cleanup["status"] != "clean":
        failures = cleanup.get("failures")
        detail = (
            "; ".join(str(item) for item in failures)
            if isinstance(failures, list) and failures
            else "cleanup owner returned no failure detail"
        )
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            redact_text(
                f"{purpose} cleanup failed for {client.spec.profile}: {detail}"
            ),
            resource=f"client:{client.spec.profile}",
        )
    active_client_ids.discard(client_identity)


def _close_runtime_stack(
    stack: ExitStack,
    *,
    primary_error: BaseException | None = None,
) -> None:
    try:
        stack.close()
    except BaseException as cleanup_error:
        if primary_error is None:
            raise
        cleanup_code = getattr(
            cleanup_error,
            "code",
            type(cleanup_error).__name__,
        )
        cleanup_note = (
            f"secondary runtime cleanup failure: {cleanup_code}: "
            f"{redact_text(str(cleanup_error))}"
        )
        existing = tuple(
            getattr(primary_error, "secondary_cleanup_failures", ())
        )
        setattr(
            primary_error,
            "secondary_cleanup_failures",
            (*existing, cleanup_note),
        )
        add_note = getattr(primary_error, "add_note", None)
        if callable(add_note):
            add_note(cleanup_note)


@contextmanager
def _runtime_cleanup_scope(stack: ExitStack) -> Iterator[ExitStack]:
    try:
        yield stack
    except BaseException as primary_error:
        _close_runtime_stack(stack, primary_error=primary_error)
        raise
    else:
        _close_runtime_stack(stack)


@contextmanager
def _restart_lease(
    runtime_root: Path,
    *,
    request_id: str,
    client_id: str,
) -> Iterator[tuple[str, str, str]]:
    path = runtime_root / "leases" / f"{client_id}.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeOwnerBlocked(
                "RUNTIME_LEASE_UNAVAILABLE",
                f"restart lease is unavailable for {client_id}",
                resource=f"client.storage:{client_id}",
            ) from error
        acquired = datetime.now(timezone.utc)
        expires = acquired + timedelta(minutes=20)
        lease_id = f"{request_id}-{os.getpid()}-{path.stat().st_ino}"
        yield (
            lease_id,
            acquired.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            expires.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        )


class W7RuntimeOwner:
    def __init__(
        self,
        *,
        repo_root: Path,
        result_root: Path,
        runtime_root: Path | None = None,
    ) -> None:
        self.repo_root = repo_root.resolve(strict=True)
        self.result_root = result_root.resolve()
        canonical_runtime_root = self.result_root / "runtime-owner"
        self.runtime_root = (
            runtime_root.resolve()
            if runtime_root is not None
            else canonical_runtime_root
        )
        self.shared_identity_root = canonical_runtime_root / "shared"

    def preflight(self) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        resolved, _profile_env = _resolve_machine_profile(self.repo_root)
        _secondary_profile_path, secondary_profile_env = (
            _resolve_secondary_profile(resolved)
        )
        return {
            "status": "READY",
            "proofState": "UNPROVEN",
            "workspaceId": identity["workspaceId"],
            "sourceCommit": identity["head"],
            "profile": resolved["binding"]["profile"],
            "slot": resolved["binding"]["slot"],
            "station": resolved["profile"]["stationUrl"],
            "secondaryProfile": SECONDARY_PROFILE,
            "secondaryStation": secondary_profile_env["PT_STATION_URL"],
            "fixtureOwner": "runtime-bound",
        }

    def run_w7_desktop_suite(self) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        resolved, profile_env = _resolve_machine_profile(self.repo_root)
        _secondary_profile_path, secondary_profile_env = (
            _resolve_secondary_profile(resolved)
        )
        run_id = (
            f"w7-desktop-suite-{identity['head'][:12]}-{os.getpid()}-"
            f"{time.time_ns()}"
        )
        owner_root = self.runtime_root / run_id
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / DESKTOP_JOURNEY
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(
            (
                (STATION_ID, profile_env),
                (SECONDARY_STATION_ID, secondary_profile_env),
            )
        )
        station_url = station_endpoints[STATION_ID].transport_url
        secondary_station_url = station_endpoints[
            SECONDARY_STATION_ID
        ].transport_url
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": DESKTOP_JOURNEY,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                attestation = produce_station_attestation(
                    environment_id="secure-content-w7-runtime",
                    run_id=run_id,
                    service_id=STATION_ID,
                    station_url=station_url,
                    profile_env=profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
                secondary_attestation = produce_station_attestation(
                    environment_id="secure-content-w7-runtime",
                    run_id=run_id,
                    service_id=SECONDARY_STATION_ID,
                    station_url=secondary_station_url,
                    profile_env=secondary_profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            reason = _error_message_with_cleanup(error)
            resource = (
                error.resource
                if isinstance(error, BlockedError)
                else "station:station-four"
            )
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                reason,
                resource=resource,
            ) from error
        if (
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != source_proto_digest(self.repo_root)
            or not commits_match(
                secondary_attestation.live_commit,
                identity["head"],
            )
            or secondary_attestation.protocol_digest
            != source_proto_digest(self.repo_root)
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "W7 Stations are not deployed from the exact source",
                resource="station:secure-content-w7",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        try:
            schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    self.result_root,
                    self.repo_root,
                    identity,
                    attestation,
                    service_id=STATION_ID,
                    profile_id=PROFILE,
                    attested_endpoint=profile_env["PT_STATION_URL"],
                )
            )
            secondary_schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    self.result_root,
                    self.repo_root,
                    identity,
                    secondary_attestation,
                    service_id=SECONDARY_STATION_ID,
                    profile_id=SECONDARY_PROFILE,
                    attested_endpoint=secondary_profile_env["PT_STATION_URL"],
                )
            )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        fixture_epoch = "w7-" + _sha256(run_id)[:32]
        ledger = SuiteRuntimeLedger(
            W7_RUNTIME_REUSE,
            suite_runtime_id=run_id,
            source_digest=str(identity["head"]),
            fixture_epoch=fixture_epoch,
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime:w7",
        )
        raw_result_root = owner_root / "unpublished-results"
        publish_root = owner_root / "publish-ready"
        receiver_evidence_refs: dict[str, dict[str, str]] = {}
        with _runtime_cleanup_scope(transport_stack) as stack:
            _activate_scenario_journey(
                self.repo_root,
                DESKTOP_JOURNEY,
                work_item_id=WORK_ITEM_ID,
                task_id=TASK_ID,
            )
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_url,
                secondary_station_url=secondary_station_url,
                run_id=run_id,
                roles=(
                    "alice",
                    "bob",
                    "eve",
                ),
                secondary_roles=("bob",),
            )
            for role in (
                "alice",
                "bob",
                "eve",
            ):
                ledger.record(
                    SuiteRuntimeAction.ACCOUNT_PROVISION,
                    resource_id=f"account:{PROFILE}:{role}",
                )
            ledger.record(
                SuiteRuntimeAction.ACCOUNT_PROVISION,
                resource_id=f"account:{SECONDARY_PROFILE}:bob",
            )
            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            desktop: dict[str, FoundationRuntimeClient] = {}
            for index, (client_id, actor, account_role) in enumerate(DESKTOP_CLIENTS):
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_url,
                    profile_env=profile_env,
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind="native-tauri",
                    port_bases=(3530 + index * 20, 3710 + index * 20, 4495 + index * 20),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose="Desktop",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                _start_client(
                    client,
                    account=accounts[account_role],
                    password=password,
                )
                _wait_for_device_enrollment(client)
                desktop[client_id] = client
                ledger.record(
                    SuiteRuntimeAction.CLIENT_LAUNCH,
                    resource_id=f"client:{client_id}",
                )
                ledger.record(
                    SuiteRuntimeAction.LOGIN,
                    resource_id=f"session:{client_id}",
                )

            _prepare_accepted_friendship(
                desktop[DESKTOP_CLIENTS[0][0]],
                desktop[DESKTOP_CLIENTS[1][0]],
            )
            fixture_owner = _build_fixture_owner(
                identity=identity,
                run_id=run_id,
                secondary_station_url=secondary_station_url,
                password=password,
                accounts=accounts,
                desktop=desktop,
            )
            fixture_path = fixture_owner.write_manifest(
                owner_root / "fixture.json"
            )
            fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
            _validate_fixture(fixture, source_commit=identity["head"])
            fixture_ref = {
                "path": fixture_path.name,
                "sha256": _sha256(fixture_path.read_bytes()),
            }
            fixture_digest = str(fixture["manifest_digest"])

            desktop_payloads: list[dict[str, Any]] = []
            for client_id, actor, _account_role in DESKTOP_CLIENTS:
                client = desktop[client_id]
                previous_namespace = client.harness_namespace
                client.harness_namespace = "moments"
                try:
                    snapshot = client.harness("snapshot", timeout=60)
                finally:
                    client.harness_namespace = previous_namespace
                desktop_payloads.append(
                    _client_payload(
                        client_id,
                        actor,
                        client,
                        snapshot,
                        service_roles={
                            "station": STATION_ID,
                            "station-secondary": SECONDARY_STATION_ID,
                        },
                    )
                )

            desktop_dir = owner_root / "desktop"
            desktop_fixture_ref = self._copy_fixture_into(
                owner_root / fixture_ref["path"],
                desktop_dir,
            )
            desktop_attestation_ref = _publish_attestation(
                desktop_dir,
                attestation,
                run_id=run_id,
                journey_id=DESKTOP_JOURNEY,
                service_id=STATION_ID,
            )
            desktop_secondary_attestation_ref = _publish_attestation(
                desktop_dir,
                secondary_attestation,
                run_id=run_id,
                journey_id=DESKTOP_JOURNEY,
                service_id=SECONDARY_STATION_ID,
            )
            desktop_schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    desktop_dir,
                    STATION_ID,
                    schema_attestation,
                )
            )
            desktop_secondary_schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    desktop_dir,
                    SECONDARY_STATION_ID,
                    secondary_schema_attestation,
                )
            )
            services = {
                STATION_ID: _service_payload(
                    attestation,
                    desktop_attestation_ref,
                    desktop_schema_attestation_ref,
                    profile_id=PROFILE,
                    schema_attestation_endpoint=profile_env[
                        "PT_STATION_URL"
                    ],
                ),
                SECONDARY_STATION_ID: _service_payload(
                    secondary_attestation,
                    desktop_secondary_attestation_ref,
                    desktop_secondary_schema_attestation_ref,
                    profile_id=SECONDARY_PROFILE,
                    schema_attestation_endpoint=secondary_profile_env[
                        "PT_STATION_URL"
                    ],
                ),
            }
            parent_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=DESKTOP_JOURNEY,
                    run_id=run_id,
                    services=services,
                    fixture_ref=desktop_fixture_ref,
                    fixture_digest=fixture_digest,
                    clients=desktop_payloads,
                ),
                output_path=desktop_dir / "runtime-parent.json",
                journey_id=DESKTOP_JOURNEY,
                sessions_by_client=desktop,
                automation_refs_by_client={
                    client_id: {
                        "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                        "endpoint": _webdriver_endpoint(client),
                        "session_id": str(client.driver.session_id),
                    }
                    for client_id, client in desktop.items()
                },
                repo_root=self.repo_root,
            )
            blocked_result_path: Path | None = None
            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="desktop-pre-restart",
            )
            try:
                execute_scenario(
                    runtime="desktop",
                    scenario_id="desktop-pilot",
                    budget_seconds=1200,
                    repo_root=self.repo_root,
                    profile=None,
                    profiles=(PROFILE, SECONDARY_PROFILE),
                    clients=tuple(item[0] for item in DESKTOP_CLIENTS),
                    runtime_manifest_path=parent_path,
                    result_root=raw_result_root,
                    workspace_identity=identity,
                )
            except ScenarioBlocked as error:
                if error.kind != "BLOCKED_RUNTIME_ACTION_REQUIRED":
                    raise
                blocked_result_path = error.result_path
            if blocked_result_path is None:
                raise RuntimeOwnerBlocked(
                    "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                    "Desktop pilot did not publish its restart boundary",
                    resource=f"client:{DESKTOP_CLIENTS[1][0]}",
                )
            pre_restart_ui = _receiver_ui_probe(
                desktop[DESKTOP_CLIENTS[1][0]],
                workstream_id=TASK_ID,
                scenario_id="desktop-pre-restart",
                action_text=None,
                visible_text=W7_PRIVATE_TEXT,
                open_comments=False,
            )
            pre_restart_ui_path = _write_receiver_ui_evidence(
                owner_root,
                workstream_id=TASK_ID,
                suite_runtime_id=run_id,
                source_digest=str(identity["head"]),
                fixture_epoch=fixture_epoch,
                fixture_manifest_digest=fixture_digest,
                scenario_id="desktop-pre-restart",
                variant_id="desktop-pre-restart",
                receiver_client_id=DESKTOP_CLIENTS[1][0],
                evidence=pre_restart_ui,
            )
            pre_restart_ref = {
                "path": pre_restart_ui_path.relative_to(owner_root).as_posix(),
                "sha256": _sha256(pre_restart_ui_path.read_bytes()),
            }
            receiver_evidence_refs["desktop-pre-restart"] = pre_restart_ref
            pre_restart_resource = (
                "artifact:"
                + pre_restart_ref["path"]
                + ":"
                + pre_restart_ref["sha256"]
            )
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id="desktop-pre-restart",
                resource_id=f"{pre_restart_resource}:ui-action",
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id="desktop-pre-restart",
                resource_id=f"{pre_restart_resource}:receiver",
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id="desktop-pre-restart",
                resource_id=pre_restart_resource,
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id="desktop-pre-restart",
            )
            request_path = (
                blocked_result_path.parent
                / f"restart-request-{DESKTOP_CLIENTS[1][0]}.json"
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            bob = desktop[DESKTOP_CLIENTS[1][0]]
            previous = next(
                item for item in desktop_payloads
                if item["id"] == DESKTOP_CLIENTS[1][0]
            )
            with _restart_lease(
                owner_root,
                request_id=str(request["request_id"]),
                client_id=DESKTOP_CLIENTS[1][0],
            ) as (lease_id, acquired_at, expires_at):
                bob.restart()
                snapshot = _wait_for_moments_snapshot(bob)
                current = _client_payload(
                    DESKTOP_CLIENTS[1][0],
                    DESKTOP_CLIENTS[1][1],
                    bob,
                    snapshot,
                    service_roles={
                        "station": STATION_ID,
                        "station-secondary": SECONDARY_STATION_ID,
                    },
                )
                ledger.record(
                    SuiteRuntimeAction.CLIENT_REPLACEMENT,
                    scenario_id="desktop-continuity",
                    resource_id=f"client:{current['id']}",
                )
                desktop_payloads = [
                    current if item["id"] == current["id"] else item
                    for item in desktop_payloads
                ]
                lease = {
                    "schema_version": 1,
                    "kind": runtime_manifest.RUNTIME_LEASE_EVIDENCE_KIND,
                    "owner_id": OWNER_ID,
                    "request_id": request["request_id"],
                    "parent_manifest_digest": request[
                        "parent_runtime_manifest_digest"
                    ],
                    "retained_client_id": current["id"],
                    "lease_ids": [lease_id],
                    "acquired_at": acquired_at,
                    "expires_at": expires_at,
                }
                lease["artifact_digest"] = runtime_manifest.canonical_digest(lease)
                lease_path = _write_immutable_json(
                    desktop_dir / "leases" / f"{current['id']}.json",
                    lease,
                )
                lease_ref = {
                    "path": lease_path.relative_to(desktop_dir).as_posix(),
                    "sha256": _sha256(lease_path.read_bytes()),
                }
                acknowledgement_id = f"ack-{request['request_id']}"
                child_run_id = _continuation_run_id(
                    run_id,
                    str(request["request_id"]),
                )
                child_services = _continuation_services(
                    desktop_dir,
                    run_id=child_run_id,
                    journey_id=DESKTOP_JOURNEY,
                    services=services,
                    attestations={
                        STATION_ID: attestation,
                        SECONDARY_STATION_ID: secondary_attestation,
                    },
                )
                child_path = write_attached_runtime_manifest(
                    manifest_payload=_manifest_payload(
                        identity=identity,
                        journey_id=DESKTOP_JOURNEY,
                        run_id=child_run_id,
                        services=child_services,
                        fixture_ref=desktop_fixture_ref,
                        fixture_digest=fixture_digest,
                        clients=desktop_payloads,
                        continuation={
                            "parent_manifest_digest": request[
                                "parent_runtime_manifest_digest"
                            ],
                            "restart_request_id": request["request_id"],
                            "retained_client_id": current["id"],
                            "retained_storage_identity_digest": current[
                                "storage_identity_digest"
                            ],
                            "previous_boot_identity": previous["boot_identity"],
                            "runtime_owner_acknowledgement_id": acknowledgement_id,
                            "lease_evidence_ref": lease_ref,
                        },
                    ),
                    output_path=desktop_dir / "runtime-child.json",
                    journey_id=DESKTOP_JOURNEY,
                    sessions_by_client=desktop,
                    automation_refs_by_client={
                        client_id: {
                            "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                            "endpoint": _webdriver_endpoint(client),
                            "session_id": str(client.driver.session_id),
                        }
                        for client_id, client in desktop.items()
                    },
                    repo_root=self.repo_root,
                )
                child = json.loads(child_path.read_text(encoding="utf-8"))
                fixture_context, fixture_action_client = (
                    fixture_owner.open_action_channel(
                        workspace_id=identity["workspaceId"],
                        gate_id=DESKTOP_JOURNEY,
                        runtime_manifest_digests=(
                            str(child["manifest_digest"]),
                        ),
                    )
                )
                stack.callback(
                    _close_fixture_action_channel,
                    fixture_context,
                    fixture_action_client,
                )
                acknowledgement = {
                    "schema_version": 1,
                    "kind": runtime_manifest.CONTINUATION_ACKNOWLEDGEMENT_KIND,
                    "request_id": request["request_id"],
                    "owner_id": OWNER_ID,
                    "acknowledgement_id": acknowledgement_id,
                    "parent_runtime_manifest_digest": request[
                        "parent_runtime_manifest_digest"
                    ],
                    "child_runtime_manifest_digest": child["manifest_digest"],
                    "previous_boot_identity": previous["boot_identity"],
                    "current_boot_identity": current["boot_identity"],
                    "session_generation": current["session_generation"],
                    "retained_storage_identity_digest": current[
                        "storage_identity_digest"
                    ],
                    "lease_evidence_ref": lease_ref,
                }
                acknowledgement["artifact_digest"] = (
                    runtime_manifest.canonical_digest(acknowledgement)
                )
                _stage_continuation_evidence(
                    blocked_result_path=blocked_result_path,
                    request_path=request_path,
                    child_run_id=child_run_id,
                    client_id=current["id"],
                    acknowledgement=acknowledgement,
                )
                station_endpoints.refresh()
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_START,
                    scenario_id="desktop-continuity",
                )
                desktop_result = execute_scenario(
                    runtime="desktop",
                    scenario_id="desktop-pilot",
                    budget_seconds=1200,
                    repo_root=self.repo_root,
                    profile=None,
                    profiles=(PROFILE, SECONDARY_PROFILE),
                    clients=tuple(item[0] for item in DESKTOP_CLIENTS),
                    runtime_manifest_path=child_path,
                    result_root=raw_result_root,
                    workspace_identity=identity,
                    fixture_action_client=fixture_action_client,
                )

            continuity_ui = _receiver_ui_probe(
                desktop[DESKTOP_CLIENTS[1][0]],
                workstream_id=TASK_ID,
                scenario_id="desktop-continuity",
                action_text=None,
                visible_text=W7_PRIVATE_TEXT,
                open_comments=False,
            )
            continuity_ui_path = _write_receiver_ui_evidence(
                owner_root,
                workstream_id=TASK_ID,
                suite_runtime_id=run_id,
                source_digest=str(identity["head"]),
                fixture_epoch=fixture_epoch,
                fixture_manifest_digest=fixture_digest,
                scenario_id="desktop-continuity",
                variant_id="desktop-continuity",
                receiver_client_id=DESKTOP_CLIENTS[1][0],
                evidence=continuity_ui,
            )
            continuity_ref = {
                "path": continuity_ui_path.relative_to(owner_root).as_posix(),
                "sha256": _sha256(continuity_ui_path.read_bytes()),
            }
            receiver_evidence_refs["desktop-continuity"] = continuity_ref
            continuity_resource = (
                "artifact:"
                + continuity_ref["path"]
                + ":"
                + continuity_ref["sha256"]
            )
            desktop_result_digest = _required_text(
                desktop_result.get("resultDigest"),
                "desktop-continuity result digest",
            )
            desktop_result_resource = (
                f"scenario-result:{desktop_result_digest}"
            )
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id="desktop-continuity",
                resource_id=continuity_resource,
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id="desktop-continuity",
                resource_id=continuity_resource,
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id="desktop-continuity",
                resource_id=desktop_result_resource,
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id="desktop-continuity",
            )

            blocked_result = json.loads(
                blocked_result_path.read_text(encoding="utf-8")
            )
            _stage_child_result(
                blocked_result,
                workstream_id=TASK_ID,
                raw_result_root=raw_result_root,
                publish_root=publish_root,
                final_result_root=self.result_root,
                ui_evidence_paths=(pre_restart_ui_path,),
            )
            desktop_result = _stage_child_result(
                desktop_result,
                workstream_id=TASK_ID,
                raw_result_root=raw_result_root,
                publish_root=publish_root,
                final_result_root=self.result_root,
                ui_evidence_paths=(
                    pre_restart_ui_path,
                    continuity_ui_path,
                ),
            )
            for client in desktop.values():
                _moments_harness(client, "clearLocalState")
            _close_fixture_action_channel(
                fixture_context,
                fixture_action_client,
            )
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        suite_report_path = _write_immutable_json(
            owner_root / "suite-runtime.json",
            suite_report,
        )
        _publish_result_generation(
            workstream_id=TASK_ID,
            publish_root=publish_root,
            final_result_root=self.result_root,
            generation_id=str(identity["head"]),
        )
        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "desktopResult": desktop_result["result"],
            "runtimeRoot": str(owner_root),
            "suiteRuntimeReport": str(suite_report_path),
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "receiverVisibleEvidence": receiver_evidence_refs,
        }

    def run_w8_suite(self) -> dict[str, Any]:
        return self._run_w8_suite(formal_acceptance=False)

    def run_social_desktop_acceptance_suite(
        self,
        *,
        slot: int = SOCIAL_ACCEPTANCE_SLOT,
    ) -> dict[str, Any]:
        return self._run_w8_suite(
            formal_acceptance=True,
            expected_slot=slot,
        )

    def run_social_cross_station_suite(
        self,
        *,
        slot: int = SOCIAL_CROSS_STATION_SLOT,
    ) -> dict[str, Any]:
        if slot != SOCIAL_CROSS_STATION_SLOT:
            raise RuntimeOwnerBlocked(
                "CONTROLLER_BINDING_MISMATCH",
                f"Cross-Station Social requires slot {SOCIAL_CROSS_STATION_SLOT}",
                resource="profile:four",
            )
        identity = _require_social_acceptance_source(
            self.repo_root,
            self.result_root,
        )
        control_commit = str(identity.get("controlHead") or identity["head"])
        result_path = (
            self.result_root
            / SOCIAL_CROSS_STATION_TASK_ID.removesuffix("-final-proof")
            / control_commit
            / "suite"
            / "result.json"
        )
        if result_path.exists():
            raise RuntimeOwnerBlocked(
                "RESULT_PUBLICATION_CONFLICT",
                "Cross-Station Social Suite result already exists",
                resource="result:social-cross-station",
            )
        resolved, profile_env = _resolve_machine_profile(
            self.repo_root,
            expected_slot=slot,
        )
        _secondary_profile_path, secondary_profile_env = (
            _resolve_secondary_profile(resolved)
        )
        run_id = (
            f"social-cross-station-{control_commit[:12]}-{os.getpid()}-"
            f"{time.time_ns()}"
        )
        owner_root = self.runtime_root / run_id
        attestation_store = owner_root / "attestation-store"
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        (
            attestation_store
            / str(identity["workspaceId"])
            / SOCIAL_CROSS_STATION_JOURNEY
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(
            (
                (STATION_ID, profile_env),
                (SECONDARY_STATION_ID, secondary_profile_env),
            )
        )
        station_url = station_endpoints[STATION_ID].transport_url
        secondary_station_url = station_endpoints[
            SECONDARY_STATION_ID
        ].transport_url
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": str(identity["workspaceId"]),
                    "PT_ACCEPTANCE_GATE_ID": SOCIAL_CROSS_STATION_JOURNEY,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                primary_attestation = produce_station_attestation(
                    environment_id="cross-station-social-native",
                    run_id=run_id,
                    service_id=STATION_ID,
                    station_url=station_url,
                    profile_env=profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
                secondary_attestation = produce_station_attestation(
                    environment_id="cross-station-social-native",
                    run_id=run_id,
                    service_id=SECONDARY_STATION_ID,
                    station_url=secondary_station_url,
                    profile_env=secondary_profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                _error_message_with_cleanup(error),
                resource="station:cross-station-social",
            ) from error
        local_proto_digest = source_proto_digest(self.repo_root)
        if any(
            (
                not commits_match(attestation.live_commit, identity["head"])
                or attestation.protocol_digest != local_proto_digest
            )
            for attestation in (primary_attestation, secondary_attestation)
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "Cross-Station Social Stations are not on the activated source",
                resource="station:cross-station-social",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        source_evidence_root = Path(
            str(identity.get("sourceEvidenceRoot") or self.result_root)
        )
        schema_identity = dict(identity)
        schema_identity["workspaceId"] = str(
            identity.get("sourceEvidenceWorkspaceId")
            or identity["workspaceId"]
        )
        try:
            primary_schema = _resolve_canonical_private_schema_attestation(
                source_evidence_root,
                self.repo_root,
                schema_identity,
                primary_attestation,
                service_id=STATION_ID,
                profile_id=PROFILE,
                attested_endpoint=profile_env["PT_STATION_URL"],
                accepted_intents=("SCHEMA_ACTIVATION",),
            )
            secondary_schema = _resolve_canonical_private_schema_attestation(
                source_evidence_root,
                self.repo_root,
                schema_identity,
                secondary_attestation,
                service_id=SECONDARY_STATION_ID,
                profile_id=SECONDARY_PROFILE,
                attested_endpoint=secondary_profile_env["PT_STATION_URL"],
                accepted_intents=("SCHEMA_ACTIVATION",),
            )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        fixture_epoch = "css09-" + _sha256(run_id)[:32]
        ledger = SuiteRuntimeLedger(
            SOCIAL_CROSS_STATION_RUNTIME_REUSE,
            suite_runtime_id=run_id,
            source_digest=str(identity["head"]),
            fixture_epoch=fixture_epoch,
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime:social-cross-station",
        )
        scenario_results: dict[str, dict[str, Any]] = {}
        supporting_artifacts: list[str] = []
        manifest_digests: dict[str, str] = {}
        max_concurrent_clients = 0
        with _runtime_cleanup_scope(transport_stack) as stack:
            suffix = _sha256(f"{run_id}:{secrets.token_hex(16)}")[:10]
            password = f"Css09Aa1!{suffix}"
            accounts = {
                "alice": _register_runtime_account(
                    station_url,
                    role="alice",
                    suffix=suffix,
                    password=password,
                ),
                "bob": _register_runtime_account(
                    secondary_station_url,
                    role="bob",
                    suffix=suffix,
                    password=password,
                ),
                "eve": _register_runtime_account(
                    secondary_station_url,
                    role="eve",
                    suffix=suffix,
                    password=password,
                ),
            }
            for role in ("alice", "bob", "eve"):
                ledger.record(
                    SuiteRuntimeAction.ACCOUNT_PROVISION,
                    resource_id=f"account:{role}",
                )

            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            clients: dict[str, FoundationRuntimeClient] = {}
            payloads: dict[str, dict[str, Any]] = {}
            for index, client_id in enumerate(
                SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS[:2]
            ):
                actor_role = "alice" if index == 0 else "bob"
                service_id = STATION_ID if index == 0 else SECONDARY_STATION_ID
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=(
                        station_url if index == 0 else secondary_station_url
                    ),
                    profile_env=(
                        profile_env if index == 0 else secondary_profile_env
                    ),
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind="native-tauri",
                    port_bases=(
                        4930 + index * 20,
                        5110 + index * 20,
                        5895 + index * 20,
                    ),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose="Cross-Station Social Suite",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                snapshot = _start_client(
                    client,
                    account=accounts[actor_role],
                    password=password,
                )
                _wait_for_device_enrollment(client)
                _wait_for_mls_readiness(client)
                _prepare_private_content_keys(client)
                clients[client_id] = client
                payloads[client_id] = _client_payload(
                    client_id,
                    actor_role,
                    client,
                    snapshot,
                    service_roles={"station": service_id},
                )
                ledger.record(
                    SuiteRuntimeAction.CLIENT_LAUNCH,
                    resource_id=f"client:{client_id}",
                )
                ledger.record(
                    SuiteRuntimeAction.LOGIN,
                    resource_id=f"session:{client_id}",
                )
                max_concurrent_clients = max(
                    max_concurrent_clients,
                    len(active_client_ids),
                )

            alice = clients[SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS[0]]
            bob = clients[SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS[1]]
            fixture_identity = _prepare_cross_station_social_fixture(alice, bob)
            recovery_phrase, recovery_preparation = _prepare_portable_recovery(
                bob
            )
            eve_token, eve_ptid = _station_login(
                secondary_station_url,
                station_peer_id=secondary_attestation.runtime_identity,
                account=accounts["eve"],
                password=password,
            )
            fixture_payload: dict[str, Any] = {
                "schema_version": 1,
                "kind": runtime_manifest.FIXTURE_MANIFEST_KIND,
                "fixture_set_id": "cross-station-social-actors",
                "source_checkpoint": str(identity["head"]),
                "handles": [],
            }
            fixture_payload["manifest_digest"] = (
                runtime_manifest.canonical_digest(fixture_payload)
            )
            fixture_path = _write_immutable_json(
                owner_root / "fixture.json",
                fixture_payload,
            )
            fixture_digest = str(fixture_payload["manifest_digest"])
            fixture_evidence: dict[str, Any] = {
                "artifactKind": "social-cross-station-fixture-evidence",
                "schemaVersion": 1,
                "fixtureEpoch": fixture_epoch,
                "sourceCommit": str(identity["head"]),
                "actors": {
                    "alice": {
                        "actorPtidSha256": _sha256(fixture_identity["alicePtid"]),
                        "serviceId": STATION_ID,
                    },
                    "bob": {
                        "actorPtidSha256": _sha256(fixture_identity["bobPtid"]),
                        "serviceId": SECONDARY_STATION_ID,
                    },
                    "eve": {
                        "actorPtidSha256": _sha256(eve_ptid),
                        "serviceId": SECONDARY_STATION_ID,
                    },
                },
                "federationIdSha256": _sha256(
                    fixture_identity["federationId"]
                ),
            }
            fixture_evidence["artifactDigest"] = (
                runtime_manifest.canonical_digest(fixture_evidence)
            )
            fixture_evidence_path = _write_immutable_json(
                owner_root / "fixture-evidence.json",
                fixture_evidence,
            )
            supporting_artifacts.append(str(fixture_evidence_path))

            def write_runtime(
                variant: str,
                selected_clients: Mapping[str, FoundationRuntimeClient],
                selected_payloads: Sequence[Mapping[str, Any]],
            ) -> Path:
                runtime_dir = owner_root / "runtime-manifests" / variant
                fixture_ref = self._copy_fixture_into(
                    fixture_path,
                    runtime_dir,
                )
                primary_ref = _publish_attestation(
                    runtime_dir,
                    primary_attestation,
                    run_id=run_id,
                    journey_id=SOCIAL_CROSS_STATION_JOURNEY,
                    service_id=STATION_ID,
                )
                secondary_ref = _publish_attestation(
                    runtime_dir,
                    secondary_attestation,
                    run_id=run_id,
                    journey_id=SOCIAL_CROSS_STATION_JOURNEY,
                    service_id=SECONDARY_STATION_ID,
                )
                primary_schema_ref = (
                    _publish_canonical_private_schema_attestation(
                        runtime_dir,
                        STATION_ID,
                        primary_schema,
                    )
                )
                secondary_schema_ref = (
                    _publish_canonical_private_schema_attestation(
                        runtime_dir,
                        SECONDARY_STATION_ID,
                        secondary_schema,
                    )
                )
                attachment: dict[str, Any] = {
                    "artifactKind": (
                        "social-cross-station-client-attachment-manifest"
                    ),
                    "schemaVersion": 1,
                    "runId": run_id,
                    "variant": variant,
                    "journeyId": SOCIAL_CROSS_STATION_JOURNEY,
                    "sourceCommit": str(identity["head"]),
                    "controlCommit": control_commit,
                    "workspaceId": str(identity["workspaceId"]),
                    "worktreeSetDigest": str(identity["worktreeSetDigest"]),
                    "controllerBinding": {
                        "profileId": PROFILE,
                        "slot": slot,
                    },
                    "fixtureManifestRef": fixture_ref,
                    "fixtureManifestDigest": fixture_digest,
                    "services": {
                        STATION_ID: {
                            "profileId": PROFILE,
                            "runtimeIdentitySha256": _sha256(
                                primary_attestation.runtime_identity
                            ),
                            "attestationRef": primary_ref,
                            "schemaAttestationRef": primary_schema_ref,
                        },
                        SECONDARY_STATION_ID: {
                            "profileId": SECONDARY_PROFILE,
                            "runtimeIdentitySha256": _sha256(
                                secondary_attestation.runtime_identity
                            ),
                            "attestationRef": secondary_ref,
                            "schemaAttestationRef": secondary_schema_ref,
                        },
                    },
                    "clients": [
                        {
                            **dict(payload),
                            "automationSessionIdSha256": _sha256(
                                str(
                                    selected_clients[str(payload["id"])]
                                    .driver.session_id
                                )
                            ),
                        }
                        for payload in selected_payloads
                    ],
                }
                attachment["manifestDigest"] = (
                    runtime_manifest.canonical_digest(attachment)
                )
                path = _write_immutable_json(
                    runtime_dir / "runtime.json",
                    attachment,
                )
                manifest_digests[variant] = str(
                    attachment["manifestDigest"]
                )
                supporting_artifacts.append(str(path))
                return path

            write_runtime(
                "initial",
                clients,
                tuple(payloads.values()),
            )
            current_bob = bob
            scenario_state: dict[str, str] = {}
            media_path = owner_root / "cross-station-private.png"
            media_path.write_bytes(W7_PNG_BYTES)

            def publish_typed(
                payload: Mapping[str, Any],
                *,
                label: str,
            ) -> str:
                staged = _moments_harness(
                    alice,
                    "stagePrivateDraft",
                    payload,
                )
                if staged.get("present") is not True:
                    raise RuntimeOwnerBlocked(
                        "CLIENT_RUNTIME_UNAVAILABLE",
                        f"{label} draft was not retained",
                        resource="client:cross-station-social-alice",
                    )
                result: Mapping[str, Any] = {}
                for attempt in range(30):
                    result = _moments_harness(
                        alice,
                        "publishPrivateDraft",
                    )
                    if (
                        result.get("state")
                        not in PRIVATE_PUBLISH_RECONCILING_STATES
                    ):
                        break
                    if attempt < 29:
                        time.sleep(1)
                post_id = result.get("transientPostId")
                if (
                    result.get("state") != "PUBLISHED"
                    or not isinstance(post_id, str)
                    or not post_id
                ):
                    raise RuntimeOwnerBlocked(
                        "CLIENT_RUNTIME_UNAVAILABLE",
                        (
                            f"{label} did not reach PUBLISHED "
                            f"(state={result.get('state')!r}, "
                            f"errorCode={result.get('errorCode')!r})"
                        ),
                        resource="client:cross-station-social-alice",
                    )
                return post_id

            def record_scenario(
                scenario_id: str,
                *,
                receiver: FoundationRuntimeClient,
                visible_text: str,
                observations: Mapping[str, Any],
                action_text: str | None = None,
                open_comments: bool = False,
                absent_texts: Sequence[str] = (),
            ) -> None:
                scenario_path = _write_social_cross_station_scenario_evidence(
                    owner_root,
                    scenario_id=scenario_id,
                    run_id=run_id,
                    source_commit=str(identity["head"]),
                    control_commit=control_commit,
                    fixture_epoch=fixture_epoch,
                    observations=observations,
                )
                ui = _receiver_ui_probe(
                    receiver,
                    workstream_id=SOCIAL_CROSS_STATION_TASK_ID,
                    scenario_id=scenario_id,
                    action_text=action_text,
                    visible_text=visible_text,
                    open_comments=open_comments,
                    absent_texts=absent_texts,
                )
                ui_path = _write_receiver_ui_evidence(
                    owner_root,
                    workstream_id=SOCIAL_CROSS_STATION_TASK_ID,
                    suite_runtime_id=run_id,
                    source_digest=str(identity["head"]),
                    fixture_epoch=fixture_epoch,
                    fixture_manifest_digest=fixture_digest,
                    scenario_id=scenario_id,
                    variant_id=scenario_id,
                    receiver_client_id=next(
                        client_id
                        for client_id, candidate in clients.items()
                        if candidate is receiver
                    ),
                    evidence=ui,
                )
                refs = [
                    {
                        "path": str(scenario_path),
                        "sha256": _sha256(scenario_path.read_bytes()),
                    },
                    {
                        "path": str(ui_path),
                        "sha256": _sha256(ui_path.read_bytes()),
                    },
                ]
                resource = (
                    f"artifact:{ui_path.relative_to(owner_root).as_posix()}:"
                    f"{refs[1]['sha256']}"
                )
                ledger.record(
                    SuiteRuntimeAction.UI_ACTION,
                    scenario_id=scenario_id,
                    resource_id=f"{resource}:ui-action",
                )
                ledger.record(
                    SuiteRuntimeAction.RECEIVER_ASSERTION,
                    scenario_id=scenario_id,
                    resource_id=f"{resource}:receiver",
                )
                ledger.record(
                    SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                    scenario_id=scenario_id,
                    resource_id=(
                        f"artifact:{scenario_path.relative_to(owner_root)}:"
                        f"{refs[0]['sha256']}"
                    ),
                )
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_END,
                    scenario_id=scenario_id,
                )
                scenario_results[scenario_id] = {
                    "status": "PASS",
                    "evidenceRefs": refs,
                }
                supporting_artifacts.extend(
                    (str(scenario_path), str(ui_path))
                )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS17",
            )
            as17_text = "css09-cross-station-private-media"
            as17_post = publish_typed(
                {
                    "draftId": "css09-as17",
                    "revision": 1,
                    "text": as17_text,
                    "audienceKind": "FRIENDS",
                    "momentKind": "IMAGE",
                    "files": [{
                        "intentId": "css09-as17-image",
                        "filePath": str(media_path),
                    }],
                },
                label="AS17 private media",
            )
            as17_read = _wait_for_private_moment_state(
                current_bob,
                post_id=as17_post,
                expected_state="CONTENT_READY",
                actor_label="Bob",
            )
            as17_media = _moments_harness(
                current_bob,
                "readPrivateMoment",
                {"postId": as17_post, "openMedia": True},
            ).get("media")
            if (
                not isinstance(as17_media, list)
                or len(as17_media) != 1
                or not isinstance(as17_media[0], Mapping)
                or as17_media[0].get("state") != "MEDIA_READY"
                or as17_media[0].get("plaintextSha256")
                != _sha256(W7_PNG_BYTES)
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "AS17 media did not decrypt on Bob's Home Station",
                    resource="client:cross-station-social-bob",
                )
            recovery_text = "css09-cross-station-never-opened"
            recovery_post = _publish_friends_moment(
                alice,
                draft_id="css09-as23-never-opened",
                text=recovery_text,
            )
            scenario_state["as17Post"] = as17_post
            scenario_state["recoveryPost"] = recovery_post
            record_scenario(
                "AS17",
                receiver=current_bob,
                visible_text=as17_text,
                observations={
                    "contentReady": as17_read.get("state") == "CONTENT_READY",
                    "mediaReady": True,
                    "textSha256": _sha256(as17_text),
                    "mediaSha256": _sha256(W7_PNG_BYTES),
                    "sourceGateIds": [
                        "social-cross-station-contract",
                        "social-cross-station-prekey",
                        "social-cross-station-delivery",
                    ],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS18",
            )
            as18_text = "css09-cross-station-custom-allow"
            as18_post = publish_typed(
                {
                    "draftId": "css09-as18",
                    "revision": 1,
                    "text": as18_text,
                    "audienceKind": "CUSTOM_ALLOW",
                    "actorPtids": [fixture_identity["bobPtid"]],
                    "momentKind": "TEXT",
                },
                label="AS18 remote custom audience",
            )
            as18_read = _wait_for_private_moment_state(
                current_bob,
                post_id=as18_post,
                expected_state="CONTENT_READY",
                actor_label="Bob",
            )
            scenario_state["as18Post"] = as18_post
            record_scenario(
                "AS18",
                receiver=current_bob,
                visible_text=as18_text,
                observations={
                    "audienceKind": as18_read.get("audienceKind"),
                    "deduplicatedRemoteRecipientCount": 1,
                    "sourceGateIds": [
                        "social-cross-station-contract",
                        "social-cross-station-prekey",
                    ],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS19",
            )
            denied_status, denied_body = _http_get(
                (
                    f"{secondary_station_url.rstrip('/')}/api/v1/social/"
                    f"moments/{as18_post}"
                ),
                authorization=f"Bearer {eve_token}",
                headers={"X-Device-ID": "css09-eve-untrusted-device"},
            )
            private_markers = (
                as18_text.encode("utf-8"),
                fixture_identity["alicePtid"].encode("utf-8"),
                fixture_identity["bobPtid"].encode("utf-8"),
            )
            if (
                denied_status != 404
                or any(marker in denied_body for marker in private_markers)
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "AS19 unauthorized fixture exposed private material",
                    resource="fixture-account:eve",
                )
            record_scenario(
                "AS19",
                receiver=current_bob,
                visible_text=as18_text,
                observations={
                    "fixtureOnlyActor": "eve",
                    "uniformDenialStatus": denied_status,
                    "responseBodySha256": _sha256(denied_body),
                    "privateMarkerCount": 0,
                    "sourceGateIds": [
                        "social-cross-station-delivery",
                        "social-cross-station-revocation-recovery",
                    ],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS20",
            )
            as20_text = "css09-cross-station-interaction-parent"
            as20_comment = "css09-cross-station-comment"
            as20_post = _publish_friends_moment(
                alice,
                draft_id="css09-as20",
                text=as20_text,
            )
            _wait_for_private_moment_state(
                current_bob,
                post_id=as20_post,
                expected_state="CONTENT_READY",
                actor_label="Bob",
            )
            comment = _moments_harness(
                current_bob,
                "submitPrivateCommentWithRetry",
                {"postId": as20_post, "text": as20_comment},
            )
            reaction = _moments_harness(
                current_bob,
                "reactToPrivateMoment",
                {"postId": as20_post, "kind": "LOVE"},
            )
            alice_comments = _moments_harness(
                alice,
                "readPrivateComments",
                {"postId": as20_post, "refresh": True},
            )
            if (
                comment.get("state") != "COMMENT_POSTED"
                or not any(
                    isinstance(item, Mapping)
                    and item.get("textSha256") == _sha256(as20_comment)
                    for item in alice_comments.get("comments", ())
                )
                or not isinstance(reaction.get("reactions"), list)
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "AS20 interaction did not converge at source authority",
                    resource="client:cross-station-social-alice",
                )
            record_scenario(
                "AS20",
                receiver=alice,
                action_text=as20_text,
                visible_text=as20_comment,
                open_comments=True,
                observations={
                    "commentPosted": True,
                    "reactionProjected": True,
                    "commentTextSha256": _sha256(as20_comment),
                    "sourceGateIds": ["social-cross-station-interaction"],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS21",
            )
            as21_text = "css09-cross-station-reconcile-after-reload"
            as21_post = _publish_friends_moment(
                alice,
                draft_id="css09-as21",
                text=as21_text,
            )
            before_reload = _wait_for_moments_snapshot(current_bob)
            after_reload = _refresh_and_wait_for_moments_snapshot(current_bob)
            as21_read = _wait_for_private_moment_state(
                current_bob,
                post_id=as21_post,
                expected_state="CONTENT_READY",
                actor_label="Bob",
            )
            record_scenario(
                "AS21",
                receiver=current_bob,
                visible_text=as21_text,
                observations={
                    "contentReady": as21_read.get("state") == "CONTENT_READY",
                    "rendererReloaded": True,
                    "bootIdentityStable": (
                        before_reload.get("bootIdentitySha256")
                        == after_reload.get("bootIdentitySha256")
                    ),
                    "sourceGateIds": ["social-cross-station-delivery"],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS22",
            )
            as22_text = "css09-cross-station-revoked"
            as22_post = _publish_friends_moment(
                alice,
                draft_id="css09-as22",
                text=as22_text,
            )
            _wait_for_private_moment_state(
                current_bob,
                post_id=as22_post,
                expected_state="CONTENT_READY",
                actor_label="Bob",
            )
            deletion = _moments_harness(
                alice,
                "deletePrivateMoment",
                {"postId": as22_post},
            )
            revoked = _wait_for_private_moment_states(
                current_bob,
                post_id=as22_post,
                expected_states=(
                    "DELETED_OR_REVOKED",
                    "NOT_FOUND_OR_NOT_AUTHORIZED",
                ),
                actor_label="Bob",
            )
            if deletion.get("deleted") is not True:
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "AS22 deletion did not revoke Bob's projection",
                    resource="client:cross-station-social-bob",
                )
            record_scenario(
                "AS22",
                receiver=current_bob,
                visible_text=as17_text,
                absent_texts=(as22_text,),
                observations={
                    "deleteCommitted": True,
                    "receiverState": revoked.get("state"),
                    "sourceGateIds": [
                        "social-cross-station-revocation-recovery"
                    ],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS23",
            )
            _stop_client_or_raise(
                current_bob,
                purpose="Cross-Station Social Bob replacement",
                active_client_ids=active_client_ids,
            )
            clients.pop(SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS[1])
            bob2_id = SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS[2]
            bob2 = _make_client(
                repo_root=self.repo_root,
                runtime_root=owner_root,
                station_url=secondary_station_url,
                profile_env=secondary_profile_env,
                source_commit=str(identity["head"]),
                client_id=bob2_id,
                runtime_kind="native-tauri",
                port_bases=(4970, 5150, 5935),
                reserved_ports=reserved_ports,
            )
            stack.callback(
                _stop_client_or_raise,
                bob2,
                purpose="Cross-Station Social Suite",
                active_client_ids=active_client_ids,
            )
            active_client_ids.add(id(bob2))
            bob2_snapshot = _start_client(
                bob2,
                account=accounts["bob"],
                password=password,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_REPLACEMENT,
                scenario_id="AS23",
                resource_id=f"client:{bob2_id}",
            )
            before_recovery = _wait_for_private_moment_state(
                bob2,
                post_id=recovery_post,
                expected_state="RECOVERY_REQUIRED",
                actor_label="Bob2",
            )
            restored = _restore_portable_recovery(bob2, recovery_phrase)
            recovery_phrase = ""
            _wait_for_device_enrollment(bob2)
            recovered = _moments_harness(
                bob2,
                "recoverPrivateMoment",
                {"postId": recovery_post},
            )
            if (
                before_recovery.get("state") != "RECOVERY_REQUIRED"
                or recovered.get("state") != "CONTENT_READY"
                or recovered.get("textSha256")
                != _sha256("css09-cross-station-never-opened")
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "AS23 replacement device did not recover exact history",
                    resource=f"client:{bob2_id}",
                )
            _prepare_private_content_keys(bob2)
            clients[bob2_id] = bob2
            payloads[bob2_id] = _client_payload(
                bob2_id,
                "bob",
                bob2,
                bob2_snapshot,
                service_roles={"station": SECONDARY_STATION_ID},
            )
            payloads.pop(SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS[1])
            current_bob = bob2
            max_concurrent_clients = max(
                max_concurrent_clients,
                len(active_client_ids),
            )
            write_runtime(
                "replacement",
                clients,
                tuple(payloads.values()),
            )
            record_scenario(
                "AS23",
                receiver=current_bob,
                visible_text=recovery_text,
                observations={
                    "beforeRecovery": "RECOVERY_REQUIRED",
                    "afterRecovery": "CONTENT_READY",
                    "preparedRecoveryEpoch": recovery_preparation[
                        "preparedEpoch"
                    ],
                    "restoredRecoveryEpoch": restored["recoveryEpoch"],
                    "replacementDeviceIdSha256": restored[
                        "deviceIdSha256"
                    ],
                    "sourceGateIds": [
                        "social-cross-station-revocation-recovery"
                    ],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="AS24",
            )
            first_replay = _moments_harness(
                current_bob,
                "readPrivateMoment",
                {"postId": recovery_post},
            )
            second_replay = _moments_harness(
                current_bob,
                "readPrivateMoment",
                {"postId": recovery_post},
            )
            if (
                first_replay.get("state") != "CONTENT_READY"
                or second_replay != first_replay
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "AS24 exact receiver replay did not remain idempotent",
                    resource=f"client:{bob2_id}",
                )
            record_scenario(
                "AS24",
                receiver=current_bob,
                visible_text=recovery_text,
                observations={
                    "exactReplayStable": True,
                    "projectionDigest": _sha256(
                        json.dumps(
                            first_replay,
                            separators=(",", ":"),
                            sort_keys=True,
                        )
                    ),
                    "sourceGateIds": [
                        "social-cross-station-delivery",
                        "social-cross-station-revocation-recovery",
                    ],
                },
            )

            station_endpoints.refresh()
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id="same-station-regression",
            )
            public_text = "css09-same-station-public-regression"
            public = _moments_harness(
                alice,
                "publishPublicMoment",
                {"text": public_text},
            )
            public_post_id = _required_text(
                public.get("transientPostId"),
                "same-station public Post",
            )
            public_status, public_body = _http_get(
                (
                    f"{station_url.rstrip('/')}/api/v1/social/"
                    f"moments/{public_post_id}"
                )
            )
            if public_status != 200 or public_text.encode("utf-8") not in public_body:
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "same-Station public Social regression failed",
                    resource="station:station-four",
                )
            public_projection = _moments_harness(
                alice,
                "findPublicMoment",
                {"text": public_text},
            )
            if (
                public_projection.get("found") is not True
                or public_projection.get("textSha256") != _sha256(public_text)
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    "same-Station public Social projection did not converge",
                    resource="client:cross-station-social-alice",
                )
            record_scenario(
                "same-station-regression",
                receiver=alice,
                action_text="Public",
                visible_text=public_text,
                observations={
                    "anonymousReadStatus": public_status,
                    "publicProjectionFound": True,
                    "publicTextSha256": _sha256(public_text),
                    "sameStationPrivateGate": "social-private-desktop-e2e",
                },
            )

            for client in clients.values():
                _moments_harness(client, "clearLocalState")
            eve_token = ""
            password = ""

        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        suite_report_path = _write_immutable_json(
            owner_root / "suite-runtime.json",
            suite_report,
        )
        supporting_artifacts.append(str(suite_report_path))
        activation_path = Path(
            _required_text(
                identity.get("activationAggregatePath"),
                "activation aggregate path",
            )
        )
        activation_digest = _required_text(
            identity.get("activationAggregateDigest"),
            "activation aggregate digest",
        )
        supporting_artifacts.append(str(activation_path))
        runtime_summary = {
            "artifactKind": SOCIAL_CROSS_STATION_RUNTIME_MANIFEST_KIND,
            "schemaVersion": 1,
            "state": "FIXTURE_READY",
            "cleanupState": "CLEANED",
            "runId": run_id,
            "workspaceId": str(identity["workspaceId"]),
            "sourceCommit": str(identity["head"]),
            "controlCommit": control_commit,
            "worktreeSetDigest": str(identity["worktreeSetDigest"]),
            "profileBindings": {
                PROFILE: STATION_ID,
                SECONDARY_PROFILE: SECONDARY_STATION_ID,
            },
            "serviceRuntimeIdentityDigests": {
                STATION_ID: _sha256(primary_attestation.runtime_identity),
                SECONDARY_STATION_ID: _sha256(
                    secondary_attestation.runtime_identity
                ),
            },
            "clientBindings": [
                {
                    "clientId": client_id,
                    "actorRole": actor_role,
                    "profileId": profile_id,
                    "serviceId": service_id,
                    "launched": client_id
                    in SOCIAL_CROSS_STATION_LAUNCHED_CLIENT_IDS,
                }
                for client_id, actor_role, profile_id, service_id
                in SOCIAL_CROSS_STATION_CLIENT_BINDINGS
            ],
            "fixtureEpoch": fixture_epoch,
            "scenarioManifestDigests": manifest_digests,
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
        }
        result: dict[str, Any] = {
            "artifactKind": SOCIAL_CROSS_STATION_RESULT_KIND,
            "schemaVersion": 1,
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "controlCommit": control_commit,
            "sourceCommit": str(identity["head"]),
            "workspaceId": str(identity["workspaceId"]),
            "worktreeSetDigest": str(identity["worktreeSetDigest"]),
            "runId": run_id,
            "fixtureEpoch": fixture_epoch,
            "activation": {
                "aggregatePath": str(activation_path),
                "resultDigest": activation_digest,
                "profiles": [PROFILE, SECONDARY_PROFILE],
            },
            "runtimeManifest": runtime_summary,
            "scenarioResults": scenario_results,
            "suiteRuntimeReport": str(suite_report_path),
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "supportingArtifacts": sorted(set(supporting_artifacts)),
            "resourceReuse": {
                "provisioningRuns": 1,
                "clientLaunches": 3,
                "maxConcurrentNativeClients": max_concurrent_clients,
                "newAccountRegistrations": 3,
                "stationBuilds": 0,
                "stationDeployments": 0,
                "desktopBuilds": 0,
                "clientReplacements": ["bob2"],
                "fixtureOnlyClients": ["eve"],
            },
            "cleanup": {
                "status": "CLEANED",
                "activeNativeClients": 0,
                "activeStationTunnels": 0,
                "credentialsRetained": False,
            },
        }
        result["resultDigest"] = runtime_manifest.canonical_digest(result)
        _write_immutable_json(result_path, result)
        return {
            **result,
            "runtimeRoot": str(owner_root),
            "suiteResult": str(result_path),
        }

    def run_w9_suite(self) -> dict[str, Any]:
        return self._run_platform_suite(
            TASK_SUITE_DEFINITIONS["run-w9-suite"]
        )

    def run_w2_suite(self) -> dict[str, Any]:
        return self._run_platform_suite(
            TASK_SUITE_DEFINITIONS["run-w2-suite"]
        )

    def run_w10_suite(self) -> dict[str, Any]:
        return self._run_platform_suite(
            TASK_SUITE_DEFINITIONS["run-w10-suite"]
        )

    def run_w11_suite(self) -> dict[str, Any]:
        return self._run_platform_suite(
            TASK_SUITE_DEFINITIONS["run-w11-suite"]
        )

    def run_final_suite(self) -> dict[str, Any]:
        return self._run_platform_suite(
            TASK_SUITE_DEFINITIONS["run-final-suite"]
        )

    def _run_platform_suite(
        self,
        suite: _TaskSuiteDefinition,
    ) -> dict[str, Any]:
        contract = load_platform_runtime_contract()
        scenario_commands = tuple(
            (scenario, contract.command(scenario.leaf_action))
            for scenario in suite.scenarios
        )
        if (
            tuple(scenario.scenario_id for scenario, _ in scenario_commands)
            != suite.runtime_reuse.scenario_ids
            or any(
                command.task_id != suite.task_id
                for _, command in scenario_commands
            )
        ):
            raise RuntimeOwnerBlocked(
                "SUITE_RUNTIME_CONTRACT_INVALID",
                f"{suite.action} does not match its Task runtimeReuse contract",
                resource=f"runtime:{suite.action}",
            )
        identity = _require_clean_source(self.repo_root, self.result_root)
        first_command = scenario_commands[0][1]
        _activate_scenario_journey(
            self.repo_root,
            suite.primary_journey_id,
            work_item_id=first_command.work_item_id,
            task_id=first_command.task_id,
        )
        resolved, primary_profile_env = _resolve_machine_profile(
            self.repo_root
        )
        profile_environments = {PROFILE: primary_profile_env}
        if SECONDARY_PROFILE in suite.profiles:
            _path, secondary_profile_env = _resolve_secondary_profile(
                resolved
            )
            profile_environments[SECONDARY_PROFILE] = secondary_profile_env
        bindings = tuple(
            (
                STATION_ID
                if profile_id == PROFILE
                else SECONDARY_STATION_ID,
                profile_environments[profile_id],
            )
            for profile_id in suite.profiles
        )
        run_id = (
            f"{suite.task_id.lower()}-suite-{identity['head'][:12]}-"
            f"{os.getpid()}-{time.time_ns()}"
        )
        owner_root = self.runtime_root / run_id
        fixture_epoch = f"{suite.task_id.lower()}-" + _sha256(run_id)[:32]
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / first_command.journey_id
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(bindings)
        attestations: dict[str, Any] = {}
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": str(
                        identity["workspaceId"]
                    ),
                    "PT_ACCEPTANCE_GATE_ID": first_command.journey_id,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                for service_id, profile_env in bindings:
                    attestations[service_id] = produce_station_attestation(
                        environment_id=(
                            f"secure-content-{suite.task_id.lower()}-suite"
                        ),
                        run_id=run_id,
                        service_id=service_id,
                        station_url=station_endpoints[
                            service_id
                        ].transport_url,
                        profile_env=profile_env,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                _error_message_with_cleanup(error),
                resource=f"station:{suite.action}",
            ) from error
        protocol_digest = source_proto_digest(self.repo_root)
        if any(
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != protocol_digest
            for attestation in attestations.values()
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                f"{suite.task_id} Stations are not deployed from exact source",
                resource=f"station:{suite.action}",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        schema_bindings: dict[
            str,
            runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
        ] = {}
        try:
            for service_id, profile_env in bindings:
                schema_bindings[service_id] = (
                    _resolve_canonical_private_schema_attestation(
                        self.result_root,
                        self.repo_root,
                        identity,
                        attestations[service_id],
                        service_id=service_id,
                        profile_id=str(profile_env["PT_DEV_PROFILE"]),
                        attested_endpoint=profile_env["PT_STATION_URL"],
                        accepted_intents=(
                            ("FINAL_CUT",)
                            if suite.task_id == "W12"
                            else ("SCHEMA_ACTIVATION",)
                        ),
                    )
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        try:
            final_cut_bindings = (
                _load_final_cut_bindings(
                    self.result_root,
                    generation_id=str(identity["head"]),
                    workspace_id=str(identity["workspaceId"]),
                )
                if suite.task_id == "W12"
                else None
            )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise
        ledger = SuiteRuntimeLedger(
            suite.runtime_reuse,
            suite_runtime_id=run_id,
            source_digest=str(identity["head"]),
            fixture_epoch=fixture_epoch,
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id=f"runtime:{suite.task_id.lower()}",
        )
        desktop_ids, mobile_ids = _suite_physical_clients(suite, contract)
        if len(desktop_ids) + len(mobile_ids) > (
            suite.runtime_reuse.max_client_launches
        ):
            error = RuntimeOwnerBlocked(
                "SUITE_RUNTIME_CONTRACT_INVALID",
                f"{suite.action} exceeds its physical client launch budget",
                resource=f"runtime:{suite.action}",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        primary_roles: set[str] = set()
        secondary_roles: set[str] = set()
        for _scenario, command in scenario_commands:
            for client_id in command.clients:
                if command.runtime == "mobile":
                    role = _mobile_actor_role(client_id)
                    physical_id = client_id
                else:
                    role = _desktop_actor_role(client_id)
                    physical_id = suite.desktop_client_aliases.get(
                        client_id,
                        client_id,
                    )
                if role == "anonymous":
                    primary_roles.add("browser_anonymous_bootstrap")
                    continue
                primary_roles.add(role)
                physical_service = (
                    _mobile_service_for_client(
                        client_id,
                        command.profiles,
                    )
                    if command.runtime == "mobile"
                    else _desktop_service_for_client(
                        physical_id,
                        command.profiles,
                    )
                )
                if physical_service == SECONDARY_STATION_ID:
                    secondary_roles.add(role)

        variant_results: dict[str, str] = {}
        result_refs: dict[str, str] = {}
        with _runtime_cleanup_scope(transport_stack) as stack:
            stack.callback(
                _activate_scenario_journey,
                self.repo_root,
                suite.primary_journey_id,
                work_item_id=first_command.work_item_id,
                task_id=first_command.task_id,
            )
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_endpoints[
                    STATION_ID
                ].transport_url,
                secondary_station_url=(
                    station_endpoints[
                        SECONDARY_STATION_ID
                    ].transport_url
                    if SECONDARY_STATION_ID in station_endpoints
                    else None
                ),
                run_id=run_id,
                roles=tuple(sorted(primary_roles)),
                secondary_roles=tuple(sorted(secondary_roles)),
            )
            for role in sorted(primary_roles):
                ledger.record(
                    SuiteRuntimeAction.ACCOUNT_PROVISION,
                    resource_id=f"account:{PROFILE}:{role}",
                )
            for role in sorted(secondary_roles):
                ledger.record(
                    SuiteRuntimeAction.ACCOUNT_PROVISION,
                    resource_id=f"account:{SECONDARY_PROFILE}:{role}",
                )

            desktop_resources = self._prepare_desktop_suite_resources(
                suite=suite,
                contract=contract,
                owner_root=owner_root,
                identity=identity,
                profile_environments=profile_environments,
                station_endpoints=station_endpoints,
                accounts=accounts,
                password=password,
                stack=stack,
                ledger=ledger,
            )
            mobile_resources = self._prepare_mobile_suite_resources(
                suite=suite,
                contract=contract,
                owner_root=owner_root,
                identity=identity,
                profile_environments=profile_environments,
                station_endpoints=station_endpoints,
                attestations=attestations,
                accounts=accounts,
                password=password,
                stack=stack,
                ledger=ledger,
            )

            prepared: dict[str, _PreparedSuiteScenario] = {}
            for scenario in suite.scenarios:
                command = contract.command(scenario.leaf_action)
                runtime_dir = owner_root / scenario.scenario_id
                resources: (
                    _PreparedDesktopSuiteResources
                    | _PreparedMobileSuiteResources
                    | None
                ) = (
                    mobile_resources
                    if command.runtime == "mobile"
                    else desktop_resources
                )
                if resources is None:
                    raise RuntimeOwnerBlocked(
                        "CLIENT_RUNTIME_UNAVAILABLE",
                        f"{scenario.leaf_action} has no prepared clients",
                        resource=f"runtime:{suite.action}",
                    )
                fixture_identity = _sha256(
                    json.dumps(
                        {
                            "fixtureEpoch": fixture_epoch,
                            "leafAction": scenario.leaf_action,
                            "physicalClients": [
                                (
                                    client_id
                                    if command.runtime == "mobile"
                                    else suite.desktop_client_aliases.get(
                                        client_id,
                                        client_id,
                                    )
                                )
                                for client_id in command.clients
                            ],
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    )
                )
                fixture_owner = RuntimeFixtureOwner(
                    source_checkpoint=str(identity["head"]),
                    run_id=run_id,
                    fixture_set_id=(
                        f"{suite.task_id.lower()}-{fixture_epoch}-"
                        f"{scenario.scenario_id}"
                    ),
                    bindings=(
                        RuntimeFixtureBinding(
                            capability=command.fixture_capability,
                            owner=(
                                "mobile-product-fixture-owner"
                                if command.runtime == "mobile"
                                else "desktop-product-fixture-owner"
                            ),
                            opaque_id=(
                                f"{suite.task_id.lower()}-"
                                f"{scenario.scenario_id}-fixture"
                            ),
                            expected_identity_digest=fixture_identity,
                            operations=command.fixture_operations,
                            action=resources.fixture.execute,
                            sensitive_values=(
                                password,
                                *accounts.values(),
                            ),
                        ),
                    ),
                )
                fixture_path = fixture_owner.write_manifest(
                    runtime_dir / "fixture.json"
                )
                fixture = fixture_owner.manifest()
                services = self._publish_suite_services(
                    root=runtime_dir,
                    command=command,
                    run_id=run_id,
                    profile_environments=profile_environments,
                    attestations=attestations,
                    schema_bindings=schema_bindings,
                )
                payload = _manifest_payload(
                    identity=identity,
                    journey_id=command.journey_id,
                    run_id=run_id,
                    services=services,
                    fixture_ref={
                        "path": fixture_path.name,
                        "sha256": _sha256(fixture_path.read_bytes()),
                    },
                    fixture_digest=str(fixture["manifest_digest"]),
                    clients=resources.payloads_for(command),
                    post_cut_epoch_id=(
                        fixture_epoch
                        if final_cut_bindings is not None
                        else None
                    ),
                    final_cut_bindings=final_cut_bindings,
                )
                if command.runtime == "mobile":
                    manifest_path = _write_owned_runtime_manifest(
                        payload=payload,
                        output_path=runtime_dir / "runtime.json",
                        repo_root=self.repo_root,
                    )
                else:
                    sessions = resources.sessions_for(command)
                    manifest_path = write_attached_runtime_manifest(
                        manifest_payload=payload,
                        output_path=runtime_dir / "runtime.json",
                        journey_id=command.journey_id,
                        sessions_by_client=sessions,
                        automation_refs_by_client={
                            client_id: {
                                "kind": (
                                    runtime_manifest
                                    .AUTOMATION_ATTACHMENT_KIND
                                ),
                                "endpoint": _webdriver_endpoint(client),
                                "session_id": str(client.driver.session_id),
                            }
                            for client_id, client in sessions.items()
                        },
                        repo_root=self.repo_root,
                    )
                manifest = json.loads(
                    manifest_path.read_text(encoding="utf-8")
                )
                fixture_context, fixture_client = (
                    fixture_owner.open_action_channel(
                        workspace_id=str(identity["workspaceId"]),
                        gate_id=command.journey_id,
                        runtime_manifest_digests=(
                            str(manifest["manifest_digest"]),
                        ),
                    )
                )
                stack.callback(
                    _close_fixture_action_channel,
                    fixture_context,
                    fixture_client,
                )
                prepared[scenario.scenario_id] = _PreparedSuiteScenario(
                    scenario_id=scenario.scenario_id,
                    command=command,
                    manifest_path=manifest_path,
                    fixture_context=fixture_context,
                    fixture_client=fixture_client,
                )

            for scenario in suite.scenarios:
                attached = prepared[scenario.scenario_id]
                command = attached.command
                _activate_scenario_journey(
                    self.repo_root,
                    command.journey_id,
                    work_item_id=command.work_item_id,
                    task_id=command.task_id,
                )
                station_endpoints.refresh()
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_START,
                    scenario_id=scenario.scenario_id,
                )
                result = execute_scenario(
                    runtime=command.runtime,
                    scenario_id=command.scenario_id,
                    budget_seconds=command.budget_seconds,
                    repo_root=self.repo_root,
                    profile=command.profile,
                    profiles=(
                        ()
                        if command.profile is not None
                        else command.profiles
                    ),
                    clients=command.clients,
                    runtime_manifest_path=attached.manifest_path,
                    result_root=self.result_root,
                    workspace_identity=identity,
                    fixture_action_client=attached.fixture_client,
                )
                result_digest = _required_text(
                    result.get("resultDigest"),
                    f"{scenario.scenario_id} result digest",
                )
                result_resource = f"scenario-result:{result_digest}"
                ledger.record(
                    SuiteRuntimeAction.UI_ACTION,
                    scenario_id=scenario.scenario_id,
                    resource_id=f"{result_resource}:ui-action",
                )
                ledger.record(
                    SuiteRuntimeAction.RECEIVER_ASSERTION,
                    scenario_id=scenario.scenario_id,
                    resource_id=f"{result_resource}:receiver",
                )
                ledger.record(
                    SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                    scenario_id=scenario.scenario_id,
                    resource_id=result_resource,
                )
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_END,
                    scenario_id=scenario.scenario_id,
                )
                variant_results[scenario.scenario_id] = str(
                    result["result"]
                )
                result_refs[scenario.scenario_id] = result_digest

        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        suite_report_path = _write_immutable_json(
            owner_root / "suite-runtime.json",
            suite_report,
        )
        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "taskId": suite.task_id,
            "variantResults": variant_results,
            "resultDigests": result_refs,
            "runtimeRoot": str(owner_root),
            "suiteRuntimeReport": str(suite_report_path),
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
        }

    def _prepare_desktop_suite_resources(
        self,
        *,
        suite: _TaskSuiteDefinition,
        contract: PlatformRuntimeContract,
        owner_root: Path,
        identity: Mapping[str, Any],
        profile_environments: Mapping[str, Mapping[str, str]],
        station_endpoints: _StationEndpoints,
        accounts: Mapping[str, str],
        password: str,
        stack: ExitStack,
        ledger: SuiteRuntimeLedger,
    ) -> _PreparedDesktopSuiteResources | None:
        plans: dict[str, tuple[str, PlatformRuntimeCommand]] = {}
        logical_to_physical: dict[str, str] = {}
        for scenario in suite.scenarios:
            command = contract.command(scenario.leaf_action)
            if command.runtime == "mobile":
                continue
            for client_id in command.clients:
                physical_id = suite.desktop_client_aliases.get(
                    client_id,
                    client_id,
                )
                logical_to_physical[client_id] = physical_id
                plans.setdefault(physical_id, (client_id, command))
        if not plans:
            return None

        reserved_ports: set[int] = set()
        active_client_ids: set[int] = set()
        clients: dict[str, FoundationRuntimeClient] = {}
        snapshots: dict[str, Mapping[str, Any]] = {}
        service_by_physical: dict[str, str] = {}
        for index, (physical_id, (logical_id, command)) in enumerate(
            plans.items()
        ):
            actor_role = _desktop_actor_role(logical_id)
            service_id = _desktop_service_for_client(
                physical_id,
                command.profiles,
            )
            profile_id = (
                PROFILE
                if service_id == STATION_ID
                else SECONDARY_PROFILE
            )
            client = _make_client(
                repo_root=self.repo_root,
                runtime_root=owner_root,
                station_url=station_endpoints[service_id].transport_url,
                profile_env=profile_environments[profile_id],
                source_commit=str(identity["head"]),
                client_id=physical_id,
                runtime_kind=(
                    "browser"
                    if command.runtime == "browser"
                    else "native-tauri"
                ),
                port_bases=(
                    3530 + index * 20,
                    3710 + index * 20,
                    4495 + index * 20,
                ),
                reserved_ports=reserved_ports,
            )
            stack.callback(
                _stop_client_or_raise,
                client,
                purpose=f"{suite.task_id} Suite",
                active_client_ids=active_client_ids,
            )
            active_client_ids.add(id(client))
            account = (
                None
                if actor_role == "anonymous"
                else accounts[actor_role]
            )
            snapshot = _start_client(
                client,
                account=account,
                password=password,
                anonymous_binding_account=(
                    accounts["browser_anonymous_bootstrap"]
                    if actor_role == "anonymous"
                    else None
                ),
            )
            if account is not None and command.runtime != "browser":
                _wait_for_device_enrollment(client)
            clients[physical_id] = client
            snapshots[physical_id] = snapshot
            service_by_physical[physical_id] = service_id
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{physical_id}",
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"session:{physical_id}",
            )

        for service_id in tuple(dict.fromkeys(service_by_physical.values())):
            by_role = {
                _desktop_actor_role(logical_id): clients[physical_id]
                for physical_id, (logical_id, _command) in plans.items()
                if service_by_physical[physical_id] == service_id
                and _desktop_actor_role(logical_id) in {"alice", "bob"}
            }
            if set(by_role) == {"alice", "bob"}:
                _prepare_accepted_friendship(
                    by_role["alice"],
                    by_role["bob"],
                )
        logical_clients = {
            logical_id: clients[physical_id]
            for logical_id, physical_id in logical_to_physical.items()
        }
        return _PreparedDesktopSuiteResources(
            clients=clients,
            snapshots=snapshots,
            logical_to_physical=logical_to_physical,
            service_by_physical=service_by_physical,
            fixture=_DesktopProductionFixture(logical_clients),
        )

    def _prepare_mobile_suite_resources(
        self,
        *,
        suite: _TaskSuiteDefinition,
        contract: PlatformRuntimeContract,
        owner_root: Path,
        identity: Mapping[str, Any],
        profile_environments: Mapping[str, Mapping[str, str]],
        station_endpoints: _StationEndpoints,
        attestations: Mapping[str, Any],
        accounts: Mapping[str, str],
        password: str,
        stack: ExitStack,
        ledger: SuiteRuntimeLedger,
    ) -> _PreparedMobileSuiteResources | None:
        specs: dict[str, Any] = {}
        command_by_client: dict[str, PlatformRuntimeCommand] = {}
        for scenario in suite.scenarios:
            command = contract.command(scenario.leaf_action)
            if command.runtime != "mobile":
                continue
            for client in command.mobile_clients:
                specs.setdefault(client.id, client)
                command_by_client.setdefault(client.id, command)
        if not specs:
            return None
        service_by_client = _suite_mobile_service_bindings(
            suite,
            contract,
        )

        base_contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-simulator.yaml"
        )
        provisioner = SelectedMobileSimulatorProvisioner(
            base_contract,
            clients=tuple(specs.values()),
            runtime_source_commit=str(identity["head"]),
            repo_root=self.repo_root,
            runtime_base=owner_root / "simulator",
        )
        stack.callback(
            _cleanup_mobile_provisioner_or_raise,
            provisioner,
        )
        provisioned = provisioner.provision(
            next(iter(command_by_client.values())).journey_id
        )
        if (
            not isinstance(provisioned, MobileSimulatorRuntimeManifest)
            or provisioned.is_blocked()
        ):
            raise RuntimeOwnerBlocked(
                "CLIENT_RUNTIME_UNAVAILABLE",
                (
                    provisioned.blocked_reason
                    or "Mobile simulator provisioning did not complete"
                ),
                resource=(
                    provisioned.blocked_resource
                    or "mobile-simulator"
                ),
            )
        resources = provisioned.simulator_resources
        client_resources = _mobile_mapping(
            resources.get("clients"),
            "client resources",
            client_id="mobile-runtime",
        )
        appium = _mobile_mapping(
            resources.get("appium"),
            "Appium resources",
            client_id="mobile-runtime",
        )
        appium_endpoint = _required_text(
            appium.get("serverUrl"),
            "Mobile Appium endpoint",
        )
        services: dict[str, dict[str, Any]] = {
            service_id: {
                "runtime_identity": attestation.runtime_identity,
                "endpoint": attestation.endpoint,
                "profile_id": (
                    PROFILE
                    if service_id == STATION_ID
                    else SECONDARY_PROFILE
                ),
            }
            for service_id, attestation in attestations.items()
        }
        sessions: dict[str, Any] = {}
        actor_ptids: dict[str, str] = {}
        payloads: dict[str, dict[str, Any]] = {}
        for client_id, client_spec in specs.items():
            command = command_by_client[client_id]
            service_id = service_by_client[client_id]
            session = provisioner.create_appium_session(
                provisioned,
                client_id,
            )
            stack.callback(
                _stop_mobile_session_or_raise,
                session,
                client_id=client_id,
            )
            actor_ptid, scope, build = _start_mobile_client(
                session,
                client_id=client_id,
                account=accounts[client_spec.role],
                password=password,
                station_endpoint=station_endpoints[service_id],
                station_runtime_identity=(
                    attestations[service_id].runtime_identity
                ),
                source_commit=str(identity["head"]),
                required_actions=contract.mobile_harness_actions,
            )
            sessions[client_id] = session
            actor_ptids[client_id] = actor_ptid
            payloads[client_id] = _mobile_client_payload(
                client_id=client_id,
                actor_role=client_spec.role,
                actor_ptid=actor_ptid,
                session=session,
                resource=_mobile_mapping(
                    client_resources.get(client_id),
                    "client resource",
                    client_id=client_id,
                ),
                service_id=service_id,
                service=services[service_id],
                source_commit=str(identity["head"]),
                build=build,
                scope=scope,
                appium_endpoint=appium_endpoint,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{client_id}",
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"session:{client_id}",
            )
        federation_id = _prepare_mobile_friendship(
            sessions,
            actor_ptids,
            accounts,
            services,
            service_by_client,
            suite.required_mobile_bob_services,
        )
        return _PreparedMobileSuiteResources(
            sessions=sessions,
            payloads=payloads,
            fixture=MobileProductionFixture(
                sessions=sessions,
                actor_ptids=actor_ptids,
                federation_id=federation_id,
            ),
        )

    @staticmethod
    def _publish_suite_services(
        *,
        root: Path,
        command: PlatformRuntimeCommand,
        run_id: str,
        profile_environments: Mapping[str, Mapping[str, str]],
        attestations: Mapping[str, Any],
        schema_bindings: Mapping[
            str,
            runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
        ],
    ) -> dict[str, dict[str, Any]]:
        services: dict[str, dict[str, Any]] = {}
        for profile_id in command.profiles:
            service_id = (
                STATION_ID
                if profile_id == PROFILE
                else SECONDARY_STATION_ID
            )
            profile_env = profile_environments[profile_id]
            attestation_ref = _publish_attestation(
                root,
                attestations[service_id],
                run_id=run_id,
                journey_id=command.journey_id,
                service_id=service_id,
            )
            schema_ref = _publish_canonical_private_schema_attestation(
                root,
                service_id,
                schema_bindings[service_id],
            )
            services[service_id] = _service_payload(
                attestations[service_id],
                attestation_ref,
                schema_ref,
                profile_id=profile_id,
                schema_attestation_endpoint=profile_env[
                    "PT_STATION_URL"
                ],
            )
        return services

    def run_platform_action(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        if command.runtime == "mobile":
            return self._run_mobile_platform_action(command)
        return self._run_desktop_platform_action(command)

    def _run_mobile_platform_action(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        _activate_scenario_journey(
            self.repo_root,
            command.journey_id,
            work_item_id=command.work_item_id,
            task_id=command.task_id,
        )
        resolved, primary_profile_env = _resolve_machine_profile(
            self.repo_root
        )
        profile_environments = {PROFILE: primary_profile_env}
        if SECONDARY_PROFILE in command.profiles:
            _path, secondary_profile_env = _resolve_secondary_profile(
                resolved
            )
            profile_environments[SECONDARY_PROFILE] = secondary_profile_env

        run_id = (
            f"{command.task_id.lower()}-{command.action.removeprefix('run-')}-"
            f"{identity['head'][:12]}-{os.getpid()}"
        )
        owner_root = self.runtime_root / run_id
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / command.journey_id
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        bindings = tuple(
            (
                STATION_ID
                if profile_id == PROFILE
                else SECONDARY_STATION_ID,
                profile_environments[profile_id],
            )
            for profile_id in command.profiles
        )
        transport_stack, station_endpoints = _open_station_tunnels(bindings)
        attestations: dict[str, Any] = {}
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": command.journey_id,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                for service_id, profile_env in bindings:
                    attestations[service_id] = produce_station_attestation(
                        environment_id=(
                            "secure-content-development-mobile-runtime"
                        ),
                        run_id=run_id,
                        service_id=service_id,
                        station_url=station_endpoints[
                            service_id
                        ].transport_url,
                        profile_env=profile_env,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                _error_message_with_cleanup(error),
                resource="station:secure-content-mobile",
            ) from error
        protocol_digest = source_proto_digest(self.repo_root)
        if any(
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != protocol_digest
            for attestation in attestations.values()
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "Mobile Stations are not deployed from the exact source",
                resource="station:secure-content-mobile",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        schema_bindings: dict[
            str,
            runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
        ] = {}
        try:
            for service_id, profile_env in bindings:
                profile_id = str(profile_env["PT_DEV_PROFILE"])
                schema_bindings[service_id] = (
                    _resolve_canonical_private_schema_attestation(
                        self.result_root,
                        self.repo_root,
                        identity,
                        attestations[service_id],
                        service_id=service_id,
                        profile_id=profile_id,
                        attested_endpoint=profile_env["PT_STATION_URL"],
                        accepted_intents=(
                            ("FINAL_CUT",)
                            if command.task_id == "W12"
                            else ("SCHEMA_ACTIVATION",)
                        ),
                    )
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            base_contract = EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "mobile-simulator.yaml"
            )
            provisioner = SelectedMobileSimulatorProvisioner(
                base_contract,
                clients=command.mobile_clients,
                runtime_source_commit=str(identity["head"]),
                repo_root=self.repo_root,
                runtime_base=owner_root / "simulator",
            )
            stack.callback(
                _cleanup_mobile_provisioner_or_raise,
                provisioner,
            )
            provisioned = provisioner.provision(command.journey_id)
            if (
                not isinstance(
                    provisioned,
                    MobileSimulatorRuntimeManifest,
                )
                or provisioned.is_blocked()
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    (
                        provisioned.blocked_reason
                        or "Mobile simulator provisioning did not complete"
                    ),
                    resource=(
                        provisioned.blocked_resource
                        or "mobile-simulator"
                    ),
                )
            resources = provisioned.simulator_resources
            client_resources = _mobile_mapping(
                resources.get("clients"),
                "client resources",
                client_id="mobile-runtime",
            )
            appium = _mobile_mapping(
                resources.get("appium"),
                "Appium resources",
                client_id="mobile-runtime",
            )
            appium_endpoint = _required_text(
                appium.get("serverUrl"),
                "Mobile Appium endpoint",
            )
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_endpoints[
                    STATION_ID
                ].transport_url,
                secondary_station_url=(
                    station_endpoints[
                        SECONDARY_STATION_ID
                    ].transport_url
                    if SECONDARY_STATION_ID in station_endpoints
                    else None
                ),
                run_id=run_id,
                roles=tuple(
                    sorted(
                        {
                            client.role
                            for client in command.mobile_clients
                        }
                    )
                ),
                secondary_roles=(
                    ("bob",)
                    if SECONDARY_PROFILE in command.profiles
                    else ()
                ),
            )
            services: dict[str, dict[str, Any]] = {}
            for service_id, profile_env in bindings:
                attestation_ref = _publish_attestation(
                    owner_root,
                    attestations[service_id],
                    run_id=run_id,
                    journey_id=command.journey_id,
                    service_id=service_id,
                )
                schema_ref = _publish_canonical_private_schema_attestation(
                    owner_root,
                    service_id,
                    schema_bindings[service_id],
                )
                services[service_id] = _service_payload(
                    attestations[service_id],
                    attestation_ref,
                    schema_ref,
                    profile_id=str(profile_env["PT_DEV_PROFILE"]),
                    schema_attestation_endpoint=profile_env[
                        "PT_STATION_URL"
                    ],
                )

            sessions: dict[str, Any] = {}
            actor_ptids: dict[str, str] = {}
            client_payloads: list[dict[str, Any]] = []
            service_by_client: dict[str, str] = {}
            for client in command.mobile_clients:
                service_id = _mobile_service_for_client(
                    client.id,
                    command.profiles,
                )
                session = provisioner.create_appium_session(
                    provisioned,
                    client.id,
                )
                stack.callback(
                    _stop_mobile_session_or_raise,
                    session,
                    client_id=client.id,
                )
                actor_ptid, scope, build = _start_mobile_client(
                    session,
                    client_id=client.id,
                    account=accounts[client.role],
                    password=password,
                    station_endpoint=station_endpoints[service_id],
                    station_runtime_identity=(
                        attestations[service_id].runtime_identity
                    ),
                    source_commit=str(identity["head"]),
                    required_actions=(
                        load_platform_runtime_contract().mobile_harness_actions
                    ),
                )
                sessions[client.id] = session
                actor_ptids[client.id] = actor_ptid
                service_by_client[client.id] = service_id
                client_payloads.append(
                    _mobile_client_payload(
                        client_id=client.id,
                        actor_role=client.role,
                        actor_ptid=actor_ptid,
                        session=session,
                        resource=_mobile_mapping(
                            client_resources.get(client.id),
                            "client resource",
                            client_id=client.id,
                        ),
                        service_id=service_id,
                        service=services[service_id],
                        source_commit=str(identity["head"]),
                        build=build,
                        scope=scope,
                        appium_endpoint=appium_endpoint,
                    )
                )

            federation_id = _prepare_mobile_friendship(
                sessions,
                actor_ptids,
                accounts,
                services,
                service_by_client,
                frozenset(
                    {
                        SECONDARY_STATION_ID
                        if SECONDARY_PROFILE in command.profiles
                        else STATION_ID
                    }
                ),
            )
            actions = MobileProductionFixture(
                sessions=sessions,
                actor_ptids=actor_ptids,
                federation_id=federation_id,
            )
            fixture_identity = _sha256(
                json.dumps(
                    {
                        "action": command.action,
                        "clients": sorted(command.clients),
                        "runId": run_id,
                        "source": identity["head"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            fixture_owner = RuntimeFixtureOwner(
                source_checkpoint=str(identity["head"]),
                run_id=run_id,
                fixture_set_id=f"{command.task_id.lower()}-{command.action}",
                bindings=(
                    RuntimeFixtureBinding(
                        capability=command.fixture_capability,
                        owner="mobile-product-fixture-owner",
                        opaque_id=f"{command.action}-fixture",
                        expected_identity_digest=fixture_identity,
                        operations=command.fixture_operations,
                        action=actions.execute,
                        sensitive_values=(password, *accounts.values()),
                    ),
                ),
            )
            fixture_path = fixture_owner.write_manifest(
                owner_root / "fixture.json"
            )
            fixture = fixture_owner.manifest()
            fixture_ref = {
                "path": fixture_path.name,
                "sha256": _sha256(fixture_path.read_bytes()),
            }
            manifest_path = _write_owned_runtime_manifest(
                payload=_manifest_payload(
                    identity=identity,
                    journey_id=command.journey_id,
                    run_id=run_id,
                    services=services,
                    fixture_ref=fixture_ref,
                    fixture_digest=str(fixture["manifest_digest"]),
                    clients=client_payloads,
                ),
                output_path=owner_root / "runtime.json",
                repo_root=self.repo_root,
            )
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            fixture_context, fixture_client = (
                fixture_owner.open_action_channel(
                    workspace_id=str(identity["workspaceId"]),
                    gate_id=command.journey_id,
                    runtime_manifest_digests=(
                        str(manifest["manifest_digest"]),
                    ),
                )
            )
            stack.callback(
                _close_fixture_action_channel,
                fixture_context,
                fixture_client,
            )
            result = execute_scenario(
                runtime=command.runtime,
                scenario_id=command.scenario_id,
                budget_seconds=command.budget_seconds,
                repo_root=self.repo_root,
                profile=command.profile,
                profiles=(
                    () if command.profile is not None else command.profiles
                ),
                clients=command.clients,
                runtime_manifest_path=manifest_path,
                result_root=self.result_root,
                workspace_identity=identity,
                fixture_action_client=fixture_client,
            )
        return {
            "status": result["result"],
            "proofState": "UNPROVEN",
            "action": command.action,
            "result": result["result"],
            "runtimeRoot": str(owner_root),
        }

    def _run_desktop_platform_action(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        _activate_scenario_journey(
            self.repo_root,
            command.journey_id,
            work_item_id=command.work_item_id,
            task_id=command.task_id,
        )
        resolved, primary_profile_env = _resolve_machine_profile(
            self.repo_root
        )
        profile_environments = {PROFILE: primary_profile_env}
        if SECONDARY_PROFILE in command.profiles:
            _path, secondary_profile_env = _resolve_secondary_profile(
                resolved
            )
            profile_environments[SECONDARY_PROFILE] = secondary_profile_env
        bindings = tuple(
            (
                STATION_ID
                if profile_id == PROFILE
                else SECONDARY_STATION_ID,
                profile_environments[profile_id],
            )
            for profile_id in command.profiles
        )
        run_id = (
            f"{command.task_id.lower()}-{command.action.removeprefix('run-')}-"
            f"{identity['head'][:12]}-{os.getpid()}"
        )
        owner_root = self.runtime_root / run_id
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / command.journey_id
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(bindings)
        attestations: dict[str, Any] = {}
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": command.journey_id,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                for service_id, profile_env in bindings:
                    attestations[service_id] = produce_station_attestation(
                        environment_id=(
                            "secure-content-development-desktop-runtime"
                        ),
                        run_id=run_id,
                        service_id=service_id,
                        station_url=station_endpoints[
                            service_id
                        ].transport_url,
                        profile_env=profile_env,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                _error_message_with_cleanup(error),
                resource="station:secure-content-desktop",
            ) from error
        protocol_digest = source_proto_digest(self.repo_root)
        if any(
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != protocol_digest
            for attestation in attestations.values()
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "Desktop Stations are not deployed from the exact source",
                resource="station:secure-content-desktop",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        schema_bindings: dict[
            str,
            runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
        ] = {}
        try:
            for service_id, profile_env in bindings:
                profile_id = str(profile_env["PT_DEV_PROFILE"])
                schema_bindings[service_id] = (
                    _resolve_canonical_private_schema_attestation(
                        self.result_root,
                        self.repo_root,
                        identity,
                        attestations[service_id],
                        service_id=service_id,
                        profile_id=profile_id,
                        attested_endpoint=profile_env["PT_STATION_URL"],
                        accepted_intents=(
                            ("FINAL_CUT",)
                            if command.task_id == "W12"
                            else ("SCHEMA_ACTIVATION",)
                        ),
                    )
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            roles = tuple(
                sorted(
                    {
                        _desktop_actor_role(client_id)
                        for client_id in command.clients
                        if _desktop_actor_role(client_id) != "anonymous"
                    }
                )
            )
            secondary_roles = tuple(
                sorted(
                    {
                        _desktop_actor_role(client_id)
                        for client_id in command.clients
                        if _desktop_service_for_client(
                            client_id,
                            command.profiles,
                        )
                        == SECONDARY_STATION_ID
                        and _desktop_actor_role(client_id) != "anonymous"
                    }
                )
            )
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_endpoints[
                    STATION_ID
                ].transport_url,
                secondary_station_url=(
                    station_endpoints[
                        SECONDARY_STATION_ID
                    ].transport_url
                    if SECONDARY_STATION_ID in station_endpoints
                    else None
                ),
                run_id=run_id,
                roles=roles,
                secondary_roles=secondary_roles,
            )
            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            clients: dict[str, FoundationRuntimeClient] = {}
            payloads: list[dict[str, Any]] = []
            for index, client_id in enumerate(command.clients):
                actor_role = _desktop_actor_role(client_id)
                service_id = _desktop_service_for_client(
                    client_id,
                    command.profiles,
                )
                profile_id = (
                    PROFILE
                    if service_id == STATION_ID
                    else SECONDARY_PROFILE
                )
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_endpoints[
                        service_id
                    ].transport_url,
                    profile_env=profile_environments[profile_id],
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind=(
                        "browser"
                        if command.runtime == "browser"
                        else "native-tauri"
                    ),
                    port_bases=(
                        3530 + index * 20,
                        3710 + index * 20,
                        4495 + index * 20,
                    ),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose=command.action,
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                account = (
                    None
                    if actor_role == "anonymous"
                    else accounts[actor_role]
                )
                snapshot = _start_client(
                    client,
                    account=account,
                    password=password,
                    anonymous_binding_account=(
                        accounts.get("browser_actor")
                        if actor_role == "anonymous"
                        else None
                    ),
                )
                if account is not None and command.runtime != "browser":
                    _wait_for_device_enrollment(client)
                clients[client_id] = client
                payloads.append(
                    _client_payload(
                        client_id,
                        actor_role,
                        client,
                        snapshot,
                        service_roles={"station": service_id},
                    )
                )
            for service_id in {
                _desktop_service_for_client(
                    client_id,
                    command.profiles,
                )
                for client_id in command.clients
            }:
                service_clients = [
                    clients[client_id]
                    for client_id in command.clients
                    if _desktop_service_for_client(
                        client_id,
                        command.profiles,
                    )
                    == service_id
                    and _desktop_actor_role(client_id)
                    in {"alice", "bob"}
                ]
                by_role = {
                    _desktop_actor_role(client_id): clients[client_id]
                    for client_id in command.clients
                    if _desktop_service_for_client(
                        client_id,
                        command.profiles,
                    )
                    == service_id
                    and _desktop_actor_role(client_id)
                    in {"alice", "bob"}
                }
                if len(service_clients) >= 2 and set(by_role) == {
                    "alice",
                    "bob",
                }:
                    _prepare_accepted_friendship(
                        by_role["alice"],
                        by_role["bob"],
                    )

            services: dict[str, dict[str, Any]] = {}
            for service_id, profile_env in bindings:
                attestation_ref = _publish_attestation(
                    owner_root,
                    attestations[service_id],
                    run_id=run_id,
                    journey_id=command.journey_id,
                    service_id=service_id,
                )
                schema_ref = _publish_canonical_private_schema_attestation(
                    owner_root,
                    service_id,
                    schema_bindings[service_id],
                )
                services[service_id] = _service_payload(
                    attestations[service_id],
                    attestation_ref,
                    schema_ref,
                    profile_id=str(profile_env["PT_DEV_PROFILE"]),
                    schema_attestation_endpoint=profile_env[
                        "PT_STATION_URL"
                    ],
                )
            fixture_actions = _DesktopProductionFixture(clients)
            fixture_identity = _sha256(
                json.dumps(
                    {
                        "action": command.action,
                        "clients": sorted(command.clients),
                        "runId": run_id,
                        "source": identity["head"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            fixture_owner = RuntimeFixtureOwner(
                source_checkpoint=str(identity["head"]),
                run_id=run_id,
                fixture_set_id=f"{command.task_id.lower()}-{command.action}",
                bindings=(
                    RuntimeFixtureBinding(
                        capability=command.fixture_capability,
                        owner="desktop-product-fixture-owner",
                        opaque_id=f"{command.action}-fixture",
                        expected_identity_digest=fixture_identity,
                        operations=command.fixture_operations,
                        action=fixture_actions.execute,
                        sensitive_values=(password, *accounts.values()),
                    ),
                ),
            )
            fixture_path = fixture_owner.write_manifest(
                owner_root / "fixture.json"
            )
            fixture = fixture_owner.manifest()
            manifest_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=command.journey_id,
                    run_id=run_id,
                    services=services,
                    fixture_ref={
                        "path": fixture_path.name,
                        "sha256": _sha256(fixture_path.read_bytes()),
                    },
                    fixture_digest=str(fixture["manifest_digest"]),
                    clients=payloads,
                ),
                output_path=owner_root / "runtime.json",
                journey_id=command.journey_id,
                sessions_by_client=clients,
                automation_refs_by_client={
                    client_id: {
                        "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                        "endpoint": _webdriver_endpoint(client),
                        "session_id": str(client.driver.session_id),
                    }
                    for client_id, client in clients.items()
                },
                repo_root=self.repo_root,
            )
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            fixture_context, fixture_client = (
                fixture_owner.open_action_channel(
                    workspace_id=str(identity["workspaceId"]),
                    gate_id=command.journey_id,
                    runtime_manifest_digests=(
                        str(manifest["manifest_digest"]),
                    ),
                )
            )
            stack.callback(
                _close_fixture_action_channel,
                fixture_context,
                fixture_client,
            )
            result = execute_scenario(
                runtime=command.runtime,
                scenario_id=command.scenario_id,
                budget_seconds=command.budget_seconds,
                repo_root=self.repo_root,
                profile=command.profile,
                profiles=(
                    () if command.profile is not None else command.profiles
                ),
                clients=command.clients,
                runtime_manifest_path=manifest_path,
                result_root=self.result_root,
                workspace_identity=identity,
                fixture_action_client=fixture_client,
            )
            for client in reversed(tuple(clients.values())):
                _stop_client_or_raise(
                    client,
                    purpose=command.action,
                    active_client_ids=active_client_ids,
                )
            clients.clear()
        return {
            "status": result["result"],
            "proofState": "UNPROVEN",
            "action": command.action,
            "result": result["result"],
            "runtimeRoot": str(owner_root),
        }

    def _run_w8_suite(
        self,
        *,
        formal_acceptance: bool,
        expected_slot: int = SLOT,
    ) -> dict[str, Any]:
        journey_id = (
            SOCIAL_ACCEPTANCE_JOURNEY
            if formal_acceptance
            else W8_JOURNEY
        )
        plan_id = SOCIAL_ACCEPTANCE_PLAN_ID if formal_acceptance else PLAN_ID
        runtime_reuse = (
            SOCIAL_ACCEPTANCE_RUNTIME_REUSE
            if formal_acceptance
            else W8_RUNTIME_REUSE
        )
        identity = (
            _require_social_acceptance_source(
                self.repo_root,
                self.result_root,
            )
            if formal_acceptance
            else _require_clean_source(self.repo_root, self.result_root)
        )
        source_evidence_root = Path(
            str(identity.get("sourceEvidenceRoot") or self.result_root)
        )
        schema_identity = dict(identity)
        schema_identity["workspaceId"] = str(
            identity.get("sourceEvidenceWorkspaceId")
            or identity["workspaceId"]
        )
        declaration = (
            _activate_social_desktop_acceptance_journey(self.repo_root)
            if formal_acceptance
            else _activate_scenario_journey(
                self.repo_root,
                journey_id,
                work_item_id=W8_WORK_ITEM_ID,
                task_id=W8_TASK_ID,
                plan_id=plan_id,
            )
        )
        work_item_id = str(declaration["workItemId"])
        task_id = str(declaration["taskId"])
        resolved, profile_env = _resolve_machine_profile(
            self.repo_root,
            expected_slot=expected_slot,
        )
        _secondary_profile_path, secondary_profile_env = (
            _resolve_secondary_profile(resolved)
        )
        run_id = (
            f"{'social-desktop-acceptance' if formal_acceptance else 'w8-suite'}-"
            f"{identity['head'][:12]}-{os.getpid()}-"
            f"{time.time_ns()}"
        )
        owner_root = self.runtime_root / run_id
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / journey_id
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        profile_bindings: tuple[tuple[str, Mapping[str, str]], ...] = (
            (STATION_ID, profile_env),
            (SECONDARY_STATION_ID, secondary_profile_env),
        )
        transport_stack, station_endpoints = _open_station_tunnels(
            profile_bindings
        )
        station_url = station_endpoints[STATION_ID].transport_url
        secondary_station_url = station_endpoints[
            SECONDARY_STATION_ID
        ].transport_url
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": journey_id,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                attestation = produce_station_attestation(
                    environment_id=(
                        "social-private-desktop-runtime"
                        if formal_acceptance
                        else "secure-content-w8-runtime"
                    ),
                    run_id=run_id,
                    service_id=STATION_ID,
                    station_url=station_url,
                    profile_env=profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
                secondary_attestation = produce_station_attestation(
                    environment_id=(
                        "social-private-desktop-runtime"
                        if formal_acceptance
                        else "secure-content-w8-runtime"
                    ),
                    run_id=run_id,
                    service_id=SECONDARY_STATION_ID,
                    station_url=secondary_station_url,
                    profile_env=secondary_profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=(
                        resolve_remote_source_identity
                    ),
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            reason = _error_message_with_cleanup(error)
            resource = (
                error.resource
                if isinstance(error, BlockedError)
                else "station:station-four"
            )
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                reason,
                resource=resource,
            ) from error
        if (
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != source_proto_digest(self.repo_root)
            or not commits_match(
                secondary_attestation.live_commit,
                identity["head"],
            )
            or secondary_attestation.protocol_digest
            != source_proto_digest(self.repo_root)
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                f"{task_id} Stations are not deployed from the exact source",
                resource=f"station:{task_id}",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        try:
            schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    source_evidence_root,
                    self.repo_root,
                    schema_identity,
                    attestation,
                    service_id=STATION_ID,
                    profile_id=PROFILE,
                    attested_endpoint=profile_env["PT_STATION_URL"],
                )
            )
            secondary_schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    source_evidence_root,
                    self.repo_root,
                    schema_identity,
                    secondary_attestation,
                    service_id=SECONDARY_STATION_ID,
                    profile_id=SECONDARY_PROFILE,
                    attested_endpoint=secondary_profile_env[
                        "PT_STATION_URL"
                    ],
                )
            )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        fixture_epoch = (
            "social-desktop-" if formal_acceptance else "w8-"
        ) + _sha256(run_id)[:32]
        ledger = SuiteRuntimeLedger(
            runtime_reuse,
            suite_runtime_id=run_id,
            source_digest=str(identity["head"]),
            fixture_epoch=fixture_epoch,
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id=(
                "social-private-desktop-suite"
                if formal_acceptance
                else "secure-content-w8-suite"
            ),
        )
        variant_results: dict[str, str] = {}
        ui_evidence_refs: dict[str, dict[str, str]] = {}
        raw_result_root = owner_root / "unpublished-results"
        publish_root = owner_root / "publish-ready"
        publication_result_root = _result_publication_root(
            self.result_root,
            identity=identity,
            formal_acceptance=formal_acceptance,
        )
        with _runtime_cleanup_scope(transport_stack) as stack:
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_url,
                run_id=run_id,
                roles=("alice", "bob", "eve"),
            )
            for account_role in ("alice", "bob", "eve"):
                ledger.record(
                    SuiteRuntimeAction.ACCOUNT_PROVISION,
                    resource_id=f"account:{account_role}",
                )
            remote_provisioner = RemotePrivateRecipientProvisioner(
                source_checkpoint=str(identity["head"]),
                run_id=run_id,
                station_url=secondary_station_url,
                password=os.environ.get("PT_DEV_ACCOUNT_PASSWORD", "1"),
                account_registrar=_register_runtime_account,
                existing_account=W8_REMOTE_SEEDED_ACCOUNT,
            )
            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            clients: dict[str, FoundationRuntimeClient] = {}
            payloads: dict[str, dict[str, Any]] = {}
            for index, (client_id, actor, account_role) in enumerate(
                DESKTOP_CLIENTS[:2]
            ):
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_url,
                    profile_env=profile_env,
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind="native-tauri",
                    port_bases=(
                        3530 + index * 20,
                        3710 + index * 20,
                        4495 + index * 20,
                    ),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose="W8 Suite",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                snapshot = _start_client(
                    client,
                    account=accounts[account_role],
                    password=password,
                )
                _wait_for_device_enrollment(client)
                ledger.record(
                    SuiteRuntimeAction.CLIENT_LAUNCH,
                    resource_id=f"client:{client_id}",
                )
                ledger.record(
                    SuiteRuntimeAction.LOGIN,
                    resource_id=f"session:{client_id}",
                )
                clients[client_id] = client
                payloads[client_id] = _client_payload(
                    client_id,
                    actor,
                    client,
                    snapshot,
                )

            remote_client_id, remote_actor, _remote_account_role = (
                W8_REMOTE_CLIENT
            )
            remote_client = _make_client(
                repo_root=self.repo_root,
                runtime_root=owner_root,
                station_url=secondary_station_url,
                profile_env=secondary_profile_env,
                source_commit=str(identity["head"]),
                client_id=remote_client_id,
                runtime_kind="native-tauri",
                port_bases=(3650, 3830, 4615),
                reserved_ports=reserved_ports,
            )
            _bind_reusable_actor_identity(
                remote_client,
                self.shared_identity_root
                / W8_REMOTE_IDENTITY_SCOPE
                / "actor-identity",
            )
            stack.callback(
                _stop_client_or_raise,
                remote_client,
                purpose="W8 Suite",
                active_client_ids=active_client_ids,
            )
            active_client_ids.add(id(remote_client))
            remote_snapshot = _start_client(
                remote_client,
                account=remote_provisioner.account,
                password=os.environ.get("PT_DEV_ACCOUNT_PASSWORD", "1"),
            )
            _wait_for_device_enrollment(remote_client)
            remote_readiness = _wait_for_mls_readiness(remote_client)
            remote_device_cleanup = {"complete": False}
            stack.callback(
                _revoke_remote_fixture_device_if_pending,
                remote_client,
                readiness=remote_readiness,
                state=remote_device_cleanup,
            )
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{remote_client_id}",
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"session:{remote_client_id}",
            )
            clients[remote_client_id] = remote_client
            payloads[remote_client_id] = _client_payload(
                remote_client_id,
                remote_actor,
                remote_client,
                remote_snapshot,
                service_roles={"station": SECONDARY_STATION_ID},
            )
            try:
                fixture_owner = remote_provisioner.bind_identity(
                    primary_client=clients[DESKTOP_CLIENTS[0][0]],
                    remote_client=remote_client,
                    identity_reader=_moments_harness,
                    authority_reader=_moments_harness,
                    federation_action=_moments_harness,
                )
            except ValueError as error:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    str(error),
                    resource=(
                        f"fixture:{W8_REMOTE_RECIPIENT_CAPABILITY}"
                    ),
                ) from error

            for local_client_id in (
                DESKTOP_CLIENTS[0][0],
                DESKTOP_CLIENTS[1][0],
            ):
                _wait_for_mls_readiness(clients[local_client_id])
            fixture_owner.bind_remote_group(
                lambda remote_actor_ptid, federation_id: (
                    _prepare_remote_group_fixture(
                        clients[DESKTOP_CLIENTS[0][0]],
                        clients[DESKTOP_CLIENTS[1][0]],
                        remote_actor_ptid=remote_actor_ptid,
                        federation_id=federation_id,
                    )
                )
            )
            _revoke_remote_fixture_device_if_pending(
                remote_client,
                readiness=remote_readiness,
                state=remote_device_cleanup,
            )
            _stop_client_or_raise(
                remote_client,
                purpose="W8 remote recipient identity preparation",
                active_client_ids=active_client_ids,
            )
            clients.pop(remote_client_id)
            payloads.pop(remote_client_id)

            eve_client_id, eve_actor, eve_account_role = DESKTOP_CLIENTS[2]
            eve_client = _make_client(
                repo_root=self.repo_root,
                runtime_root=owner_root,
                station_url=station_url,
                profile_env=profile_env,
                source_commit=str(identity["head"]),
                client_id=eve_client_id,
                runtime_kind="native-tauri",
                port_bases=(3570, 3750, 4535),
                reserved_ports=reserved_ports,
            )
            stack.callback(
                _stop_client_or_raise,
                eve_client,
                purpose="W8 Suite",
                active_client_ids=active_client_ids,
            )
            active_client_ids.add(id(eve_client))
            eve_snapshot = _start_client(
                eve_client,
                account=accounts[eve_account_role],
                password=password,
            )
            _wait_for_device_enrollment(eve_client)
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id=f"client:{eve_client_id}",
            )
            ledger.record(
                SuiteRuntimeAction.LOGIN,
                resource_id=f"session:{eve_client_id}",
            )
            clients[eve_client_id] = eve_client
            payloads[eve_client_id] = _client_payload(
                eve_client_id,
                eve_actor,
                eve_client,
                eve_snapshot,
            )

            for client_id, _actor, _account_role in DESKTOP_CLIENTS:
                if (
                    formal_acceptance
                    and client_id == DESKTOP_CLIENTS[1][0]
                ):
                    continue
                _prepare_private_content_keys(clients[client_id])
            recovery_phrase = ""
            recovery_preparation: Mapping[str, Any] = {}
            if formal_acceptance:
                (
                    recovery_phrase,
                    recovery_preparation,
                ) = _prepare_portable_recovery(
                    clients[DESKTOP_CLIENTS[1][0]]
                )
            _prepare_accepted_friendship(
                clients[DESKTOP_CLIENTS[0][0]],
                clients[DESKTOP_CLIENTS[1][0]],
            )
            fixture = fixture_owner.manifest()
            fixture_path = _write_immutable_json(
                owner_root / "fixture.json",
                fixture,
            )
            fixture_digest = str(fixture["manifest_digest"])
            scenario_results: dict[str, str] = {}
            supporting_artifacts: list[str] = []

            if formal_acceptance:
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_START,
                    scenario_id="desktop-pre-restart",
                )
                (
                    baseline,
                    recovery_post_id,
                ) = _run_social_acceptance_pre_restart(
                    alice=clients[DESKTOP_CLIENTS[0][0]],
                    bob=clients[DESKTOP_CLIENTS[1][0]],
                    eve=clients[DESKTOP_CLIENTS[2][0]],
                    station_url=station_url,
                    owner_root=owner_root,
                )
                pre_restart_ui = _receiver_ui_probe(
                    clients[DESKTOP_CLIENTS[1][0]],
                    workstream_id=task_id,
                    scenario_id="desktop-pre-restart",
                    action_text=None,
                    visible_text=W7_PRIVATE_TEXT,
                    open_comments=False,
                )
                pre_restart_ui_path = _write_receiver_ui_evidence(
                    owner_root,
                    workstream_id=task_id,
                    suite_runtime_id=run_id,
                    source_digest=str(identity["head"]),
                    fixture_epoch=fixture_epoch,
                    fixture_manifest_digest=fixture_digest,
                    scenario_id="desktop-pre-restart",
                    variant_id="desktop-pre-restart",
                    receiver_client_id=DESKTOP_CLIENTS[1][0],
                    evidence=pre_restart_ui,
                )
                baseline_path = _write_immutable_json(
                    owner_root / "desktop-pre-restart.json",
                    baseline,
                )
                for action, suffix in (
                    (SuiteRuntimeAction.UI_ACTION, "ui-action"),
                    (
                        SuiteRuntimeAction.RECEIVER_ASSERTION,
                        "receiver",
                    ),
                    (
                        SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                        "supporting",
                    ),
                ):
                    ledger.record(
                        action,
                        scenario_id="desktop-pre-restart",
                        resource_id=(
                            f"artifact:{baseline_path.name}:{suffix}"
                        ),
                    )
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_END,
                    scenario_id="desktop-pre-restart",
                )
                supporting_artifacts.extend(
                    (str(baseline_path), str(pre_restart_ui_path))
                )
                for scenario_id in (
                    "SOC-SEC-AS01",
                    "SOC-SEC-AS03",
                    "SOC-SEC-AS04",
                    "SOC-SEC-AS10",
                ):
                    scenario_results[scenario_id] = "PASS"

                ledger.record(
                    SuiteRuntimeAction.SCENARIO_START,
                    scenario_id="desktop-continuity",
                )
                bob_client_id, bob_actor, bob_account_role = DESKTOP_CLIENTS[1]
                previous_bob = clients[bob_client_id]
                _stop_client_or_raise(
                    previous_bob,
                    purpose="Social Desktop Bob replacement",
                    active_client_ids=active_client_ids,
                )
                bob_replacement = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_url,
                    profile_env=profile_env,
                    source_commit=str(identity["head"]),
                    client_id="secure-content-desktop-bob2",
                    runtime_kind="native-tauri",
                    port_bases=(3590, 3770, 4555),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    bob_replacement,
                    purpose="Social Desktop Suite",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(bob_replacement))
                replacement_snapshot = _start_client(
                    bob_replacement,
                    account=accounts[bob_account_role],
                    password=password,
                )
                ledger.record(
                    SuiteRuntimeAction.CLIENT_REPLACEMENT,
                    scenario_id="desktop-continuity",
                    resource_id="client:secure-content-desktop-bob2",
                )
                before_recovery = _wait_for_private_moment_state(
                    bob_replacement,
                    post_id=recovery_post_id,
                    expected_state="RECOVERY_REQUIRED",
                    actor_label="Bob replacement device",
                )
                restored = _restore_portable_recovery(
                    bob_replacement,
                    recovery_phrase,
                )
                _wait_for_device_enrollment(bob_replacement)
                recovery_phrase = ""
                recovered = _moments_harness(
                    bob_replacement,
                    "recoverPrivateMoment",
                    {"postId": recovery_post_id},
                )
                if (
                    recovered.get("state") != "CONTENT_READY"
                    or recovered.get("textSha256")
                    != _sha256("social-acceptance-never-opened")
                ):
                    raise RuntimeOwnerBlocked(
                        "CLIENT_RUNTIME_UNAVAILABLE",
                        (
                            "Bob replacement device did not recover private "
                            f"history (state={recovered.get('state')!r}, "
                            f"errorCode={recovered.get('errorCode')!r})"
                        ),
                        resource="client:secure-content-desktop-bob2",
                    )
                _prepare_private_content_keys(bob_replacement)
                replacement_snapshot = _wait_for_moments_snapshot(
                    bob_replacement
                )
                clients[bob_client_id] = bob_replacement
                payloads[bob_client_id] = _client_payload(
                    bob_client_id,
                    bob_actor,
                    bob_replacement,
                    replacement_snapshot,
                )
                continuity = {
                    "beforeRecovery": "RECOVERY_REQUIRED",
                    "afterRecovery": "CONTENT_READY",
                    "recoveryPostIdSha256": _sha256(recovery_post_id),
                    "preparedRecoveryEpoch": recovery_preparation[
                        "preparedEpoch"
                    ],
                    "restoredRecoveryEpoch": restored["recoveryEpoch"],
                    "replacementDeviceIdSha256": restored[
                        "deviceIdSha256"
                    ],
                }
                continuity_path = _write_immutable_json(
                    owner_root / "desktop-continuity.json",
                    continuity,
                )
                continuity_ui = _receiver_ui_probe(
                    bob_replacement,
                    workstream_id=task_id,
                    scenario_id="desktop-continuity",
                    action_text=None,
                    visible_text="social-acceptance-never-opened",
                    open_comments=False,
                )
                continuity_ui_path = _write_receiver_ui_evidence(
                    owner_root,
                    workstream_id=task_id,
                    suite_runtime_id=run_id,
                    source_digest=str(identity["head"]),
                    fixture_epoch=fixture_epoch,
                    fixture_manifest_digest=fixture_digest,
                    scenario_id="desktop-continuity",
                    variant_id="desktop-continuity",
                    receiver_client_id=bob_client_id,
                    evidence=continuity_ui,
                )
                for action, suffix in (
                    (SuiteRuntimeAction.UI_ACTION, "ui-action"),
                    (
                        SuiteRuntimeAction.RECEIVER_ASSERTION,
                        "receiver",
                    ),
                    (
                        SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                        "supporting",
                    ),
                ):
                    ledger.record(
                        action,
                        scenario_id="desktop-continuity",
                        resource_id=(
                            f"artifact:{continuity_path.name}:{suffix}"
                        ),
                    )
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_END,
                    scenario_id="desktop-continuity",
                )
                supporting_artifacts.extend(
                    (str(continuity_path), str(continuity_ui_path))
                )
                scenario_results["SOC-SEC-AS02"] = "PASS"
                scenario_results["SOC-SEC-AS08"] = "PASS"

            manifests: dict[str, Path] = {}
            manifest_digests: list[str] = []
            scenario_manifest_digests: dict[str, str] = {}
            service_ids: set[str] = set()
            client_ids: set[str] = set()
            local_client_ids = tuple(item[0] for item in DESKTOP_CLIENTS)
            for spec in W8_SCENARIOS:
                runtime_dir = owner_root / spec.variant_id
                fixture_ref = self._copy_fixture_into(
                    fixture_path,
                    runtime_dir,
                )
                attestation_ref = _publish_attestation(
                    runtime_dir,
                    attestation,
                    run_id=run_id,
                    journey_id=journey_id,
                    service_id=STATION_ID,
                )
                schema_attestation_ref = (
                    _publish_canonical_private_schema_attestation(
                        runtime_dir,
                        STATION_ID,
                        schema_attestation,
                    )
                )
                services = {
                    STATION_ID: _service_payload(
                        attestation,
                        attestation_ref,
                        schema_attestation_ref,
                        profile_id=PROFILE,
                        schema_attestation_endpoint=profile_env[
                            "PT_STATION_URL"
                        ],
                    )
                }
                selected_client_ids = local_client_ids
                if spec.requires_remote_recipient:
                    secondary_attestation_ref = _publish_attestation(
                        runtime_dir,
                        secondary_attestation,
                        run_id=run_id,
                        journey_id=journey_id,
                        service_id=SECONDARY_STATION_ID,
                    )
                    secondary_schema_attestation_ref = (
                        _publish_canonical_private_schema_attestation(
                            runtime_dir,
                            SECONDARY_STATION_ID,
                            secondary_schema_attestation,
                        )
                    )
                    services[SECONDARY_STATION_ID] = _service_payload(
                        secondary_attestation,
                        secondary_attestation_ref,
                        secondary_schema_attestation_ref,
                        profile_id=SECONDARY_PROFILE,
                        schema_attestation_endpoint=secondary_profile_env[
                            "PT_STATION_URL"
                        ],
                    )
                selected_clients = {
                    client_id: clients[client_id]
                    for client_id in selected_client_ids
                }
                manifest_path = write_attached_runtime_manifest(
                    manifest_payload=_manifest_payload(
                        identity=identity,
                        journey_id=journey_id,
                        run_id=run_id,
                        services=services,
                        fixture_ref=fixture_ref,
                        fixture_digest=fixture_digest,
                        clients=[
                            payloads[client_id]
                            for client_id in selected_client_ids
                        ],
                    ),
                    output_path=runtime_dir / "runtime.json",
                    journey_id=journey_id,
                    sessions_by_client=selected_clients,
                    automation_refs_by_client={
                        client_id: {
                            "kind": (
                                runtime_manifest.AUTOMATION_ATTACHMENT_KIND
                            ),
                            "endpoint": _webdriver_endpoint(client),
                            "session_id": str(client.driver.session_id),
                        }
                        for client_id, client in selected_clients.items()
                    },
                    repo_root=self.repo_root,
                )
                manifest = json.loads(
                    manifest_path.read_text(encoding="utf-8")
                )
                manifests[spec.scenario_id] = manifest_path
                manifest_digests.append(str(manifest["manifest_digest"]))
                scenario_manifest_digests[spec.scenario_id] = str(
                    manifest["manifest_digest"]
                )
                service_ids.update(manifest["services"])
                client_ids.update(
                    str(client["id"]) for client in manifest["clients"]
                )

            fixture_context, fixture_action_client = (
                fixture_owner.open_action_channel(
                    workspace_id=str(identity["workspaceId"]),
                    gate_id=journey_id,
                    runtime_manifest_digests=tuple(manifest_digests),
                )
            )
            stack.callback(
                _close_fixture_action_channel,
                fixture_context,
                fixture_action_client,
            )
            for spec in W8_SCENARIOS:
                station_endpoints.refresh()
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_START,
                    scenario_id=spec.scenario_id,
                )
                selected_client_ids = local_client_ids
                for client_id in selected_client_ids:
                    _moments_harness(
                        clients[client_id],
                        "clearLocalState",
                    )
                ledger.record(
                    SuiteRuntimeAction.FIXTURE_RESET,
                    scenario_id=spec.scenario_id,
                    resource_id=f"local-state:{spec.variant_id}",
                )
                result = execute_scenario(
                    runtime="desktop",
                    scenario_id=spec.scenario_id,
                    budget_seconds=1200,
                    repo_root=self.repo_root,
                    profile=(
                        None
                        if spec.requires_remote_recipient
                        else PROFILE
                    ),
                    profiles=(
                        (PROFILE, SECONDARY_PROFILE)
                        if spec.requires_remote_recipient
                        else ()
                    ),
                    clients=selected_client_ids,
                    runtime_manifest_path=manifests[spec.scenario_id],
                    result_root=raw_result_root,
                    workspace_identity=identity,
                    fixture_action_client=fixture_action_client,
                    registry=(
                        _social_acceptance_scenario_registry(
                            spec.scenario_id,
                            work_item_id=work_item_id,
                            task_id=task_id,
                        )
                        if formal_acceptance
                        else None
                    ),
                )
                ui_evidence = _receiver_ui_probe(
                    clients[spec.receiver_client_id],
                    workstream_id=task_id,
                    scenario_id=spec.scenario_id,
                    action_text=(
                        spec.action_text if spec.click_content else None
                    ),
                    visible_text=spec.visible_text,
                    open_comments=spec.open_comments,
                    absent_texts=spec.absent_texts,
                )
                ui_artifact_path = _write_receiver_ui_evidence(
                    owner_root,
                    workstream_id=task_id,
                    suite_runtime_id=run_id,
                    source_digest=str(identity["head"]),
                    fixture_epoch=fixture_epoch,
                    fixture_manifest_digest=fixture_digest,
                    scenario_id=spec.scenario_id,
                    variant_id=spec.variant_id,
                    receiver_client_id=spec.receiver_client_id,
                    evidence=ui_evidence,
                )
                result = _stage_child_result(
                    result,
                    workstream_id=task_id,
                    raw_result_root=raw_result_root,
                    publish_root=publish_root,
                    final_result_root=publication_result_root,
                    ui_evidence_paths=(ui_artifact_path,),
                )
                ui_artifact_ref = {
                    "path": ui_artifact_path.relative_to(
                        owner_root
                    ).as_posix(),
                    "sha256": _sha256(ui_artifact_path.read_bytes()),
                }
                ui_evidence_refs[spec.variant_id] = ui_artifact_ref
                ui_resource_id = (
                    "artifact:"
                    + ui_artifact_ref["path"]
                    + ":"
                    + ui_artifact_ref["sha256"]
                )
                ledger.record(
                    SuiteRuntimeAction.UI_ACTION,
                    scenario_id=spec.scenario_id,
                    resource_id=ui_resource_id,
                )
                ledger.record(
                    SuiteRuntimeAction.RECEIVER_ASSERTION,
                    scenario_id=spec.scenario_id,
                    resource_id=ui_resource_id,
                )
                ledger.record(
                    SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                    scenario_id=spec.scenario_id,
                    resource_id=(
                        "scenario-result:"
                        + str(result.get("resultDigest") or "")
                    ),
                )
                for fixture_id in _restore_w8_invalidated_fixtures(
                    spec,
                    clients,
                ):
                    ledger.record(
                        SuiteRuntimeAction.FIXTURE_RESET,
                        scenario_id=spec.scenario_id,
                        resource_id=f"fixture:{fixture_id}",
                    )
                ledger.record(
                    SuiteRuntimeAction.SCENARIO_END,
                    scenario_id=spec.scenario_id,
                )
                variant_results[spec.variant_id] = str(result["result"])
                if formal_acceptance and result["result"] == "PASS":
                    for scenario_id in SOCIAL_ACCEPTANCE_SCENARIO_MAP[
                        spec.scenario_id
                    ]:
                        scenario_results[scenario_id] = "PASS"

            if (
                formal_acceptance
                and set(scenario_results) != set(SOCIAL_ACCEPTANCE_IDS)
            ):
                raise RuntimeOwnerBlocked(
                    "SOCIAL_ACCEPTANCE_COVERAGE_INCOMPLETE",
                    "Social Desktop Acceptance scenario coverage is incomplete",
                    resource="runtime:social-private-desktop",
                )

        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        suite_report = ledger.require_valid()
        suite_report_path = _write_immutable_json(
            owner_root / "suite-runtime.json",
            suite_report,
        )
        acceptance_runtime_manifest: dict[str, Any] | None = None
        if formal_acceptance:
            acceptance_runtime_manifest = {
                "artifactKind": (
                    "social-private-desktop-suite-runtime-manifest"
                ),
                "schemaVersion": 1,
                "state": "FIXTURE_READY",
                "cleanupState": "CLEANED",
                "runId": run_id,
                "workspaceId": str(identity["workspaceId"]),
                "sourceCommit": str(identity["head"]),
                "worktreeSetDigest": str(identity["worktreeSetDigest"]),
                "scenarioManifestDigests": scenario_manifest_digests,
                "serviceIds": sorted(service_ids),
                "clientIds": sorted(client_ids),
                "suiteRuntimeReportDigest": suite_report["reportDigest"],
            }
        published_generation = _publish_result_generation(
            workstream_id=task_id,
            publish_root=publish_root,
            final_result_root=publication_result_root,
            generation_id=str(identity["head"]),
        )
        result = {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "variantResults": variant_results,
            "runtimeRoot": str(owner_root),
            "suiteRuntimeReport": str(suite_report_path),
            "suiteRuntimeReportDigest": suite_report["reportDigest"],
            "receiverVisibleEvidence": ui_evidence_refs,
        }
        if formal_acceptance:
            supporting_artifacts.extend(
                str(owner_root / reference["path"])
                for reference in ui_evidence_refs.values()
            )
            supporting_artifacts.extend(
                str(path)
                for path in sorted(
                    published_generation.glob("*/*/result.json")
                )
            )
            result.update(
                {
                    "scenarioResults": scenario_results,
                    "unprovenScenarios": [
                        "SOC-SEC-AS11",
                        "SOC-SEC-AS14",
                    ],
                    "historicalScenarios": list(
                        SOCIAL_ACCEPTANCE_HISTORICAL_IDS
                    ),
                    "resourceReuse": {
                        "provisioningRuns": 1,
                        "clientLaunches": 5,
                        "maxConcurrentNativeClients": 3,
                        "newAccountRegistrations": 3,
                        "stationBuilds": 0,
                        "stationDeployments": 0,
                        "desktopBuilds": 0,
                        "clientReplacements": ["bob"],
                    },
                    "runtimeManifest": acceptance_runtime_manifest,
                    "supportingArtifacts": supporting_artifacts,
                }
            )
        return result

    @staticmethod
    def _copy_fixture_into(source: Path, target_root: Path) -> dict[str, str]:
        target = target_root / "fixture.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.open("rb") as reader:
            descriptor = os.open(
                target,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
            with os.fdopen(descriptor, "wb") as writer:
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fsync(writer.fileno())
        return {
            "path": target.relative_to(target_root).as_posix(),
            "sha256": _sha256(target.read_bytes()),
        }


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=(
            "preflight",
            "run-w7-desktop-suite",
            "run-w8-suite",
            "run-social-desktop-acceptance-suite",
            "run-social-cross-station-suite",
            "run-w9-suite",
            "run-w2-suite",
            "run-w10-suite",
            "run-w11-suite",
            "run-final-suite",
        ),
    )
    parser.add_argument("--profile", default=PROFILE)
    parser.add_argument("--profiles")
    parser.add_argument("--slot", type=int, default=SLOT)
    parser.add_argument("--result-root", type=Path)
    parser.add_argument("--runtime-root", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    required_slot = {
        "run-social-desktop-acceptance-suite": SOCIAL_ACCEPTANCE_SLOT,
        "run-social-cross-station-suite": SOCIAL_CROSS_STATION_SLOT,
    }.get(args.action, SLOT)
    if args.profile != PROFILE or args.slot != required_slot:
        blocked = RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            (
                f"{args.action} runtime owner requires --profile four "
                f"--slot {required_slot}"
            ),
            resource="profile:four",
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    selected_profiles = tuple(
        profile.strip()
        for profile in (args.profiles or "").split(",")
        if profile.strip()
    )
    dual_profile_actions = {
        "run-w7-desktop-suite",
        "run-w8-suite",
        "run-social-desktop-acceptance-suite",
        "run-social-cross-station-suite",
        "run-w2-suite",
        "run-w10-suite",
        "run-w11-suite",
        "run-final-suite",
    }
    if (
        args.action in dual_profile_actions
        and selected_profiles != (PROFILE, SECONDARY_PROFILE)
    ):
        resource = {
            "run-w7-desktop-suite": "runtime:secure-content-w7",
            "run-w8-suite": "runtime:secure-content-w8",
            "run-social-desktop-acceptance-suite": (
                "runtime:social-private-desktop"
            ),
            "run-social-cross-station-suite": (
                "runtime:social-cross-station"
            ),
            "run-w2-suite": "runtime:secure-content-w2",
            "run-w10-suite": "runtime:secure-content-w10",
            "run-w11-suite": "runtime:secure-content-w11",
            "run-final-suite": "runtime:secure-content-w12",
        }[args.action]
        blocked = RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            (
                f"{args.action} requires exactly "
                "--profiles four,fiveArm"
            ),
            resource=resource,
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    if args.action == "run-w9-suite" and args.profiles is not None:
        blocked = RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "W9 Suite Runtime requires exactly --profile four",
            resource="runtime:secure-content-w9",
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    repo_root = Path(__file__).resolve().parents[3]
    result_root = args.result_root or (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / hashlib.sha256(str(repo_root).encode("utf-8")).hexdigest()[:16]
        / "development"
        / "secure-content"
    )
    owner = W7RuntimeOwner(
        repo_root=repo_root,
        result_root=result_root,
        runtime_root=args.runtime_root,
    )
    try:
        if args.action == "preflight":
            result = owner.preflight()
        elif args.action == "run-w7-desktop-suite":
            result = owner.run_w7_desktop_suite()
        elif args.action == "run-w8-suite":
            result = owner.run_w8_suite()
        elif args.action == "run-social-desktop-acceptance-suite":
            result = owner.run_social_desktop_acceptance_suite(slot=args.slot)
        elif args.action == "run-social-cross-station-suite":
            result = owner.run_social_cross_station_suite(slot=args.slot)
        elif args.action == "run-w9-suite":
            result = owner.run_w9_suite()
        elif args.action == "run-w2-suite":
            result = owner.run_w2_suite()
        elif args.action == "run-w10-suite":
            result = owner.run_w10_suite()
        elif args.action == "run-w11-suite":
            result = owner.run_w11_suite()
        elif args.action == "run-final-suite":
            result = owner.run_final_suite()
        else:
            raise RuntimeOwnerBlocked(
                "RUNTIME_ACTION_UNSUPPORTED",
                f"unsupported runtime owner action: {args.action}",
                resource=f"runtime:{args.action}",
            )
    except RuntimeOwnerBlocked as error:
        print(json.dumps(error.payload(), sort_keys=True), file=sys.stderr)
        return 2
    except (
        BlockedError,
        RunnerError,
        OSError,
        subprocess.SubprocessError,
        ValueError,
    ) as error:
        blocked = RuntimeOwnerBlocked(
            "RUNTIME_OWNER_FAILED",
            _error_message_with_cleanup(error),
            resource=f"runtime:{args.action}",
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
