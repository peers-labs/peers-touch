#!/usr/bin/env python3
"""Prepare reviewed Linux/POSIX Relay runtime secrets."""

from __future__ import annotations

import argparse
import json
import ssl
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Callable


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
    resolve_posix_relay_trust_anchor,
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

        def capture(argv):
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if completed.returncode != 0:
                return None
            return completed.stdout.strip()

        def succeeds(argv):
            return capture(argv) is not None

        def ensure_secret(path):
            if not path.is_file() or not path.read_text(
                encoding="utf-8",
            ).strip():
                path.write_text(secrets.token_hex(32) + "\n", encoding="utf-8")
            os.chmod(path, 0o600)

        def unlink_if_exists(path):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

        operator_key = secret_root / "relay-operator.key"
        ca_key = ca_root / "relay-ca.key"
        ca_cert = secret_root / "relay-ca.crt"
        tls_key = secret_root / "relay-tls.key"
        tls_cert = secret_root / "relay.crt"
        ensure_secret(operator_key)

        host = cfg["host"]
        try:
            ipaddress.ip_address(host)
            san = "IP:" + host
            identity_option = "-checkip"
        except ValueError:
            san = "DNS:" + host
            identity_option = "-checkhost"

        def non_empty(paths):
            return all(path.is_file() and path.stat().st_size > 0 for path in paths)

        def key_matches_certificate(key, certificate):
            key_modulus = capture(
                ["openssl", "rsa", "-in", str(key), "-noout", "-modulus"]
            )
            certificate_modulus = capture(
                ["openssl", "x509", "-in", str(certificate), "-noout", "-modulus"]
            )
            return (
                key_modulus is not None
                and certificate_modulus is not None
                and key_modulus == certificate_modulus
            )

        def certificate_extensions(certificate):
            return capture(
                ["openssl", "x509", "-in", str(certificate), "-noout", "-text"]
            )

        ca_extensions = certificate_extensions(ca_cert)
        ca_material = (ca_key, ca_cert)
        ca_valid = (
            non_empty(ca_material)
            and key_matches_certificate(ca_key, ca_cert)
            and ca_extensions is not None
            and ca_extensions.count("X509v3 Basic Constraints") == 1
            and "X509v3 Subject Key Identifier" in ca_extensions
            and "X509v3 Authority Key Identifier" in ca_extensions
            and succeeds(
                ["openssl", "x509", "-in", str(ca_cert), "-noout", "-checkend", "86400"]
            )
            and succeeds(["openssl", "verify", "-CAfile", str(ca_cert), str(ca_cert)])
        )
        if not ca_valid:
            for path in (ca_key, ca_cert, tls_key, tls_cert):
                unlink_if_exists(path)
            ca_config = ca_root / "relay-ca.cnf"
            try:
                ca_config.write_text(
                    "[req]\n"
                    "distinguished_name=dn\n"
                    "x509_extensions=ca\n"
                    "prompt=no\n"
                    "[dn]\n"
                    "CN=Peers Touch Relay CA\n"
                    "[ca]\n"
                    "subjectKeyIdentifier=hash\n"
                    "authorityKeyIdentifier=keyid:always\n"
                    "basicConstraints=critical,CA:TRUE,pathlen:0\n"
                    "keyUsage=critical,keyCertSign,cRLSign\n",
                    encoding="ascii",
                )
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
                        "-config",
                        str(ca_config),
                        "-extensions",
                        "ca",
                    ]
                )
            finally:
                unlink_if_exists(ca_config)

        tls_extensions = certificate_extensions(tls_cert)
        tls_material = (tls_key, tls_cert)
        tls_valid = (
            non_empty(tls_material)
            and key_matches_certificate(tls_key, tls_cert)
            and tls_extensions is not None
            and "X509v3 Subject Key Identifier" in tls_extensions
            and "X509v3 Authority Key Identifier" in tls_extensions
            and succeeds(
                ["openssl", "verify", "-CAfile", str(ca_cert), str(tls_cert)]
            )
            and succeeds(
                ["openssl", "x509", "-in", str(tls_cert), "-noout", "-checkend", "86400"]
            )
            and succeeds(
                [
                    "openssl",
                    "x509",
                    "-in",
                    str(tls_cert),
                    "-noout",
                    identity_option,
                    host,
                ]
            )
        )
        if not tls_valid:
            for path in tls_material:
                unlink_if_exists(path)
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
                    "subjectKeyIdentifier=hash\n"
                    "authorityKeyIdentifier=keyid:always\n"
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
                unlink_if_exists(request)
                unlink_if_exists(extensions)
                unlink_if_exists(serial)

        for path in (operator_key, ca_key, tls_key):
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


