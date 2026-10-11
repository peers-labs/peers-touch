#!/usr/bin/env python3
"""Prove real Native Chat through the standard libp2p Circuit route."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_file_picker import select_native_file
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import (
    REQUIRED_STEPS,
    load_report,
    require,
    validate_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    REQUIRED_ASSERTIONS,
    NativeTwoClientGate,
    message_snapshot,
    send_text,
)
from tooling.acceptance.gates.station_access.relay_native_support import (
    is_relay_transport,
    station_registry_snapshot,
)


GATE_ID = "NCP-G03"
ENVIRONMENT_ID = "station-access-relay-role"
RUNTIME_CELL_ID = "desktop-macos-native"
JOURNEY_ID = "native-circuit-chat"
ATTACHMENT_BYTES = 32 * 1024 * 1024
ATTACHMENT_CHUNK = (
    b"peers-touch-node-connectivity-circuit-attachment-v1\n"
) * 2048
NCP_ASSERTIONS = {
    "native_actor_identity_state_persistent",
    "native_clients_use_circuit_route",
    "native_text_read",
    "native_attachment_receiver_visible",
    "native_attachment_byte_exact",
}
NCP_REQUIRED_ASSERTIONS = REQUIRED_ASSERTIONS | NCP_ASSERTIONS
NCP_REQUIRED_STEPS = (
    REQUIRED_STEPS
    - {"fixture.reset"}
    | {
        "fixture.existing",
        "route.circuit",
        "receipt.read",
        "attachment.upload",
        "attachment.received",
        "attachment.opened",
        "attachment.digest",
    }
)


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{label} must be an object")
    return dict(value)


def _write_attachment(path: Path) -> str:
    digest = hashlib.sha256()
    remaining = ATTACHMENT_BYTES
    with path.open("wb") as output:
        while remaining:
            chunk = ATTACHMENT_CHUNK[:remaining]
            output.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
    if path.stat().st_size != ATTACHMENT_BYTES:
        raise GateError("32 MiB attachment fixture has the wrong size")
    return digest.hexdigest()


class NodeConnectivityNativeGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "NCP-03"
    bom = ("NCP-NS02", "NCP-NS04")
    spec = ("NCP-G03", "node-connectivity-standard-stream")

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "NCP-G03 requires the station-access-relay-role environment"
            )
        if runtime_binding.cell_id != RUNTIME_CELL_ID:
            raise GateError(
                f"NCP-G03 requires {RUNTIME_CELL_ID}, got "
                f"{runtime_binding.cell_id}"
            )
        services = _mapping(manifest.get("services"), "runtime services")
        station = _mapping(services.get("station"), "direct Station service")
        self.services = services
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=GATE_ID,
            allow_existing_fixture=True,
            journey_id=JOURNEY_ID,
            station_identity_url=str(station.get("endpoint") or ""),
        )

    def _active_conversation_id(self) -> str:
        identities = {
            str(
                client.find_element(
                    "[data-chat-conversation-pane]",
                    30,
                ).get_attribute("data-chat-conversation-pane")
                or ""
            )
            for client in self.clients.values()
        }
        if len(identities) != 1 or not next(iter(identities), ""):
            raise GateError(
                "Native Circuit clients do not share one active conversation"
            )
        return identities.pop()

    def _prove_persistent_identity_state(self) -> dict[str, Any]:
        evidence = {
            actor: {
                "storageRoot": str(
                    self.client_specs[actor].get("storage_root") or ""
                ),
                "storageLifecycle": str(
                    self.client_specs[actor].get("storage_lifecycle") or ""
                ),
                "devicePolicy": str(
                    self.actor_specs[actor].get("devicePolicy") or ""
                ),
            }
            for actor in ("alice", "bob")
        }
        roots = [
            Path(item["storageRoot"]) for item in evidence.values()
        ]
        self.assert_condition(
            "native_actor_identity_state_persistent",
            len(set(roots)) == 2
            and all(
                item["storageLifecycle"] == "persistent"
                and item["devicePolicy"] == "persistent-acceptance"
                and root.is_dir()
                and not root.is_symlink()
                for item, root in zip(evidence.values(), roots)
            ),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def _prove_circuit_routes(self) -> dict[str, Any]:
        station = _mapping(self.services.get("station"), "Station service")
        relay = _mapping(self.services.get("relay"), "Relay service")
        expected_station_peer_id = str(
            station.get("runtimeIdentity") or ""
        )
        relay_locator = str(relay.get("endpoint") or "")
        routes = {
            actor: station_registry_snapshot(client)
            for actor, client in self.clients.items()
        }
        valid = bool(expected_station_peer_id and relay_locator) and all(
            snapshot.get("stationPeerId") == expected_station_peer_id
            and (snapshot.get("route") or {}).get("route_type") == "relay"
            and (snapshot.get("route") or {}).get("health") == "available"
            and is_relay_transport(
                relay_locator,
                (snapshot.get("route") or {}).get("endpoint_origin"),
            )
            for snapshot in routes.values()
        )
        self.assert_condition(
            "native_clients_use_circuit_route",
            valid,
            json.dumps(routes, sort_keys=True),
        )
        return routes

    def _prove_read_receipt(self) -> dict[str, Any]:
        text = f"ncp-circuit-read-{time.time_ns()}"
        sent = send_text(self.clients["alice"], text)
        message_id = str(sent.get("messageUlid") or "")
        received = wait_until(
            lambda: message_snapshot(self.clients["bob"], text),
            "Bob receiver-visible Circuit plaintext",
            timeout=120,
        )
        read = wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := message_snapshot(
                        self.clients["alice"],
                        text,
                    )
                )
                and snapshot.get("receipt") == "read"
                else None
            ),
            "Alice sender-visible READ receipt through Circuit",
            timeout=120,
        )
        evidence = {
            "messageId": message_id,
            "sender": read,
            "receiver": received,
        }
        self.assert_condition(
            "native_text_read",
            bool(message_id)
            and received.get("messageUlid") == message_id
            and read.get("messageUlid") == message_id
            and read.get("receipt") == "read",
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    @staticmethod
    def _composer_outcome(
        client: TauriSession,
        conversation_id: str,
        after_revision: int,
    ) -> dict[str, Any] | None:
        composer = client.find_element(
            f'[data-chat-composer="{conversation_id}"]',
            5,
        )
        revision = int(
            composer.get_attribute("data-chat-send-outcome-revision") or 0
        )
        if revision <= after_revision:
            return None
        return {
            "revision": revision,
            "state": composer.get_attribute(
                "data-chat-send-outcome-state"
            )
            or "",
            "messageId": composer.get_attribute(
                "data-chat-send-outcome-message-id"
            )
            or "",
            "attachmentIds": [
                item
                for item in (
                    composer.get_attribute(
                        "data-chat-send-outcome-attachment-ids"
                    )
                    or ""
                ).split(",")
                if item
            ],
        }

    @staticmethod
    def _attachment_snapshot(
        client: TauriSession,
        message_id: str,
        attachment_id: str,
    ) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            const messageId = arguments[0];
            const attachmentId = arguments[1];
            const row = document.querySelector(
              `[data-message-ulid="${CSS.escape(messageId)}"]`
            );
            const attachment = row?.querySelector(
              `[data-messaging-attachment-id="${CSS.escape(attachmentId)}"]`
            );
            if (!row || !attachment) return null;
            const rect = attachment.getBoundingClientRect();
            return {
              messageId: row.getAttribute('data-message-ulid') || '',
              attachmentId:
                attachment.getAttribute('data-messaging-attachment-id') || '',
              kind:
                attachment.getAttribute('data-messaging-attachment-kind') || '',
              state:
                attachment.getAttribute('data-messaging-attachment-state') || '',
              openState:
                attachment.getAttribute(
                  'data-messaging-attachment-open-state'
                ) || '',
              visible: rect.width > 0 && rect.height > 0,
            };
            """,
            message_id,
            attachment_id,
        )
        return value if isinstance(value, dict) else None

    def _open_attachment(
        self,
        actor: str,
        attachment_id: str,
    ) -> Path:
        value = async_harness(
            self.clients[actor],
            "openAttachment",
            {
                "actorPtid": self.ptids[actor],
                "attachmentId": attachment_id,
            },
            timeout=60,
        )
        local_path = (
            str(value.get("localPath") or "")
            if isinstance(value, dict)
            else ""
        )
        if not local_path:
            raise GateError("Native attachment readback returned no local path")
        return Path(local_path)

    def _prove_attachment(self) -> dict[str, Any]:
        conversation_id = self._active_conversation_id()
        sender = self.clients["alice"]
        receiver = self.clients["bob"]
        with tempfile.TemporaryDirectory(
            prefix="pt-ncp-circuit-attachment-"
        ) as raw:
            source_path = Path(raw) / "ncp-circuit-32m.bin"
            source_sha256 = _write_attachment(source_path)
            composer = sender.find_element(
                f'[data-chat-composer="{conversation_id}"]',
                30,
            )
            previous_revision = int(
                composer.get_attribute(
                    "data-chat-send-outcome-revision"
                )
                or 0
            )
            trigger = sender.find_element(
                "[data-chat-attachment-picker]",
                30,
            )
            if not trigger.is_displayed() or not trigger.is_enabled():
                raise GateError(
                    "Alice Native attachment picker is not actionable"
                )
            selection = self.step(
                "attachment.upload",
                lambda: select_native_file(
                    actor="alice",
                    client=sender,
                    sessions=tuple(self.clients.values()),
                    runtime_binding=self.runtime_binding,
                    source_path=source_path,
                    trigger=trigger.click,
                ),
                "alice",
            )
            wait_until(
                lambda: (
                    drafts
                    if len(
                        drafts := sender.find_elements(
                            '[data-chat-attachment-draft]'
                            '[data-chat-attachment-status="ready"]'
                        )
                    )
                    == 1
                    else None
                ),
                "Alice 32 MiB attachment draft",
                timeout=120,
            )
            sender.find_element("[data-chat-send]", 30).click()
            outcome = wait_until(
                lambda: self._composer_outcome(
                    sender,
                    conversation_id,
                    previous_revision,
                ),
                "Alice Circuit attachment send outcome",
                timeout=180,
            )
            if (
                outcome.get("state") != "pending"
                or not outcome.get("messageId")
                or len(outcome.get("attachmentIds") or []) != 1
            ):
                raise GateError(
                    "Circuit attachment send outcome is incomplete: "
                    f"{json.dumps(outcome, sort_keys=True)}"
                )
            message_id = str(outcome["messageId"])
            attachment_id = str(outcome["attachmentIds"][0])
            receiver_snapshot = self.step(
                "attachment.received",
                lambda: wait_until(
                    lambda: (
                        snapshot
                        if (
                            snapshot := self._attachment_snapshot(
                                receiver,
                                message_id,
                                attachment_id,
                            )
                        )
                        and snapshot.get("visible") is True
                        else None
                    ),
                    "Bob receiver-visible 32 MiB attachment",
                    timeout=180,
                ),
                "bob",
            )
            attachment_element = receiver.find_element(
                f'[data-message-ulid="{message_id}"] '
                f'[data-messaging-attachment-id="{attachment_id}"]',
                30,
            )
            self.step(
                "attachment.opened",
                attachment_element.click,
                "bob",
            )
            opened_snapshot = wait_until(
                lambda: (
                    snapshot
                    if (
                        snapshot := self._attachment_snapshot(
                            receiver,
                            message_id,
                            attachment_id,
                        )
                    )
                    and snapshot.get("openState") == "ready"
                    else None
                ),
                "Bob opened Circuit attachment",
                timeout=120,
            )
            local_path = self._open_attachment("bob", attachment_id)
            receiver_sha256 = self.step(
                "attachment.digest",
                lambda: self.runtime_binding.native_file_sha256(
                    "bob",
                    local_path,
                ),
                "bob",
            )
            evidence = {
                "conversationId": conversation_id,
                "messageId": message_id,
                "attachmentId": attachment_id,
                "byteLength": ATTACHMENT_BYTES,
                "selection": selection,
                "sendOutcome": outcome,
                "receiverSnapshot": receiver_snapshot,
                "openedSnapshot": opened_snapshot,
                "sourceSha256": source_sha256,
                "receiverSha256": receiver_sha256,
            }
            self.assert_condition(
                "native_attachment_receiver_visible",
                receiver_snapshot.get("visible") is True
                and opened_snapshot.get("openState") == "ready",
                json.dumps(evidence, sort_keys=True),
            )
            self.assert_condition(
                "native_attachment_byte_exact",
                selection.get("size") == ATTACHMENT_BYTES
                and receiver_sha256 == source_sha256,
                json.dumps(evidence, sort_keys=True),
            )
            return evidence

    def prove_additional_journey_assertions(self) -> None:
        identity_state = self._prove_persistent_identity_state()
        routes = self.step("route.circuit", self._prove_circuit_routes)
        read = self.step("receipt.read", self._prove_read_receipt)
        attachment = self._prove_attachment()
        self.report.runtime["nodeConnectivity"] = {
            "identityState": identity_state,
            "routes": routes,
            "read": read,
            "attachment": attachment,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {
            assertion.name for assertion in self.report.assertions
        }
        missing = NCP_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"NCP-G03 assertions are missing: {sorted(missing)}"
            )
        return result


