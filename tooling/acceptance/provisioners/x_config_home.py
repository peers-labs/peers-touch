"""Exact-source Home X Config runtime and private operator authority."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import math
import os
import re
import shlex
import stat
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlparse

from tooling.acceptance.core import (
    BlockedError,
    EnvironmentProvisioner,
    ProvisioningError,
    ProvisioningState,
    REPO_ROOT,
)
from tooling.acceptance.core.launch_context import (
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
)


ENVIRONMENT_ID = "x-config-home-runtime"
CAPABILITY_ID = ENVIRONMENT_ID
OPERATOR_GATE_ID = "x-config-home-operator-login-e2e"
PUBLICATION_GATE_ID = "x-config-home-publication-e2e"
GATE_IDS = frozenset({OPERATOR_GATE_ID, PUBLICATION_GATE_ID})
OPERATOR_OPERATIONS = (
    "service-authority",
    "operator-session",
    "restart-with-session",
    "operator-session-after-restart",
    "csrf-denial",
    "replay-denial",
    "warm-timing",
    "git-auth-isolation",
    "cleanup",
)
PUBLICATION_OPERATIONS = (
    "service-authority",
    "operator-session",
    "publish-reviewed-catalog",
    "public-readback",
    "client-verification",
    "logout",
    "restart-after-logout",
    "revocation-readback",
    "git-auth-isolation",
    "cleanup",
)
CONFIG_FIELDS = {
    "service_origin",
    "ssh_host",
    "ssh_port",
    "ssh_user",
    "known_hosts_file",
    "runtime_root",
    "env_repository",
    "operator_session_file",
    "catalog_file",
    "public_keyring_file",
    "data_repository",
    "data_branch",
}
SESSION_FIELDS = {
    "session_cookie",
    "csrf_token",
    "provider",
    "provider_subject",
    "journey_started_at",
    "admin_auth_tree_before",
}
LOCAL_TIMING_FIELDS = (
    "operator_attempt_store_ms",
    "operator_attempt_read_ms",
    "operator_session_commit_ms",
    "operator_session_read_ms",
)


REMOTE_SCRIPT = r"""
import json, os, pathlib, stat, subprocess, sys

request = json.load(sys.stdin)
root = pathlib.Path(request["runtimeRoot"])
action = request["action"]
container_name = "peers-x-config-api"

def inspect_runtime():
    current = (root / "current").resolve(strict=True)
    release = json.loads((current / "release.json").read_text())
    container = json.loads(subprocess.check_output(
        ["docker", "inspect", container_name], text=True
    ))[0]
    mounts = [
        item for item in container["Mounts"]
        if item.get("Destination") == "/var/lib/x-config"
    ]
    if len(mounts) != 1:
        raise RuntimeError("operator state mount missing")
    state = (root / "state").resolve(strict=True)
    state_info = state.stat()
    database_metadata = subprocess.check_output(
        [
            "docker", "exec", container_name, "stat", "-c", "%a %u %g",
            "/var/lib/x-config/operator-auth.sqlite",
        ],
        text=True,
    ).strip().split()
    if len(database_metadata) != 3:
        raise RuntimeError("operator database metadata invalid")
    health = (container.get("State", {}).get("Health") or {}).get("Status", "")
    return {
        "appCommit": release.get("appCommit", ""),
        "envCommit": release.get("envCommit", ""),
        "releaseId": current.name,
        "containerRunning": container.get("State", {}).get("Running") is True,
        "healthStatus": health,
        "operatorMountSource": str(pathlib.Path(mounts[0]["Source"]).resolve()),
        "operatorMountRW": mounts[0].get("RW") is True,
        "stateDirectoryMode": stat.S_IMODE(state_info.st_mode),
        "stateDirectoryUid": state_info.st_uid,
        "stateDirectoryGid": state_info.st_gid,
        "databaseExists": True,
        "databaseMode": int(database_metadata[0], 8),
        "databaseUid": int(database_metadata[1]),
        "databaseGid": int(database_metadata[2]),
    }

if action == "inspect":
    result = inspect_runtime()
elif action == "restart":
    subprocess.check_call(
        ["docker", "restart", "--time", "20", container_name],
        stdout=subprocess.DEVNULL,
    )
    result = {"restarted": True}
