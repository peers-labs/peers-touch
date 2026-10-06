#!/usr/bin/env python3

from __future__ import annotations

import unittest

from tooling.scripts.deploy.windows_runtime import _remote_runtime_script


class WindowsRuntimeScriptTest(unittest.TestCase):
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
        native_stderr = runner.index("\"$ErrorActionPreference = 'Continue'\"")
        service_start = runner.index('"& "')

        self.assertLess(fail_fast, native_stderr)
        self.assertLess(native_stderr, service_start)


if __name__ == "__main__":
    unittest.main()