def probe_public_health(
    config: PosixServiceRuntimeConfig,
    *,
    expected_base_url: str = "",
    trust_anchor_resolver: Callable[[str], tuple[bytes, str]] = (
        resolve_posix_relay_trust_anchor
    ),
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, object]:
    if config.role != "relay":
        raise ProvisioningError("POSIX Relay health probe requires relay role")
    expected = expected_base_url.rstrip("/")
    if expected and expected != config.public_base_url:
        raise ProvisioningError(
            "active profile Relay URL does not match the reviewed deploy environment"
        )
    certificate, certificate_digest = trust_anchor_resolver(
        config.environment_name
    )
    try:
        ssl.PEM_cert_to_DER_cert(certificate.decode("ascii"))
    except (UnicodeError, ValueError) as error:
        raise ProvisioningError(
            "reviewed Relay trust anchor is not a valid PEM certificate"
        ) from error
    endpoint = config.public_base_url + "/healthz"
    with tempfile.TemporaryDirectory(
        prefix="peers-touch-relay-health-",
    ) as directory:
        ca_path = Path(directory) / "relay-ca.pem"
        ca_path.write_bytes(certificate)
        ca_path.chmod(0o600)
        try:
            completed = runner(
                [
                    "curl",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    "5",
                    "--cacert",
                    str(ca_path),
                    endpoint,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
        except OSError as error:
            raise ProvisioningError(
                f"reviewed Relay HTTPS health probe failed: {error}"
            ) from error
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "curl failed"
        raise ProvisioningError(
            f"reviewed Relay HTTPS health probe failed: {detail[-1000:]}"
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ProvisioningError(
            "reviewed Relay HTTPS health response is not JSON"
        ) from error
    if (
        not isinstance(payload, dict)
        or payload.get("status") != "ready"
        or payload.get("role") != "relay"
        or not isinstance(payload.get("peer_id"), str)
        or not payload["peer_id"]
    ):
        raise ProvisioningError(
            "reviewed Relay HTTPS health response is invalid"
        )
    return {
        "artifactKind": "posix-relay-public-health",
        "environmentName": config.environment_name,
        "endpoint": endpoint,
        "peerId": payload["peer_id"],
        "status": "ready",
        "trustAnchorSha256": certificate_digest,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare a reviewed Linux/POSIX Relay runtime"
    )
    parser.add_argument("environment")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--expected-base-url", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        config = PosixServiceRuntimeConfig.load(
            args.environment,
            expected_role="relay",
        )
        result = (
            probe_public_health(
                config,
                expected_base_url=args.expected_base_url,
            )
            if args.check
            else prepare(config)
        )
    except (OSError, ValueError, ProvisioningError, RuntimeError) as error:
        sys.stderr.write(f"[ERROR] {error}\n")
        return 1
    if args.json:
        print(json.dumps(result, sort_keys=True))
    elif args.check:
        print(
            "[OK] Relay public TLS health: "
            f"{args.environment} ({result['peerId']})"
        )
    else:
        print(
            "[OK] POSIX Relay runtime prepared: "
            f"{args.environment} ({result['secretMountPath']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