elif action == "auth-evidence":
    logs = subprocess.check_output(
        [
            "docker", "logs", "--since", request["journeyStartedAt"],
            container_name,
        ],
        text=True,
        stderr=subprocess.STDOUT,
    )
    timing_names = {
        "operator-attempt-store",
        "operator-attempt-read",
        "oauth-redeem",
        "operator-session-commit",
        "operator-session-read",
    }
    timings = {name: [] for name in timing_names}
    events = {
        "callbackRejected": 0,
        "csrfRejected": 0,
        "logoutSucceeded": 0,
    }
    for line in logs.splitlines():
        if "x_config_timing " in line:
            fields = dict(
                item.split("=", 1)
                for item in line.split()
                if "=" in item
            )
            metric = fields.get("metric", "")
            if metric in timing_names and fields.get("outcome") == "success":
                timings[metric].append(float(fields["duration_ms"]))
        if "x_config_auth event=callback outcome=rejected" in line:
            events["callbackRejected"] += 1
        if "x_config_auth event=csrf outcome=rejected" in line:
            events["csrfRejected"] += 1
        if "x_config_auth event=logout outcome=success" in line:
            events["logoutSucceeded"] += 1
    result = {"timings": timings, "events": events}
else:
    raise RuntimeError("unsupported X Config Home operation")
