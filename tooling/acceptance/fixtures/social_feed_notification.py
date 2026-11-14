"""Parent-owned, source-bound one-shot loss at the original Federation receiver."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections.abc import Mapping

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked, EphemeralCapabilityHandler, EphemeralHandlerCleanup,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    _deployment_compose_project, _remote_transport,
)

CAPABILITY_ID = "social-feed-notification"
RUN_PATTERN = re.compile(r"^[0-9a-f]{16}$")
PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
RULE_FIELDS = frozenset({
    "runId", "profile", "commit", "station", "id", "actor", "sourceStation",
    "minimumHead", "issuedMillis", "expiresMillis", "effectCount", "observedHead",
    "frameSha256", "repairReads", "maxEvents", "maxThreads", "maxBytes", "bounded",
    "repairApplied", "repairAfterSequence", "repairVerifiedHead",
})

# The container receives rule bytes exclusively on stdin. Scope values are
# validated atoms; no Actor or credential becomes command text or argv.
CONTROL_SCRIPT = r"""
root=$1
operation=$2
case "$root" in /tmp/peers-social-acceptance-*) ;; *) exit 21 ;; esac
umask 077
if [ "$operation" = clear ] && [ ! -e "$root" ]; then
  [ ! -L "$root" ] || exit 22
  if [ ! -e "$root.retired" ]; then
    [ ! -L "$root.retired" ] || exit 22
    printf 'CLEARED'
    exit 0
  fi
  root="$root.retired"
  retired=1
else
  retired=0
fi
if [ "$operation" = arm ]; then
  mkdir -m 0700 "$root"
fi
[ -d "$root" ] && [ ! -L "$root" ] || exit 22
[ "$(stat -c '%a:%u' "$root")" = "700:$(id -u)" ] || exit 23
if [ -e "$root/control.lock" ]; then
  [ ! -L "$root/control.lock" ] || exit 24
  [ "$(stat -c '%a:%u:%F' "$root/control.lock")" = "600:$(id -u):regular empty file" ] || exit 24
fi
exec 9>"$root/control.lock"
flock -x 9
case "$operation" in
  arm)
    [ ! -e "$root/rule.json" ] && [ ! -L "$root/rule.json" ] || exit 25
    temporary=$(mktemp "$root/.parent-XXXXXXXX")
    trap 'rm -f "$temporary"' EXIT HUP INT TERM
    head -c 4097 > "$temporary"
    [ "$(stat -c '%s' "$temporary")" -le 4096 ] || exit 26
    mv "$temporary" "$root/rule.json"
    printf 'ARMED'
    ;;
  read)
    [ ! -L "$root/rule.json" ] || exit 27
    [ "$(stat -c '%a:%u:%F' "$root/rule.json")" = "600:$(id -u):regular file" ] || exit 27
    [ "$(stat -c '%s' "$root/rule.json")" -le 4096 ] || exit 27
    cat "$root/rule.json"
    ;;
  clear)
    if [ "$retired" = 0 ]; then
      [ ! -e "$root.retired" ] && [ ! -L "$root.retired" ] || exit 28
      mv "$root" "$root.retired"
      root="$root.retired"
    fi
    rm -f "$root/rule.json" "$root/control.lock"
    rmdir "$root"
    printf 'CLEARED'
    ;;
  *) exit 29 ;;
