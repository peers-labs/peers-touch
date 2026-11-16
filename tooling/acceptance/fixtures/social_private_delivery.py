"""Source-bound private Social outbox and real Federation ingress observations."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
from collections.abc import Mapping

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked, EphemeralCapabilityHandler, EphemeralHandlerCleanup,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    _deployment_compose_project, _remote_transport,
)
from tooling.acceptance.fixtures.social_feed_notification import (
    CONTROL_SCRIPT, PROFILE_PATTERN,
)

CAPABILITY_ID = "social-private-delivery"
PROBE = Path(__file__).with_name("social_private_delivery_probe.go")
MUTATIONS = (
    "duplicate", "reordered", "expired", "hash-conflict",
    "untrusted-station", "wrong-station", "wrong-actor",
)

# This parent owns only its digest-bound executable inside the original DB
# container. Database credentials are read by the probe from container env.
CONTROL = r"""
root=$1
operation=$2
digest=$3
case "$root" in /tmp/peers-social-delivery-*) ;; *) exit 21 ;; esac
umask 077
if [ "$operation" = clear ] && [ ! -e "$root" ]; then
  [ ! -L "$root" ] || exit 22
  printf 'CLEARED'
  exit 0
fi
if [ "$operation" = install ]; then
  [ ! -e "$root" ] && [ ! -L "$root" ] || exit 22
  mkdir -m 0700 "$root"
fi
[ -d "$root" ] && [ ! -L "$root" ] || exit 23
[ "$(stat -c '%a:%u' "$root")" = "700:$(id -u)" ] || exit 23
if [ "$operation" = install ]; then
  printf '%s' "$digest" > "$root/binding"
  base64 -d > "$root/probe"
  chmod 0700 "$root/probe"
fi
[ ! -L "$root/binding" ] || exit 24
[ "$(stat -c '%a:%u:%F' "$root/binding")" = "600:$(id -u):regular file" ] || exit 24
[ "$(cat "$root/binding")" = "$digest" ] || exit 25
if [ "$operation" = clear ]; then
  if [ -e "$root/probe" ] || [ -L "$root/probe" ]; then
    [ -f "$root/probe" ] && [ ! -L "$root/probe" ] || exit 24
    [ "$(stat -c '%u' "$root/probe")" = "$(id -u)" ] || exit 24
    rm "$root/probe"
  fi
  rm "$root/binding"
  rmdir "$root"
  printf 'CLEARED'
  exit 0
fi
[ ! -L "$root/probe" ] || exit 24
[ "$(stat -c '%a:%u:%F' "$root/probe")" = "700:$(id -u):regular file" ] || exit 24
[ "$(sha256sum "$root/probe" | cut -d ' ' -f 1)" = "$digest" ] || exit 25
case "$operation" in
  install) printf 'INSTALLED' ;;
  invoke) exec "$root/probe" ;;
  *) exit 26 ;;