def validate_ncp_report(report: dict[str, Any]) -> None:
    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    evidence = runtime.get("nodeConnectivity")
    require(
        isinstance(evidence, dict),
        "node-connectivity evidence is required",
    )
    routes = evidence.get("routes")
    identity_state = evidence.get("identityState")
    read = evidence.get("read")
    attachment = evidence.get("attachment")
    manifest = report.get("manifest")
    services = (
        manifest.get("services")
        if isinstance(manifest, dict)
        and isinstance(manifest.get("services"), dict)
        else {}
    )
    station = (
        services.get("station")
        if isinstance(services.get("station"), dict)
        else {}
    )
    relay = (
        services.get("relay")
        if isinstance(services.get("relay"), dict)
        else {}
    )
    expected_station_peer_id = str(
        station.get("runtimeIdentity") or ""
    )
    relay_locator = str(relay.get("endpoint") or "")
    require(
        isinstance(identity_state, dict)
        and set(identity_state) == {"alice", "bob"}
        and len(
            {
                str(item.get("storageRoot") or "")
                for item in identity_state.values()
                if isinstance(item, dict)
            }
        )
        == 2
        and all(
            isinstance(item, dict)
            and item.get("storageLifecycle") == "persistent"
            and item.get("devicePolicy") == "persistent-acceptance"
            and bool(item.get("storageRoot"))
            for item in identity_state.values()
        ),
        "Native Actor identity storage must be persistent and isolated",
    )
    require(
        isinstance(routes, dict) and set(routes) == {"alice", "bob"},
        "both Native clients require Circuit route evidence",
    )
    require(
        all(
            isinstance(snapshot, dict)
            and snapshot.get("stationPeerId")
            == expected_station_peer_id
            and (snapshot.get("route") or {}).get("route_type") == "relay"
            and (snapshot.get("route") or {}).get("health") == "available"
            and is_relay_transport(
                relay_locator,
                (snapshot.get("route") or {}).get("endpoint_origin"),
            )
            for snapshot in routes.values()
        )
        and bool(expected_station_peer_id)
        and bool(relay_locator),
        "both Native clients must use Relay routes",
    )
    require(
        isinstance(read, dict)
        and (read.get("sender") or {}).get("receipt") == "read"
        and (read.get("sender") or {}).get("messageUlid")
        == (read.get("receiver") or {}).get("messageUlid"),
        "Native text must reach sender-visible READ",
    )
    require(
        isinstance(attachment, dict)
        and attachment.get("byteLength") == ATTACHMENT_BYTES
        and (attachment.get("receiverSnapshot") or {}).get("visible") is True
        and (attachment.get("openedSnapshot") or {}).get("openState")
        == "ready"
        and re.fullmatch(
            r"[0-9a-f]{64}",
            str(attachment.get("sourceSha256") or ""),
        )
        is not None
        and attachment.get("sourceSha256")
        == attachment.get("receiverSha256"),
        "32 MiB receiver-opened attachment evidence is incomplete",
    )


def write_ncp_validation(
    report: dict[str, Any],
    source_ref: ArtifactRef,
) -> ArtifactRef:
    output = {
        "artifactKind": "node-connectivity-native-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "NCP-03",
        "bom": ["NCP-NS02", "NCP-NS04"],
        "spec": ["NCP-G03", "node-connectivity-standard-stream"],
        "gate": GATE_ID,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(NCP_REQUIRED_ASSERTIONS),
    }
    return ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=GATE_ID,
    ).write_json(
        f"reports/{GATE_ID}-validation.json",
        output,
        role="validation",
    )


def validate_current_report() -> None:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store, GATE_ID)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
        gate_id=GATE_ID,
        required_steps=NCP_REQUIRED_STEPS,
        required_assertions=NCP_REQUIRED_ASSERTIONS,
        expected_journey=JOURNEY_ID,
    )
    validate_ncp_report(report)
    write_ncp_validation(report, source_ref)


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = NodeConnectivityNativeGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    result = gate.execute()
    if result != 0:
        return result
    validate_current_report()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"NCP-G03 validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
