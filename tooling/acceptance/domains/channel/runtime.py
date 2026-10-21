"""Live adapters and evidence validation for Lark Channel journeys."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tooling.acceptance.core import GateError

from .contract import (
    Actor,
    JourneyContract,
    SuiteManifest,
    resolve_env_ref,
)


MAX_RESPONSE_BYTES = 8 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 30
WAIT_TIMEOUT_SECONDS = 300
SCENARIO_PLAN_KIND = "lark-channel-scenario-plan"
SCENARIO_OBSERVATION_KIND = "lark-channel-scenario-observation"
SCENARIO_PROTOCOL_VERSION = 1
CHANNEL_API_PREFIX = "/sub-channel/channel/"


def identity_hash(value: object) -> str:
    encoded = str(value or "").encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def canonical_digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


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


def _text(value: object, field: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise GateError(f"{field} must be a string")
    result = value.strip()
    if not allow_empty and not result:
        raise GateError(f"{field} must be non-empty")
    return result


def _non_negative_int(value: object, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise GateError(f"{field} must be a non-negative integer")
    return value


def _read_json_response(
    request: urllib.request.Request,
    *,
    timeout: float,
    label: str,
) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        detail = error.read(4096).decode("utf-8", errors="replace")
        raise GateError(
            f"{label} failed with HTTP {error.code}: {detail}"
        ) from error
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise GateError(f"{label} failed: {error}") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise GateError(f"{label} response exceeded the bounded limit")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GateError(f"{label} returned invalid JSON") from error
    return _mapping(payload, f"{label} response")


def _unwrap_data(value: dict[str, Any]) -> dict[str, Any]:
    data = value.get("data")
    if isinstance(data, Mapping):
        return dict(data)
    return value


class StationChannelClient:
    def __init__(
        self,
        *,
        endpoint: str,
        token: str,
        expected_commit: str,
        expected_runtime_identity: str,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token = _text(token, "Station Channel capability token")
        self.expected_commit = expected_commit
        self.expected_runtime_identity = expected_runtime_identity

    def verify_live_source(self) -> None:
        version = _unwrap_data(
            _read_json_response(
                urllib.request.Request(
                    f"{self.endpoint}/app-meta/version",
                    headers={"Accept": "application/json"},
                    method="GET",
                ),
                timeout=10,
                label="Station version probe",
            )
        )
        live_commit = _text(
            version.get("build_commit"),
            "Station build_commit",
        )
        if live_commit != self.expected_commit:
            raise GateError(
                f"Station live commit {live_commit} does not match Suite source"
            )
        live_identity = str(
            version.get("peer_id")
            or version.get("station_peer_id")
            or version.get("service_id")
            or ""
        ).strip()
        if live_identity and live_identity != self.expected_runtime_identity:
            raise GateError("Station runtime identity does not match the Suite")

    def post_channel(
        self,
        path: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        if not path.startswith(CHANNEL_API_PREFIX):
            raise GateError(f"Channel path is outside its owner: {path}")
        return _unwrap_data(self._post(path, payload, authenticated=True))

    def list_bindings(self) -> list[dict[str, Any]]:
        result = self.post_channel(
            f"{CHANNEL_API_PREFIX}binding/list",
            {},
        )
        bindings = result.get("bindings")
        if not isinstance(bindings, list):
            raise GateError("Channel binding list is invalid")
        return [
            dict(binding)
            for binding in bindings
            if isinstance(binding, Mapping)
        ]

    def list_events(
        self,
        binding_id: str,
        *,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        result = self.post_channel(
            f"{CHANNEL_API_PREFIX}event/list",
            {"binding_id": binding_id, "limit": limit, "offset": 0},
        )
        events = result.get("events")
        if not isinstance(events, list):
            raise GateError("Channel event list is invalid")
        return [
            dict(event)
            for event in events
            if isinstance(event, Mapping)
        ]

    def export_diagnostics(self, binding_id: str) -> dict[str, Any]:
        response = self.post_channel(
            f"{CHANNEL_API_PREFIX}diagnostics/export",
            {"binding_id": binding_id},
        )
        raw = response.get("json_data")
        if not isinstance(raw, str):
            raise GateError("Channel diagnostic export did not return bytes")
        try:
            decoded = bytes.fromhex(raw)
        except ValueError:
            try:
                import base64

                decoded = base64.b64decode(raw, validate=True)
            except Exception as error:
                raise GateError(
                    "Channel diagnostic export bytes are invalid"
                ) from error
        try:
            value = json.loads(decoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GateError("Channel diagnostic export is invalid JSON") from error
        return _mapping(value, "Channel diagnostic export")

    def wait_for_events(
        self,
        *,
        binding_id: str,
        turn_id: str,
        delivery_id: str,
        marker: str,
        timeout: float = WAIT_TIMEOUT_SECONDS,
    ) -> list[dict[str, Any]]:
        deadline = time.monotonic() + timeout
        latest: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            latest = self.list_events(binding_id)
            matched = [
                event
                for event in latest
                if (
                    (not turn_id or event.get("turn_id") == turn_id)
                    and (
                        not delivery_id
                        or event.get("delivery_id") == delivery_id
                    )
                    and (
                        not marker
                        or marker in str(event.get("summary") or "")
                        or marker in str(event.get("error_message") or "")
                    )
                )
            ]
            if matched:
                return matched
            time.sleep(1)
        raise GateError(
            "Station Channel diagnostics did not converge for the Scenario"
        )

    def _post(
        self,
        path: str,
        payload: Mapping[str, Any],
        *,
        authenticated: bool,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if authenticated:
            if not self.token:
                raise GateError("Station Channel client is not authenticated")
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(
            f"{self.endpoint}{path}",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        return _read_json_response(
            request,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            label=f"Station {path}",
        )


class LarkCLIClient:
    def __init__(self, actor: Actor) -> None:
        if actor.kind != "lark-user":
            raise GateError(f"actor {actor.actor_id} is not a Lark user")
        self.actor_id = actor.actor_id
        self.executable = Path(
            resolve_env_ref(
                actor.config["executableRef"],
                f"actors.{actor.actor_id}.executableRef",
            )
        ).expanduser().resolve()
        self.config_dir = Path(
            resolve_env_ref(
                actor.config["configDirRef"],
                f"actors.{actor.actor_id}.configDirRef",
            )
        ).expanduser().resolve()
        self.data_dir = Path(
            resolve_env_ref(
                actor.config["dataDirRef"],
                f"actors.{actor.actor_id}.dataDirRef",
            )
        ).expanduser().resolve()
        self.profile = str(actor.config["profile"])
        if (
            not self.executable.is_file()
            or not os.access(self.executable, os.X_OK)
        ):
            raise GateError(
                f"Lark CLI executable for {actor.actor_id} is unavailable"
            )
        if not self.config_dir.is_dir() or not self.data_dir.is_dir():
            raise GateError(
                f"Lark CLI profile storage for {actor.actor_id} is unavailable"
            )

    def verify_authorization(self) -> dict[str, Any]:
        result = self.run("auth", "status", "--verify", "--json")
        identities = result.get("identities")
        user = (
            dict(identities.get("user"))
            if isinstance(identities, Mapping)
            and isinstance(identities.get("user"), Mapping)
            else result
        )
        if (
            user.get("available") is False
            or user.get("verified") is False
            or user.get("tokenStatus")
            not in {"valid", "needs_refresh", None}
        ):
            raise GateError(
                f"Lark authorization for {self.actor_id} is not valid"
            )
        return result

    def message(self, message_id: str) -> dict[str, Any]:
        result = self.run(
            "im",
            "+messages-mget",
            "--message-ids",
            message_id,
            "--as",
            "user",
            "--format",
            "json",
        )
        messages = self._find_list(result, "messages")
        message = next(
            (
                item
                for item in messages
                if isinstance(item, Mapping)
                and item.get("message_id") == message_id
            ),
            None,
        )
        if not isinstance(message, Mapping):
            raise GateError(
                f"Lark receiver cannot read message {identity_hash(message_id)}"
            )
        return dict(message)

    def send(
        self,
        *,
        kind: str,
        chat_id: str,
        content: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        content_flags = {
            "lark-send-text": ("--text", content),
            "lark-send-post": ("--markdown", content),
            "lark-send-image": ("--image", content),
            "lark-send-file": ("--file", content),
        }
        try:
            flag, value = content_flags[kind]
        except KeyError as error:
            raise GateError(f"unsupported Lark send action {kind!r}") from error
        result = self.run(
            "im",
            "+messages-send",
            "--chat-id",
            chat_id,
            flag,
            value,
            "--idempotency-key",
            idempotency_key,
            "--as",
            "user",
            "--format",
            "json",
        )
        message_id = self._find_text(result, "message_id")
        if not message_id.startswith("om_"):
            raise GateError("Lark send did not return a provider message ID")
        return {
            "messageId": message_id,
            "chatId": self._find_text(result, "chat_id") or chat_id,
        }

    def reply(
        self,
        *,
        message_id: str,
        content: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        result = self.run(
            "im",
            "+messages-reply",
            "--message-id",
            message_id,
            "--text",
            content,
            "--idempotency-key",
            idempotency_key,
            "--as",
            "user",
            "--format",
            "json",
        )
        reply_id = self._find_text(result, "message_id")
        if not reply_id.startswith("om_"):
            raise GateError("Lark reply did not return a provider message ID")
        return {
            "messageId": reply_id,
            "chatId": self._find_text(result, "chat_id"),
        }

    def list_messages(self, chat_id: str) -> list[dict[str, Any]]:
        result = self.run(
            "im",
            "+chat-messages-list",
            "--chat-id",
            chat_id,
            "--order",
            "desc",
            "--page-size",
            "50",
            "--as",
            "user",
            "--format",
            "json",
        )
        return [
            dict(item)
            for item in self._find_list(result, "messages")
            if isinstance(item, Mapping)
        ]

    def wait_for_marker(
        self,
        *,
        chat_id: str,
        marker: str,
        excluded_message_id: str = "",
        timeout: float = WAIT_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for message in self.list_messages(chat_id):
                if message.get("message_id") == excluded_message_id:
                    continue
                rendered = json.dumps(
                    message,
                    ensure_ascii=False,
                    sort_keys=True,
                )
                if marker in rendered:
                    return message
            time.sleep(1)
        raise GateError("Lark receiver did not observe the Scenario marker")

    def run(self, *args: str, timeout: int = 120) -> dict[str, Any]:
        command = [
            str(self.executable),
            "--profile",
            self.profile,
            *args,
        ]
        environment = {
            key: value
            for key, value in os.environ.items()
            if key
            not in {
                "FEISHU_APP_ID",
                "FEISHU_APP_SECRET",
                "LARK_APP_ID",
                "LARK_APP_SECRET",
                "LARKSUITE_CLI_TENANT_ACCESS_TOKEN",
                "LARKSUITE_CLI_USER_ACCESS_TOKEN",
            }
        }
        environment.update(
            {
                "LARKSUITE_CLI_CONFIG_DIR": str(self.config_dir),
                "LARKSUITE_CLI_DATA_DIR": str(self.data_dir),
                "LARKSUITE_CLI_NO_UPDATE_NOTIFIER": "1",
                "LARKSUITE_CLI_NO_SKILLS_NOTIFIER": "1",
            }
        )
        completed = subprocess.run(
            command,
            capture_output=True,
            env=environment,
            text=True,
            check=False,
            timeout=timeout,
        )
        if completed.returncode != 0:
            raise GateError(
                f"Lark CLI operation for {self.actor_id} failed "
                f"with exit code {completed.returncode}"
            )
        output = completed.stdout
        if len(output.encode("utf-8")) > MAX_RESPONSE_BYTES:
            raise GateError("Lark CLI output exceeded the bounded limit")
        try:
            result = json.loads(output)
        except json.JSONDecodeError as error:
            raise GateError("Lark CLI returned invalid JSON") from error
        return _mapping(result, "Lark CLI response")

    @classmethod
    def _find_list(cls, value: object, key: str) -> list[Any]:
        if isinstance(value, Mapping):
            candidate = value.get(key)
            if isinstance(candidate, list):
                return candidate
            for child in value.values():
                found = cls._find_list(child, key)
                if found:
                    return found
        elif isinstance(value, Sequence) and not isinstance(
            value,
            (str, bytes, bytearray),
        ):
            for child in value:
                found = cls._find_list(child, key)
                if found:
                    return found
        return []

    @classmethod
    def _find_text(cls, value: object, key: str) -> str:
        if isinstance(value, Mapping):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
            for child in value.values():
                found = cls._find_text(child, key)
                if found:
                    return found
        elif isinstance(value, Sequence) and not isinstance(
            value,
            (str, bytes, bytearray),
        ):
            for child in value:
                found = cls._find_text(child, key)
                if found:
                    return found
        return ""


class DesktopObserver:
    def __init__(self, actor: Actor) -> None:
        from tooling.acceptance.drivers.tauri import TauriDriver

        if actor.kind != "desktop-native":
            raise GateError(f"actor {actor.actor_id} is not a Native Desktop")
        self.actor_id = actor.actor_id
        self.driver = TauriDriver(
            host=str(actor.config["webdriverHost"]),
            port=int(actor.config["webdriverPort"]),
        )
        self.driver.start()
        self.driver.wait_for_ready()

    def close(self) -> None:
        self.driver.stop()

    def click(self, selector: str) -> dict[str, Any]:
        element = self.driver.find_element(selector, timeout=30)
        element.click()
        return {
            "actor": self.actor_id,
            "selector": selector,
        }

    def assert_visible(self, selector: str, marker: str) -> dict[str, Any]:
        element = self.driver.find_element(selector, timeout=30)
        text = str(element.text or "")
        if marker and marker not in text:
            raise GateError(
                f"Desktop receiver selector {selector!r} omitted the marker"
            )
        return {
            "actor": self.actor_id,
            "selector": selector,
            "textDigest": identity_hash(text),
        }


class JourneyControlClient:
    def __init__(
        self,
        manifest: SuiteManifest,
        contract: JourneyContract,
    ) -> None:
        capability = manifest.capabilities["journey-control"]
        service = manifest.services[capability.subject_id]
        self.endpoint = service.endpoint
        self.token = manifest.capability_token("journey-control")
        self.manifest = manifest
        self.contract = contract

    def verify_live_source(self) -> None:
        response = _closed_mapping(
            self._request(
                "/v1/channel-journeys/info",
                {
                    "suiteRuntimeId": self.manifest.suite_runtime_id,
                    "fixtureEpoch": self.manifest.fixture_epoch,
                },
            ),
            "Journey control info",
            {
                "artifactKind",
                "schemaVersion",
                "suiteRuntimeId",
                "fixtureEpoch",
                "liveCommit",
                "workspaceDigest",
                "protocolDigest",
                "runtimeIdentity",
            },
        )
        if (
            response["artifactKind"] != "lark-channel-journey-control"
            or response["schemaVersion"] != 1
            or response["suiteRuntimeId"] != self.manifest.suite_runtime_id
            or response["fixtureEpoch"] != self.manifest.fixture_epoch
            or response["liveCommit"] != self.manifest.source.commit
            or response["workspaceDigest"]
            != self.manifest.source.workspace_digest
            or response["protocolDigest"]
            != self.manifest.source.protocol_digest
        ):
            raise GateError("Journey control is not bound to the Suite source")

    def prepare_scenario(
        self,
        scenario_id: str,
        marker: str,
    ) -> dict[str, Any]:
        response = self._request(
            "/v1/channel-journeys/prepare",
            {
                "suiteRuntimeId": self.manifest.suite_runtime_id,
                "fixtureEpoch": self.manifest.fixture_epoch,
                "journeyId": self.contract.journey_id,
                "scenarioId": scenario_id,
                "marker": marker,
                "idempotencyKey": (
                    f"{self.manifest.suite_runtime_id}:"
                    f"{self.contract.journey_id}:{scenario_id}"
                ),
                "resourceRefs": {
                    key: self.manifest.resources[key]
                    for key in self.contract.required_resources
                },
            },
        )
        return validate_scenario_plan(
            response,
            contract=self.contract,
            scenario_id=scenario_id,
            marker=marker,
        )

    def observe_scenario(
        self,
        scenario_id: str,
        plan_token: str,
        product_result: Mapping[str, Any],
    ) -> dict[str, Any]:
        response = self._request(
            "/v1/channel-journeys/observe",
            {
                "suiteRuntimeId": self.manifest.suite_runtime_id,
                "fixtureEpoch": self.manifest.fixture_epoch,
                "journeyId": self.contract.journey_id,
                "scenarioId": scenario_id,
                "planToken": plan_token,
                "productResult": dict(product_result),
            },
        )
        return validate_scenario_observation(
            response,
            contract=self.contract,
            scenario_id=scenario_id,
            plan_token=plan_token,
        )

    def cleanup(self) -> dict[str, Any]:
        response = _closed_mapping(
            self._request(
                "/v1/channel-journeys/cleanup",
                {
                    "suiteRuntimeId": self.manifest.suite_runtime_id,
                    "fixtureEpoch": self.manifest.fixture_epoch,
                    "journeyId": self.contract.journey_id,
                    "ownedResourcePrefix": self.manifest.cleanup[
                        "ownedResourcePrefix"
                    ],
                },
            ),
            "Journey cleanup",
            {"status", "releasedResources", "retainedResources"},
        )
        if response["status"] != "CLEANED":
            raise GateError("Lark Journey cleanup did not complete")
        if response["retainedResources"]:
            raise GateError("Lark Journey cleanup retained task-owned resources")
        return response

    def _request(
        self,
        path: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return _read_json_response(
            urllib.request.Request(
                f"{self.endpoint}{path}",
                data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                headers=headers,
                method="POST",
            ),
            timeout=WAIT_TIMEOUT_SECONDS,
            label=f"Journey control {path}",
        )


def validate_scenario_plan(
    value: object,
    *,
    contract: JourneyContract,
    scenario_id: str,
    marker: str,
) -> dict[str, Any]:
    plan = _closed_mapping(
        value,
        "Scenario plan",
        {
            "artifactKind",
            "schemaVersion",
            "journeyId",
            "scenarioId",
            "marker",
            "action",
            "receiver",
            "station",
            "planToken",
            "planDigest",
        },
    )
    unsigned = dict(plan)
    plan_digest = _text(unsigned.pop("planDigest"), "Scenario planDigest")
    if plan_digest != canonical_digest(unsigned):
        raise GateError("Scenario plan digest does not match its payload")
    if (
        plan["artifactKind"] != SCENARIO_PLAN_KIND
        or plan["schemaVersion"] != SCENARIO_PROTOCOL_VERSION
        or plan["journeyId"] != contract.journey_id
        or plan["scenarioId"] != scenario_id
        or plan["marker"] != marker
    ):
        raise GateError("Scenario plan identity is invalid")
    _text(plan["planToken"], "Scenario planToken")

    action = _closed_mapping(
        plan["action"],
        "Scenario action",
        {
            "kind",
            "actor",
            "targetResource",
            "content",
            "fileResource",
            "selector",
            "stationPath",
            "stationBody",
        },
    )
    action_kind = _text(action["kind"], "Scenario action.kind")
    if action_kind not in {
        "lark-send-text",
        "lark-send-post",
        "lark-send-image",
        "lark-send-file",
        "lark-reply",
        "station-channel-call",
        "desktop-click",
    }:
        raise GateError("Scenario action kind is unsupported")
    _text(action["actor"], "Scenario action.actor")
    _text(
        action["targetResource"],
        "Scenario action.targetResource",
        allow_empty=action_kind in {"station-channel-call", "desktop-click"},
    )
    _text(
        action["content"],
        "Scenario action.content",
        allow_empty=action_kind
        in {
            "lark-send-image",
            "lark-send-file",
            "station-channel-call",
            "desktop-click",
        },
    )
    _text(
        action["fileResource"],
        "Scenario action.fileResource",
        allow_empty=action_kind not in {"lark-send-image", "lark-send-file"},
    )
    _text(
        action["selector"],
        "Scenario action.selector",
        allow_empty=action_kind != "desktop-click",
    )
    station_path = _text(
        action["stationPath"],
        "Scenario action.stationPath",
        allow_empty=action_kind != "station-channel-call",
    )
    if station_path and not station_path.startswith(CHANNEL_API_PREFIX):
        raise GateError("Scenario Station action is outside Channel ownership")
    if not isinstance(action["stationBody"], Mapping):
        raise GateError("Scenario action.stationBody must be an object")
    if action_kind in {"lark-send-text", "lark-send-post", "lark-reply"}:
        if marker not in action["content"]:
            raise GateError("Scenario Lark action must carry the run marker")

    receiver = _closed_mapping(
        plan["receiver"],
        "Scenario receiver",
        {
            "kind",
            "actor",
            "chatResource",
            "marker",
            "selector",
            "timeoutSeconds",
        },
    )
    if receiver["kind"] not in {
        "lark-message",
        "lark-resource",
        "lark-absence",
        "desktop-dom",
    }:
        raise GateError("Scenario receiver kind is unsupported")
    for field in ("actor", "marker"):
        _text(receiver[field], f"Scenario receiver.{field}")
    if receiver["marker"] != marker:
        raise GateError("Scenario receiver marker differs from the run marker")
    _text(
        receiver["chatResource"],
        "Scenario receiver.chatResource",
        allow_empty=receiver["kind"] == "desktop-dom",
    )
    _text(
        receiver["selector"],
        "Scenario receiver.selector",
        allow_empty=receiver["kind"] != "desktop-dom",
    )
    timeout_seconds = receiver["timeoutSeconds"]
    if (
        not isinstance(timeout_seconds, int)
        or isinstance(timeout_seconds, bool)
        or not 1 <= timeout_seconds <= WAIT_TIMEOUT_SECONDS
    ):
        raise GateError("Scenario receiver.timeoutSeconds is invalid")

    station = _closed_mapping(
        plan["station"],
        "Scenario station",
        {
            "bindingResource",
            "bindingState",
            "requireTurn",
            "requireDelivery",
        },
    )
    _text(station["bindingResource"], "Scenario station.bindingResource")
    _text(station["bindingState"], "Scenario station.bindingState")
    if (
        not isinstance(station["requireTurn"], bool)
        or not isinstance(station["requireDelivery"], bool)
    ):
        raise GateError("Scenario Station requirements must be booleans")
    return plan


def validate_scenario_observation(
    value: object,
    *,
    contract: JourneyContract,
    scenario_id: str,
    plan_token: str,
) -> dict[str, Any]:
    observation = _closed_mapping(
        value,
        "Scenario observation",
        {
            "artifactKind",
            "schemaVersion",
            "journeyId",
            "scenarioId",
            "planToken",
            "turnId",
            "deliveryId",
            "executionCount",
            "sideEffectCount",
            "cleanup",
            "observationDigest",
        },
    )
    unsigned = dict(observation)
    digest = _text(
        unsigned.pop("observationDigest"),
        "Scenario observationDigest",
    )
    if digest != canonical_digest(unsigned):
        raise GateError("Scenario observation digest does not match its payload")
    if (
        observation["artifactKind"] != SCENARIO_OBSERVATION_KIND
        or observation["schemaVersion"] != SCENARIO_PROTOCOL_VERSION
        or observation["journeyId"] != contract.journey_id
        or observation["scenarioId"] != scenario_id
        or observation["planToken"] != plan_token
    ):
        raise GateError("Scenario observation identity is invalid")
    _text(observation["turnId"], "Scenario observation.turnId", allow_empty=True)
    _text(
        observation["deliveryId"],
        "Scenario observation.deliveryId",
        allow_empty=True,
    )
    _non_negative_int(
        observation["executionCount"],
        "Scenario observation.executionCount",
    )
    _non_negative_int(
        observation["sideEffectCount"],
        "Scenario observation.sideEffectCount",
    )
    cleanup = _closed_mapping(
        observation["cleanup"],
        "Scenario cleanup",
        {"status", "ownedResourceCount"},
    )
    if cleanup["status"] != "NAMESPACED":
        raise GateError("Scenario cleanup is not namespaced")
    _non_negative_int(
        cleanup["ownedResourceCount"],
        "Scenario cleanup.ownedResourceCount",
    )
    return observation


@dataclass(frozen=True)
class ScenarioEvidence:
    scenario_id: str
    product_action: dict[str, Any]
    receiver: dict[str, Any]
    station: dict[str, Any]
    cleanup: dict[str, Any]
    result_digest: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "scenarioId": self.scenario_id,
            "productAction": self.product_action,
            "receiver": self.receiver,
            "station": self.station,
            "cleanup": self.cleanup,
            "resultDigest": self.result_digest,
        }


class LiveJourneyRuntime:
    def __init__(
        self,
        manifest: SuiteManifest,
        contract: JourneyContract,
    ) -> None:
        self.manifest = manifest
        self.contract = contract
        manifest.actor("station-operator", "station-operator")
        self.station = StationChannelClient(
            endpoint=manifest.station.endpoint,
            token=manifest.capability_token("station-channel-api"),
            expected_commit=manifest.source.commit,
            expected_runtime_identity=manifest.station.runtime_identity,
        )
        self.sender = LarkCLIClient(
            manifest.actor("lark-sender", "lark-user")
        )
        self.receiver = LarkCLIClient(
            manifest.actor("lark-receiver", "lark-user")
        )
        self.desktop: DesktopObserver | None = None
        self.control = JourneyControlClient(manifest, contract)

    def preflight(self) -> None:
        self.station.verify_live_source()
        self.control.verify_live_source()
        self.sender.verify_authorization()
        self.receiver.verify_authorization()
        if "desktop-native" in self.contract.required_capabilities:
            self.desktop = DesktopObserver(
                self.manifest.actor("desktop-native", "desktop-native")
            )
        bindings = self.station.list_bindings()
        for resource_id in (
            resource
            for resource in self.contract.required_resources
            if resource.endswith("_binding")
        ):
            binding_id = self.manifest.resource(resource_id)
            if not any(
                binding.get("binding_id") == binding_id
                for binding in bindings
            ):
                raise GateError(
                    f"Suite binding {resource_id!r} is absent from Station"
                )

    def run_scenario(self, scenario_id: str) -> ScenarioEvidence:
        marker = (
            f"pt-{self.contract.journey_id.lower()}-"
            f"{scenario_id.rsplit('-', 1)[-1].lower()}-"
            f"{secrets.token_hex(8)}"
        )
        plan = self.control.prepare_scenario(scenario_id, marker)
        action = _mapping(plan["action"], "Scenario action")
        product_result = self._execute_action(
            action,
            scenario_id=scenario_id,
            marker=marker,
        )
        receiver_plan = _mapping(plan["receiver"], "Scenario receiver")
        receiver = self._validate_receiver(
            receiver_plan,
            product_result=product_result,
        )
        observation = self.control.observe_scenario(
            scenario_id,
            plan["planToken"],
            product_result,
        )
        station_plan = _mapping(plan["station"], "Scenario station")
        matched_events = self._validate_station(
            station_plan,
            observation,
            receiver_plan,
        )
        return ScenarioEvidence(
            scenario_id=scenario_id,
            product_action={
                "kind": action["kind"],
                "resourceIdHash": identity_hash(
                    product_result["resourceId"]
                ),
                "observedAt": product_result["observedAt"],
            },
            receiver={
                "kind": receiver_plan["kind"],
                "actor": receiver_plan["actor"],
                "messageIdHash": identity_hash(
                    receiver.get("message_id", "")
                ),
                "markerDigest": identity_hash(marker),
                "observedAt": receiver["observedAt"],
            },
            station={
                "bindingIdHash": identity_hash(
                    self.manifest.resource(station_plan["bindingResource"])
                ),
                "turnIdHash": identity_hash(observation["turnId"]),
                "deliveryIdHash": identity_hash(
                    observation["deliveryId"]
                ),
                "matchedEventCount": len(matched_events),
                "executionCount": observation["executionCount"],
                "sideEffectCount": observation["sideEffectCount"],
            },
            cleanup=dict(observation["cleanup"]),
            result_digest=observation["observationDigest"],
        )

    def cleanup(self) -> dict[str, Any]:
        return self.control.cleanup()

    def close(self) -> None:
        if self.desktop is not None:
            self.desktop.close()

    def _execute_action(
        self,
        action: dict[str, Any],
        *,
        scenario_id: str,
        marker: str,
    ) -> dict[str, Any]:
        kind = action["kind"]
        actor = action["actor"]
        idempotency_source = (
            f"{self.manifest.suite_runtime_id}:"
            f"{self.contract.journey_id}:{scenario_id}"
        )
        idempotency_key = f"pt-{hashlib.sha256(idempotency_source.encode()).hexdigest()[:40]}"
        started_at = time.time()
        if kind.startswith("lark-send-"):
            if actor != "lark-sender":
                raise GateError("Lark send action must use lark-sender")
            chat_id = self.manifest.resource(action["targetResource"])
            content = action["content"]
            if kind in {"lark-send-image", "lark-send-file"}:
                content = self.manifest.resource(action["fileResource"])
            result = self.sender.send(
                kind=kind,
                chat_id=chat_id,
                content=content,
                idempotency_key=idempotency_key,
            )
        elif kind == "lark-reply":
            if actor != "lark-sender":
                raise GateError("Lark reply action must use lark-sender")
            result = self.sender.reply(
                message_id=self.manifest.resource(
                    action["targetResource"]
                ),
                content=action["content"],
                idempotency_key=idempotency_key,
            )
        elif kind == "station-channel-call":
            if actor != "station-operator":
                raise GateError(
                    "Station Channel action must use station-operator"
                )
            body = self._resolve_action_value(action["stationBody"], marker)
            result = self.station.post_channel(
                action["stationPath"],
                _mapping(body, "resolved Station action body"),
            )
        elif kind == "desktop-click":
            if actor != "desktop-native" or self.desktop is None:
                raise GateError(
                    "Desktop action requires the Suite Native Desktop"
                )
            result = self.desktop.click(action["selector"])
        else:
            raise GateError(f"unsupported Scenario action {kind!r}")
        return {
            "resourceId": (
                str(result.get("messageId") or "")
                or str(result.get("delivery_id") or "")
                or str(result.get("binding_id") or "")
                or identity_hash(result)
            ),
            "messageId": str(result.get("messageId") or ""),
            "resultDigest": canonical_digest(result),
            "observedAt": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ",
                time.gmtime(started_at),
            ),
        }

    def _resolve_action_value(self, value: object, marker: str) -> object:
        if isinstance(value, Mapping):
            return {
                key: self._resolve_action_value(child, marker)
                for key, child in value.items()
            }
        if isinstance(value, list):
            return [
                self._resolve_action_value(child, marker)
                for child in value
            ]
        if isinstance(value, str):
            if value == "{marker}":
                return marker
            if value.startswith("resource:"):
                return self.manifest.resource(
                    value.removeprefix("resource:")
                )
        return value

    def _validate_receiver(
        self,
        receiver: dict[str, Any],
        *,
        product_result: Mapping[str, Any],
    ) -> dict[str, Any]:
        kind = receiver["kind"]
        marker = receiver["marker"]
        if kind in {"lark-message", "lark-resource"}:
            actor = receiver["actor"]
            client = self.receiver if actor == "lark-receiver" else self.sender
            message = client.wait_for_marker(
                chat_id=self.manifest.resource(receiver["chatResource"]),
                marker=marker,
                excluded_message_id=str(product_result.get("messageId") or ""),
                timeout=float(receiver["timeoutSeconds"]),
            )
            return {
                **message,
                "observedAt": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(),
                ),
            }
        if kind == "lark-absence":
            chat_id = self.manifest.resource(receiver["chatResource"])
            messages = self.receiver.list_messages(chat_id)
            rendered = json.dumps(messages, ensure_ascii=False, sort_keys=True)
            if marker in rendered:
                raise GateError("Lark negative receiver evidence found a forbidden result")
            return {
                "message_id": "",
                "observedAt": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(),
                ),
            }
        if self.desktop is None:
            raise GateError("Desktop receiver evidence has no Native Desktop client")
        observed = self.desktop.assert_visible(receiver["selector"], marker)
        return {
            "message_id": "",
            "observedAt": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ",
                time.gmtime(),
            ),
            **observed,
        }

    def _validate_station(
        self,
        station: dict[str, Any],
        observation: dict[str, Any],
        receiver: dict[str, Any],
    ) -> list[dict[str, Any]]:
        binding_id = self.manifest.resource(station["bindingResource"])
        bindings = self.station.list_bindings()
        binding = next(
            (
                item
                for item in bindings
                if item.get("binding_id") == binding_id
            ),
            None,
        )
        if not isinstance(binding, Mapping):
            raise GateError("Scenario Station binding is no longer available")
        observed_states = {
            str(binding.get("connection_state") or ""),
            str(binding.get("readiness") or ""),
            "enabled" if binding.get("enabled") is True else "disabled",
        }
        if station["bindingState"] not in observed_states:
            raise GateError(
                "Scenario Station binding state does not match owner readback"
            )
        turn_id = observation["turnId"]
        delivery_id = observation["deliveryId"]
        if station["requireTurn"] and not turn_id:
            raise GateError("Scenario requires a Station Turn identity")
        if station["requireDelivery"] and not delivery_id:
            raise GateError("Scenario requires a Station delivery identity")
        if not turn_id and not delivery_id:
            if observation["executionCount"] != 0:
                raise GateError(
                    "Scenario without a turn cannot report Agent execution"
                )
            return [dict(binding)]
        matched = self.station.wait_for_events(
            binding_id=binding_id,
            turn_id=turn_id,
            delivery_id=delivery_id,
            marker=receiver["marker"],
        )
        turn_ids = {
            event.get("turn_id")
            for event in matched
            if event.get("turn_id")
        }
        if observation["executionCount"] != len(turn_ids):
            raise GateError(
                "Station execution count does not match unique diagnostic turns"
            )
        return matched
