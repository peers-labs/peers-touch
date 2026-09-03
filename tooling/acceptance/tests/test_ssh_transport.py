from __future__ import annotations

import base64
import unittest

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


if __name__ == "__main__":
    unittest.main()
