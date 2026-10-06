#!/usr/bin/env python3

from __future__ import annotations

import unittest

from tooling.scripts.deploy.windows_runtime import _remote_runtime_script


class WindowsRuntimeScriptTest(unittest.TestCase):
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

        self.assertIn("def rotate_service_log():", script)
        self.assertIn("log_path.replace(previous_log_path)", script)
        self.assertLess(
            deploy.index("stop_owned()"),
            deploy.index("rotate_service_log()"),
        )


if __name__ == "__main__":
    unittest.main()
