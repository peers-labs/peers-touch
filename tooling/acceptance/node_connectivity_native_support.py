from __future__ import annotations

import hashlib
import json
import select
import socket
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_file_picker import select_native_file
from tooling.acceptance.gates.chat.native_support import async_harness, wait_until
from tooling.acceptance.gates.chat.native_two_client_runner import (
    message_snapshot,
    send_text,
)


ATTACHMENT_BYTES = 32 * 1024 * 1024
ATTACHMENT_CHUNK = (
    b"peers-touch-node-connectivity-circuit-attachment-v1\n"
) * 2048
ROUTE_PROBE_PATH = "/app-meta/version"


class _DirectRouteFaultState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._armed = False
        self._failure_count = 0
        self._forwarded_connections = 0

    def arm(self) -> None:
        with self._lock:
            self._armed = True

    def disarm(self) -> None:
        with self._lock:
            self._armed = False

    def record_active_drop(self) -> None:
        with self._lock:
            self._failure_count += 1

    def should_drop_connection(self) -> bool:
        with self._lock:
            if self._armed:
                self._failure_count += 1
                return True
            self._forwarded_connections += 1
            return False

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "armed": self._armed,
                "failureCount": self._failure_count,
                "forwardedConnections": self._forwarded_connections,
            }


def _parse_direct_multiaddr(value: str) -> tuple[str, int, str]:
    parts = value.strip().split("/")
    if (
        len(parts) != 7
        or parts[0] != ""
        or parts[1] not in {"ip4", "ip6", "dns4", "dns6"}
        or parts[3] != "tcp"
        or parts[5] != "p2p"
        or not parts[2]
        or not parts[6]
    ):
        raise ValueError(
            "Node Connectivity Direct fault proxy requires one TCP Direct multiaddr"
        )
    try:
        port = int(parts[4])
    except ValueError as error:
        raise ValueError("Direct multiaddr TCP port is invalid") from error
    if port < 1 or port > 65535:
        raise ValueError("Direct multiaddr TCP port is invalid")
    return parts[2], port, parts[6]


