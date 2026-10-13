from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
)
from tooling.scripts.deploy.posix_relay_runtime import (
    _remote_prepare_script,
    prepare,
    probe_public_health,
)


def _config() -> PosixServiceRuntimeConfig:
    return PosixServiceRuntimeConfig(
        environment_name="relay-1",
        role="relay",
        host="10.37.118.48",
        user="operator",
        ssh_port=22,
        known_hosts_file="",
        deploy_path="peers-touch/repo",
        runtime_path=".peers-touch/runtime/relay-1",
        http_port=18082,
        public_port=18081,
        libp2p_port=4001,
        public_base_url="https://10.37.118.48:18081",
        compose_project="pt-relay",
        compose_service="relay",
        data_volume="pt-relay_peers_data",
        tls_ca_path="/app/relay-secrets/relay-ca.crt",
        operator_key_path="/app/relay-secrets/relay-operator.key",
    )


class PosixRelayRuntimeTest(unittest.TestCase):
    def test_remote_prepare_script_is_valid_python(self) -> None:
        compile(_remote_prepare_script(), "<posix-relay-runtime>", "exec")

    def test_prepare_generates_linux_secret_contract(self) -> None:
        script = _remote_prepare_script()

        self.assertIn('secret_root.mkdir(parents=True, exist_ok=True)', script)
        self.assertIn('os.chmod(secret_root, 0o700)', script)
        self.assertNotIn('relay-signing.key', script)
        self.assertIn('relay-operator.key', script)
        self.assertIn('ca_key = ca_root / "relay-ca.key"', script)
        self.assertNotIn('ca_key = secret_root / "relay-ca.key"', script)
        self.assertIn('"openssl"', script)
        self.assertIn('os.chmod(path, 0o600)', script)
        self.assertIn('os.chmod(path, 0o644)', script)
        self.assertIn('def unlink_if_exists(path):', script)
        self.assertNotIn('missing_ok=', script)

    @unittest.skipUnless(shutil.which("openssl"), "openssl is required")
    def test_prepare_repairs_leaf_signed_by_foreign_ca(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            cfg = {
                "environmentName": "relay-1",
                "host": "10.37.118.48",
                "runtimePath": ".peers-touch/runtime/relay-1",
            }

            def prepare_runtime() -> None:
                completed = subprocess.run(
                    [sys.executable, "-", json.dumps(cfg, sort_keys=True)],
                    input=_remote_prepare_script(),
                    capture_output=True,
                    text=True,
                    env={**os.environ, "HOME": str(home)},
                    check=False,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)

            prepare_runtime()
            runtime = home / cfg["runtimePath"]
            secrets = runtime / "secrets"

            def certificate_text(path: Path) -> str:
                completed = subprocess.run(
                    [
                        "openssl",
                        "x509",
                        "-in",
                        str(path),
                        "-noout",
                        "-text",
                    ],
                    capture_output=True,
                    check=True,
                    text=True,
                )
                return completed.stdout

            ca_text = certificate_text(secrets / "relay-ca.crt")
            leaf_text = certificate_text(secrets / "relay.crt")
            self.assertEqual(ca_text.count("X509v3 Basic Constraints"), 1)
            self.assertIn("X509v3 Subject Key Identifier", leaf_text)
            self.assertIn("X509v3 Authority Key Identifier", leaf_text)
            original_ca = (secrets / "relay-ca.crt").read_bytes()
            foreign_key = runtime / "foreign-ca.key"
            foreign_cert = runtime / "foreign-ca.crt"
            request = runtime / "foreign-leaf.csr"
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    str(foreign_key),
                    "-out",
                    str(foreign_cert),
                    "-days",
                    "1",
                    "-subj",
                    "/CN=Foreign CA",
                ],
                capture_output=True,
                check=True,
            )
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-new",
                    "-key",
                    str(secrets / "relay-tls.key"),
                    "-out",
                    str(request),
                    "-subj",
                    "/CN=10.37.118.48",
                ],
                capture_output=True,
                check=True,
            )
            subprocess.run(
                [
                    "openssl",
                    "x509",
                    "-req",
                    "-in",
                    str(request),
                    "-CA",
                    str(foreign_cert),
                    "-CAkey",
                    str(foreign_key),
                    "-CAcreateserial",
                    "-out",
                    str(secrets / "relay.crt"),
                    "-days",
                    "1",
                ],
                capture_output=True,
                check=True,
            )
            invalid = subprocess.run(
                [
                    "openssl",
                    "verify",
                    "-CAfile",
                    str(secrets / "relay-ca.crt"),
                    str(secrets / "relay.crt"),
                ],
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(invalid.returncode, 0)

            prepare_runtime()

            self.assertEqual(
                (secrets / "relay-ca.crt").read_bytes(),
                original_ca,
            )
            subprocess.run(
                [
                    "openssl",
                    "verify",
                    "-CAfile",
                    str(secrets / "relay-ca.crt"),
                    str(secrets / "relay.crt"),
                ],
                capture_output=True,
                check=True,
            )
            subprocess.run(
                [
                    "openssl",
                    "x509",
                    "-in",
                    str(secrets / "relay.crt"),
                    "-noout",
                    "-checkip",
                    cfg["host"],
                ],
                capture_output=True,
                check=True,
            )
            repaired_leaf = certificate_text(secrets / "relay.crt")
            self.assertIn("X509v3 Subject Key Identifier", repaired_leaf)
            self.assertIn("X509v3 Authority Key Identifier", repaired_leaf)

    def test_prepare_uses_reviewed_linux_transport(self) -> None:
        config = _config()
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(
                {
                    "artifactKind": "posix-relay-runtime-preparation",
                    "environmentName": "relay-1",
                    "platform": "linux",
                    "runtimePath": "/home/operator/.peers-touch/runtime/relay-1",
                    "secretMountPath": (
                        "/home/operator/.peers-touch/runtime/relay-1/secrets"
                    ),
                    "files": [],
                }
            ),
            stderr="",
        )
        config_transport = MagicMock(return_value=transport)
        object.__setattr__(config, "transport", config_transport)

        result = prepare(config)

        self.assertEqual(result["platform"], "linux")
        argv = transport.run_argv.call_args.args[0]
        self.assertEqual(argv[:2], ["python3", "-"])
        self.assertIn('"runtimePath": ".peers-touch/runtime/relay-1"', argv[2])

    def test_public_probe_uses_reviewed_ca_and_exact_profile_url(self) -> None:
        certificate = (
            "-----BEGIN CERTIFICATE-----\n"
            "MIIB\n"
            "-----END CERTIFICATE-----\n"
        ).encode("ascii")
        resolver = MagicMock(
            return_value=(certificate, "sha256:" + ("a" * 64))
        )
        runner = MagicMock(
            return_value=subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(
                    {
                        "peer_id": "12D3KooWRelay",
                        "role": "relay",
                        "status": "ready",
                    }
                ),
                stderr="",
            )
        )

        with patch(
            "tooling.scripts.deploy.posix_relay_runtime.ssl.PEM_cert_to_DER_cert",
            return_value=b"der",
        ):
            result = probe_public_health(
                _config(),
                expected_base_url="https://10.37.118.48:18081",
                trust_anchor_resolver=resolver,
                runner=runner,
            )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["peerId"], "12D3KooWRelay")
        resolver.assert_called_once_with("relay-1")
        argv = runner.call_args.args[0]
        self.assertIn("--cacert", argv)
        self.assertNotIn("-k", argv)
        self.assertEqual(
            argv[-1],
            "https://10.37.118.48:18081/healthz",
        )
        self.assertEqual(
            Path(argv[argv.index("--cacert") + 1]).name,
            "relay-ca.pem",
        )

    def test_public_probe_rejects_profile_url_drift_before_tls(self) -> None:
        resolver = MagicMock()

        with self.assertRaisesRegex(
            Exception,
            "does not match the reviewed deploy environment",
        ):
            probe_public_health(
                _config(),
                expected_base_url="https://relay.example.com",
                trust_anchor_resolver=resolver,
            )

        resolver.assert_not_called()


if __name__ == "__main__":
    unittest.main()
