from __future__ import annotations

import concurrent.futures
import json
import shutil
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    GateError,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    call_async_harness,
)
from tooling.acceptance.drivers.native.runtime import (
    NativeDesktopRuntimeBinding,
    NativeLaunchOptions,
)
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    cleanup_preserving_primary_failure,
    enter_chat_page,
    native_runtime_source_identity,
    read_station_version,
    runtime_station_service,
    selected_native_runtime,
    wait_until,
)


GATE_ID = "chat-message-publishing-native-e2e"
SCENARIO_IDS = (
    "grant-lifecycle",
    "program-and-bot-publish",
    "idempotency-and-replay",
    "content-and-security",
    "native-render-and-notification",
    "semantic-aggregation",
    "restart-partial-history-and-locate",
    "human-chat-regression",
)
RUNTIME_CONTRACT = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "message-publishing-native-functional",
        "scenarioIds": list(SCENARIO_IDS),
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 2,
        "minWarmReuseRate": 0.85,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)


def _field(value: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in value:
            return value[name]
    return None


def _mapping(value: object, description: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateError(f"{description} must be an object")
    return value


def _unwrap_data(value: object) -> dict[str, Any]:
    root = _mapping(value, "Station response")
    data = root.get("data")
    return _mapping(data, "Station response data") if isinstance(data, dict) else root


class MessagePublishingNativeGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MPUB-03"
    bom = ("MPUB-01-CONTRACT", "MPUB-02-LIFECYCLE", "MPUB-03-NATIVE")
    spec = ("MP-D04", "MP-D05", "MP-D10", "MP-D12")

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        super().__init__()
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        self.report.manifest = manifest
        station = runtime_station_service(manifest, "alice")
        self.station_url = str(station.get("endpoint") or "").rstrip("/")
        self.report.station_url = self.station_url
        if not self.station_url:
            raise GateError("Message Publishing runtime has no Station URL")
        self.client_spec = next(
            (
                client
                for client in manifest.get("clients", [])
                if isinstance(client, dict) and client.get("id") == "alice"
            ),
            None,
        )
        self.actor_spec = next(
            (
                actor
                for actor in actor_manifest.get("actors", [])
                if isinstance(actor, dict) and actor.get("role") == "alice"
            ),
            None,
        )
        if not isinstance(self.client_spec, dict):
            raise GateError("Message Publishing requires exactly one Alice client")
        if not isinstance(self.actor_spec, dict):
            raise GateError("Message Publishing requires the reviewed Alice actor")
        if len(manifest.get("clients", [])) != 1:
            raise GateError("Message Publishing must not allocate a second client")

        source = _mapping(manifest.get("source"), "runtime source")
        source_digest = str(source.get("commit") or "")
        fixture_epoch = str(
            actor_manifest.get("createdAt")
            or actor_manifest.get("runId")
            or manifest.get("runId")
            or ""
        )
        self.suite = SuiteRuntimeLedger(
            RUNTIME_CONTRACT,
            suite_runtime_id=f"message-publishing:{manifest.get('runId')}",
            source_digest=source_digest,
            fixture_epoch=fixture_epoch,
        )
        self.clients: list[TauriSession] = []
        self.client: TauriSession | None = None
        self.lifecycles = NativeClientLifecycleLedger()
        self.owner_ptid = str(self.actor_spec.get("ptid") or "")
        self.owner_token = ""
        self.grant: dict[str, Any] = {}
        self.secret = ""
        self.bot: dict[str, Any] = {}
        self.attachment: dict[str, Any] = {}
        self.original_chat_preference: dict[str, Any] | None = None
        self.retained_fixtures: list[dict[str, str]] = []
        self.scenario_evidence: dict[str, Any] = {}
        self.runtime_launches: list[dict[str, Any]] = []
        self.fixture_root = Path(
            tempfile.mkdtemp(prefix="pt-message-publishing-")
        )

    def execute(self) -> int:
        try:
            return super().execute()
        finally:
            shutil.rmtree(self.fixture_root, ignore_errors=True)

    def harness(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        *,
        namespace: str = "messagePublishing",
        timeout: float = 45,
    ) -> Any:
        if self.client is None:
            raise GateError("Native client is not available")
        return call_async_harness(
            self.client,
            method,
            payload or {},
            namespace=namespace,
            script_timeout=timeout,
        )

    def write_json_evidence(self, key: str, value: Any) -> None:
        path = self.fixture_root / f"{key}.json"
        path.write_text(
            json.dumps(
                value,
                indent=2,
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            + "\n",
            encoding="utf-8",
        )
        self.report.add_evidence_file(key, path)

    def _launch_client(self) -> TauriSession:
        client = self.runtime_binding.create_bound_session(
            "alice",
            NativeLaunchOptions(window_slot=0, window_count=1),
        )
        self.clients.append(client)
        self.register_driver(client)
        self.lifecycles.register(client, self.owner_ptid)
        attempt = {
            "sequence": len(self.runtime_launches) + 1,
            "client": "alice",
            "profile": client.profile,
            "webdriverPort": client.port,
            "gatewayPort": client.gateway_port,
            "storageRoot": client.storage_root,
            "restoreSession": False,
            "state": "starting",
        }
        self.runtime_launches.append(attempt)
        try:
            self.lifecycles.mark_live(client)
            account_ref = str(self.actor_spec.get("accountRef") or "")
            account = account_ref.removeprefix("station-account:")
            login = call_async_harness(
                client,
                "loginWithPassword",
                {
                    "account": account,
                    "password": DEV_ACCOUNT_PASSWORD,
                },
                namespace="chat",
                script_timeout=90,
            )
            if (
                not isinstance(login, dict)
                or login.get("authenticated") is not True
                or login.get("actorPtid") != self.owner_ptid
            ):
                raise GateError("Alice Native login identity is invalid")
            hydration = call_async_harness(
                client,
                "hydrateActiveActor",
                {},
                namespace="chat",
                script_timeout=30,
            )
            if (
                not isinstance(hydration, dict)
                or hydration.get("actorPtid") != self.owner_ptid
            ):
                raise GateError("Alice Native messaging identity did not hydrate")
            resumed = call_async_harness(
                client,
                "resumeMessagingLifecycle",
                {"actorPtid": self.owner_ptid},
                namespace="chat",
                script_timeout=30,
            )
            if (
                not isinstance(resumed, dict)
                or resumed.get("activated") is not True
            ):
                raise GateError("Alice Native messaging lifecycle did not resume")
            self.lifecycles.mark_authenticated(client)
            self.client = client

            def ready_device() -> dict[str, Any] | None:
                value = self.harness(
                    "getRealtimeDevice",
                    namespace="chat",
                    timeout=10,
                )
                if (
                    isinstance(value, dict)
                    and value.get("actorPtid") == self.owner_ptid
                    and value.get("deviceId")
                    and value.get("active") is True
                ):
                    return value
                return None

            device = wait_until(
                ready_device,
                "Alice Native messaging device",
                timeout=90,
            )
            attempt["deviceId"] = device["deviceId"]
            attempt["pid"] = client.process_id
            attempt["state"] = "ready"
            self.report.add_actor(
                ActorRuntime(
                    name=f"alice-{len(self.runtime_launches)}",
                    runtime=self.runtime_binding.cell_id,
                    port=client.port,
                    gateway_port=client.gateway_port,
                    profile=client.profile,
                    storage_root=client.storage_root,
                    pid=client.process_id,
                )
            )
            return client
        except Exception:
            attempt["state"] = "failed"
            self.lifecycles.release(client)
            raise

    def _relaunch_client(self) -> None:
        if self.client is None:
            raise GateError("Native client is unavailable")
        client = self.client
        storage_root = client.storage_root
        self.lifecycles.stop_preserving_session(client)
        attempt = {
            "sequence": len(self.runtime_launches) + 1,
            "client": "alice",
            "profile": client.profile,
            "webdriverPort": client.port,
            "gatewayPort": client.gateway_port,
            "storageRoot": storage_root,
            "restoreSession": True,
            "state": "starting",
        }
        self.runtime_launches.append(attempt)
        try:
            client.start()
            self.lifecycles.mark_live(client)
            self.lifecycles.mark_authenticated(client)

            def ready_device() -> dict[str, Any] | None:
                value = self.harness(
                    "getRealtimeDevice",
                    namespace="chat",
                    timeout=10,
                )
                if (
                    isinstance(value, dict)
                    and value.get("actorPtid") == self.owner_ptid
                    and value.get("deviceId")
                    and value.get("active") is True
                ):
                    return value
                return None

            device = wait_until(
                ready_device,
                "restarted Alice Native messaging device",
                timeout=90,
            )
            if client.storage_root != storage_root:
                raise GateError("Alice Native storage changed across relaunch")
            attempt["deviceId"] = device["deviceId"]
            attempt["pid"] = client.process_id
            attempt["state"] = "ready"
        except Exception:
            attempt["state"] = "failed"
            self.lifecycles.release(client)
            raise

    def _session_token(self) -> str:
        if self.client is None:
            raise GateError("Native client is unavailable")
        sessions = (
            Path(self.client.storage_root)
            / "peers-touch"
            / "desktop"
            / "data"
            / "auth"
            / "sessions"
        )

        def current_token() -> str | None:
            candidates: list[str] = []
            for path in sessions.glob("*.json"):
                try:
                    value = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if (
                    isinstance(value, dict)
                    and value.get("actor_ptid") == self.owner_ptid
                    and isinstance(value.get("token"), str)
                    and value["token"].strip()
                ):
                    candidates.append(value["token"].strip())
            return candidates[0] if len(candidates) == 1 else None

        return wait_until(
            current_token,
            "isolated Alice session token",
            timeout=30,
        )

    def _request(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        bearer: str,
        idempotency_key: str = "",
        expected_statuses: tuple[int, ...] = (200,),
        discard_response: bool = False,
    ) -> tuple[int, dict[str, Any] | str | None]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {bearer}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            f"{self.station_url}{path}",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        status = 0
        raw = b""
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = response.status
                if not discard_response:
                    raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            raise GateError(f"Station request {path} failed: {error}") from error
        if status not in expected_statuses:
            detail = raw.decode("utf-8", errors="replace")[:500]
            raise GateError(
                f"Station request {path} returned {status}: {detail}"
            )
        if discard_response or not raw:
            return status, None
        try:
            return status, json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return status, raw.decode("utf-8", errors="replace")

    def owner_request(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        expected_statuses: tuple[int, ...] = (200,),
    ) -> tuple[int, dict[str, Any] | str | None]:
        if not self.owner_token:
            raise GateError("Owner credential is unavailable")
        return self._request(
            path,
            payload,
            bearer=self.owner_token,
            expected_statuses=expected_statuses,
        )

    def publish(
        self,
        publishing_id: str,
        secret: str,
        request: dict[str, Any],
        *,
        expected_statuses: tuple[int, ...] = (200,),
        discard_response: bool = False,
    ) -> tuple[int, dict[str, Any] | str | None]:
        command_id = str(_field(request, "command_id", "commandId") or "")
        return self._request(
            f"/message-ingress/{publishing_id}",
            request,
            bearer=secret,
            idempotency_key=command_id,
            expected_statuses=expected_statuses,
            discard_response=discard_response,
        )

    def _publication_response(
        self,
        value: dict[str, Any] | str | None,
    ) -> dict[str, Any]:
        response = _unwrap_data(value)
        required = (
            ("command_id", "commandId"),
            ("message_id", "messageId"),
            ("conversation_id", "conversationId"),
            ("conversation_event_id", "conversationEventId"),
            ("event_sequence", "eventSequence"),
            ("outcome",),
        )
        if any(_field(response, *names) in (None, "") for names in required):
            raise GateError(f"Publication response is incomplete: {response}")
        return response

    def _record_fixture(
        self,
        response: dict[str, Any],
        namespace: str,
    ) -> None:
        self.retained_fixtures.append(
            {
                "namespace": namespace,
                "messageId": str(_field(response, "message_id", "messageId")),
                "conversationId": str(
                    _field(response, "conversation_id", "conversationId")
                ),
            }
        )

    def _park(self) -> None:
        result = self.harness("parkReceiver")
        if not isinstance(result, dict) or result.get("parked") is not True:
            raise GateError("Receiver did not park the active conversation")

    def _receiver_snapshot(
        self,
        response: dict[str, Any],
        *,
        expected_notifications: int,
        sender_ptid: str,
        source_namespace: str,
        timeout: float = 120,
    ) -> dict[str, Any]:
        conversation_id = str(
            _field(response, "conversation_id", "conversationId")
        )
        message_id = str(_field(response, "message_id", "messageId"))

        def ready() -> dict[str, Any] | None:
            snapshot = self.harness(
                "receiverSnapshot",
                {
                    "conversationId": conversation_id,
                    "messageId": message_id,
                },
                timeout=20,
            )
            if not isinstance(snapshot, dict):
                return None
            message = snapshot.get("message")
            service = (
                message.get("serviceMessage")
                if isinstance(message, dict)
                else None
            )
            if (
                snapshot.get("messageCount") == 1
                and snapshot.get("notificationCount")
                == expected_notifications
                and isinstance(message, dict)
                and message.get("id") == message_id
                and message.get("senderPtid") == sender_ptid
                and isinstance(service, dict)
                and service.get("messageId") == message_id
                and service.get("sourceNamespace") == source_namespace
            ):
                return snapshot
            return None

        return wait_until(
            ready,
            f"receiver projection for {message_id}",
            timeout=timeout,
        )

    def _open_visible_message(
        self,
        response: dict[str, Any],
        expected_text: str,
    ) -> dict[str, Any]:
        if self.client is None:
            raise GateError("Native client is unavailable")
        enter_chat_page(self.client)
        conversation_id = str(
            _field(response, "conversation_id", "conversationId")
        )
        message_id = str(_field(response, "message_id", "messageId"))
        self.harness(
            "openReceiverMessage",
            {
                "conversationId": conversation_id,
                "messageId": message_id,
            },
        )

        def visible() -> dict[str, Any] | None:
            value = self.client.driver.execute_script(
                """
                const id = arguments[0];
                const row = Array.from(
                  document.querySelectorAll('[data-message-ulid]')
                ).find(item => item.getAttribute('data-message-ulid') === id);
                if (!row) return null;
                const card = row.querySelector('[data-service-message-card="true"]');
                const text = (row.innerText || '').trim();
                const rect = row.getBoundingClientRect();
                if (!card || rect.width <= 0 || rect.height <= 0) return null;
                return {
                  messageId: id,
                  text,
                  sequence: Number(
                    row.getAttribute('data-message-authority-sequence') || 0
                  ),
                  aggregationCount: Number(
                    card.getAttribute('data-service-aggregation-count') || 0
                  ),
                  eventType: card.getAttribute('data-service-event-type') || '',
                  trustedServiceCard: true,
                };
                """,
                message_id,
            )
            if (
                isinstance(value, dict)
                and value.get("messageId") == message_id
                and expected_text in str(value.get("text") or "")
            ):
                return value
            return None

        return wait_until(
            visible,
            f"visible Native service message {message_id}",
            timeout=60,
        )

    def _run_scenario(
        self,
        scenario_id: str,
        action: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        value = action()
        self.suite.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id="alice-native",
        )
        self.suite.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id="alice-visible-projection",
        )
        self.suite.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
        self.scenario_evidence[scenario_id] = value
        return value

    def _create_grant_and_restart_seed(self) -> dict[str, Any]:
        _, raw_created = self.owner_request(
            "/message-publishing/grants/create",
            {"name": f"Acceptance Publisher {uuid.uuid4().hex[:8]}"},
        )
        created = _unwrap_data(raw_created)
        grant = _mapping(created.get("grant"), "created publishing grant")
        secret = str(created.get("secret") or "")
        publishing_id = str(
            _field(grant, "publishing_id", "publishingId") or ""
        )
        sender_ptid = str(_field(grant, "sender_ptid", "senderPtid") or "")
        namespace = str(
            _field(grant, "source_namespace", "sourceNamespace") or ""
        )
        if (
            not publishing_id
            or not sender_ptid.startswith("ptid:")
            or not namespace
            or not secret
        ):
            raise GateError("Created publishing grant is incomplete")
        self.grant = grant
        self.secret = secret
        self._park()
        command_id = f"mpub-restart-{uuid.uuid4().hex}"
        _, raw = self.publish(
            publishing_id,
            secret,
            {
                "command_id": command_id,
                "content": {"text": {"text": "Restart recovery seed"}},
                "source_context": {
                    "program": "acceptance",
                    "workspace": "message-publishing",
                    "session_id": str(self.manifest.get("runId") or ""),
                },
            },
        )
        response = self._publication_response(raw)
        self._receiver_snapshot(
            response,
            expected_notifications=1,
            sender_ptid=sender_ptid,
            source_namespace=namespace,
        )
        self._record_fixture(response, namespace)
        return response

    def scenario_grant_text(self) -> dict[str, Any]:
        _, raw_list = self.owner_request(
            "/message-publishing/grants/list",
            {},
        )
        listed = _unwrap_data(raw_list)
        grants = listed.get("grants")
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId") or ""
        )
        if not isinstance(grants, list) or not any(
            isinstance(item, dict)
            and str(_field(item, "publishing_id", "publishingId") or "")
            == publishing_id
            for item in grants
        ):
            raise GateError("Created grant is missing from owner list")
        self._park()
        command_id = f"mpub-text-{uuid.uuid4().hex}"
        _, raw = self.publish(
            publishing_id,
            self.secret,
            {
                "command_id": command_id,
                "content": {"text": {"text": "Acceptance text publication"}},
            },
        )
        response = self._publication_response(raw)
        snapshot = self._receiver_snapshot(
            response,
            expected_notifications=1,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid") or ""
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
                or ""
            ),
        )
        visible = self._open_visible_message(
            response,
            "Acceptance text publication",
        )
        self._record_fixture(
            response,
            str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        return {
            "response": response,
            "snapshot": snapshot,
            "visible": visible,
        }

    def scenario_retry_convergence(self) -> dict[str, Any]:
        first = self.scenario_evidence["grant-lifecycle"]["response"]
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId")
        )
        command_id = str(_field(first, "command_id", "commandId"))
        request = {
            "command_id": command_id,
            "content": {"text": {"text": "Acceptance text publication"}},
        }
        _, raw_replay = self.publish(publishing_id, self.secret, request)
        replay = self._publication_response(raw_replay)
        for field_names in (
            ("message_id", "messageId"),
            ("conversation_id", "conversationId"),
            ("conversation_event_id", "conversationEventId"),
            ("event_sequence", "eventSequence"),
        ):
            if _field(first, *field_names) != _field(replay, *field_names):
                raise GateError("Replay changed committed publication identity")

        lost_command = f"mpub-lost-{uuid.uuid4().hex}"
        lost_request = {
            "command_id": lost_command,
            "content": {"text": {"text": "Lost response converged"}},
        }
        self.publish(
            publishing_id,
            self.secret,
            lost_request,
            discard_response=True,
        )
        _, raw_lost_replay = self.publish(
            publishing_id,
            self.secret,
            lost_request,
        )
        lost_replay = self._publication_response(raw_lost_replay)

        concurrent_command = f"mpub-concurrent-{uuid.uuid4().hex}"
        concurrent_request = {
            "command_id": concurrent_command,
            "content": {"text": {"text": "Concurrent retry converged"}},
        }
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(
                    self.publish,
                    publishing_id,
                    self.secret,
                    concurrent_request,
                )
                for _ in range(2)
            ]
            concurrent_responses = [
                self._publication_response(future.result()[1])
                for future in futures
            ]
        identities = {
            (
                _field(item, "message_id", "messageId"),
                _field(item, "conversation_event_id", "conversationEventId"),
            )
            for item in concurrent_responses
        }
        if len(identities) != 1:
            raise GateError("Concurrent retries did not converge")
        snapshot = self._receiver_snapshot(
            concurrent_responses[0],
            expected_notifications=1,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid")
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        visible = self._open_visible_message(
            concurrent_responses[0],
            "Concurrent retry converged",
        )
        self._record_fixture(
            lost_replay,
            str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        self._record_fixture(
            concurrent_responses[0],
            str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        return {
            "replay": replay,
            "lostResponseReplay": lost_replay,
            "concurrent": concurrent_responses,
            "snapshot": snapshot,
            "visible": visible,
        }

    def scenario_credential_rotation(self) -> dict[str, Any]:
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId")
        )
        old_secret = self.secret
        _, raw_rotated = self.owner_request(
            "/message-publishing/grants/rotate-secret",
            {"publishing_id": publishing_id},
        )
        rotated = _unwrap_data(raw_rotated)
        new_secret = str(rotated.get("secret") or "")
        if not new_secret or new_secret == old_secret:
            raise GateError("Credential rotation did not produce a new secret")
        command_id = f"mpub-rotated-{uuid.uuid4().hex}"
        request = {
            "command_id": command_id,
            "content": {"text": {"text": "Rotated credential accepted"}},
        }
        self.publish(
            publishing_id,
            old_secret,
            request,
            expected_statuses=(401,),
        )
        self.secret = new_secret
        _, raw = self.publish(publishing_id, new_secret, request)
        response = self._publication_response(raw)
        snapshot = self._receiver_snapshot(
            response,
            expected_notifications=1,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid")
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        visible = self._open_visible_message(
            response,
            "Rotated credential accepted",
        )
        self._record_fixture(
            response,
            str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        return {
            "oldCredentialRejected": True,
            "response": response,
            "snapshot": snapshot,
            "visible": visible,
        }

    def scenario_notification_suppression(self) -> dict[str, Any]:
        preference = _mapping(
            self.harness("disableChatNotifications"),
            "notification preference result",
        )
        self.original_chat_preference = _mapping(
            preference.get("original"),
            "original Chat notification preference",
        )
        updated = _mapping(
            preference.get("updated"),
            "updated Chat notification preference",
        )
        if updated.get("enabled") is not False:
            raise GateError("Chat notification preference was not disabled")
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId")
        )
        _, raw = self.publish(
            publishing_id,
            self.secret,
            {
                "command_id": f"mpub-muted-{uuid.uuid4().hex}",
                "content": {"text": {"text": "Suppressed notification message"}},
            },
        )
        response = self._publication_response(raw)
        snapshot = self._receiver_snapshot(
            response,
            expected_notifications=0,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid")
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        visible = self._open_visible_message(
            response,
            "Suppressed notification message",
        )
        self._record_fixture(
            response,
            str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        return {
            "preference": preference,
            "response": response,
            "snapshot": snapshot,
            "visible": visible,
        }

    def scenario_structured_aggregation(self) -> dict[str, Any]:
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId")
        )
        execution_id = f"execution-{uuid.uuid4().hex}"
        responses: list[dict[str, Any]] = []
        for revision, state, title in (
            (1, "REPORTED_TASK_STATE_RUNNING", "Build running"),
            (2, "REPORTED_TASK_STATE_COMPLETED", "Build completed"),
        ):
            _, raw = self.publish(
                publishing_id,
                self.secret,
                {
                    "command_id": f"mpub-event-{revision}-{uuid.uuid4().hex}",
                    "content": {
                        "event": {
                            "event_type": "ci.task.state",
                            "title": title,
                            "subject": {
                                "kind": "build",
                                "id": "acceptance-build",
                                "execution_id": execution_id,
                            },
                            "task_state": {
                                "revision": str(revision),
                                "state": state,
                            },
                        }
                    },
                },
            )
            responses.append(self._publication_response(raw))
        latest_snapshot = self._receiver_snapshot(
            responses[1],
            expected_notifications=1,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid")
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        visible = self._open_visible_message(responses[1], "Build completed")
        if (
            visible.get("aggregationCount") != 2
            or not isinstance(latest_snapshot.get("aggregation"), dict)
            or latest_snapshot["aggregation"].get("knownCount") != 2
            or latest_snapshot["aggregation"].get("effectiveRevision") != "2"
        ):
            raise GateError("Structured event aggregation is not deterministic")
        conversation_id = str(
            _field(responses[0], "conversation_id", "conversationId")
        )
        first_message_id = str(
            _field(responses[0], "message_id", "messageId")
        )
        self.harness(
            "locateReceiverMessage",
            {
                "conversationId": conversation_id,
                "messageId": first_message_id,
            },
        )

        def located_history() -> bool:
            if self.client is None:
                return False
            return bool(
                self.client.driver.execute_script(
                    """
                    const id = arguments[0];
                    return Array.from(
                      document.querySelectorAll('[data-message-ulid]')
                    ).some(item => item.getAttribute('data-message-ulid') === id);
                    """,
                    first_message_id,
                )
            )

        wait_until(
            located_history,
            "located aggregate history message",
            timeout=30,
        )
        for response in responses:
            self._record_fixture(
                response,
                str(
                    _field(
                        self.grant,
                        "source_namespace",
                        "sourceNamespace",
                    )
                ),
            )
        return {
            "responses": responses,
            "snapshot": latest_snapshot,
            "visible": visible,
            "locatedMessageId": first_message_id,
        }

    def restore_chat_notification_preference(self) -> None:
        if self.original_chat_preference is None:
            return
        restored = _mapping(
            self.harness(
                "restoreChatNotifications",
                {"preference": self.original_chat_preference},
            ),
            "restored notification preference",
        )
        value = _mapping(
            restored.get("restored"),
            "restored Chat notification preference",
        )
        expected = self.original_chat_preference
        for field in ("enabled", "pushEnabled", "soundEnabled"):
            if value.get(field) != expected.get(field):
                raise GateError(
                    f"Chat notification preference did not restore {field}"
                )
        self.original_chat_preference = None

    def scenario_card_attachment_security(self) -> dict[str, Any]:
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId")
        )
        conversation_id = str(
            _field(self.grant, "default_target", "defaultTarget")
        )
        attachment = _mapping(
            self.harness(
                "uploadAttachment",
                {
                    "conversationId": conversation_id,
                    "filename": "acceptance.pdf",
                    "mimeType": "application/pdf",
                    "bytes": list(b"%PDF-1.4\nAcceptance attachment\n%%EOF\n"),
                },
                timeout=60,
            ),
            "uploaded attachment",
        )
        self.attachment = attachment
        _, raw = self.publish(
            publishing_id,
            self.secret,
            {
                "command_id": f"mpub-card-{uuid.uuid4().hex}",
                "content": {
                    "card": {
                        "title": "Acceptance card",
                        "body": "Attachment metadata is authoritative",
                        "actions": [
                            {
                                "label": "Open",
                                "url": "https://example.test/acceptance",
                            }
                        ],
                    },
                    "attachments": [
                        {
                            "object_id": attachment["objectId"],
                            "filename": "caller-name.txt",
                            "media_type": "text/plain",
                            "size": "1",
                        }
                    ],
                },
            },
        )
        response = self._publication_response(raw)
        snapshot = self._receiver_snapshot(
            response,
            expected_notifications=1,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid")
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        visible = self._open_visible_message(response, "Acceptance card")
        service = _mapping(
            _mapping(snapshot.get("message"), "receiver message").get(
                "serviceMessage"
            ),
            "service message",
        )
        content = _mapping(service.get("content"), "service content")
        attachments = content.get("attachments")
        if (
            not isinstance(attachments, list)
            or len(attachments) != 1
            or attachments[0].get("objectId") != attachment["objectId"]
            or attachments[0].get("filename") != attachment["filename"]
            or attachments[0].get("mediaType") != attachment["mediaType"]
        ):
            raise GateError(
                "Receiver attachment metadata is not object-authoritative"
            )
        bad_command = f"mpub-invalid-{uuid.uuid4().hex}"
        self.publish(
            publishing_id,
            self.secret,
            {
                "command_id": bad_command,
                "content": {
                    "card": {
                        "title": "Invalid action",
                        "actions": [
                            {
                                "label": "Unsafe",
                                "url": "javascript:alert(1)",
                            }
                        ],
                    }
                },
            },
            expected_statuses=(400,),
        )
        unauthorized_command = f"mpub-object-{uuid.uuid4().hex}"
        self.publish(
            publishing_id,
            self.secret,
            {
                "command_id": unauthorized_command,
                "content": {
                    "text": {"text": "Unauthorized attachment"},
                    "attachments": [{"object_id": "not-owned-object"}],
                },
            },
            expected_statuses=(401,),
        )
        self._record_fixture(
            response,
            str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        return {
            "response": response,
            "snapshot": snapshot,
            "visible": visible,
            "attachment": attachment,
            "malformedRejected": True,
            "unauthorizedObjectRejected": True,
        }

    def scenario_content_and_security(self) -> dict[str, Any]:
        return {
            "credentialLifecycle": self.scenario_credential_rotation(),
            "contentSecurity": self.scenario_card_attachment_security(),
        }

    def scenario_bot_common_ingress(self) -> dict[str, Any]:
        created = _mapping(
            self.harness(
                "createBot",
                {"name": f"Acceptance Bot {uuid.uuid4().hex[:8]}"},
            ),
            "created Bot",
        )
        if (
            not str(created.get("botPtid") or "").startswith("ptid:")
            or not created.get("publishingId")
            or not created.get("secret")
        ):
            raise GateError("Created Bot publishing adapter is incomplete")
        self.bot = created
        _, raw = self.publish(
            str(created["publishingId"]),
            str(created["secret"]),
            {
                "command_id": f"mpub-bot-{uuid.uuid4().hex}",
                "content": {"text": {"text": "Bot used generic ingress"}},
            },
        )
        response = self._publication_response(raw)
        snapshot = self._receiver_snapshot(
            response,
            expected_notifications=1,
            sender_ptid=str(created["botPtid"]),
            source_namespace=f"bot.{created['botPtid']}",
        )
        visible = self._open_visible_message(
            response,
            "Bot used generic ingress",
        )
        self._record_fixture(response, f"bot.{created['botPtid']}")
        return {
            "botPtid": created["botPtid"],
            "publishingId": created["publishingId"],
            "response": response,
            "snapshot": snapshot,
            "visible": visible,
        }

    def scenario_restart_recovery(
        self,
        restart_seed: dict[str, Any],
    ) -> dict[str, Any]:
        snapshot = self._receiver_snapshot(
            restart_seed,
            expected_notifications=1,
            sender_ptid=str(
                _field(self.grant, "sender_ptid", "senderPtid")
            ),
            source_namespace=str(
                _field(
                    self.grant,
                    "source_namespace",
                    "sourceNamespace",
                )
            ),
        )
        visible = self._open_visible_message(
            restart_seed,
            "Restart recovery seed",
        )
        aggregation = _mapping(
            self.scenario_evidence.get("semantic-aggregation"),
            "semantic aggregation evidence",
        )
        responses = aggregation.get("responses")
        if not isinstance(responses, list) or not responses:
            raise GateError("Semantic aggregation history is unavailable")
        first = _mapping(responses[0], "first aggregate response")
        first_message_id = str(_field(first, "message_id", "messageId") or "")
        conversation_id = str(
            _field(first, "conversation_id", "conversationId") or ""
        )
        self.harness(
            "locateReceiverMessage",
            {
                "conversationId": conversation_id,
                "messageId": first_message_id,
            },
        )

        def located_after_restart() -> bool:
            if self.client is None:
                return False
            return bool(
                self.client.driver.execute_script(
                    """
                    const id = arguments[0];
                    return Array.from(
                      document.querySelectorAll('[data-message-ulid]')
                    ).some(item => item.getAttribute('data-message-ulid') === id);
                    """,
                    first_message_id,
                )
            )

        wait_until(
            located_after_restart,
            "aggregate history locate after restart",
            timeout=30,
        )
        return {
            "response": restart_seed,
            "snapshot": snapshot,
            "visible": visible,
            "launchCount": len(self.runtime_launches),
            "locatedMessageId": first_message_id,
        }

    def scenario_human_chat_regression(self) -> dict[str, Any]:
        contexts = _mapping(
            self.harness(
                "federationContext",
                namespace="chat",
            ),
            "Alice Federation context",
        )
        federations = contexts.get("federations")
        if not isinstance(federations, list) or not federations:
            raise GateError("Alice has no active Federation context")
        federation_id = str(
            _mapping(federations[0], "Federation context").get(
                "federationId"
            )
            or ""
        )
        search = _mapping(
            self.harness(
                "searchFederationContext",
                {
                    "federationId": federation_id,
                    "prefix": "bob",
                },
                namespace="chat",
            ),
            "human peer search",
        )
        entries = search.get("entries")
        peer = next(
            (
                _mapping(entry, "human peer")
                for entry in entries
                if isinstance(entry, dict)
                and str(entry.get("actorPtid") or "") != self.owner_ptid
            ),
            None,
        ) if isinstance(entries, list) else None
        if peer is None:
            raise GateError("No human peer is available for Direct regression")
        peer_ptid = str(peer.get("actorPtid") or "")
        created = _mapping(
            self.harness(
                "createDirectConversation",
                {
                    "peerPtid": peer_ptid,
                    "federationId": federation_id,
                },
                namespace="chat",
            ),
            "human Direct creation",
        )
        conversation_id = str(created.get("conversationId") or "")
        content = f"Human E2EE regression {uuid.uuid4().hex[:8]}"
        sent = _mapping(
            self.harness(
                "sendInteractionMessage",
                {
                    "conversationId": conversation_id,
                    "kind": "friend",
                    "content": content,
                },
                namespace="chat",
                timeout=90,
            ),
            "human Direct send",
        )
        message_id = str(sent.get("messageId") or "")
        projection = sent.get("projection")
        if (
            not message_id
            or not isinstance(projection, dict)
            or projection.get("content") != content
            or projection.get("senderPtid") != self.owner_ptid
        ):
            raise GateError("Human Direct projection is incomplete")
        if self.client is None:
            raise GateError("Native client is unavailable")
        enter_chat_page(self.client)

        def visible_human_message() -> dict[str, Any] | None:
            value = self.client.driver.execute_script(
                """
                const id = arguments[0];
                const row = Array.from(
                  document.querySelectorAll('[data-message-ulid]')
                ).find(item => item.getAttribute('data-message-ulid') === id);
                if (!row) return null;
                const text = (row.innerText || '').trim();
                const service = row.querySelector(
                  '[data-service-message-card=\"true\"]'
                );
                return {
                  messageId: id,
                  text,
                  serviceCard: Boolean(service),
                };
                """,
                message_id,
            )
            if (
                isinstance(value, dict)
                and content in str(value.get("text") or "")
                and value.get("serviceCard") is False
            ):
                return value
            return None

        visible = wait_until(
            visible_human_message,
            "visible human E2EE Direct message",
            timeout=60,
        )
        return {
            "conversationId": conversation_id,
            "messageId": message_id,
            "peerPtid": peer_ptid,
            "projection": projection,
            "visible": visible,
        }

    def _cleanup(self) -> dict[str, Any]:
        errors: list[dict[str, str]] = []
        cleanup: dict[str, Any] = {
            "grantRevoked": False,
            "botRevoked": not bool(self.bot),
            "attachmentDeleted": not bool(self.attachment),
            "notificationPreferenceRestored": (
                self.original_chat_preference is None
            ),
            "clientReleased": False,
            "retainedFixtures": list(self.retained_fixtures),
        }
        if self.original_chat_preference is not None and self.client is not None:
            try:
                restored = _mapping(
                    self.harness(
                        "restoreChatNotifications",
                        {"preference": self.original_chat_preference},
                    ),
                    "restored notification preference",
                )
                cleanup["notificationPreferenceRestored"] = (
                    _mapping(
                        restored.get("restored"),
                        "restored Chat notification preference",
                    ).get("enabled")
                    == self.original_chat_preference.get("enabled")
                )
            except Exception as error:
                errors.append(
                    {
                        "resource": "notification-preference",
                        "error": str(error),
                    }
                )
        if self.attachment and self.client is not None:
            try:
                self.harness(
                    "deleteAttachment",
                    {"key": self.attachment["key"]},
                )
                cleanup["attachmentDeleted"] = True
            except Exception as error:
                errors.append(
                    {"resource": "attachment", "error": str(error)}
                )
        if self.bot and self.client is not None:
            try:
                revoked = _mapping(
                    self.harness(
                        "revokeBot",
                        {"botPtid": self.bot["botPtid"]},
                    ),
                    "revoked Bot",
                )
                cleanup["botRevoked"] = revoked.get("state") == 4
            except Exception as error:
                errors.append({"resource": "bot", "error": str(error)})
        publishing_id = str(
            _field(self.grant, "publishing_id", "publishingId") or ""
        )
        if publishing_id and self.owner_token:
            try:
                _, raw = self.owner_request(
                    "/message-publishing/grants/revoke",
                    {"publishing_id": publishing_id},
                )
                revoked = _mapping(
                    _unwrap_data(raw).get("grant"),
                    "revoked publishing grant",
                )
                cleanup["grantRevoked"] = bool(
                    _field(revoked, "revoked")
                )
                if self.secret:
                    self.publish(
                        publishing_id,
                        self.secret,
                        {
                            "command_id": f"mpub-revoked-{uuid.uuid4().hex}",
                            "content": {
                                "text": {
                                    "text": "Revoked credential must fail"
                                }
                            },
                        },
                        expected_statuses=(401,),
                    )
                    cleanup["revokedCredentialRejected"] = True
            except Exception as error:
                errors.append(
                    {"resource": "publishing-grant", "error": str(error)}
                )
        self.owner_token = ""
        self.secret = ""
        if self.client is not None and self.client.is_alive():
            try:
                self.save_screenshot(self.client, "alice-final")
                self.save_dom(self.client, "alice-final")
            except Exception as error:
                errors.append(
                    {"resource": "final-native-evidence", "error": str(error)}
                )
        lifecycle_errors = self.lifecycles.release_all()
        errors.extend(lifecycle_errors)
        try:
            runtime_cleanup = self.runtime_binding.finalize_cleanup(
                self.clients,
                {"alice": self.client_spec},
            )
        except Exception as error:
            runtime_cleanup = {"cleanupErrors": [{"error": str(error)}]}
            errors.append(
                {"resource": "runtime-binding", "error": str(error)}
            )
        cleanup["runtime"] = runtime_cleanup
        cleanup["clientReleased"] = (
            bool(runtime_cleanup.get("portsReleased"))
            and bool(runtime_cleanup.get("processesReleased"))
            and bool(runtime_cleanup.get("storageReleased"))
            and not lifecycle_errors
        )
        cleanup["cleanupErrors"] = errors
        cleanup["complete"] = (
            cleanup["grantRevoked"]
            and cleanup["botRevoked"]
            and cleanup["attachmentDeleted"]
            and cleanup["notificationPreferenceRestored"]
            and cleanup["clientReleased"]
            and not errors
        )
        if cleanup["complete"]:
            self.suite.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
        return cleanup

    def run(self) -> dict[str, Any]:
        source_identity = native_runtime_source_identity(
            gate_id=self.gate_id,
            manifest=self.manifest,
            runtime_binding=self.runtime_binding,
            station_live=read_station_version(self.station_url),
        )
        self.report.add_assertion(
            "source_build_runtime_identity",
            True,
            "Station, runtime cell, binary, and orchestrator share exact source",
        )
        self.suite.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="home-station:one",
        )
        self.suite.record(
            SuiteRuntimeAction.ACCOUNT_PROVISION,
            resource_id="alice-reviewed-existing-account",
        )
        cleanup: dict[str, Any] = {}
        try:
            self._launch_client()
            self.suite.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id="alice-native-initial",
            )
            self.suite.record(
                SuiteRuntimeAction.LOGIN,
                resource_id="alice-owner-session",
            )
            self.owner_token = self._session_token()
            restart_seed = self._create_grant_and_restart_seed()

            self._relaunch_client()
            self.suite.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id="alice-native-relaunch",
            )
            self.owner_token = self._session_token()
            if len(self.runtime_launches) != 2:
                raise GateError("Message Publishing exceeded one client restart")
            enter_chat_page(self.client)

            self._run_scenario(
                "grant-lifecycle",
                self.scenario_grant_text,
            )
            self._run_scenario(
                "program-and-bot-publish",
                self.scenario_bot_common_ingress,
            )
            self._run_scenario(
                "idempotency-and-replay",
                self.scenario_retry_convergence,
            )
            self._run_scenario(
                "content-and-security",
                self.scenario_content_and_security,
            )
            self._run_scenario(
                "native-render-and-notification",
                self.scenario_notification_suppression,
            )
            self.restore_chat_notification_preference()
            self._run_scenario(
                "semantic-aggregation",
                self.scenario_structured_aggregation,
            )
            self._run_scenario(
                "restart-partial-history-and-locate",
                lambda: self.scenario_restart_recovery(restart_seed),
            )
            self._run_scenario(
                "human-chat-regression",
                self.scenario_human_chat_regression,
            )
        finally:
            try:
                cleanup = cleanup_preserving_primary_failure(
                    self._cleanup,
                    self.report,
                    "Message Publishing Native Gate",
                )
            finally:
                self.write_json_evidence(
                    "scenario-ledger",
                    self.scenario_evidence,
                )
                self.write_json_evidence(
                    "runtime-launch-ledger",
                    self.runtime_launches,
                )
                self.write_json_evidence("cleanup", cleanup)

        if not cleanup.get("complete"):
            raise GateError(
                "Message Publishing cleanup is incomplete: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        suite_report = self.suite.require_valid()
        self.write_json_evidence("suite-runtime", suite_report)
        self.write_json_evidence("source-build-runtime", source_identity)
        self.write_json_evidence(
            "retained-message-fixtures",
            {
                "policy": "retained immutable Conversation messages",
                "fixtures": self.retained_fixtures,
            },
        )

        text = self.scenario_evidence["grant-lifecycle"]
        replay = self.scenario_evidence["idempotency-and-replay"]
        suppressed = self.scenario_evidence[
            "native-render-and-notification"
        ]
        aggregation = self.scenario_evidence["semantic-aggregation"]
        self.assert_condition(
            "native_receiver_identity_content_trust",
            bool(text["visible"]["trustedServiceCard"])
            and text["snapshot"]["messageCount"] == 1,
        )
        self.assert_condition(
            "unread_exactly_once",
            int(text["snapshot"]["unreadBeforeOpen"]) >= 1
            and replay["snapshot"]["messageCount"] == 1,
        )
        self.assert_condition(
            "notification_exactly_once",
            text["snapshot"]["notificationCount"] == 1
            and replay["snapshot"]["notificationCount"] == 1
            and suppressed["snapshot"]["notificationCount"] == 0,
        )
        self.assert_condition(
            "aggregation_restart_locate",
            aggregation["snapshot"]["aggregation"]["knownCount"] == 2
            and self.scenario_evidence[
                "restart-partial-history-and-locate"
            ]["launchCount"]
            == 2,
        )
        self.assert_condition(
            "suite_runtime_valid",
            suite_report["result"] == "PASS",
        )
        self.assert_condition("cleanup_complete", True)
        return {
            "journey": "message-publishing-owner-native-receiver",
            "runtimeCell": self.runtime_binding.cell_id,
            "scenarios": list(SCENARIO_IDS),
            "suiteRuntime": suite_report,
            "cleanup": cleanup,
        }


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    if selected is None:
        raise GateError("Message Publishing runtime selection failed")
    gate = MessagePublishingNativeGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
