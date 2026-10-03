from __future__ import annotations

import base64
import json
import subprocess
import unittest
from unittest.mock import Mock
from unittest.mock import patch

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.transports.ssh import (
    RemotePlatform,
    SshTarget,
    SshTransport,
    SshTunnel,
)


class SshTransportRenderingTest(unittest.TestCase):
    @patch("tooling.acceptance.transports.ssh.os.name", "nt")
    def test_windows_tunnel_stop_terminates_process(self) -> None:
        process = Mock()
        process.poll.return_value = None
        tunnel = SshTunnel(process, 4645)

        tunnel.stop()

        process.terminate.assert_called_once_with()
        process.kill.assert_not_called()
        process.wait.assert_called_once_with(timeout=5)

    @patch("tooling.acceptance.transports.ssh.os.name", "nt")
    def test_windows_tunnel_stop_kills_after_timeout(self) -> None:
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = (
            subprocess.TimeoutExpired("ssh", 5),
            0,
        )
        tunnel = SshTunnel(process, 4645)

        tunnel.stop()

        process.terminate.assert_called_once_with()
        process.kill.assert_called_once_with()
        self.assertEqual(process.wait.call_count, 2)

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
        argv = ("tool.exe", "a b", "x'y", 'quoted"value', "$value; & echo")
        rendered = transport.render_remote_argv(argv)
        prefix = "powershell.exe -NoProfile -NonInteractive -EncodedCommand "
        self.assertTrue(rendered.startswith(prefix))
        decoded = base64.b64decode(
            rendered.removeprefix(prefix)
        ).decode("utf-16le")
        self.assertIn("[Console]::OutputEncoding=$utf8", decoded)
        encoded_argv = base64.b64encode(
            json.dumps(list(argv), ensure_ascii=False).encode("utf-8")
        ).decode("ascii")
        self.assertIn(f"'{encoded_argv}'", decoded)
        self.assertIn("argv=json.loads(base64.b64decode(sys.argv[1]))", decoded)
        self.assertIn("subprocess.run(argv)", decoded)
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

    def test_local_forward_targets_reviewed_remote_endpoint(self) -> None:
        transport = SshTransport(SshTarget("host.example", "runner"))
        tunnel = Mock()
        with (
            patch.object(
                transport,
                "remote_endpoint_listening",
                return_value=True,
            ) as probe,
            patch.object(
                transport,
                "_start_forward",
                return_value=tunnel,
            ) as start,
        ):
            resolved = transport.start_local_forward(
                remote_host="10.0.0.4",
                remote_port=18080,
                local_port=4101,
                timeout=7,
            )

        self.assertIs(resolved, tunnel)
        probe.assert_called_once_with("10.0.0.4", 18080, timeout=7)
        start.assert_called_once_with(
            direction="-L",
            specification="127.0.0.1:4101:10.0.0.4:18080",
            local_probe_port=4101,
            remote_probe_port=None,
            timeout=7,
        )

    def test_local_forward_defaults_to_remote_loopback(self) -> None:
        transport = SshTransport(SshTarget("host.example", "runner"))
        with (
            patch.object(
                transport,
                "remote_endpoint_listening",
                return_value=True,
            ) as probe,
            patch.object(transport, "_start_forward", return_value=Mock()),
        ):
            transport.start_local_forward(
                remote_port=18080,
                local_port=4101,
            )

        probe.assert_called_once_with("127.0.0.1", 18080, timeout=10)

    def test_local_forward_rejects_invalid_remote_host(self) -> None:
        transport = SshTransport(SshTarget("host.example", "runner"))

        with self.assertRaises(ProvisioningError):
            transport.start_local_forward(
                remote_host="host name",
                remote_port=18080,
            )

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
                self.assertEqual(
                    run.call_args.args[0][-2:],
                    ("127.0.0.1", "4645"),
                )

    def test_remote_endpoint_probe_uses_requested_host(self) -> None:
        transport = SshTransport(SshTarget("host.example", "runner"))
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
                transport.remote_endpoint_listening(
                    "10.0.0.4",
                    18080,
                )
            )

        self.assertEqual(
            run.call_args.args[0][-2:],
            ("10.0.0.4", "18080"),
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

    def test_available_remote_port_uses_target_python(self) -> None:
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
            stdout="61234\n",
            stderr="",
        )
        with patch.object(
            transport,
            "run_argv",
            return_value=completed,
        ) as run:
            self.assertEqual(transport.available_remote_port(), 61234)

        self.assertEqual(run.call_args.args[0][0], "python")
        self.assertTrue(run.call_args.kwargs["check"])


if __name__ == "__main__":
    unittest.main()
