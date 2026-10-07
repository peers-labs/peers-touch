#!/usr/bin/env python3

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from tooling.acceptance.core.errors import ProvisioningError
from tooling.scripts.deploy.windows_runtime import (
    WindowsRuntimeConfig,
    _remote_runtime_script,
    _rotate_service_log,
)


class WindowsRuntimeScriptTest(unittest.TestCase):
    def test_relay_config_rejects_public_port_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "relay.env"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=relay.example",
                        "PT_DEPLOY_USER=administrator",
                        "PT_DEPLOY_PATH=deploy/relay",
                        "PT_DEPLOY_RUNTIME_PATH=runtime/relay",
                        "PT_DEPLOY_ROLE=relay",
                        "PT_DEPLOY_PLATFORM=windows",
                        "PT_DEPLOY_HTTP_PORT=18081",
                        "PT_DEPLOY_PUBLIC_BASE_URL=https://relay.example:18081",
                        "PT_DEPLOY_STREAM_PORT=4501",
                        "PT_DEPLOY_TASK_NAME=PeersTouch-relay",
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ProvisioningError,
                "must be distinct",
            ):
                WindowsRuntimeConfig.load("relay", environment)

    def test_remote_runtime_script_is_valid_python(self) -> None:
        compile(_remote_runtime_script(), "<windows-runtime>", "exec")

    def test_build_artifact_is_reused_by_exact_station_tree(self) -> None:
        script = _remote_runtime_script()

        self.assertIn('commit + ":apps/station"', script)
        self.assertIn('"buildIdentity": build_identity', script)
        self.assertIn("shutil.copy2(binary, temporary)", script)
        self.assertIn("shutil.copy2(artifact_path, binary)", script)

    def test_build_limits_memory_and_strips_debug_symbols(self) -> None:
        script = _remote_runtime_script()

        self.assertIn('"-Wl,--no-keep-memory "', script)
        self.assertIn('"-Wl,--reduce-memory-overheads"', script)
        self.assertIn('"GOMAXPROCS": "2"', script)
        self.assertIn('"-p=1"', script)
        self.assertIn('"-ldflags=-s -w"', script)

    def test_tls_generation_ignores_broken_openssl_install_defaults(self) -> None:
        script = _remote_runtime_script()
        generate_tls = script[
            script.index("def generate_tls")
            : script.index("def apply_secret_acl")
        ]

        self.assertIn('"-config",', generate_tls)
        self.assertIn('"NUL",', generate_tls)
        self.assertIn("basicConstraints=critical,CA:TRUE,pathlen:0", generate_tls)
        self.assertIn("extendedKeyUsage=serverAuth", generate_tls)
        self.assertIn("subjectAltName=", generate_tls)

    def test_relay_uses_distinct_public_internal_and_stream_ports(self) -> None:
        script = _remote_runtime_script()

        self.assertIn('"          public-listen-addr: :"', script)
        self.assertIn(
            '"          public-upstream-url: http://127.0.0.1:"',
            script,
        )
        self.assertIn('"      address: 127.0.0.1:"', script)
        self.assertIn(
            'cfg["publicPort"] if role == "relay" else cfg["httpPort"]',
            script,
        )

    def test_native_service_stderr_does_not_terminate_runner(self) -> None:
        script = _remote_runtime_script()
        runner = script[
            script.index("def prepare_runner")
            : script.index("def configure_firewall")
        ]

        fail_fast = runner.index("\"$ErrorActionPreference = 'Stop'\"")
        utf8_logs = runner.index(
            "\"$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'\""
        )
        native_stderr = runner.index("\"$ErrorActionPreference = 'Continue'\"")
        service_start = runner.index('"& "')

        self.assertLess(fail_fast, utf8_logs)
        self.assertLess(utf8_logs, native_stderr)
        self.assertLess(native_stderr, service_start)

    def test_deploy_rotates_the_previous_service_log(self) -> None:
        script = _remote_runtime_script()
        deploy = script[script.index("def deploy()") :]
        rotate = script[
            script.index("def _rotate_service_log(")
            : script.index("def materialize_binary")
        ]

        self.assertIn("def _rotate_service_log(", script)
        self.assertIn("log_path.replace(previous_log_path)", script)
        self.assertIn("deadline = monotonic() + timeout_seconds", rotate)
        self.assertIn("except PermissionError as error:", rotate)
        self.assertIn(
            "timed out waiting for Windows service log release",
            rotate,
        )
        self.assertIn("sleep(retry_interval_seconds)", rotate)
        self.assertLess(
            deploy.index("stop_owned()"),
            deploy.index("_rotate_service_log(log_path)"),
        )

    def test_log_rotation_retries_transient_permission_error(self) -> None:
        log_path = MagicMock()
        previous_log_path = MagicMock()
        log_path.is_file.return_value = True
        log_path.with_suffix.return_value = previous_log_path
        log_path.replace.side_effect = [PermissionError("busy"), None]
        monotonic = MagicMock(side_effect=[0.0, 0.1])
        sleep = MagicMock()

        _rotate_service_log(
            log_path,
            monotonic=monotonic,
            sleep=sleep,
        )

        self.assertEqual(log_path.replace.call_count, 2)
        sleep.assert_called_once_with(0.25)

    def test_log_rotation_times_out_on_persistent_permission_error(self) -> None:
        log_path = MagicMock()
        log_path.is_file.return_value = True
        log_path.with_suffix.return_value = MagicMock()
        log_path.replace.side_effect = PermissionError("busy")

        with self.assertRaisesRegex(
            RuntimeError,
            "timed out waiting for Windows service log release",
        ):
            _rotate_service_log(
                log_path,
                timeout_seconds=1.0,
                monotonic=MagicMock(side_effect=[0.0, 1.0]),
                sleep=MagicMock(),
            )

    def test_log_rotation_ignores_missing_service_log(self) -> None:
        log_path = MagicMock()
        log_path.is_file.return_value = False

        _rotate_service_log(log_path)

        log_path.with_suffix.assert_not_called()

    def test_log_rotation_replaces_existing_previous_log(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory) / "relay.log"
            previous_log_path = log_path.with_suffix(".previous.log")
            log_path.write_text("current", encoding="utf-8")
            previous_log_path.write_text("old", encoding="utf-8")

            _rotate_service_log(log_path)

            self.assertFalse(log_path.exists())
            self.assertEqual(
                previous_log_path.read_text(encoding="utf-8"),
                "current",
            )

    def test_secret_acl_is_applied_to_each_relay_secret_file(self) -> None:
        script = _remote_runtime_script()
        acl = script[
            script.index("def apply_secret_acl")
            : script.index("def yaml_path")
        ]

        self.assertIn('secret_root / "relay-operator.key"', acl)
        self.assertIn('secret_root / "relay-signing.key"', acl)
        self.assertIn('secret_root / "relay-ca.key"', acl)
        self.assertIn('secret_root / "relay-ca.crt"', acl)
        self.assertIn('secret_root / "relay-tls.key"', acl)
        self.assertIn('secret_root / "relay.crt"', acl)
        self.assertIn("for secret_path in secret_paths:", acl)
        self.assertIn('username + ":F"', acl)


if __name__ == "__main__":
    unittest.main()