esac
"""


class SocialPrivateDeliveryHandler(EphemeralCapabilityHandler):
    def __init__(self, *, repo_root: Path, source_commit: str, run_id: str,
                 source_deployment: Mapping[str, str],
                 receiver_deployment: Mapping[str, str],
                 source_station: str, receiver_station: str,
                 receiver_origin: str, receiver_actor: str, outsider_actor: str,
                 receiver_profile: str) -> None:
        if (not re.fullmatch(r"[0-9a-f]{40}", source_commit)
                or not re.fullmatch(r"[0-9a-f]{16}", run_id)
                or source_station == receiver_station
                or not source_station or not receiver_station
                or not PROFILE_PATTERN.fullmatch(receiver_profile)
                or receiver_profile.lower().endswith("stable")
                or any(not actor.startswith("ptid:") for actor in (receiver_actor, outsider_actor))
                or receiver_actor == outsider_actor):
            raise ValueError("private delivery fixture binding is invalid")
        self.repo_root = repo_root
        self._deployments = {
            "source": dict(source_deployment), "receiver": dict(receiver_deployment),
        }
        self._projects = {
            role: _deployment_compose_project(values)
            for role, values in self._deployments.items()
        }
        if any(values.get("PT_DEPLOY_ROLE") != "station"
               or values.get("PT_DEV_RESET_POLICY") == "stable"
               for values in self._deployments.values()):
            raise ValueError("private delivery fixture requires reviewed Stations")
        self._scope = {
            "sourceCommit": source_commit, "runId": run_id,
            "sourceStation": source_station, "targetStation": receiver_station,
            "receiverOrigin": receiver_origin, "targetActor": receiver_actor,
            "outsiderActor": outsider_actor,
        }
        self._root = f"/tmp/peers-social-delivery-{run_id}"
        self._hold_scope = {
            "runId": run_id, "profile": receiver_profile, "commit": source_commit,
            "station": receiver_station,
        }
        self._hold_root = f"/tmp/peers-social-acceptance-{run_id}"
        self._hold_rule: dict | None = None
        self._hold_attempted = False
        self._source_digest = hashlib.sha256(PROBE.read_bytes()).hexdigest()
        self._installed: dict[str, str] = {}
        self._attempted: dict[str, str] = {}
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("outbox", "snapshot", "replay", "hold", "read-hold", "release")

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    @staticmethod
    def _remaining(deadline: float, cancellation: threading.Event) -> float:
        remaining = deadline - time.monotonic()
        if cancellation.is_set() or remaining <= 0:
            raise TimeoutError("private delivery fixture deadline exceeded")
        return remaining

    def _remote(self, role: str, argv: list[str], *, deadline: float,
                cancellation: threading.Event, wire: str | None = None) -> str:
        result = _remote_transport(self._deployments[role]).run_argv(
            argv, input_text=wire, check=False,
            timeout=min(25, self._remaining(deadline, cancellation)),
        )
        if result.returncode:
            raise ValueError("private delivery fixture remote operation failed")
        self._remaining(deadline, cancellation)
        return result.stdout.strip()

    def _verify(self, role: str, *, acceptance: bool = False, **options) -> None:
        template = (
            '{{index .Config.Labels "org.opencontainers.image.revision"}}|'
            '{{index .Config.Labels "com.docker.compose.project"}}|'
            '{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}'
        )
        if acceptance:
            template += (
                '|{{index .Config.Labels "io.peers-touch.social-acceptance"}}'
                '{{range .Config.Env}}{{if eq (index (split . "=") 0) '
                '"PT_SOCIAL_ACCEPTANCE_RUN_ID"}}|{{index (split . "=") 1}}{{end}}{{end}}'
                '{{range .Config.Env}}{{if eq (index (split . "=") 0) '
                '"PT_SOCIAL_ACCEPTANCE_PROFILE"}}|{{index (split . "=") 1}}{{end}}{{end}}'
            )
        project = self._projects[role]
        observed = self._remote(role, [
            "docker", "inspect", "--format", template, f"{project}-station-1",
        ], **options)
        expected = f'{self._scope["sourceCommit"]}|{project}|station|true'
        if acceptance:
            expected += f'|1|{self._hold_scope["runId"]}|{self._hold_scope["profile"]}'
        if observed != expected:
            raise ValueError("private delivery fixture Station source changed")

    def _hold_control(self, operation: str, **options) -> str:
        return self._remote("receiver", [
            "docker", "exec", "-i", f'{self._projects["receiver"]}-station-1',
            "sh", "-ceu", CONTROL_SCRIPT, "--", self._hold_root, operation,
        ], **options)

    def _hold_observation(self, value: dict) -> dict:
        if self._hold_rule is None or set(value) != set(self._hold_rule):
            raise ValueError("private delivery hold observation is invalid")
        for key in self._hold_rule.keys() - {"effectCount", "frameSha256"}:
            if value[key] != self._hold_rule[key]:
                raise ValueError("private delivery hold scope changed")
        count, frame = value["effectCount"], value["frameSha256"]
        if (type(count) is not int or not 0 <= count <= 2**32 - 1
                or not isinstance(frame, str)
                or (count == 0 and frame != "")
                or (count > 0 and not re.fullmatch(r"[0-9a-f]{64}", frame))):
            raise ValueError("private delivery hold frame is invalid")
        return {
            "sourceCommit": self._scope["sourceCommit"], "runId": self._scope["runId"],
            "scopeSha256": hashlib.sha256(json.dumps(
                self._hold_rule, sort_keys=True, separators=(",", ":"),
            ).encode()).hexdigest(),
            "effectCount": count, "frameSha256": frame,
            "expired": int(time.time() * 1000) >= value["expiresMillis"],
        }

    def _invoke_hold(self, operation: str, payload: dict, **options) -> dict:
        if payload:
            raise ValueError("private delivery hold accepts only its parent-bound scope")
        self._verify("receiver", acceptance=True, **options)
        if operation == "hold":
            if self._hold_rule is not None or self._hold_attempted:
                raise ValueError("private delivery hold is already owned")
            issued = int(time.time() * 1000)
            self._hold_rule = {
                **self._hold_scope, "id": "private-post-hold",
                "actor": self._scope["targetActor"],
                "sourceStation": self._scope["sourceStation"],
                "issuedMillis": issued, "expiresMillis": issued + 90_000,
                "effectCount": 0, "frameSha256": "",
            }
            self._hold_attempted = True
            if self._hold_control("arm", wire=json.dumps(
                self._hold_rule, separators=(",", ":"),
            ), **options) != "ARMED":
                raise ValueError("private delivery hold was not acknowledged")
            return {"held": True}
        if operation == "read-hold":
            value = json.loads(self._hold_control("read", **options),
                               object_pairs_hook=self._unique_fields)
            return self._hold_observation(value)
        if self._hold_attempted:
            if self._hold_control("clear", **options) != "CLEARED":
                raise ValueError("private delivery hold release was not acknowledged")
            self._hold_attempted = False
        return {"released": True}

    @staticmethod
    def _unique_fields(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate private delivery hold field")
            value[key] = item
        return value

    def _control(self, role: str, operation: str, digest: str, **options) -> str:
        return self._remote(role, [
            "docker", "exec", "-i", f"{self._projects[role]}-postgres-1",
            "sh", "-ceu", CONTROL, "--", self._root, operation, digest,
        ], **options)

    def prepare(self) -> None:
        """Build and install once, before any Suite Scenario starts."""
        options = {"deadline": time.monotonic() + 180, "cancellation": threading.Event()}
        binaries: dict[str, tuple[bytes, str]] = {}
        with tempfile.TemporaryDirectory(prefix="social-private-delivery-") as temporary:
            for role in self._deployments:
                self._verify(role, **options)
                machine = self._remote(role, ["uname", "-m"], **options)
                arch = {"aarch64": "arm64", "x86_64": "amd64"}.get(machine)
                if arch is None:
                    raise ValueError("private delivery fixture architecture is unavailable")
                if arch not in binaries:
                    output = Path(temporary) / arch
                    if hashlib.sha256(PROBE.read_bytes()).hexdigest() != self._source_digest:
                        raise ValueError("private delivery fixture source changed")
                    built = subprocess.run(
                        ["go", "build", "-o", str(output), str(PROBE)],
                        cwd=self.repo_root / "apps/station/frame",
                        env={**os.environ, "GOOS": "linux", "GOARCH": arch, "CGO_ENABLED": "0"},
                        capture_output=True, text=True, check=False,
                        timeout=self._remaining(**options),
                    )
                    if built.returncode:
                        raise ValueError("private delivery fixture compilation failed")
                    data = output.read_bytes()
                    binaries[arch] = data, hashlib.sha256(data).hexdigest()
                data, digest = binaries[arch]
                self._remote(role, ["docker", "exec", f"{self._projects[role]}-postgres-1",
                                    "ls", "-d", "/tmp"], **options)
                self._attempted[role] = digest
                observed = self._control(role, "install", digest, **options,
                                         wire=base64.b64encode(data).decode("ascii"))
                if observed != "INSTALLED":
                    raise ValueError("private delivery fixture installation was not acknowledged")
                self._installed[role] = digest

    def invoke(self, operation: str, payload: dict, *, deadline_monotonic: float,
               cancellation: threading.Event) -> dict:
        if self._closed or set(self._installed) != {"source", "receiver"}:
            raise EphemeralCapabilityBlocked("private delivery fixture is unavailable",
                                             resource=CAPABILITY_ID)
        try:
            options = {"deadline": deadline_monotonic, "cancellation": cancellation}
            if operation in {"hold", "read-hold", "release"}:
                return self._invoke_hold(operation, payload, **options)
            expected = {"postId", "mutation"} if operation == "replay" else {"postId"}
            if (operation not in self.allowed_operations or set(payload) != expected
                    or not isinstance(payload.get("postId"), str)
                    or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", payload["postId"])
                    or (operation == "replay" and payload["mutation"] not in MUTATIONS)):
                raise ValueError("private delivery fixture operation scope is invalid")
            role = "receiver" if operation == "snapshot" else "source"
            self._verify(role, **options)
            if hashlib.sha256(PROBE.read_bytes()).hexdigest() != self._source_digest:
                raise ValueError("private delivery fixture source changed")
            observed = json.loads(self._control(
                role, "invoke", self._installed[role], **options,
                wire=json.dumps({**self._scope, **payload, "operation": operation},
                                separators=(",", ":")),
            ))
            if (observed.get("sourceCommit") != self._scope["sourceCommit"]
                    or observed.get("runId") != self._scope["runId"]
                    or observed.get("operation") != operation
                    or observed.get("postIdSha256")
                    != hashlib.sha256(payload["postId"].encode()).hexdigest()):
                raise ValueError("private delivery fixture response identity changed")
            return {**observed, "probeSourceSha256": self._source_digest,
                    "probeExecutableSha256": self._installed[role]}
        except Exception as error:
            raise EphemeralCapabilityBlocked("source-bound private delivery observation failed",
                                             resource=CAPABILITY_ID) from error

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        complete = True
        if self._hold_attempted:
            try:
                result = self._hold_control("clear", deadline=deadline_monotonic,
                                            cancellation=threading.Event())
                if result != "CLEARED":
                    raise ValueError("private delivery hold cleanup was not acknowledged")
                self._hold_attempted = False
            except Exception:
                complete = False
        for role, digest in list(self._attempted.items()):
            try:
                result = self._control(role, "clear", digest, deadline=deadline_monotonic,
                                       cancellation=threading.Event())
                if result != "CLEARED":
                    raise ValueError("private delivery fixture cleanup was not acknowledged")
                self._attempted.pop(role)
                self._installed.pop(role, None)
            except Exception:
                complete = False
        if complete:
            self._scope.clear()
            self._hold_scope.clear()
            self._hold_rule = None
            self._deployments.clear()
            self._closed = True
        return complete

    def project_response(self, operation: str, response: Mapping[str, object]) -> dict:
        if response.get("status") == "OK":
            if operation in {"hold", "read-hold", "release"}:
                value = response.get("result")
                expected = (
                    {"sourceCommit", "runId", "scopeSha256", "effectCount", "frameSha256", "expired"}
                    if operation == "read-hold"
                    else {"held"} if operation == "hold" else {"released"}
                )
                if not isinstance(value, Mapping) or set(value) != expected:
                    raise ValueError("private delivery hold projection is invalid")
                if operation != "read-hold" and next(iter(value.values())) is not True:
                    raise ValueError("private delivery hold acknowledgment is invalid")
                if operation == "read-hold" and (
                    type(value["effectCount"]) is not int or type(value["expired"]) is not bool
                    or not re.fullmatch(r"[0-9a-f]{64}", str(value["scopeSha256"]))
                ):
                    raise ValueError("private delivery hold result is invalid")
                return dict(response)
            expected = {
                "sourceCommit", "runId", "postIdSha256", "operation",
                "probeSourceSha256", "probeExecutableSha256",
            }
            if operation == "snapshot":
                expected.add("projections")
            else:
                expected |= {"originalFrameSha256", "outboxRows", "outboxState", "attemptCount"}
            if operation == "replay":
                expected |= {"mutation", "sentFrameSha256", "disposition", "errorCode"}
            value = response.get("result")
            if not isinstance(value, Mapping) or set(value) != expected:
                raise ValueError("private delivery fixture projection is invalid")
            for key in expected:
                if key.endswith("Sha256") and (
                    not isinstance(value[key], str)
                    or not re.fullmatch(r"[0-9a-f]{64}", value[key])
                ):
                    raise ValueError("private delivery fixture digest is invalid")
        return dict(response)

    def close(self) -> EphemeralHandlerCleanup:
        complete = self.quarantine("close", deadline_monotonic=time.monotonic() + 55)
        return EphemeralHandlerCleanup(closed=complete, secrets_zeroized=complete)
