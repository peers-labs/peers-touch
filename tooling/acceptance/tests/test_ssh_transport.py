from __future__ import annotations

import base64
import subprocess
import unittest
from unittest.mock import patch

from tooling.acceptance.transports.ssh import (
    RemotePlatform,
    SshTarget,
    SshTransport,
)


class SshTransportRenderingTest(unittest.TestCase):
    def test_posix_rendering_is_unchanged(self) -> None:
        transport = SshTransport(SshTarget("host.example", "runner"))
        self.assertEqual(
            transport.render_remote_argv(("printf", "%s", "a b")),
            "printf %s 'a b'",
        )

    def test_windows_rendering_uses_encoded_powershell(self) -> None:
        transport = SshTransport(
            SshTarget(
                "host.example",
                "runner",
                remote_platform=RemotePlatform.WINDOWS,
            )
        )
        rendered = transport.render_remote_argv(
            ("tool.exe", "a b", "x'y", "$value; & echo")
        )
        prefix = "powershell.exe -NoProfile -NonInteractive -EncodedCommand "
        self.assertTrue(rendered.startswith(prefix))
        decoded = base64.b64decode(
            rendered.removeprefix(prefix)
        ).decode("utf-16le")
        self.assertIn("[Console]::OutputEncoding=$utf8", decoded)
        self.assertIn("& 'tool.exe' 'a b' 'x''y' '$value; & echo'", decoded)
        self.assertIn("$LASTEXITCODE", decoded)

    def test_windows_path_validation_is_fail_closed(self) -> None:
        valid = (
            "C:/Users/runner/AppData/Local/Peers Touch/log.txt",
            "D:/cache/file.bin",
        )
        invalid = (
            "/tmp/file",
            "C:relative/file",
            "C:/safe/../escape",
            "//server/share/file",
            "C:/bad./file",
            "C:/bad /file",
        )
        for path in valid:
            with self.subTest(path=path):
                self.assertTrue(SshTransport._valid_windows_path(path))
        for path in invalid:
            with self.subTest(path=path):
                self.assertFalse(SshTransport._valid_windows_path(path))

    def test_loopback_probe_default_accounts_for_remote_platform_startup(
        self,
    ) -> None:
        for platform, expected_timeout in (
            (RemotePlatform.POSIX, 2.0),
            (RemotePlatform.WINDOWS, 5.0),
        ):
            with self.subTest(platform=platform):
                transport = SshTransport(
                    SshTarget(
                        "host.example",
                        "runner",
                        remote_platform=platform,
                    )
                )
                completed = subprocess.CompletedProcess(
                    ("python",),
                    0,
                    stdout="",
                    stderr="",
                )
                with patch.object(
                    transport,
                    "run_argv",
                    return_value=completed,
                ) as run:
                    self.assertTrue(
                        transport.remote_loopback_port_listening(4645)
                    )

                self.assertEqual(
                    run.call_args.kwargs["timeout"],
                    expected_timeout,
                )

    def test_loopback_probe_preserves_explicit_timeout(self) -> None:
        transport = SshTransport(
            SshTarget(
                "host.example",
                "runner",
                remote_platform=RemotePlatform.WINDOWS,
            )
        )
        completed = subprocess.CompletedProcess(
            ("python",),
            0,
            stdout="",
            stderr="",
        )
        with patch.object(
            transport,
            "run_argv",
            return_value=completed,
        ) as run:
            self.assertTrue(
                transport.remote_loopback_port_listening(
                    4645,
                    timeout=1.5,
                )
            )

        self.assertEqual(run.call_args.kwargs["timeout"], 1.5)


if __name__ == "__main__":
    unittest.main()
