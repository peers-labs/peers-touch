#!/usr/bin/env python3
"""Windows-native runtime adapter for the canonical remote deploy command."""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import re
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.core.source_sync import load_env_file
from tooling.acceptance.remote_platform import RemotePlatform
from tooling.acceptance.transports.ssh import SshTarget, SshTransport


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_RELATIVE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")
_HEALTH_PATH = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$")
_ROLE = {"station", "relay"}


def _rotate_service_log(
    log_path,
    *,
    timeout_seconds=15.0,
    retry_interval_seconds=0.25,
    monotonic=time.monotonic,
    sleep=time.sleep,
):
    if not log_path.is_file():
        return
    previous_log_path = log_path.with_suffix(".previous.log")
    deadline = monotonic() + timeout_seconds
    while True:
        try:
            previous_log_path.unlink(missing_ok=True)
            log_path.replace(previous_log_path)
            return
        except FileNotFoundError:
            return
        except PermissionError as error:
            if monotonic() >= deadline:
                raise RuntimeError(
                    "timed out waiting for Windows service log release"
                ) from error
            sleep(retry_interval_seconds)


def _required(values: dict[str, str], key: str, source: Path) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ProvisioningError(f"{key} is not set in {source}")
    return value


def _relative_path(value: str, name: str) -> str:
    candidate = PurePosixPath(value.strip())
    if (
        not value.strip()
        or candidate.is_absolute()
        or ".." in candidate.parts
        or not _RELATIVE_PATH.fullmatch(candidate.as_posix())
    ):
        raise ProvisioningError(
            f"{name} must be a safe path relative to the remote home"
        )
    return candidate.as_posix()


def _port(values: dict[str, str], key: str, source: Path) -> int:
    raw = _required(values, key, source)
    try:
        value = int(raw)
    except ValueError as error:
        raise ProvisioningError(f"{key} must be an integer in {source}") from error
    if value < 1024 or value > 65535:
        raise ProvisioningError(f"{key} must be between 1024 and 65535")
    return value


def _git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(f"cannot read local Git identity: {detail}")
    return completed.stdout.strip()


