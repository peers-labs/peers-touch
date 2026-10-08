from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
    audit_posix_relay_security,
    inspect_posix_runtime,
)


COMMIT = "a" * 40


def _config(role: str) -> PosixServiceRuntimeConfig:
    return PosixServiceRuntimeConfig(
        environment_name=f"one-{role}",
        role=role,
        host=f"{role}.example",
        user="operator",
        ssh_port=22,
        known_hosts_file="",
        deploy_path=f"peers-touch/{role}",
        runtime_path=f".peers-touch/runtime/{role}",
        http_port=18080 if role == "station" else 18082,
        public_port=18080 if role == "station" else 18081,
        stream_port=None if role == "station" else 4501,
        public_base_url=(
            "http://station.example:18080"
            if role == "station"
            else "https://relay.example:18081"
        ),
        compose_project=f"pt-{role}",
        compose_service=role,
        data_volume=f"pt-{role}_peers_data",
        tls_ca_path=(
            "" if role == "station" else "/app/data/relay-ca.crt"
        ),
        operator_key_path=(
            "" if role == "station" else "/app/data/relay-operator.key"
        ),
    )


def _status(role: str) -> dict[str, object]:
    config = _config(role)
    return {
        "artifactKind": "posix-compose-runtime-status",
        "environmentName": config.environment_name,
        "platform": "linux",
        "role": role,
        "runtimeOwner": f"docker-compose:pt-{role}/{role}",
        "runtimePath": f"/home/operator/peers-touch/{role}",
        "containerId": role + "-container",
        "processIds": [101 if role == "station" else 202],
        "healthy": True,
        "sourceCommit": COMMIT,
        "sourceClean": True,
        "imageId": "sha256:" + "b" * 64,
        "imageDigest": "sha256:" + "b" * 64,
        "buildCommit": COMMIT,
        "buildTime": "2026-10-08T00:00:00Z",
        "dataOwner": config.data_volume,
        "httpPort": config.http_port,
        "publicPort": config.public_port,
        "streamPort": config.stream_port,
    }


class PosixServiceRuntimeTest(unittest.TestCase):
    def test_relay_config_requires_posix_compose_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "relay-1.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=10.37.118.48",
                        "PT_DEPLOY_USER=operator",
                        "PT_DEPLOY_PATH=peers-touch/repo",
                        "PT_DEPLOY_RUNTIME_PATH=.peers-touch/runtime/relay-1",
                        "PT_DEPLOY_ROLE=relay",
                        "PT_DEPLOY_PLATFORM=posix",
                        "PT_DEPLOY_RUNTIME_KIND=docker-compose",
                        "PT_DEPLOY_COMPOSE_PROJECT=pt-relay",
                        "PT_DEPLOY_COMPOSE_SERVICE=relay",
                        "PT_DEPLOY_DATA_VOLUME=pt-relay_peers_data",
                        "PT_DEPLOY_HTTP_PORT=18082",
                        "PT_DEPLOY_STREAM_PORT=4501",
                        "PT_DEPLOY_PUBLIC_BASE_URL=https://10.37.118.48:18081",
                        "PT_DEPLOY_TLS_CA_PATH=/app/relay-secrets/relay-ca.crt",
                        "PT_DEPLOY_OPERATOR_KEY_PATH=/app/relay-secrets/relay-operator.key",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            with patch(
                "tooling.acceptance.provisioners.posix_service_runtime."
                "resolve_deployment_environment_path",
                return_value=environment,
            ):
                config = PosixServiceRuntimeConfig.load(
                    "relay-1",
                    expected_role="relay",
                )

        self.assertEqual(config.host, "10.37.118.48")
        self.assertEqual(config.http_port, 18082)
        self.assertEqual(config.public_port, 18081)
        self.assertEqual(config.stream_port, 4501)

    def test_relay_config_rejects_windows_platform(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "relay.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=windows.example",
                        "PT_DEPLOY_USER=operator",
                        "PT_DEPLOY_PATH=relay",
                        "PT_DEPLOY_ROLE=relay",
                        "PT_DEPLOY_PLATFORM=windows",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            with (
                patch(
                    "tooling.acceptance.provisioners.posix_service_runtime."
                    "resolve_deployment_environment_path",
                    return_value=environment,
                ),
                self.assertRaisesRegex(
                    ProvisioningError,
                    "POSIX deployment contract",
                ),
            ):
                PosixServiceRuntimeConfig.load(
                    "relay",
                    expected_role="relay",
                )

    def test_runtime_inspection_accepts_exact_linux_compose_owner(self) -> None:
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(_status("relay")),
            stderr="",
        )

        status = inspect_posix_runtime(_config("relay"), transport=transport)

        self.assertEqual(status["platform"], "linux")
        self.assertEqual(
            status["runtimeOwner"],
            "docker-compose:pt-relay/relay",
        )
        self.assertEqual(
            transport.run_argv.call_args.args[0][:2],
            ["python3", "-"],
        )

    def test_runtime_inspection_rejects_unhealthy_container(self) -> None:
        status = _status("relay")
        status["healthy"] = False
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(status),
            stderr="",
        )

        with self.assertRaisesRegex(BlockedError, "is incomplete"):
            inspect_posix_runtime(_config("relay"), transport=transport)

    def test_relay_security_requires_posix_modes_and_distinct_data(self) -> None:
        transport = MagicMock()
        status = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(_status("relay")),
            stderr="",
        )
        file_lines = [
            "/app/relay-secrets/relay-operator.key|600|0|0|32",
            "/app/relay-secrets/relay-signing.key|600|0|0|32",
            "/app/relay-secrets/relay-tls.key|600|0|0|32",
            "/app/relay-secrets/relay-ca.crt|644|0|0|512",
            "/app/relay-secrets/relay.crt|644|0|0|512",
            ("c" * 64) + "  /app/peers-touch-station",
        ]
        audit = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="\n".join(file_lines) + "\n",
            stderr="",
        )
        transport.run_argv.side_effect = (status, audit)

        evidence = audit_posix_relay_security(
            _config("relay"),
            station_runtime={
                "runtimeOwner": "docker-compose:pt-station/station",
                "dataOwner": "pt-station_peers_data",
            },
            relay_runtime={
                "runtimeOwner": "docker-compose:pt-relay/relay",
                "dataOwner": "pt-relay_peers_data",
            },
            transport=transport,
        )

        self.assertEqual(evidence["platform"], "linux")
        self.assertTrue(evidence["processBinaryMatches"])
        self.assertTrue(
            all(
                record["protected"]
                for record in evidence["requiredProtectedFiles"]
            )
        )


if __name__ == "__main__":
    unittest.main()
