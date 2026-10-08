#!/usr/bin/env python3
"""Prepare reviewed Linux/POSIX Relay runtime secrets."""

from __future__ import annotations

import argparse
import json
import sys
import textwrap
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
)


def _remote_prepare_script() -> str:
    return textwrap.dedent(
        r"""
        import ipaddress
        import json
        import os
        import pathlib
        import secrets
        import subprocess
        import sys

        cfg = json.loads(sys.argv[1])
        home = pathlib.Path.home()
        runtime = home / cfg["runtimePath"]
        secret_root = runtime / "secrets"
        ca_root = runtime / "ca"
        secret_root.mkdir(parents=True, exist_ok=True)
        ca_root.mkdir(parents=True, exist_ok=True)
        os.chmod(secret_root, 0o700)
        os.chmod(ca_root, 0o700)

        def run(argv):
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip() or completed.stdout.strip()
                raise RuntimeError(detail or "command failed")

        def ensure_secret(path):
            if not path.is_file() or not path.read_text(
                encoding="utf-8",
            ).strip():
                path.write_text(secrets.token_hex(32) + "\n", encoding="utf-8")
            os.chmod(path, 0o600)

        signing_key = secret_root / "relay-signing.key"
        operator_key = secret_root / "relay-operator.key"
        ca_key = ca_root / "relay-ca.key"
        ca_cert = secret_root / "relay-ca.crt"
        tls_key = secret_root / "relay-tls.key"
        tls_cert = secret_root / "relay.crt"
        ensure_secret(signing_key)
        ensure_secret(operator_key)

        required_tls = (ca_key, ca_cert, tls_key, tls_cert)
        if not all(path.is_file() and path.stat().st_size > 0 for path in required_tls):
            for path in required_tls:
                path.unlink(missing_ok=True)
            host = cfg["host"]
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
                    "-keyout",
                    str(ca_key),
                    "-out",
                    str(ca_cert),
                    "-days",
                    "3650",
                    "-subj",
                    "/CN=Peers Touch Relay CA",
                    "-addext",
                    "basicConstraints=critical,CA:TRUE,pathlen:0",
                    "-addext",
                    "keyUsage=critical,keyCertSign,cRLSign",
                ]
            )
            request = secret_root / "relay.csr"
            extensions = secret_root / "relay.ext"
            serial = ca_cert.with_suffix(".srl")
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
                        "-keyout",
                        str(tls_key),
                        "-out",
                        str(request),
                        "-subj",
                        "/CN=" + host,
                    ]
                )
                extensions.write_text(
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
                        str(request),
                        "-CA",
                        str(ca_cert),
                        "-CAkey",
                        str(ca_key),
                        "-CAcreateserial",
                        "-out",
                        str(tls_cert),
                        "-days",
                        "825",
                        "-sha256",
                        "-extfile",
                        str(extensions),
                        "-extensions",
                        "server",
                    ]
                )
            finally:
                request.unlink(missing_ok=True)
                extensions.unlink(missing_ok=True)
                serial.unlink(missing_ok=True)

        for path in (signing_key, operator_key, ca_key, tls_key):
            os.chmod(path, 0o600)
        for path in (ca_cert, tls_cert):
            os.chmod(path, 0o644)

        print(
            json.dumps(
                {
                    "artifactKind": "posix-relay-runtime-preparation",
                    "environmentName": cfg["environmentName"],
                    "platform": "linux",
                    "runtimePath": str(runtime),
                    "secretMountPath": str(secret_root),
                    "files": sorted(path.name for path in secret_root.iterdir()),
                },
                sort_keys=True,
            )
        )
        """
    ).strip()


def prepare(
    config: PosixServiceRuntimeConfig,
) -> dict[str, object]:
    if config.role != "relay":
        raise ProvisioningError("POSIX Relay preparation requires relay role")
    remote = config.transport()
    completed = remote.run_argv(
        [
            "python3",
            "-",
            json.dumps(
                {
                    "environmentName": config.environment_name,
                    "host": config.host,
                    "runtimePath": config.runtime_path,
                },
                sort_keys=True,
            ),
        ],
        timeout=60,
        check=False,
        input_text=_remote_prepare_script(),
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"POSIX Relay preparation failed: {detail[-4000:]}"
        )
    try:
        result = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise ProvisioningError(
            "POSIX Relay preparation returned invalid JSON"
        ) from error
    if (
        not isinstance(result, dict)
        or result.get("artifactKind") != "posix-relay-runtime-preparation"
        or result.get("environmentName") != config.environment_name
        or result.get("platform") != "linux"
    ):
        raise ProvisioningError(
            "POSIX Relay preparation returned invalid evidence"
        )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare a reviewed Linux/POSIX Relay runtime"
    )
    parser.add_argument("environment")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        config = PosixServiceRuntimeConfig.load(
            args.environment,
            expected_role="relay",
        )
        result = prepare(config)
    except (OSError, ValueError, ProvisioningError, RuntimeError) as error:
        sys.stderr.write(f"[ERROR] {error}\n")
        return 1
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(
            "[OK] POSIX Relay runtime prepared: "
            f"{args.environment} ({result['secretMountPath']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
