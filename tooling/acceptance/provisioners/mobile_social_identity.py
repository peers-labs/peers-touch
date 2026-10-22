"""Parent-owned retained Actor Identity preparation for the iOS Social Gate."""
from __future__ import annotations

import base64
from collections.abc import Callable, Mapping
from pathlib import Path
import threading
import time
from typing import Any

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralHandlerCleanup,
)
from tooling.acceptance.provisioners.preset_actor import (
    _identity_key_path,
    _read_private_seed,
    resolve_existing_preset_actor_identity,
)
from tooling.acceptance.fixtures.chat_native_actors import ACTOR_ACCOUNTS, ACTOR_PASSWORD

CAPABILITY_ID = "mobile.social.actor-identity"


class MobileSocialIdentityHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        *,
        session_factory: Callable[[str], Any],
        station_url: str,
        station_peer_id: str,
    ) -> None:
        self._session_factory = session_factory
        self._station_url = station_url
        self._station_peer_id = station_peer_id
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("prepare",)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if (
            self._closed or operation != "prepare"
            or set(payload) != {"clientId", "sessionId", "role"}
            or payload["clientId"] not in {"sim-ios", "sim-ios-peer"}
            or payload["role"] not in {"alice", "bob", "eve"}
            or not isinstance(payload["sessionId"], str)
        ):
            raise EphemeralCapabilityBlocked(
                "iOS Social identity preparation scope is invalid",
                resource=CAPABILITY_ID,
            )
        if cancellation.is_set() or time.monotonic() >= deadline_monotonic:
            raise TimeoutError("iOS Social identity preparation expired")
        role = str(payload["role"])
        session = self._session_factory(str(payload["clientId"]))
        sessions = session.transport.request("GET", "/sessions")
        if not isinstance(sessions, list):
            raise EphemeralCapabilityBlocked(
                "iOS Social Appium session inventory is invalid",
                resource=CAPABILITY_ID,
            )
        bound = next(
            (item for item in sessions if isinstance(item, Mapping)
             and (item.get("id") or item.get("sessionId")) == payload["sessionId"]),
            None,
        )
        capabilities = bound.get("capabilities") if bound else None
        if not isinstance(capabilities, Mapping) or (
            capabilities.get("udid") or capabilities.get("appium:udid")
        ) != session.device.identifier:
            raise EphemeralCapabilityBlocked(
                "iOS Social session does not match its owned Simulator",
                resource=CAPABILITY_ID,
            )
        identity = resolve_existing_preset_actor_identity(
            station_url=self._station_url,
            station_peer_id=self._station_peer_id,
            role=role,
            account=ACTOR_ACCOUNTS[role],
            password=ACTOR_PASSWORD,
            device_policy="persistent-acceptance",
        )
        from tooling.acceptance.provisioners.mobile_simulator import (
            MobileSimulatorAppiumCapabilityHandler,
        )
        seed = _read_private_seed(
            _identity_key_path(
                Path(identity.fixture.root), self._station_peer_id,
                identity.actor.ptid,
            ),
            resource=f"fixture-identity:{role}",
        )
        session.session_id = str(payload["sessionId"])
        try:
            result = session.call_action(
                "runtime.prepareActorIdentity",
                {
                    "storageKey": MobileSimulatorAppiumCapabilityHandler
                    ._mobile_actor_identity_storage_key(
                        self._station_peer_id, identity.actor.ptid,
                    ),
                    "seedBase64": base64.b64encode(seed).decode("ascii"),
                },
            )
        finally:
            seed[:] = b"\x00" * len(seed)
            session.session_id = ""
        if result != {"prepared": True}:
            raise EphemeralCapabilityBlocked(
                "iOS Social identity preparation was not acknowledged",
                resource=CAPABILITY_ID,
            )
        return {"prepared": True}

    def project_response(
        self, operation: str, response: Mapping[str, object],
    ) -> Mapping[str, object]:
        if operation != "prepare":
            raise ValueError("iOS Social identity response is invalid")
        projected = dict(response)
        if projected.get("status") == "OK":
            if projected.get("result") != {"prepared": True}:
                raise ValueError("iOS Social identity result is invalid")
            projected["result"] = {"prepared": True}
        return projected

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        self._closed = True
        return True

    def close(self) -> EphemeralHandlerCleanup:
        self._closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)