class DirectRouteFaultProxy:
    """Opaque TCP route used to prove real Direct connection loss."""

    def __init__(self, upstream_multiaddr: str) -> None:
        host, port, peer_id = _parse_direct_multiaddr(upstream_multiaddr)
        self._upstream = (host, port)
        self._peer_id = peer_id
        self._state = _DirectRouteFaultState()
        self._listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._listener.bind(("127.0.0.1", 0))
        self._listener.listen()
        self._listener.settimeout(0.2)
        self._stop = threading.Event()
        self._connections_lock = threading.Lock()
        self._connections: set[socket.socket] = set()
        self._thread = threading.Thread(
            target=self._serve,
            name="ncp-direct-route-fault-proxy",
            daemon=True,
        )

    @property
    def port(self) -> int:
        return int(self._listener.getsockname()[1])

    @property
    def multiaddr(self) -> str:
        return f"/ip4/127.0.0.1/tcp/{self.port}/p2p/{self._peer_id}"

    def start(self) -> None:
        self._thread.start()

    def arm(self) -> None:
        self._state.arm()
        with self._connections_lock:
            connections = list(self._connections)
        if connections:
            self._state.record_active_drop()
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()

    def disarm(self) -> None:
        self._state.disarm()

    def evidence(self) -> dict[str, Any]:
        return self._state.snapshot()

    def stop(self) -> None:
        self._stop.set()
        self._listener.close()
        with self._connections_lock:
            connections = list(self._connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        self._thread.join(timeout=5)

    def _serve(self) -> None:
        while not self._stop.is_set():
            try:
                client, _ = self._listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            if self._state.should_drop_connection():
                client.close()
                continue
            worker = threading.Thread(
                target=self._forward,
                args=(client,),
                name="ncp-direct-route-forwarder",
                daemon=True,
            )
            worker.start()

    def _forward(self, client: socket.socket) -> None:
        upstream: socket.socket | None = None
        try:
            upstream = socket.create_connection(self._upstream, timeout=10)
            client.settimeout(None)
            upstream.settimeout(None)
            with self._connections_lock:
                self._connections.update((client, upstream))
            peers = {client: upstream, upstream: client}
            while not self._stop.is_set():
                readable, _, _ = select.select(list(peers), [], [], 0.2)
                for source in readable:
                    payload = source.recv(64 * 1024)
                    if not payload:
                        return
                    peers[source].sendall(payload)
        except (OSError, ValueError):
            return
        finally:
            sockets = [client]
            if upstream is not None:
                sockets.append(upstream)
            with self._connections_lock:
                for connection in sockets:
                    self._connections.discard(connection)
            for connection in sockets:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()


def invoke_tauri_result(
    client: TauriSession,
    command: str,
    arguments: dict[str, Any] | None = None,
    *,
    timeout: float = 30,
) -> dict[str, Any]:
    request_id = f"ncp-native-invoke-{time.monotonic_ns()}"
    client.execute_script(
        """
        const [command, commandArguments, requestId] = arguments;
        const requests = window.__PT_NCP_NATIVE_INVOKE_REQUESTS__ ||= {};
        requests[requestId] = { done: false };
        window.__TAURI_INTERNALS__.invoke(command, commandArguments)
          .then((result) => {
            requests[requestId] = { done: true, result };
          })
          .catch((error) => {
            requests[requestId] = {
              done: true,
              result: {
                ok: false,
                error: { message: String(error) },
              },
            };
          });
        """,
        command,
        arguments or {},
        request_id,
    )
    deadline = time.monotonic() + timeout
    result: object = None
    try:
        while time.monotonic() < deadline:
            result = client.execute_script(
                """
                const request = window.__PT_NCP_NATIVE_INVOKE_REQUESTS__
                  ?.[arguments[0]];
                return request?.done ? request.result : null;
                """,
                request_id,
            )
            if result is not None:
                break
            time.sleep(0.01)
    finally:
        client.execute_script(
            """
            if (window.__PT_NCP_NATIVE_INVOKE_REQUESTS__) {
              delete window.__PT_NCP_NATIVE_INVOKE_REQUESTS__[arguments[0]];
            }
            """,
            request_id,
        )
    if not isinstance(result, dict):
        raise GateError(f"{command} returned no AppResult")
    return result


def app_result_status(
    result: dict[str, Any],
    command: str,
) -> dict[str, Any]:
    if result.get("ok") is not True:
        raise GateError(f"{command} failed: {json.dumps(result, sort_keys=True)}")
    data = result.get("data")
    status = data.get("status") if isinstance(data, dict) else None
    try:
        value = json.loads(status) if isinstance(status, str) else None
    except json.JSONDecodeError as error:
        raise GateError(f"{command} returned invalid status JSON") from error
    if not isinstance(value, dict):
        raise GateError(f"{command} returned no status object")
    return value


def app_result_error_code(result: dict[str, Any]) -> str:
    error = result.get("error")
    details = error.get("details") if isinstance(error, dict) else None
    return (
        str(details.get("code") or "")
        if isinstance(details, dict)
        else ""
    )


def route_probe(
    client: TauriSession,
    policy: str,
) -> dict[str, Any]:
    result = invoke_tauri_result(
        client,
        "acceptance_station_route_probe",
        {"input": {"route_policy": policy}},
    )
    if result.get("ok") is True:
        return {
            "ok": True,
            **app_result_status(result, "acceptance_station_route_probe"),
        }
    return {
        "ok": False,
        "code": app_result_error_code(result),
    }


def transport_diagnostics(client: TauriSession) -> dict[str, Any]:
    return app_result_status(
        invoke_tauri_result(
            client,
            "acceptance_station_transport_diagnostics",
        ),
        "acceptance_station_transport_diagnostics",
    )


def session_identity(client: TauriSession) -> dict[str, Any]:
    return app_result_status(
        invoke_tauri_result(
            client,
            "acceptance_window_session_identity",
        ),
        "acceptance_window_session_identity",
    )


def add_station_candidate(client: TauriSession, station_url: str) -> None:
    app_result_status(
        invoke_tauri_result(
            client,
            "station_add",
            {"input": {"input": station_url}},
        ),
        "station_add",
    )


def profile_snapshot(
    client: TauriSession,
    *,
    actor_ptid: str | None = None,
) -> dict[str, Any]:
    command = "peer_profile_get" if actor_ptid else "profile_get"
    arguments = (
        {"input": {"actor_ptid": actor_ptid}}
        if actor_ptid
        else None
    )
    return app_result_status(
        invoke_tauri_result(client, command, arguments),
        command,
    )


def update_profile_note(
    client: TauriSession,
    note: str,
    observed_revision: int,
) -> dict[str, Any]:
    result = app_result_status(
        invoke_tauri_result(
            client,
            "profile_update",
            {
                "input": {
                    "note": note,
                    "observed_revision": observed_revision,
                }
            },
        ),
        "profile_update",
    )
    profile = result.get("profile")
    if not isinstance(profile, dict):
        raise GateError("profile_update returned no canonical profile")
    return profile


def prove_profile_mutation_readback(
    *,
    sender: TauriSession,
    receiver: TauriSession,
    sender_ptid: str,
    marker: str,
) -> dict[str, Any]:
    before = profile_snapshot(sender)
    before_revision = int(before.get("profile_revision") or 0)
    if before_revision <= 0:
        raise GateError("canonical profile has no positive revision")
    original_note = str(before.get("note") or "")
    mutated: dict[str, Any] | None = None
    receiver_snapshot: dict[str, Any] | None = None
    restored = False
    try:
        mutated = update_profile_note(
            sender,
            marker,
            before_revision,
        )
        receiver_snapshot = wait_until(
            lambda: (
                profile
                if (
                    (profile := profile_snapshot(
                        receiver,
                        actor_ptid=sender_ptid,
                    )).get("note")
                    == marker
                )
                else None
            ),
            "receiver-visible canonical Profile mutation",
            timeout=30,
        )
    finally:
        current = profile_snapshot(sender)
        if current.get("note") == marker:
            restore_revision = int(current.get("profile_revision") or 0)
            restored_profile = update_profile_note(
                sender,
                original_note,
                restore_revision,
            )
            restored = (
                restored_profile.get("note") == original_note
                and int(restored_profile.get("profile_revision") or 0)
                > restore_revision
            )
        else:
            restored = current.get("note") == original_note
    readback_matches = bool(
        mutated
        and receiver_snapshot
        and mutated.get("note") == marker
        and receiver_snapshot.get("note") == marker
        and receiver_snapshot.get("profile_revision")
        == mutated.get("profile_revision")
    )
    if not readback_matches or not restored:
        raise GateError("canonical Profile mutation/readback did not close")
    return {
        "field": "note",
        "revisionBefore": before_revision,
        "revisionAfter": int(mutated.get("profile_revision") or 0),
        "receiverVisible": True,
        "readbackMatches": True,
        "restored": True,
    }


def write_attachment(path: Path) -> str:
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


class NodeConnectivityNativeJourneyMixin:
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
                "Native clients do not share one active conversation"
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
                "endpoint": async_harness(
                    self.clients[actor],
                    "getRealtimeDevice",
                    {},
                ),
                "profile": profile_snapshot(self.clients[actor]),
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
        self.assert_condition(
            "native_device_enrollment_profile_revision",
            all(
                item["endpoint"].get("active") is True
                and int(item["endpoint"].get("profileRevision") or 0)
                == int(item["profile"].get("profile_revision") or 0)
                > 0
                for item in evidence.values()
            ),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def _prove_read_receipt(self) -> dict[str, Any]:
        text = f"ncp-native-read-{time.time_ns()}"
        sent = send_text(self.clients["alice"], text)
        message_id = str(sent.get("messageUlid") or "")
        received = wait_until(
            lambda: message_snapshot(self.clients["bob"], text),
            "Bob receiver-visible Native plaintext",
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
            "Alice sender-visible READ receipt",
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
        from tooling.acceptance.gates.chat.native_support import async_harness

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
            prefix="pt-ncp-native-attachment-"
        ) as raw:
            source_path = Path(raw) / "ncp-native-32m.bin"
            source_sha256 = write_attachment(source_path)
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
                "Alice Native attachment send outcome",
                timeout=180,
            )
            if (
                outcome.get("state") != "pending"
                or not outcome.get("messageId")
                or len(outcome.get("attachmentIds") or []) != 1
            ):
                raise GateError(
                    "Native attachment send outcome is incomplete: "
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
                "Bob opened Native attachment",
                timeout=180,
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