print(json.dumps(result, sort_keys=True))
"""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProvisioningError("X Config request redirected")


def private_file(path: Path) -> Path:
    resolved = path.expanduser().resolve(strict=True)
    mode = resolved.stat().st_mode
    if (
        resolved.is_relative_to(REPO_ROOT)
        or not stat.S_ISREG(mode)
        or mode & 0o077
    ):
        raise ProvisioningError("X Config private input requires mode 0600 outside Git")
    return resolved


def private_document(path: Path) -> dict:
    value = json.loads(private_file(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ProvisioningError("X Config private input must be an object")
    return value


def regular_external_file(path: Path) -> Path:
    resolved = path.expanduser().resolve(strict=True)
    if resolved.is_relative_to(REPO_ROOT) or not resolved.is_file():
        raise ProvisioningError("reviewed external file is unavailable")
    return resolved


def service_origin(raw: str) -> str:
    parsed = urlparse(raw)
    hostname = parsed.hostname or ""
    if (
        parsed.scheme != "https"
        or "." not in hostname
        or hostname.endswith(".vercel.app")
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ProvisioningError(
            "service origin must be the private-config HTTPS root URL"
        )
    return raw.rstrip("/")


def git_identity(repository: Path) -> tuple[str, str]:
    commit = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    status = subprocess.run(
        ("git", "status", "--porcelain", "--untracked-files=all"),
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if commit.returncode or status.returncode or status.stdout.strip():
        raise ProvisioningError("X Config env repository must be tracked and clean")
    return commit.stdout.strip(), "clean"


def percentile95(values: list[float]) -> float:
    if not values or any(
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
        or value < 0
        for value in values
    ):
        raise ProvisioningError("X Config timing samples are invalid")
    ordered = sorted(float(value) for value in values)
    index = max(0, math.ceil(len(ordered) * 0.95) - 1)
    return ordered[index]


class HomeRuntimeHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        gate_id: str,
        config: dict,
        source_commit: str,
        env_commit: str,
        verifier: Path | None,
        temporary: Path,
    ) -> None:
        self.gate_id = gate_id
        self.config = config
        self.source_commit = source_commit
        self.env_commit = env_commit
        self.verifier = verifier
        self.temporary = temporary
        self.session: dict = {}
        self.catalog: dict = {}
        self.secrets: dict[str, bytearray] = {}
        self.publication: dict = {}
        self.snapshot = b""
        self.runtime: dict = {}
        self.closed = False
        self.next_operation = 0

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (
            OPERATOR_OPERATIONS
            if self.gate_id == OPERATOR_GATE_ID
            else PUBLICATION_OPERATIONS
        )

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return tuple(
            value.decode()
            for value in self.secrets.values()
            if value
        )

    def prepare(self) -> None:
        session = private_document(Path(self.config["operator_session_file"]))
        if set(session) != SESSION_FIELDS:
            raise ProvisioningError("operator session evidence fields are invalid")
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})",
            str(session["journey_started_at"]),
        ):
            raise ProvisioningError("operator journey timestamp is invalid")
        tree = session["admin_auth_tree_before"]
        if (
            not isinstance(tree, dict)
            or any(
                not isinstance(path, str)
                or not path.startswith("x-config/admin-auth/")
                or not isinstance(digest, str)
                or not re.fullmatch(r"[0-9a-f]{40}", digest)
                for path, digest in tree.items()
            )
        ):
            raise ProvisioningError("operator Git baseline is invalid")
        self.secrets = {
            "session": bytearray(str(session["session_cookie"]).encode()),
            "csrf": bytearray(str(session["csrf_token"]).encode()),
        }
        if any(
            not value or b"\r" in value or b"\n" in value
            for value in self.secrets.values()
        ):
            raise ProvisioningError("operator session authority is unavailable")
        self.session = {
            key: value
            for key, value in session.items()
            if key not in {"session_cookie", "csrf_token"}
        }
        self.catalog = private_document(Path(self.config["catalog_file"]))
        if set(self.catalog) != {
            "schema_version",
            "channel",
            "endpoints",
            "releases",
        }:
            raise ProvisioningError("reviewed catalog fields are invalid")
        self.runtime = self._inspect_runtime()

    def _ssh(self, action: str) -> dict:
        remote_command = "python3 -c " + shlex.quote(REMOTE_SCRIPT)
        completed = subprocess.run(
            (
                "ssh",
                "-p",
                str(self.config["ssh_port"]),
                "-o",
                "BatchMode=yes",
                "-o",
                "IdentitiesOnly=yes",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "UserKnownHostsFile=" + self.config["known_hosts_file"],
                self.config["ssh_user"] + "@" + self.config["ssh_host"],
                remote_command,
            ),
            input=json.dumps(
                {
                    "action": action,
                    "runtimeRoot": self.config["runtime_root"],
                    "journeyStartedAt": self.session.get(
                        "journey_started_at",
                        "1970-01-01T00:00:00Z",
                    ),
                }
            ),
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
        if completed.returncode:
            raise ProvisioningError(f"Home runtime operation failed: {action}")
        try:
            value = json.loads(completed.stdout)
        except (TypeError, ValueError) as error:
            raise ProvisioningError(
                f"Home runtime response is invalid: {action}"
            ) from error
        if not isinstance(value, dict):
            raise ProvisioningError(f"Home runtime response is invalid: {action}")
        return value

    def _inspect_runtime(self) -> dict:
        value = self._ssh("inspect")
        state_root = str(
            (Path(self.config["runtime_root"]) / "state").as_posix()
        )
        if (
            value.get("appCommit") != self.source_commit
            or value.get("envCommit") != self.env_commit
            or value.get("containerRunning") is not True
            or value.get("healthStatus") != "healthy"
            or value.get("operatorMountSource") != state_root
            or value.get("operatorMountRW") is not True
            or value.get("stateDirectoryMode") != 0o700
            or value.get("stateDirectoryUid") != 101
            or value.get("stateDirectoryGid") != 101
            or value.get("databaseExists") is not True
            or value.get("databaseMode") != 0o600
            or value.get("databaseUid") != 101
            or value.get("databaseGid") != 101
            or not re.fullmatch(r"[0-9a-f]{9}-[0-9a-f]{7}", str(value.get("releaseId", "")))
        ):
            raise ProvisioningError("Home runtime identity or operator state mount differs")
        return value

    def _http(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: object | None = None,
        authenticated: bool = False,
        csrf: str | None = None,
    ) -> tuple[int, Mapping[str, str], bytes]:
        headers = {"Accept": "application/json"}
        cookies = []
        if authenticated:
            cookies.extend(
                (
                    "peers_xcfg_session=" + self.secrets["session"].decode(),
                    "peers_xcfg_csrf=" + self.secrets["csrf"].decode(),
                )
            )
        if cookies:
            headers["Cookie"] = "; ".join(cookies)
        if csrf is not None:
            headers["X-CSRF-Token"] = csrf
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.config["service_origin"] + path,
            data=body,
            headers=headers,
            method=method,
        )
        try:
            response = urllib.request.build_opener(NoRedirect()).open(
                request,
                timeout=20,
            )
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(512 * 1024 + 1)
            if len(raw) > 512 * 1024:
                raise ProvisioningError("X Config response exceeds the bound")
            return response.code, response.headers, raw

    def _wait_ready(self) -> dict:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                code, _, _ = self._http("/healthz")
                if code == 200:
                    return self._inspect_runtime()
            except (OSError, ProvisioningError, urllib.error.URLError):
                pass
            time.sleep(2)
        raise ProvisioningError("Home X Config did not become ready after restart")

    def _restart(self) -> dict:
        self._ssh("restart")
        self.runtime = self._wait_ready()
        return {
            "restarted": True,
            "releaseId": self.runtime["releaseId"],
            "databaseRetained": True,
        }

    def _session_read(self) -> tuple[dict, float]:
        started = time.monotonic()
        code, headers, raw = self._http(
            "/api/admin/auth/session",
            authenticated=True,
        )
        elapsed_ms = (time.monotonic() - started) * 1000
        if code != 200:
            raise ProvisioningError("operator session is unavailable")
        value = json.loads(raw)
        if (
            value.get("authenticated") is not True
            or value.get("provider") != self.session["provider"]
            or value.get("provider_subject") != self.session["provider_subject"]
        ):
            raise ProvisioningError("operator session identity differs")
        timing = headers.get("Server-Timing", "")
        match = re.search(r"(?:^|,\s*)operator-session-read;dur=([0-9.]+)", timing)
        if not match:
            raise ProvisioningError("operator session timing is unavailable")
        return {
            "authenticated": True,
            "provider": value["provider"],
            "timingExposed": True,
        }, float(match.group(1)) if match else elapsed_ms

    def _csrf_denial(self) -> dict:
        for csrf in (None, "invalid-csrf"):
            code, _, raw = self._http(
                "/api/admin/catalog/validate",
                method="POST",
                payload={},
                authenticated=True,
                csrf=csrf,
            )
            if (
                code != 403
                or json.loads(raw).get("error") != "operator_csrf_invalid"
            ):
                raise ProvisioningError("operator CSRF negative control failed")
        return {"missingDenied": True, "invalidDenied": True}

    def _replay_denial(self) -> dict:
        evidence = self._ssh("auth-evidence")
        rejected = int(evidence.get("events", {}).get("callbackRejected", 0))
        if rejected < 1:
            raise ProvisioningError("operator callback replay evidence is unavailable")
        return {
            "callbackReplayDenied": True,
            "rejectedCallbackCount": rejected,
        }

    def _git_tree(self, prefix: str) -> dict[str, str]:
        completed = subprocess.run(
            (
                "gh",
                "api",
                "-X",
                "GET",
                "repos/" + self.config["data_repository"] + "/git/trees/"
                + self.config["data_branch"],
                "-f",
                "recursive=1",
            ),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if completed.returncode:
            raise ProvisioningError("GitHub repository tree is unavailable")
        try:
            tree = json.loads(completed.stdout)["tree"]
        except (KeyError, TypeError, ValueError) as error:
            raise ProvisioningError("GitHub repository tree is invalid") from error
        return {
            item["path"]: item["sha"]
            for item in tree
            if (
                isinstance(item, dict)
                and item.get("type") == "blob"
                and isinstance(item.get("path"), str)
                and item["path"].startswith(prefix)
                and isinstance(item.get("sha"), str)
            )
        }

    def _git_auth_isolation(self) -> dict:
        current = self._git_tree("x-config/admin-auth/")
        if current != self.session["admin_auth_tree_before"]:
            raise ProvisioningError("X Config admin-auth Git paths changed")
        return {
            "adminAuthMutationCount": 0,
            "adminAuthPathCount": len(current),
        }

    def _timing(self) -> dict:
        evidence = self._ssh("auth-evidence")
        raw_timings = evidence.get("timings")
        if not isinstance(raw_timings, dict):
            raise ProvisioningError("operator timing evidence is unavailable")
        session_reads = [self._session_read()[1] for _ in range(20)]
        source_names = {
            "operator_attempt_store_ms": "operator-attempt-store",
            "operator_attempt_read_ms": "operator-attempt-read",
            "oauth_redeem_ms": "oauth-redeem",
            "operator_session_commit_ms": "operator-session-commit",
        }
        values = {}
        for field, metric in source_names.items():
            samples = raw_timings.get(metric)
            if not isinstance(samples, list) or len(samples) < 20:
                raise ProvisioningError(
                    f"operator timing metric requires twenty samples: {metric}"
                )
            values[field] = [float(value) for value in samples[-20:]]
        values["operator_session_read_ms"] = session_reads
        p95 = {
            field: round(percentile95(values[field]), 3)
            for field in (*source_names, "operator_session_read_ms")
        }
        if any(p95[field] >= 1000 for field in LOCAL_TIMING_FIELDS):
            raise ProvisioningError("X Config local timing P95 exceeds one second")
        return {
            "sampleCount": 20,
            "p95Milliseconds": p95,
            "brokerTimingReportedSeparately": True,
        }

    def _publish(self) -> dict:
        channel = str(self.catalog["channel"])
        before = self._git_tree("x-config/")
        code, _, raw = self._http(
            "/api/admin/catalog?channel=" + channel,
            authenticated=True,
        )
        if code == 404:
            base_revision = ""
            prior_sequence = 0
        elif code == 200:
            base_revision = json.loads(raw)["revision"]
            history_code, _, history_raw = self._http(
                "/api/admin/publications?channel=" + channel + "&limit=1",
                authenticated=True,
            )
            if history_code != 200:
                raise ProvisioningError("publication history is unavailable")
            publications = json.loads(history_raw).get("publications", [])
            prior_sequence = int(publications[0]["sequence"]) if publications else 0
        else:
            raise ProvisioningError("catalog read is unavailable")
        csrf = self.secrets["csrf"].decode()
        code, _, raw = self._http(
            "/api/admin/catalog",
            method="PUT",
            payload={"base_revision": base_revision, "catalog": self.catalog},
            authenticated=True,
            csrf=csrf,
        )
        if code != 200:
            raise ProvisioningError("catalog save failed")
        draft = json.loads(raw)
        code, _, raw = self._http(
            "/api/admin/publications",
            method="POST",
            payload={
                "channel": channel,
                "base_revision": draft["revision"],
                "acknowledged_digest": draft["content_sha256"],
            },
            authenticated=True,
            csrf=csrf,
        )
        if code != 201:
            raise ProvisioningError("direct publication failed")
        publication = json.loads(raw)
        sequence = publication.get("sequence")
        revision = publication.get("repository_revision")
        if (
            publication.get("channel") != channel
            or type(sequence) is not int
            or sequence <= prior_sequence
            or not re.fullmatch(
                r"[0-9a-f]{64}",
                str(publication.get("envelope_sha256", "")),
            )
            or not re.fullmatch(r"[0-9a-f]{40}", str(revision or ""))
        ):
            raise ProvisioningError("publication receipt is invalid")
        required_paths = {
            f"x-config/publications/{channel}/current.json",
            f"x-config/publications/{channel}/{sequence:020d}.json",
            f"x-config/snapshots/{channel}/{sequence:020d}.pb",
        }
        commit = subprocess.run(
            (
                "gh",
                "api",
                "repos/" + self.config["data_repository"] + "/commits/" + revision,
            ),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if commit.returncode:
            raise ProvisioningError("publication Git commit is unavailable")
        changed = {
            item.get("filename")
            for item in json.loads(commit.stdout).get("files", [])
            if isinstance(item, dict)
        }
        if changed != required_paths:
            raise ProvisioningError("publication commit changed unexpected Git paths")
        after = self._git_tree("x-config/")
        observed_changes = {
            path
            for path in set(before) | set(after)
            if before.get(path) != after.get(path)
        }
        allowed_changes = required_paths | {f"x-config/catalogs/{channel}.yaml"}
        if not required_paths <= observed_changes or not observed_changes <= allowed_changes:
            raise ProvisioningError("publication tree changed unrelated Git paths")
        self.publication = publication
        return {
            "channel": channel,
            "sequence": sequence,
            "priorSequence": prior_sequence,
            "repositoryRevision": revision,
            "changedPaths": sorted(changed),
            "envelopeSha256": publication["envelope_sha256"],
        }

    def _readback(self) -> dict:
        channel = self.publication["channel"]
        sequence = self.publication["sequence"]
        bodies = []
        caches = []
        etags = []
        for path in (
            f"/channels/{channel}/latest.pb",
            f"/snapshots/{channel}-{sequence:020d}.pb",
        ):
            code, headers, raw = self._http(path)
            cache = headers.get("Cache-Control", "").lower()
            if (
                code != 200
                or headers.get_content_type() != "application/protobuf"
                or headers.get("X-Content-Type-Options") != "nosniff"
                or "public" not in cache
            ):
                raise ProvisioningError("public snapshot response contract failed")
            bodies.append(raw)
            caches.append(cache)
            etags.append(headers.get("ETag", "").strip('"'))
        digest = hashlib.sha256(bodies[0]).hexdigest()
        if (
            bodies[0] != bodies[1]
            or digest != self.publication["envelope_sha256"]
            or etags != [digest, digest]
            or "must-revalidate" not in caches[0]
            or "immutable" not in caches[1]
        ):
            raise ProvisioningError("public snapshot bytes or cache policy differ")
        self.snapshot = bodies[0]
        (self.temporary / "snapshot.pb").write_bytes(self.snapshot)
        return {
            "envelopeSha256": digest,
            "latestAndImmutableEqual": True,
            "credentialFreePublicRead": True,
        }

    def _verify_client(self) -> dict:
        if self.verifier is None or not self.snapshot:
            raise ProvisioningError("client verifier inputs are unavailable")
        completed = subprocess.run(
            (str(self.verifier),),
            cwd=REPO_ROOT,
            input=json.dumps(
                {
                    "snapshot_file": str(self.temporary / "snapshot.pb"),
                    "keyring_file": self.config["public_keyring_file"],
                    "channel": self.publication["channel"],
                    "expected_sequence": self.publication["sequence"],
                }
            ),
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )
        if completed.returncode:
            raise ProvisioningError("shared X Config client verification failed")
        try:
            value = json.loads(completed.stdout)
        except ValueError as error:
            raise ProvisioningError("client verification response is invalid") from error
        for key in (
            "signatureVerified",
            "tamperDenied",
            "wrongChannelDenied",
            "expiryDenied",
            "rollbackDenied",
        ):
            if value.get(key) is not True:
                raise ProvisioningError("client verification checks are incomplete")
        return value

    def _logout(self) -> dict:
        code, _, _ = self._http(
            "/api/admin/auth/logout",
            method="POST",
            payload={},
            authenticated=True,
            csrf=self.secrets["csrf"].decode(),
        )
        if code != 204:
            raise ProvisioningError("operator logout failed")
        return {"revoked": True}

    def _revocation_readback(self) -> dict:
        code, _, raw = self._http(
            "/api/admin/auth/session",
            authenticated=True,
        )
        if (
            code != 401
            or json.loads(raw).get("error") != "operator_session_required"
        ):
            raise ProvisioningError("revoked operator session became valid")
        return {"revokedAfterRestart": True}

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        operations = self.allowed_operations
        if (
            self.closed
            or payload
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
            or self.next_operation >= len(operations)
            or operation != operations[self.next_operation]
        ):
            raise ProvisioningError("Home X Config lifecycle operation is unavailable")
        if operation == "service-authority":
            result = {
                "sourceCommit": self.runtime["appCommit"],
                "envCommit": self.runtime["envCommit"],
                "releaseId": self.runtime["releaseId"],
                "origin": self.config["service_origin"],
                "operatorStatePersistent": True,
            }
        elif operation in {"operator-session", "operator-session-after-restart"}:
            result, _ = self._session_read()
        elif operation in {"restart-with-session", "restart-after-logout"}:
            result = self._restart()
        elif operation == "csrf-denial":
            result = self._csrf_denial()
        elif operation == "replay-denial":
            result = self._replay_denial()
        elif operation == "warm-timing":
            result = self._timing()
        elif operation == "git-auth-isolation":
            result = self._git_auth_isolation()
        elif operation == "publish-reviewed-catalog":
            result = self._publish()
        elif operation == "public-readback":
            result = self._readback()
        elif operation == "client-verification":
            result = self._verify_client()
        elif operation == "logout":
            result = self._logout()
        elif operation == "revocation-readback":
            result = self._revocation_readback()
        else:
            cleanup = self.close()
            result = {
                "closed": cleanup.closed,
                "secretsZeroized": cleanup.secrets_zeroized,
            }
        self.next_operation += 1
        return result

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        return self.close().closed

    def close(self) -> EphemeralHandlerCleanup:
        if self.closed:
            return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)
        for value in self.secrets.values():
            value[:] = b"\x00" * len(value)
            value.clear()
        self.secrets.clear()
        self.session.clear()
        self.catalog.clear()
        self.config.clear()
        self.publication.clear()
        self.runtime.clear()
        self.snapshot = b""
        self.closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)


class XConfigHomeProvisioner(EnvironmentProvisioner):
    environment_id = ENVIRONMENT_ID

    def __init__(self, contract) -> None:
        super().__init__(contract)
        self.handler: HomeRuntimeHandler | None = None

    def provision(self, gate_id: str):
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id not in GATE_IDS:
                raise ProvisioningError("unsupported Home X Config Gate")
            if self._manifest.workspace_digest != "clean":
                raise ProvisioningError("Home X Config proof requires clean exact source")
            config_path = os.environ.get("X_CONFIG_HOME_ACCEPTANCE_CONFIG", "")
            if not config_path:
                raise BlockedError(
                    reason="PRIVATE_HOME_X_CONFIG_INPUTS_REQUIRED",
                    resource=self.environment_id,
                )
            config = private_document(Path(config_path))
            if set(config) != CONFIG_FIELDS:
                raise ProvisioningError("Home X Config configuration fields are invalid")
            config["service_origin"] = service_origin(str(config["service_origin"]))
            if (
                not isinstance(config["ssh_port"], int)
                or isinstance(config["ssh_port"], bool)
                or not 1 <= config["ssh_port"] <= 65535
                or not re.fullmatch(r"[A-Za-z0-9.-]+", str(config["ssh_host"]))
                or not re.fullmatch(r"[A-Za-z0-9._-]+", str(config["ssh_user"]))
                or not str(config["runtime_root"]).startswith("/")
                or not re.fullmatch(
                    r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",
                    str(config["data_repository"]),
                )
                or not re.fullmatch(r"[A-Za-z0-9._/-]+", str(config["data_branch"]))
            ):
                raise ProvisioningError("Home X Config runtime identity is invalid")
            known_hosts = regular_external_file(Path(config["known_hosts_file"]))
            config["known_hosts_file"] = str(known_hosts)
            for key in (
                "operator_session_file",
                "catalog_file",
            ):
                config[key] = str(private_file(Path(config[key])))
            keyring = Path(config["public_keyring_file"]).expanduser().resolve(strict=True)
            if not keyring.is_file() or not keyring.is_relative_to(REPO_ROOT):
                raise ProvisioningError("X Config public keyring is unavailable")
            config["public_keyring_file"] = str(keyring)
            env_repository = Path(config["env_repository"]).expanduser().resolve(strict=True)
            if not env_repository.is_dir():
                raise ProvisioningError("X Config env repository is unavailable")
            env_commit, _ = git_identity(env_repository)
            config["env_repository"] = str(env_repository)
            temporary = tempfile.TemporaryDirectory(prefix="x-config-home-")
            self.register_cleanup(
                "publication-verification-artifacts",
                temporary.cleanup,
            )
            verifier = None
            if gate_id == PUBLICATION_GATE_ID:
                target = Path(temporary.name) / "cargo"
                completed = subprocess.run(
                    (
                        "cargo",
                        "build",
                        "--manifest-path",
                        "packages/x-config-core/Cargo.toml",
                        "--locked",
                        "--example",
                        "verify_production",
                        "--target-dir",
                        str(target),
                    ),
                    cwd=REPO_ROOT,
                    capture_output=True,
                    timeout=600,
                    check=False,
                )
                if completed.returncode:
                    raise ProvisioningError("X Config client verifier build failed")
                verifier = target / "debug/examples/verify_production"
            self.handler = HomeRuntimeHandler(
                gate_id,
                config,
                self._manifest.source_commit,
                env_commit,
                verifier,
                Path(temporary.name),
            )
            self.register_cleanup(
                "home-runtime-authority",
                self.handler.close,
            )
            self.handler.prepare()
            self._manifest = dataclasses.replace(
                self._manifest,
                state=ProvisioningState.PROVISIONED,
                clients=(),
                cleanup_resources=self.contract.cleanup.resources,
            )
            return self._ready(self._manifest)
        except (
            BlockedError,
            ProvisioningError,
            OSError,
            ValueError,
            TypeError,
            KeyError,
            subprocess.SubprocessError,
        ) as error:
            return self._blocked(
                self._manifest,
                reason=str(error),
                resource=self.environment_id,
            )

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id not in GATE_IDS
            or required_capabilities != (CAPABILITY_ID,)
            or self.handler is None
            or self._manifest is None
            or not self._manifest.is_ready()
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
        ):
            raise ProvisioningError("Home X Config launch identity is incomplete")
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=1900,
            quiesce_timeout_seconds=40,
        )
        context.register_capability(CAPABILITY_ID, self.handler)
        return context