def _git_tree_digest(commit: str) -> str:
    completed = subprocess.run(
        [
            "git",
            "-C",
            str(REPO_ROOT),
            "ls-tree",
            "-r",
            "-z",
            "--full-tree",
            commit,
        ],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ProvisioningError("cannot compute local Git tree digest")
    return "sha256:" + hashlib.sha256(completed.stdout).hexdigest()


@dataclass(frozen=True)
class WindowsRuntimeConfig:
    environment_name: str
    host: str
    user: str
    ssh_port: int
    known_hosts_file: str
    deploy_path: str
    runtime_path: str
    role: str
    profile: str
    http_port: int
    public_port: int
    health_path: str
    public_base_url: str
    stream_port: int | None
    relay_client_url: str
    relay_control_url: str
    relay_stream_addr: str
    relay_runtime_path: str
    task_name: str
    firewall_remote_address: str

    @classmethod
    def load(
        cls,
        environment_name: str,
        environment_path: Path,
    ) -> "WindowsRuntimeConfig":
        if not _IDENTIFIER.fullmatch(environment_name):
            raise ProvisioningError("deploy environment name is invalid")
        values = load_env_file(environment_path)
        if values.get("PT_DEPLOY_PLATFORM", "").strip().lower() != "windows":
            raise ProvisioningError(
                f"PT_DEPLOY_PLATFORM must be windows in {environment_path}"
            )
        role = _required(values, "PT_DEPLOY_ROLE", environment_path).lower()
        if role not in _ROLE:
            raise ProvisioningError(
                f"PT_DEPLOY_ROLE must be station or relay in {environment_path}"
            )
        health_path = values.get(
            "PT_DEPLOY_HEALTH_PATH",
            "/healthz" if role == "relay" else "/sub-oss/healthz",
        ).strip()
        if not _HEALTH_PATH.fullmatch(health_path):
            raise ProvisioningError("PT_DEPLOY_HEALTH_PATH is invalid")
        public_base_url = _required(
            values,
            "PT_DEPLOY_PUBLIC_BASE_URL",
            environment_path,
        )
        parsed_base_url = urlparse(public_base_url)
        required_scheme = "https" if role == "relay" else "http"
        if (
            parsed_base_url.scheme.lower() != required_scheme
            or not parsed_base_url.hostname
        ):
            raise ProvisioningError(
                f"{role} PT_DEPLOY_PUBLIC_BASE_URL must use {required_scheme}"
            )
        try:
            public_port = parsed_base_url.port or (
                443 if required_scheme == "https" else 80
            )
        except ValueError as error:
            raise ProvisioningError(
                f"PT_DEPLOY_PUBLIC_BASE_URL has an invalid port in {environment_path}"
            ) from error
        http_port = _port(values, "PT_DEPLOY_HTTP_PORT", environment_path)
        task_name = _required(values, "PT_DEPLOY_TASK_NAME", environment_path)
        if not _IDENTIFIER.fullmatch(task_name):
            raise ProvisioningError("PT_DEPLOY_TASK_NAME is invalid")
        profile = values.get("PT_DEPLOY_PROFILE", "sixwin").strip()
        if not _IDENTIFIER.fullmatch(profile):
            raise ProvisioningError("PT_DEPLOY_PROFILE is invalid")
        firewall_remote_address = values.get(
            "PT_DEPLOY_FIREWALL_REMOTE_ADDRESS",
            "LocalSubnet",
        ).strip()
        if (
            not firewall_remote_address
            or "\n" in firewall_remote_address
            or "\r" in firewall_remote_address
        ):
            raise ProvisioningError(
                "PT_DEPLOY_FIREWALL_REMOTE_ADDRESS is invalid"
            )
        stream_port = (
            _port(values, "PT_DEPLOY_STREAM_PORT", environment_path)
            if role == "relay"
            else None
        )
        if role == "relay" and (
            public_port == http_port or public_port == stream_port
        ):
            raise ProvisioningError(
                "relay public, internal HTTP, and stream ports must be distinct"
            )
        relay_client_url = values.get("PT_DEPLOY_RELAY_CLIENT_URL", "").strip()
        relay_control_url = values.get(
            "PT_DEPLOY_RELAY_CONTROL_URL",
            "",
        ).strip()
        relay_stream_addr = values.get(
            "PT_DEPLOY_RELAY_STREAM_ADDR",
            "",
        ).strip()
        relay_runtime_path_raw = values.get(
            "PT_DEPLOY_RELAY_RUNTIME_PATH",
            "",
        ).strip()
        relay_values = (
            relay_client_url,
            relay_control_url,
            relay_stream_addr,
            relay_runtime_path_raw,
        )
        if role == "station" and any(relay_values):
            if not all(relay_values):
                raise ProvisioningError(
                    "station Relay client binding must define URL, control URL, "
                    "stream address, and Relay runtime path"
                )
            relay_public = urlparse(relay_client_url)
            relay_control = urlparse(relay_control_url)
            if (
                relay_public.scheme.lower() != "https"
                or not relay_public.hostname
                or relay_control.scheme.lower() != "http"
                or relay_control.hostname not in {"127.0.0.1", "::1", "localhost"}
            ):
                raise ProvisioningError(
                    "station Relay client requires public HTTPS and loopback HTTP control"
                )
            stream = urlparse("//" + relay_stream_addr)
            if not stream.hostname or stream.port is None:
                raise ProvisioningError(
                    "PT_DEPLOY_RELAY_STREAM_ADDR must be a host and port"
                )
            relay_runtime_path = _relative_path(
                relay_runtime_path_raw,
                "PT_DEPLOY_RELAY_RUNTIME_PATH",
            )
        else:
            relay_client_url = ""
            relay_control_url = ""
            relay_stream_addr = ""
            relay_runtime_path = ""
        return cls(
            environment_name=environment_name,
            host=_required(values, "PT_DEPLOY_HOST", environment_path),
            user=_required(values, "PT_DEPLOY_USER", environment_path),
            ssh_port=int(values.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=values.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ).strip(),
            deploy_path=_relative_path(
                _required(values, "PT_DEPLOY_PATH", environment_path),
                "PT_DEPLOY_PATH",
            ),
            runtime_path=_relative_path(
                _required(values, "PT_DEPLOY_RUNTIME_PATH", environment_path),
                "PT_DEPLOY_RUNTIME_PATH",
            ),
            role=role,
            profile=profile,
            http_port=http_port,
            public_port=public_port,
            health_path=health_path,
            public_base_url=public_base_url,
            stream_port=stream_port,
            relay_client_url=relay_client_url,
            relay_control_url=relay_control_url,
            relay_stream_addr=relay_stream_addr,
            relay_runtime_path=relay_runtime_path,
            task_name=task_name,
            firewall_remote_address=firewall_remote_address,
        )

    def payload(self, *, branch: str, commit: str, tree_digest: str) -> dict[str, object]:
        return {
            "environmentName": self.environment_name,
            "deployPath": self.deploy_path,
            "runtimePath": self.runtime_path,
            "role": self.role,
            "profile": self.profile,
            "httpPort": self.http_port,
            "publicPort": self.public_port,
            "healthPath": self.health_path,
            "publicBaseUrl": self.public_base_url,
            "streamPort": self.stream_port,
            "relayClientUrl": self.relay_client_url,
            "relayControlUrl": self.relay_control_url,
            "relayStreamAddr": self.relay_stream_addr,
            "relayRuntimePath": self.relay_runtime_path,
            "taskName": self.task_name,
            "firewallRemoteAddress": self.firewall_remote_address,
            "branch": branch,
            "sourceCommit": commit,
            "sourceTreeDigest": tree_digest,
        }


def _remote_runtime_script() -> str:
    script = textwrap.dedent(
        r"""
        import getpass
        import base64
        import hashlib
        import hmac
        import ipaddress
        import json
        import os
        import pathlib
        import re
        import secrets
        import shutil
        import subprocess
        import sys
        import time
        import urllib.error
        import urllib.request
        from datetime import datetime, timezone

        action = sys.argv[1]
        cfg = json.loads(sys.argv[2])
        home = pathlib.Path.home()
        source = home / cfg["deployPath"]
        runtime = home / cfg["runtimePath"]
        role = cfg["role"]
        binary = runtime / "bin" / ("peers-touch-" + role + ".exe")
        artifact_root = home / ".peers-touch" / "artifacts" / "windows-amd64"
        config_root = runtime / "conf"
        config_path = config_root / "peers-sqlite.yml"
        data_root = runtime / "data"
        secret_root = runtime / "secrets"
        log_path = runtime / "logs" / (role + ".log")
        runner_path = runtime / "run-service.ps1"
        manifest_path = runtime / "runtime-manifest.json"
        task_name = cfg["taskName"]
        relay_client_enabled = bool(cfg["relayClientUrl"])
        relay_credential_path = secret_root / "relay-mount-credential.json"
        relay_invite_path = secret_root / "relay-invite-token"
        health_url = (
            "http://127.0.0.1:"
            + str(cfg["httpPort"])
            + cfg["healthPath"]
        )

        __ROTATE_SERVICE_LOG__

        def run(argv, *, cwd=None, env=None, check=True, binary_output=False):
            completed = subprocess.run(
                argv,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=not binary_output,
                encoding=None if binary_output else "utf-8",
                errors=None if binary_output else "replace",
                check=False,
            )
            if check and completed.returncode != 0:
                stderr = (
                    completed.stderr.decode("utf-8", errors="replace")
                    if binary_output
                    else completed.stderr
                )
                stdout = (
                    completed.stdout.decode("utf-8", errors="replace")
                    if binary_output
                    else completed.stdout
                )
                detail = (stderr or stdout or "").strip()
                raise RuntimeError(
                    "command failed ("
                    + subprocess.list2cmdline(argv)
                    + "): "
                    + detail[-4000:]
                )
            return completed

        def ps_literal(value):
            return "'" + str(value).replace("'", "''") + "'"

        def powershell(script, *, check=True):
            return run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ],
                check=check,
            )

        def source_identity():
            commit = run(["git", "-C", str(source), "rev-parse", "HEAD"]).stdout.strip()
            tree = run(
                [
                    "git",
                    "-C",
                    str(source),
                    "ls-tree",
                    "-r",
                    "-z",
                    "--full-tree",
                    commit,
                ],
                binary_output=True,
            ).stdout
            digest = "sha256:" + hashlib.sha256(tree).hexdigest()
            dirty = run(
                [
                    "git",
                    "-C",
                    str(source),
                    "status",
                    "--porcelain",
                    "--untracked-files=all",
                ]
            ).stdout.strip()
            return commit, digest, not bool(dirty)

        def station_source_tree(commit):
            completed = run(
                [
                    "git",
                    "-C",
                    str(source),
                    "rev-parse",
                    commit + ":apps/station",
                ],
                check=False,
            )
            tree = completed.stdout.strip()
            if completed.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", tree):
                return ""
            return tree

        def file_digest(path):
            digest = hashlib.sha256()
            with path.open("rb") as source_file:
                while chunk := source_file.read(1024 * 1024):
                    digest.update(chunk)
            return "sha256:" + digest.hexdigest()

        def read_manifest():
            if not manifest_path.is_file():
                return {}
            return json.loads(manifest_path.read_text(encoding="utf-8"))

        def health():
            try:
                with urllib.request.urlopen(health_url, timeout=3) as response:
                    return 200 <= response.status < 300
            except (OSError, urllib.error.URLError):
                return False

        def process_ids():
            script = (
                "$target="
                + ps_literal(str(binary))
                + "; @(Get-CimInstance Win32_Process | "
                + "Where-Object { $_.ExecutablePath -eq $target } | "
                + "Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"
            )
            completed = powershell(script, check=False)
            if completed.returncode != 0 or not completed.stdout.strip():
                return []
            try:
                value = json.loads(completed.stdout.strip())
            except json.JSONDecodeError:
                return []
            if value is None:
                return []
            return [int(value)] if isinstance(value, int) else [int(item) for item in value]

        def stop_owned():
            run(
                ["schtasks.exe", "/End", "/TN", task_name],
                check=False,
            )
            for pid in process_ids():
                powershell(
                    "Stop-Process -Id " + str(pid) + " -Force -ErrorAction SilentlyContinue",
                    check=False,
                )
            run(
                ["schtasks.exe", "/Delete", "/TN", task_name, "/F"],
                check=False,
            )

        def status():
            manifest = read_manifest()
            query = run(
                ["schtasks.exe", "/Query", "/TN", task_name, "/FO", "LIST"],
                check=False,
            )
            current_commit = ""
            source_clean = False
            if (source / ".git").is_dir():
                current_commit, _, source_clean = source_identity()
            return {
                "artifactKind": "windows-native-runtime-status",
                "environmentName": cfg["environmentName"],
                "role": role,
                "taskName": task_name,
                "taskRegistered": query.returncode == 0,
                "processIds": process_ids(),
                "healthy": health(),
                "healthUrl": health_url,
                "runtimePath": str(runtime),
                "logPath": str(log_path),
                "sourceCommit": current_commit,
                "sourceClean": source_clean,
                "manifest": manifest,
            }

        def ensure_secret(path):
            if not path.is_file() or not path.read_text(encoding="utf-8").strip():
                path.write_text(secrets.token_hex(32) + "\n", encoding="utf-8")

        def generate_tls(ca_cert_path, ca_key_path, cert_path, key_path):
            required = (ca_cert_path, ca_key_path, cert_path, key_path)
            if all(path.is_file() for path in required):
                return
            for path in required:
                path.unlink(missing_ok=True)
            host = cfg["publicBaseUrl"].split("://", 1)[1].split(":", 1)[0]
            try:
                ipaddress.ip_address(host)
                san = "IP:" + host
            except ValueError:
                san = "DNS:" + host
            run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:3072",
                    "-sha256",
                    "-nodes",
                    "-config",
                    "NUL",
                    "-keyout",
                    str(ca_key_path),
                    "-out",
                    str(ca_cert_path),
                    "-days",
                    "3650",
                    "-subj",
                    "/CN=Peers Touch Relay Acceptance CA",
                    "-addext",
                    "basicConstraints=critical,CA:TRUE,pathlen:0",
                    "-addext",
                    "keyUsage=critical,keyCertSign,cRLSign",
                ]
            )
            request_path = secret_root / "relay-tls.csr"
            extensions_path = secret_root / "relay-tls.ext"
            serial_path = ca_cert_path.with_suffix(".srl")
            try:
                run(
                    [
                        "openssl",
                        "req",
                        "-new",
                        "-newkey",
                        "rsa:2048",
                        "-sha256",
                        "-nodes",
                        "-config",
                        "NUL",
                        "-keyout",
                        str(key_path),
                        "-out",
                        str(request_path),
                        "-subj",
                        "/CN=" + host,
                    ]
                )
                extensions_path.write_text(
                    "[server]\n"
                    "basicConstraints=critical,CA:FALSE\n"
                    "keyUsage=critical,digitalSignature,keyEncipherment\n"
                    "extendedKeyUsage=serverAuth\n"
                    "subjectAltName=" + san + ",IP:127.0.0.1\n",
                    encoding="ascii",
                )
                run(
                    [
                        "openssl",
                        "x509",
                        "-req",
                        "-in",
                        str(request_path),
                        "-CA",
                        str(ca_cert_path),
                        "-CAkey",
                        str(ca_key_path),
                        "-CAcreateserial",
                        "-out",
                        str(cert_path),
                        "-days",
                        "825",
                        "-sha256",
                        "-extfile",
                        str(extensions_path),
                        "-extensions",
                        "server",
                    ]
                )
            finally:
                request_path.unlink(missing_ok=True)
                extensions_path.unlink(missing_ok=True)
                serial_path.unlink(missing_ok=True)

        def install_relay_ca(ca_cert_path):
            run(
                [
                    "certutil.exe",
                    "-addstore",
                    "-f",
                    "Root",
                    str(ca_cert_path),
                ]
            )

        def request_json(url, *, payload=None, bearer=""):
            body = (
                json.dumps(payload, separators=(",", ":")).encode("utf-8")
                if payload is not None
                else None
            )
            request = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    **(
                        {"Authorization": "Bearer " + bearer}
                        if bearer
                        else {}
                    ),
                },
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                decoded = json.loads(response.read().decode("utf-8"))
            if not isinstance(decoded, dict):
                raise RuntimeError("Relay returned a non-object response")
            return decoded

        def relay_operator_token(operator_key):
            now = int(time.time())
            header = {"alg": "HS256", "typ": "JWT"}
            payload = {
                "iss": "peers-relay-operator",
                "sub": "operator:windows-runtime",
                "aud": ["peers-relay-admin"],
                "iat": now,
                "exp": now + 300,
                "scope": "relay.admin",
            }

            def encode(value):
                return base64.urlsafe_b64encode(
                    json.dumps(
                        value,
                        separators=(",", ":"),
                        sort_keys=True,
                    ).encode("utf-8")
                ).rstrip(b"=")

            unsigned = encode(header) + b"." + encode(payload)
            signature = base64.urlsafe_b64encode(
                hmac.new(operator_key, unsigned, hashlib.sha256).digest()
            ).rstrip(b"=")
            return (unsigned + b"." + signature).decode("ascii")

        def relay_credential_active():
            if not relay_credential_path.is_file():
                return False
            try:
                credential = json.loads(
                    relay_credential_path.read_text(encoding="utf-8")
                )
                token = str(credential.get("relay_token") or "")
                if not token:
                    return False
                request_json(
                    cfg["relayControlUrl"] + "/api/v1/relay/heartbeat",
                    payload={},
                    bearer=token,
                )
                return True
            except (
                OSError,
                ValueError,
                urllib.error.HTTPError,
                urllib.error.URLError,
            ):
                return False

        def prepare_station_relay_invite():
            if not relay_client_enabled:
                return
            if relay_credential_active():
                relay_invite_path.unlink(missing_ok=True)
                return
            relay_credential_path.unlink(missing_ok=True)
            relay_runtime = home / cfg["relayRuntimePath"]
            operator_key = (
                relay_runtime / "secrets" / "relay-operator.key"
            ).read_text(encoding="utf-8").strip().encode("utf-8")
            response = request_json(
                cfg["relayControlUrl"] + "/api/v1/relay/invite",
                payload={
                    "label": cfg["environmentName"],
                    "max_clients": 64,
                    "bandwidth_limit": 8388608,
                    "expires_in": "10m",
                },
                bearer=relay_operator_token(operator_key),
            )
            invite_token = str(response.get("invite_token") or "")
            if not invite_token:
                raise RuntimeError("Relay invite response omitted its secret")
            relay_invite_path.write_text(
                invite_token + "\n",
                encoding="utf-8",
            )

        def wait_for_station_relay_mount():
            if not relay_client_enabled:
                return
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if relay_credential_active():
                    relay_invite_path.unlink(missing_ok=True)
                    return
                time.sleep(1)
            raise RuntimeError(
                "Station Relay client did not establish an authenticated mount"
            )

        def apply_secret_acl():
            username = os.environ.get("USERNAME") or getpass.getuser()
            run(
                [
                    "icacls.exe",
                    str(secret_root),
                    "/inheritance:r",
                    "/grant:r",
                    username + ":(OI)(CI)F",
                    "SYSTEM:(OI)(CI)F",
                ]
            )
            secret_paths = [secret_root / "auth-secret"]
            if role == "relay":
                secret_paths.extend(
                    [
                        secret_root / "relay-operator.key",
                        secret_root / "relay-signing.key",
                        secret_root / "relay-ca.key",
                        secret_root / "relay-ca.crt",
                        secret_root / "relay-tls.key",
                        secret_root / "relay.crt",
                    ]
                )
            elif relay_client_enabled:
                secret_paths.extend(
                    [
                        relay_invite_path,
                        relay_credential_path,
                    ]
                )
            for secret_path in secret_paths:
                if not secret_path.is_file():
                    continue
                run(
                    [
                        "icacls.exe",
                        str(secret_path),
                        "/inheritance:r",
                        "/grant:r",
                        username + ":F",
                        "SYSTEM:F",
                    ]
                )

        def yaml_path(path):
            return str(path).replace("\\", "/")

        def prepare_config():
            source_conf = source / "apps" / "station" / "app" / "conf"
            if config_root.exists():
                shutil.rmtree(config_root)
            shutil.copytree(source_conf, config_root)
            database = yaml_path(data_root / (role + ".db"))
            store = config_root / "store.sqlite.yml"
            store.write_text(
                store.read_text(encoding="utf-8").replace(
                    "/tmp/peers-touch-local.db",
                    database,
                ),
                encoding="utf-8",
            )
            main = config_path.read_text(encoding="utf-8")
            if role == "relay":
                includes = (
                    "store.sqlite.yml, sub_relay.yml, log.yml, "
                    "server.host.local.yml, runtime.windows.yml"
                )
            else:
                match = re.search(r"(?m)^  includes: (.+)$", main)
                if match is None:
                    raise RuntimeError("peers-sqlite.yml has no includes declaration")
                includes = match.group(1)
                if relay_client_enabled and "sub_relay_client.yml" not in includes:
                    includes += ", sub_relay_client.yml"
                if "runtime.windows.yml" not in includes:
                    includes += ", runtime.windows.yml"
            main = re.sub(
                r"(?m)^  includes: .+$",
                "  includes: " + includes,
                main,
                count=1,
            )
            config_path.write_text(main, encoding="utf-8")
            (config_root / "server.host.local.yml").write_text(
                "peers:\n"
                "  node:\n"
                "    server:\n"
                "      baseurl: " + json.dumps(cfg["publicBaseUrl"]) + "\n",
                encoding="utf-8",
            )
            overlay = [
                "peers:",
                "  node:",
                "    transport:",
                "      native:",
                "        libp2p-identity-key-file: "
                + json.dumps(yaml_path(data_root / "libp2p.key")),
                "    server:",
                (
                    "      address: 127.0.0.1:"
                    if role == "relay"
                    else "      address: :"
                )
                + str(cfg["httpPort"]),
                "      subserver:",
                "        bootstrap:",
                "          identity-key: "
                + json.dumps(yaml_path(data_root / "bootstrap.key")),
                "        oss:",
                "          store-path: " + json.dumps(yaml_path(runtime / "oss")),
            ]
            if role == "relay":
                overlay.extend(
                    [
                        "        relay:",
                        "          enabled: true",
                        "          public-listen-addr: :"
                        + str(cfg["publicPort"]),
                        "          public-upstream-url: http://127.0.0.1:"
                        + str(cfg["httpPort"]),
                        "          stream-listen-addr: :"
                        + str(cfg["streamPort"]),
                        "          tls-cert-file: "
                        + json.dumps(yaml_path(secret_root / "relay.crt")),
                        "          tls-key-file: "
                        + json.dumps(yaml_path(secret_root / "relay-tls.key")),
                        "          allow-insecure-loopback: false",
                        "          signing-key-file: "
                        + json.dumps(yaml_path(secret_root / "relay-signing.key")),
                        "          operator-key-file: "
                        + json.dumps(yaml_path(secret_root / "relay-operator.key")),
                        "          operator-issuer: peers-relay-operator",
                        "          operator-audience: peers-relay-admin",
                        "          operator-scope: relay.admin",
                    ]
                )
            elif relay_client_enabled:
                overlay.extend(
                    [
                        "        relay-client:",
                        "          enabled: true",
                        "          relay-url: "
                        + json.dumps(cfg["relayClientUrl"]),
                        "          relay-stream-addr: "
                        + json.dumps(cfg["relayStreamAddr"]),
                        "          invite-token-file: "
                        + json.dumps(yaml_path(relay_invite_path)),
                        "          label: "
                        + json.dumps(cfg["environmentName"]),
                        "          local-http-port: " + str(cfg["httpPort"]),
                        "          bootstrap-info-url: http://127.0.0.1:"
                        + str(cfg["httpPort"])
                        + "/sub-bootstrap/info",
                        "          bootstrap-identity-url: http://127.0.0.1:"
                        + str(cfg["httpPort"])
                        + "/sub-bootstrap/station-identity",
                        "          token-store-path: "
                        + json.dumps(yaml_path(relay_credential_path)),
                        "          use-tls: true",
                        "          tls-insecure-skip-verify: false",
                    ]
                )
            (config_root / "runtime.windows.yml").write_text(
                "\n".join(overlay) + "\n",
                encoding="utf-8",
            )

        def prepare_runner(source_commit):
            environment = {
                "PEERS_NODE_ROLE": role,
                "PEERS_PROFILE": cfg["profile"],
                "PEERS_CONFIG_DIR": str(runtime / "config"),
                "PEERS_DATA_DIR": str(data_root),
                "PEERS_CACHE_DIR": str(runtime / "cache"),
                "PEERS_LOGS_DIR": str(runtime / "logs"),
                "PEERS_RUNTIME_DIR": str(runtime / "run"),
                "PEERS_TEMP_DIR": str(runtime / "temp"),
                "PEERS_TOUCH_BUILD_COMMIT": source_commit,
                "PEERS_TOUCH_BUILD_LABEL": cfg["branch"],
                "PEERS_TOUCH_BUILD_TIME": datetime.now(timezone.utc).isoformat(),
                "PEERS_NODE_LABEL": cfg["environmentName"],
                "PEERS_NODE_SERVER_SUBSERVER_OSS_STORE_PATH": str(runtime / "oss"),
            }
            lines = [
                "$ErrorActionPreference = 'Stop'",
                "$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'",
                "$env:PEERS_AUTH_SECRET = "
                + "(Get-Content -Raw -LiteralPath "
                + ps_literal(secret_root / "auth-secret")
                + ").Trim()",
            ]
            for key, value in environment.items():
                lines.append("$env:" + key + " = " + ps_literal(value))
            lines.extend(
                [
                    "Set-Location -LiteralPath " + ps_literal(runtime),
                    "$ErrorActionPreference = 'Continue'",
                    "& "
                    + ps_literal(binary)
                    + " "
                    + ps_literal("--config=" + str(config_path))
                    + " *>> "
                    + ps_literal(log_path),
                    "exit $LASTEXITCODE",
                ]
            )
            runner_path.write_text("\n".join(lines) + "\n", encoding="ascii")

        def materialize_binary(source_commit, build_env):
            station_tree = station_source_tree(source_commit)
            if not station_tree:
                raise RuntimeError("cannot resolve apps/station source tree")
            go_version = run(
                ["go", "env", "GOVERSION"],
                env=build_env,
            ).stdout.strip()
            cc_version = run(
                ["gcc", "--version"],
                env=build_env,
            ).stdout.splitlines()[0].strip()
            build_identity = {
                "cgo": "1",
                "cgoLdflags": build_env["CGO_LDFLAGS"],
                "flags": ["-p=1", "-trimpath", "-ldflags=-s -w"],
                "goVersion": go_version,
                "ccVersion": cc_version,
                "stationSourceTree": station_tree,
            }
            artifact_key = hashlib.sha256(
                json.dumps(
                    build_identity,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            artifact_root.mkdir(parents=True, exist_ok=True)
            artifact_path = artifact_root / (artifact_key + ".exe")
            metadata_path = artifact_root / (artifact_key + ".json")
            lock_path = artifact_root / (artifact_key + ".lock")

            def artifact_valid():
                if not artifact_path.is_file() or not metadata_path.is_file():
                    return False
                try:
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    return False
                return (
                    metadata.get("buildIdentity") == build_identity
                    and metadata.get("binarySha256") == file_digest(artifact_path)
                )

            deadline = time.monotonic() + 840
            acquired = False
            while not artifact_valid():
                try:
                    lock_path.mkdir()
                    acquired = True
                    break
                except FileExistsError:
                    try:
                        stale = time.time() - lock_path.stat().st_mtime > 1800
                    except FileNotFoundError:
                        continue
                    if stale:
                        shutil.rmtree(lock_path, ignore_errors=True)
                        continue
                    if time.monotonic() >= deadline:
                        raise RuntimeError("timed out waiting for Windows build artifact")
                    time.sleep(1)

            if acquired:
                try:
                    if not artifact_valid():
                        temporary = artifact_root / (
                            artifact_key + "." + str(os.getpid()) + ".tmp.exe"
                        )
                        temporary.unlink(missing_ok=True)
                        previous = read_manifest()
                        previous_commit = previous.get("sourceCommit", "")
                        if (
                            binary.is_file()
                            and previous_commit
                            and station_source_tree(previous_commit) == station_tree
                        ):
                            shutil.copy2(binary, temporary)
                        else:
                            run(
                                [
                                    "go",
                                    "build",
                                    "-p=1",
                                    "-trimpath",
                                    "-ldflags=-s -w",
                                    "-o",
                                    str(temporary),
                                    ".",
                                ],
                                cwd=source / "apps" / "station" / "app",
                                env=build_env,
                            )
                        os.replace(temporary, artifact_path)
                        metadata = {
                            "artifactKind": "windows-native-build-artifact",
                            "artifactKey": artifact_key,
                            "binarySha256": file_digest(artifact_path),
                            "buildIdentity": build_identity,
                            "createdAt": datetime.now(timezone.utc).isoformat(),
                        }
                        temporary_metadata = metadata_path.with_suffix(".json.tmp")
                        temporary_metadata.write_text(
                            json.dumps(metadata, indent=2, sort_keys=True) + "\n",
                            encoding="utf-8",
                        )
                        os.replace(temporary_metadata, metadata_path)
                finally:
                    shutil.rmtree(lock_path, ignore_errors=True)

            if not artifact_valid():
                raise RuntimeError("Windows build artifact failed integrity validation")
            shutil.copy2(artifact_path, binary)
            return station_tree, artifact_key, file_digest(binary)

        def configure_firewall():
            ports = [
                cfg["publicPort"] if role == "relay" else cfg["httpPort"]
            ]
            if role == "relay" and cfg["streamPort"] is not None:
                ports.append(cfg["streamPort"])
            group = "PeersTouch-" + cfg["environmentName"]
            commands = [
                "$ErrorActionPreference='Stop'",
                "Get-NetFirewallRule -Group "
                + ps_literal(group)
                + " -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
            ]
            for port in ports:
                commands.append(
                    "New-NetFirewallRule -DisplayName "
                    + ps_literal(group + "-" + str(port))
                    + " -Group "
                    + ps_literal(group)
                    + " -Direction Inbound -Action Allow -Protocol TCP"
                    + " -LocalPort "
                    + str(port)
                    + " -Profile Any -RemoteAddress "
                    + ps_literal(cfg["firewallRemoteAddress"])
                    + " | Out-Null"
                )
            powershell("; ".join(commands))

        def deploy():
            source_commit, source_digest, source_clean = source_identity()
            if (
                source_commit != cfg["sourceCommit"]
                or source_digest != cfg["sourceTreeDigest"]
                or not source_clean
            ):
                raise RuntimeError("remote source identity does not match deploy request")
            if source.resolve() == runtime.resolve():
                raise RuntimeError("runtime path must be isolated from source checkout")
            for directory in (
                runtime / "bin",
                data_root,
                secret_root,
                runtime / "cache" / "go-mod",
                runtime / "cache" / "go-build",
                runtime / "config",
                runtime / "logs",
                runtime / "run",
                runtime / "temp",
                runtime / "oss",
            ):
                directory.mkdir(parents=True, exist_ok=True)
            auth_secret = secret_root / "auth-secret"
            ensure_secret(auth_secret)
            if role == "relay":
                ensure_secret(secret_root / "relay-signing.key")
                ensure_secret(secret_root / "relay-operator.key")
                generate_tls(
                    secret_root / "relay-ca.crt",
                    secret_root / "relay-ca.key",
                    secret_root / "relay.crt",
                    secret_root / "relay-tls.key",
                )
                install_relay_ca(secret_root / "relay-ca.crt")
            elif relay_client_enabled:
                prepare_station_relay_invite()
            apply_secret_acl()
            prepare_config()
            stop_owned()
            _rotate_service_log(log_path)
            build_env = os.environ.copy()
            build_env.update(
                {
                    "CGO_ENABLED": "1",
                    "CGO_LDFLAGS": (
                        "-Wl,--no-keep-memory "
                        "-Wl,--reduce-memory-overheads"
                    ),
                    "GOMODCACHE": str(runtime / "cache" / "go-mod"),
                    "GOCACHE": str(runtime / "cache" / "go-build"),
                    "GOMAXPROCS": "2",
                }
            )
            station_tree, artifact_key, binary_digest = materialize_binary(
                source_commit,
                build_env,
            )
            prepare_runner(source_commit)
            configure_firewall()
            task_command = subprocess.list2cmdline(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(runner_path),
                ]
            )
            run(
                [
                    "schtasks.exe",
                    "/Create",
                    "/TN",
                    task_name,
                    "/SC",
                    "ONSTART",
                    "/RU",
                    "SYSTEM",
                    "/RL",
                    "HIGHEST",
                    "/TR",
                    task_command,
                    "/F",
                ]
            )
            run(["schtasks.exe", "/Run", "/TN", task_name])
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if health():
                    break
                time.sleep(1)
            if not health():
                tail = []
                if log_path.is_file():
                    tail = log_path.read_text(
                        encoding="utf-8",
                        errors="replace",
                    ).splitlines()[-80:]
                raise RuntimeError(
                    "runtime failed health check: " + "\n".join(tail)
                )
            wait_for_station_relay_mount()
            final_commit, final_digest, final_clean = source_identity()
            if (
                final_commit != source_commit
                or final_digest != source_digest
                or not final_clean
            ):
                raise RuntimeError("runtime build contaminated source checkout")
            manifest = {
                "artifactKind": "windows-native-runtime-manifest",
                "environmentName": cfg["environmentName"],
                "role": role,
                "taskName": task_name,
                "sourceCommit": source_commit,
                "sourceTreeDigest": source_digest,
                "stationSourceTree": station_tree,
                "sourceClean": True,
                "binaryPath": str(binary),
                "binarySha256": binary_digest,
                "buildArtifactKey": artifact_key,
                "configPath": str(config_path),
                "runtimePath": str(runtime),
                "healthUrl": health_url,
                "httpPort": cfg["httpPort"],
                "publicPort": cfg["publicPort"],
                "streamPort": cfg["streamPort"],
                "tlsCaCertificatePath": (
                    str(secret_root / "relay-ca.crt")
                    if role == "relay"
                    else ""
                ),
                "tlsCaCertificateSha256": (
                    file_digest(secret_root / "relay-ca.crt")
                    if role == "relay"
                    else ""
                ),
                "deployedAt": datetime.now(timezone.utc).isoformat(),
            }
            temporary = manifest_path.with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, manifest_path)
            return status()

        try:
            if action == "deploy":
                result = deploy()
            elif action == "status":
                result = status()
            elif action == "logs":
                lines = (
                    log_path.read_text(
                        encoding="utf-8",
                        errors="replace",
                    ).splitlines()[-100:]
                    if log_path.is_file()
                    else []
                )
                result = {
                    "artifactKind": "windows-native-runtime-logs",
                    "environmentName": cfg["environmentName"],
                    "lines": lines,
                }
            elif action == "stop":
                stop_owned()
                result = status()
            else:
                raise RuntimeError("unsupported Windows runtime action")
            print(json.dumps(result, sort_keys=True), flush=True)
        except Exception as error:
            print("FAILED:" + str(error), file=sys.stderr, flush=True)
            raise SystemExit(1)
        """
    ).strip() + "\n"
    helper = textwrap.dedent(inspect.getsource(_rotate_service_log)).strip()
    return script.replace("__ROTATE_SERVICE_LOG__", helper)


def execute(
    action: str,
    config: WindowsRuntimeConfig,
    *,
    branch: str,
    transport: SshTransport | None = None,
) -> dict[str, object]:
    if action not in {"deploy", "status", "logs", "stop"}:
        raise ProvisioningError(f"unsupported Windows deploy action: {action}")
    commit = _git_output("rev-parse", "HEAD") if action == "deploy" else ""
    tree_digest = _git_tree_digest(commit) if commit else ""
    request = config.payload(
        branch=branch,
        commit=commit,
        tree_digest=tree_digest,
    )
    remote = transport or SshTransport(
        SshTarget(
            host=config.host,
            user=config.user,
            port=config.ssh_port,
            known_hosts_file=config.known_hosts_file,
            remote_platform=RemotePlatform.WINDOWS,
        )
    )
    completed = remote.run_argv(
        ["python", "-", action, json.dumps(request, sort_keys=True)],
        timeout=900 if action == "deploy" else 60,
        check=False,
        input_text=_remote_runtime_script(),
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"Windows runtime {action} failed: {detail[-8000:]}"
        )
    try:
        return json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise ProvisioningError(
            f"Windows runtime {action} returned invalid JSON"
        ) from error


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Operate a reviewed Windows-native Station or Relay runtime"
    )
    parser.add_argument("action", choices=("deploy", "status", "logs", "stop"))
    parser.add_argument("environment")
    parser.add_argument("--environment-file", type=Path, required=True)
    parser.add_argument("--branch", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        config = WindowsRuntimeConfig.load(
            args.environment,
            args.environment_file,
        )
        payload = execute(
            args.action,
            config,
            branch=args.branch or _git_output("branch", "--show-current"),
        )
    except (OSError, ValueError, ProvisioningError, RuntimeError) as error:
        sys.stderr.write(f"[ERROR] {error}\n")
        return 1
    if args.action == "logs" and not args.json:
        for line in payload.get("lines", []):
            print(line)
    elif args.json:
        print(json.dumps(payload, sort_keys=True))
    else:
        print(
            "[OK] Windows runtime "
            f"{args.action}: {args.environment} "
            f"(healthy={payload.get('healthy', 'n/a')})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
