from __future__ import annotations

import json
import subprocess
import unittest
from unittest.mock import MagicMock

from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
)
from tooling.scripts.deploy.posix_relay_runtime import (
    _remote_prepare_script,
    prepare,
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
        stream_port=4501,
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
        self.assertIn('relay-signing.key', script)
        self.assertIn('relay-operator.key', script)
        self.assertIn('ca_key = ca_root / "relay-ca.key"', script)
        self.assertNotIn('ca_key = secret_root / "relay-ca.key"', script)
        self.assertIn('"openssl"', script)
        self.assertIn('os.chmod(path, 0o600)', script)
        self.assertIn('os.chmod(path, 0o644)', script)

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


if __name__ == "__main__":
    unittest.main()