esac
"""


class SocialFeedNotificationHandler(EphemeralCapabilityHandler):
    """One run's retained service/source owner controls one genuine lost hint."""

    def __init__(self, *, deployment: Mapping[str, str], run_id: str,
                 profile: str, commit: str, station: str, source_station: str) -> None:
        if (not RUN_PATTERN.fullmatch(run_id)
                or not PROFILE_PATTERN.fullmatch(profile)
                or profile.lower().endswith("stable")
                or not COMMIT_PATTERN.fullmatch(commit)
                or not station or station == source_station or not source_station):
            raise ValueError("Social notification fixture identity is invalid")
        if deployment.get("PT_DEPLOY_ROLE") != "station":
            raise ValueError("Social notification fixture requires a reviewed Station")
        self._deployment = {field: deployment[field] for field in (
            "PT_DEPLOY_HOST", "PT_DEPLOY_USER", "PT_DEPLOY_PORT",
            "PT_DEPLOY_KNOWN_HOSTS_FILE", "PT_DEPLOY_ROLE",
            "PT_DEPLOY_RESTART_CMD", "PT_DEPLOY_BUILD_CMD",
        ) if field in deployment}
        self._project = _deployment_compose_project(self._deployment)
        self._container = f"{self._project}-station-1"
        self._scope = {
            "runId": run_id, "profile": profile, "commit": commit, "station": station,
        }
        self._source_station = source_station
        self._root = f"/tmp/peers-social-acceptance-{run_id}"
        self._rule: dict[str, object] | None = None
        self._root_may_exist = False
        self._closed = False

    @staticmethod
    def _unique_fields(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate Social notification observation field")
            value[key] = item
        return value

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("arm", "read", "clear")

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    def _transport(self, argv: list[str], *, deadline: float,
                   cancellation: threading.Event, input_text: str | None = None) -> str:
        remaining = deadline - time.monotonic()
        if cancellation.is_set() or remaining <= 0:
            raise TimeoutError("Social notification fixture deadline exceeded")
        completed = _remote_transport(self._deployment).run_argv(
            argv, timeout=min(30, remaining), check=True, input_text=input_text,
        )
        if cancellation.is_set() or time.monotonic() >= deadline:
            raise TimeoutError("Social notification fixture deadline exceeded")
        return completed.stdout.strip()

    def _verify_runtime(self, deadline: float, cancellation: threading.Event) -> None:
        template = (
            '{{index .Config.Labels "org.opencontainers.image.revision"}}|'
            '{{index .Config.Labels "com.docker.compose.project"}}|'
            '{{index .Config.Labels "com.docker.compose.service"}}|'
            '{{.State.Running}}|'
            '{{index .Config.Labels "io.peers-touch.social-acceptance"}}'
        )
        observed = self._transport(
            ["docker", "inspect", "--format", template, self._container],
            deadline=deadline, cancellation=cancellation,
        )
        if observed != f'{self._scope["commit"]}|{self._project}|station|true|1':
            raise ValueError("Social notification fixture runtime identity changed")

    def _control(self, operation: str, deadline: float,
                 cancellation: threading.Event, wire: str | None = None) -> str:
        return self._transport(
            ["docker", "exec", "-i", self._container, "sh", "-ceu", CONTROL_SCRIPT,
             "--", self._root, operation],
            deadline=deadline, cancellation=cancellation, input_text=wire,
        )

    def _observation(self, value: Mapping[str, object]) -> Mapping[str, object]:
        if self._rule is None or set(value) != RULE_FIELDS:
            raise ValueError("Social notification fixture observation is invalid")
        for field in (
            "runId", "profile", "commit", "station", "id", "actor", "sourceStation",
            "minimumHead", "issuedMillis", "expiresMillis",
        ):
            if value[field] != self._rule[field]:
                raise ValueError("Social notification fixture observation scope changed")
        for field in (
            "effectCount", "observedHead", "repairReads", "maxEvents", "maxThreads", "maxBytes",
            "repairAfterSequence", "repairVerifiedHead",
        ):
            if type(value[field]) is not int or value[field] < 0:
                raise ValueError("Social notification fixture counter is invalid")
        if (value["effectCount"] not in (0, 1) or type(value["bounded"]) is not bool
                or type(value["repairApplied"]) is not bool):
            raise ValueError("Social notification fixture result is invalid")
        if value["repairApplied"] and (
                value["effectCount"] != 1 or value["repairReads"] < 1
                or value["repairAfterSequence"] >= value["observedHead"]
                or value["repairVerifiedHead"] < value["observedHead"]):
            raise ValueError("Social notification fixture repair is not causal")
        frame = value["frameSha256"]
        if (not isinstance(frame, str)
                or (value["effectCount"] == 0 and frame != "")
                or (value["effectCount"] == 1
                    and (not re.fullmatch(r"[0-9a-f]{64}", frame)
                         or value["observedHead"] < self._rule["minimumHead"]))):
            raise ValueError("Social notification fixture frame observation is invalid")
        identity = {key: self._rule[key] for key in (
            "runId", "profile", "commit", "station", "actor", "sourceStation",
        )}
        return {
            "scopeSha256": hashlib.sha256(json.dumps(
                identity, sort_keys=True, separators=(",", ":"),
            ).encode()).hexdigest(),
            **{key: value[key] for key in (
                "effectCount", "observedHead", "frameSha256", "repairReads",
                "maxEvents", "maxThreads", "maxBytes", "bounded",
                "repairApplied", "repairAfterSequence", "repairVerifiedHead",
            )},
            "expired": int(time.time() * 1000) >= self._rule["expiresMillis"],
        }

    def invoke(self, operation: str, payload: Mapping[str, object], *,
               deadline_monotonic: float,
               cancellation: threading.Event) -> Mapping[str, object]:
        if self._closed or operation not in self.allowed_operations:
            raise EphemeralCapabilityBlocked(
                "Social notification fixture is unavailable", resource=CAPABILITY_ID,
            )
        try:
            self._verify_runtime(deadline_monotonic, cancellation)
            if operation == "arm":
                if self._rule is not None or set(payload) != {"actorPtid", "minimumHead"}:
                    raise ValueError("Social notification fixture arm scope is invalid")
                actor, minimum = payload["actorPtid"], payload["minimumHead"]
                if (not isinstance(actor, str) or not actor.startswith("ptid:")
                        or len(actor) > 512 or type(minimum) is not int
                        or minimum < 1 or minimum > (1 << 64) - 1):
                    raise ValueError("Social notification fixture Actor/head is invalid")
                now = int(time.time() * 1000)
                rule = {
                    **self._scope, "id": "lost-notification", "actor": actor,
                    "sourceStation": self._source_station, "minimumHead": minimum,
                    "issuedMillis": now, "expiresMillis": now + 90_000,
                    "effectCount": 0, "observedHead": 0, "frameSha256": "",
                    "repairReads": 0, "maxEvents": 0, "maxThreads": 0,
                    "maxBytes": 0, "bounded": True,
                    "repairApplied": False, "repairAfterSequence": 0, "repairVerifiedHead": 0,
                }
                self._root_may_exist = True
                if self._control("arm", deadline_monotonic, cancellation,
                                 json.dumps(rule, separators=(",", ":"))) != "ARMED":
                    raise ValueError("Social notification fixture arm was not acknowledged")
                self._rule = rule
                return {"armed": True}
            if payload:
                raise ValueError("Social notification fixture operation takes no payload")
            if operation == "read":
                raw = self._control("read", deadline_monotonic, cancellation)
                if len(raw.encode()) > 4096:
                    raise ValueError("Social notification fixture observation is too large")
                value = json.loads(raw, object_pairs_hook=self._unique_fields)
                if not isinstance(value, dict):
                    raise ValueError("Social notification fixture observation is invalid")
                return self._observation(value)
            if self._control("clear", deadline_monotonic, cancellation) != "CLEARED":
                raise ValueError("Social notification fixture cleanup was not acknowledged")
            self._root_may_exist = False
            self._rule = None
            return {"cleared": True}
        except EphemeralCapabilityBlocked:
            raise
        except Exception as error:
            raise EphemeralCapabilityBlocked(
                "Social notification fixture operation failed", resource=CAPABILITY_ID,
            ) from error

    def project_response(self, operation: str,
                         response: Mapping[str, object]) -> Mapping[str, object]:
        result = response.get("result")
        if response.get("status") == "OK":
            allowed = {
                "arm": {"armed"}, "clear": {"cleared"},
                "read": {
                    "scopeSha256", "effectCount", "observedHead", "frameSha256",
                    "repairReads", "maxEvents", "maxThreads", "maxBytes", "bounded", "expired",
                    "repairApplied", "repairAfterSequence", "repairVerifiedHead",
                },
            }[operation]
            if not isinstance(result, Mapping) or set(result) != allowed:
                raise ValueError("Social notification fixture response is invalid")
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        if self._root_may_exist:
            try:
                self._verify_runtime(deadline_monotonic, threading.Event())
                if self._control("clear", deadline_monotonic, threading.Event()) != "CLEARED":
                    return False
                self._root_may_exist = False
                self._rule = None
            except Exception:
                return False
        self._closed = True
        return True

    def close(self) -> EphemeralHandlerCleanup:
        successful = self.quarantine("close", deadline_monotonic=time.monotonic() + 30)
        return EphemeralHandlerCleanup(
            closed=successful, secrets_zeroized=True,
        )
