"""Parent-owned opaque Relay observation at the original Public Social Suite."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import threading
import time
from uuid import uuid4

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked, EphemeralCapabilityHandler, EphemeralHandlerCleanup,
)
from tooling.acceptance.core.evidence_store import current_artifact_ref, write_current_artifact
from tooling.acceptance.fixtures.social_relay_packet import observe, validate_legs
from tooling.acceptance.provisioners.posix_service_runtime import mint_posix_relay_operator_token
from tooling.acceptance.provisioners.relay_attachment import relay_json_request

CAPABILITY_ID = "social-relay-opaque"
WORKER = Path(__file__).with_name("social_relay_capture_worker.py")


class _DeadlineTransport:
    """Keep original token/runtime helpers inside this operation's deadline."""
    def __init__(self, transport, deadline, cancellation):
        self.transport, self.deadline, self.cancellation = transport, deadline, cancellation

    def run_argv(self, argv, *, timeout, **options):
        remaining = SocialRelayCaptureHandler.remaining(self.deadline, self.cancellation)
        return self.transport.run_argv(argv, timeout=min(timeout, remaining), **options)


def tcp_endpoint(address: str) -> tuple[str, int]:
    match = re.fullmatch(r"/ip([46])/([^/]+)/tcp/([0-9]+)", address)
    if match is None:
        raise ValueError("observed Relay connection is not a plain TCP leg")
    return match[2], int(match[3])


class SocialRelayCaptureHandler(EphemeralCapabilityHandler):
    def __init__(self, *, config, inventory: dict, trust_anchor: bytes,
                 probe: Path, probe_digest: str, repo_root: Path) -> None:
        if (inventory.get("artifactKind") != "social-relay-preparation"
                or len(inventory.get("stations", {})) != 2
                or config.role != "relay"
                or config.environment_name.lower().endswith("stable")
                or not re.fullmatch(r"[0-9a-f]{40}", inventory.get("sourceCommit", ""))):
            raise ValueError("capture requires the prepared non-stable Social Relay")
        self.config, self.inventory, self.trust_anchor = config, inventory, trust_anchor
        self.probe, self.probe_digest, self.repo_root = probe, probe_digest, repo_root
        self.root = f"/tmp/peers-social-capture-{uuid4().hex}"
        self.worker_source = WORKER.read_text()
        self.worker_digest = hashlib.sha256(self.worker_source.encode()).hexdigest()
        self._may_exist = False
        self._closed = False
        self._markers: tuple[bytes, ...] = ()
        self._before: dict | None = None
        self._finished = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("arm", "finish", "clear")

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    @staticmethod
    def remaining(deadline: float, cancellation: threading.Event) -> float:
        remaining = deadline - time.monotonic()
        if cancellation.is_set() or remaining <= 0:
            raise TimeoutError("capture operation deadline exceeded")
        return remaining

    def _remote(self, argv, *, deadline, cancellation, wire=None) -> str:
        result = self.config.transport().run_argv(
            argv, input_text=wire, check=False,
            timeout=min(12, self.remaining(deadline, cancellation)),
        )
        self.remaining(deadline, cancellation)
        if result.returncode:
            raise ValueError("owned Relay capture transport failed")
        return result.stdout

    def _control(self, operation, *, deadline, cancellation, payload=None) -> dict:
        raw = self._remote(
            ["sudo", "-n", "python3", "-c", self.worker_source, operation, self.root],
            deadline=deadline, cancellation=cancellation,
            wire=json.dumps(payload, separators=(",", ":")) if payload else None,
        )
        return json.loads(raw)

    def _namespace(self, *, deadline, cancellation) -> dict:
        runtime = self.inventory["relayRuntime"]
        pid, = runtime["processIds"]
        # Actual executable/container/PID identity is checked at every arm and
        # finish. The original parent retains the remote source lease.
        script = r"""
import json,pathlib,subprocess,sys
expected=json.load(sys.stdin)
container=json.loads(subprocess.check_output(
    ["docker","inspect",expected["containerId"]],text=True,timeout=5))[0]
labels=container["Config"].get("Labels") or {}
if (container["State"]["Pid"] != expected["pid"] or not container["State"]["Running"]
    or labels.get("org.opencontainers.image.revision") != expected["commit"]
    or labels.get("com.docker.compose.project") != expected["project"]
    or labels.get("com.docker.compose.service") != "relay"):
    raise ValueError("runtime differs")
raw=pathlib.Path("/proc/"+str(expected["pid"])+"/stat").read_text()
fields=raw[raw.rindex(")")+2:].split()
if fields[0] == "Z": raise ValueError("runtime stopped")
print(json.dumps({"pid":expected["pid"],"startTicks":fields[19]}))
"""
        return json.loads(self._remote(
            ["python3", "-c", script], deadline=deadline, cancellation=cancellation,
            wire=json.dumps({
                "containerId": runtime["containerId"], "pid": pid,
                "commit": self.inventory["sourceCommit"], "project": self.config.compose_project,
            }),
        ))

    def _snapshot(self, *, deadline, cancellation) -> dict:
        namespace = self._namespace(deadline=deadline, cancellation=cancellation)
        if hashlib.sha256(self.probe.read_bytes()).hexdigest() != self.probe_digest:
            raise ValueError("source-bound route observer executable changed")
        result = subprocess.run(
            [str(self.probe)], input=json.dumps({
                "origin": self.config.public_base_url, "ca": self.trust_anchor.decode("ascii"),
                "relayPeerId": self.inventory["relayPeerId"],
                "stations": {
                    value["stationPeerId"]: value["attachment"]["route_generation"]
                    for value in self.inventory["stations"].values()
                },
            }), capture_output=True, text=True, check=False,
            timeout=min(12, self.remaining(deadline, cancellation)),
        )
        self.remaining(deadline, cancellation)
        if result.returncode:
            raise ValueError("prepared signed Circuit routes could not be verified")
        routes = json.loads(result.stdout)
        token = mint_posix_relay_operator_token(self.config, transport=_DeadlineTransport(
            self.config.transport(), deadline, cancellation,
        ))
        try:
            status, stats = relay_json_request(
                self.config.public_base_url + "/api/v1/relay/stats", method="GET",
                token=token, trust_anchor=self.trust_anchor,
                timeout_seconds=min(8, self.remaining(deadline, cancellation)),
            )
        finally:
            token = ""
        if status != 200:
            raise ValueError("authenticated transport metadata is unavailable")
        connections, legs = [], []
        for record in self.inventory["stations"].values():
            peer = record["stationPeerId"]
            route = routes[peer]
            candidates = []
            for connection in stats["connections"]:
                if connection["node_peer_id"] != route["nodePeerId"]:
                    continue
                try:
                    local, local_port = tcp_endpoint(connection["local_multiaddr"])
                    remote, remote_port = tcp_endpoint(connection["remote_multiaddr"])
                except ValueError:
                    continue
                if local_port == self.config.libp2p_port:
                    candidates.append((connection, {
                        "relayAddress": local, "relayPort": local_port,
                        "stationAddress": remote, "stationPort": remote_port,
                    }))
            if len(candidates) != 1:
                raise ValueError("prepared Node does not own exactly one bound Relay TCP leg")
            connection, leg = candidates[0]
            connections.append({"stationPeerId": peer, "connectionId": connection["id"],
                                "route": route})
            legs.append(leg)
        validate_legs(legs)
        return {"namespace": namespace, "legs": legs, "connections": connections}

    def invoke(self, operation: str, payload: dict, *, deadline_monotonic: float,
               cancellation: threading.Event) -> dict:
        if self._closed or operation not in self.allowed_operations:
            raise EphemeralCapabilityBlocked("Relay capture is unavailable", resource=CAPABILITY_ID)
        try:
            options = {"deadline": deadline_monotonic, "cancellation": cancellation}
            if operation == "arm":
                markers = payload.get("markers")
                if (self._before is not None or set(payload) != {"markers"}
                        or not isinstance(markers, list) or not 2 <= len(markers) <= 4
                        or any(not isinstance(marker, str) or not 32 <= len(marker) <= 1024
                               for marker in markers) or len(set(markers)) != len(markers)):
                    raise ValueError("Relay capture marker scope is invalid")
                self._before = self._snapshot(**options)
                self._markers = tuple(marker.encode() for marker in markers)
                self._may_exist = True
                result = self._control("arm", **options, payload={
                    "namespace": self._before["namespace"], "legs": self._before["legs"],
                    "sourceDigest": self.worker_digest, "workerSource": self.worker_source,
                })
                if result.get("armed") is not True:
                    raise ValueError("capture readiness was not acknowledged")
                self._before["processes"] = result
                return {"armed": True}
            if payload:
                raise ValueError("Relay capture operation takes no caller observations")
            if operation == "clear":
                result = self._control("clear", **options)
                if result != {"cleared": True}:
                    raise ValueError("capture cleanup was not acknowledged")
                self._may_exist = False
                self._markers = ()
                return result
            if self._before is None or not self._markers or self._finished:
                raise ValueError("capture was not armed")
            captured = self._control("finish", **options)
            self._finished = True
            wire = base64.b64decode(captured.pop("pcap"), validate=True)
            relative = f"runtime/social-relay-capture/{uuid4().hex}.pcap"
            write_current_artifact(relative, wire, repo_root=self.repo_root)
            reference = current_artifact_ref(relative, repo_root=self.repo_root).to_dict()
            if reference["sha256"] != hashlib.sha256(wire).hexdigest():
                raise ValueError("immutable capture bytes changed")
            if (captured.get("stopped") is not True or captured.get("exitCode") != 0
                    or captured.get("reason") != "requested" or captured.get("kernelDrops") != 0):
                raise ValueError("capture did not flush and stop without packet loss")
            after = self._snapshot(**options)
            if (after["namespace"] != self._before["namespace"]
                    or after["legs"] != self._before["legs"]):
                raise ValueError("capture namespace or TCP legs changed")
            for before, current in zip(self._before["connections"], after["connections"]):
                if (before["stationPeerId"] != current["stationPeerId"]
                        or before["connectionId"] != current["connectionId"]
                        or any(before["route"][key] != current["route"][key] for key in (
                            "nodePeerId", "routeId", "generation", "addresses", "innerSpkiSha256"))):
                    raise ValueError("capture signed route or authenticated connection changed")
            observation = observe(wire, legs=after["legs"], markers=self._markers)
            evidence = {
                "artifactKind": "social-relay-opaque-observation",
                "sourceCommit": self.inventory["sourceCommit"], "runId": self.inventory["runId"],
                "before": self._before, "after": after, "capture": captured,
                "observation": observation, "captureArtifact": reference,
                "markerDigests": [hashlib.sha256(marker).hexdigest() for marker in self._markers],
            }
            relative = relative.removesuffix(".pcap") + ".json"
            write_current_artifact(relative, (json.dumps(evidence, sort_keys=True) + "\n").encode(),
                                   repo_root=self.repo_root)
            return {**observation, "evidence": current_artifact_ref(relative, repo_root=self.repo_root).to_dict()}
        except EphemeralCapabilityBlocked:
            raise
        except Exception as error:
            raise EphemeralCapabilityBlocked(
                "Source-bound Relay capture operation failed", resource=CAPABILITY_ID,
            ) from error

    def project_response(self, operation: str, response: dict) -> dict:
        if response.get("status") == "OK":
            result = response.get("result")
            fields = {"arm": {"armed"}, "clear": {"cleared"}, "finish": {
                "captureSha256", "captureBytes", "records", "directionBytes",
                "plaintextObserved", "evidence",
            }}[operation]
            if not isinstance(result, dict) or set(result) != fields:
                raise ValueError("capture projection fields are invalid")
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        if self._may_exist:
            try:
                value = self._control("clear", deadline=deadline_monotonic,
                                      cancellation=threading.Event())
                if value != {"cleared": True}:
                    return False
                self._may_exist = False
            except Exception:
                return False
        self._markers = ()
        self._closed = True
        return True

    def close(self) -> EphemeralHandlerCleanup:
        return EphemeralHandlerCleanup(
            closed=self.quarantine("close", deadline_monotonic=time.monotonic() + 15),
            secrets_zeroized=True,
        )
