from __future__ import annotations

import os
import signal
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.gates.agent import foundation_runtime_client
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
    FoundationClientSpec,
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.tcp_fault_proxy import (
    TcpFaultProxy,
    TcpFaultProxyCutController,
    TcpFaultProxyError,
)


class _EchoHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        while True:
            data = self.request.recv(4096)
            if not data:
                return
            self.request.sendall(data)


class TcpFaultProxyTest(unittest.TestCase):
    def test_rejects_https_to_preserve_tls_endpoint_identity(self) -> None:
        with self.assertRaisesRegex(
            TcpFaultProxyError,
            "requires an HTTP Station URL",
        ):
            TcpFaultProxy.from_url("https://station.example")

    def test_cut_restore_and_close_control_real_tcp_path(self) -> None:
        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _EchoHandler)
        server.daemon_threads = True
        server_thread = threading.Thread(
            target=server.serve_forever,
            daemon=True,
        )
        server_thread.start()
        proxy = TcpFaultProxy(
            "127.0.0.1",
            int(server.server_address[1]),
            scheme="http",
        )
        proxy.start()

        try:
            with socket.create_connection(
                ("127.0.0.1", proxy.port),
                timeout=2,
            ) as client:
                client.settimeout(2)
                client.sendall(b"before-cut")
                self.assertEqual(client.recv(64), b"before-cut")
                proxy.cut()
                try:
                    client.sendall(b"after-cut")
                    self.assertNotEqual(client.recv(64), b"after-cut")
                except OSError:
                    pass

            proxy.restore()
            with socket.create_connection(
                ("127.0.0.1", proxy.port),
                timeout=2,
            ) as client:
                client.settimeout(2)
                client.sendall(b"after-restore")
                self.assertEqual(client.recv(64), b"after-restore")
        finally:
            proxy.close()
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=2)

        with socket.socket() as probe:
            self.assertNotEqual(
                probe.connect_ex(("127.0.0.1", proxy.port)),
                0,
            )

    def test_cut_rejects_connection_that_was_dialing_before_restore(self) -> None:
        connect_started = threading.Event()
        release_connect = threading.Event()
        proxy_side, upstream_side = socket.socketpair()
        upstream_side.settimeout(2)

        def connect_upstream(
            _address: tuple[str, int],
            timeout: float,
        ) -> socket.socket:
            self.assertEqual(timeout, 10)
            connect_started.set()
            self.assertTrue(release_connect.wait(timeout=2))
            return proxy_side

        proxy = TcpFaultProxy("127.0.0.1", 1, scheme="http")
        proxy.start()
        downstream = socket.socket()
        downstream.settimeout(2)
        try:
            with patch(
                "tooling.acceptance.gates.agent.tcp_fault_proxy."
                "socket.create_connection",
                side_effect=connect_upstream,
            ):
                downstream.connect(("127.0.0.1", proxy.port))
                self.assertTrue(connect_started.wait(timeout=2))
                proxy.cut()
                proxy.restore()
                release_connect.set()
                self.assertEqual(upstream_side.recv(1), b"")
        finally:
            release_connect.set()
            downstream.close()
            proxy_side.close()
            upstream_side.close()
            proxy.close()

    def test_cut_controller_acknowledges_completed_proxy_cut(self) -> None:
        proxy = TcpFaultProxy("127.0.0.1", 1, scheme="http")
        controller = TcpFaultProxyCutController(proxy)
        proxy.start()
        controller.start()

        try:
            with patch.object(proxy, "cut") as cut:
                request = urllib.request.Request(
                    controller.cut_url,
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    self.assertEqual(response.status, 204)
                cut.assert_called_once_with()
        finally:
            controller.close()
            proxy.close()

        self.assertFalse(controller.is_alive)
        with socket.socket() as probe:
            self.assertNotEqual(
                probe.connect_ex(("127.0.0.1", controller.port)),
                0,
            )


class FoundationClientSpecTest(unittest.TestCase):
    def spec(self, root: Path, runtime: str) -> FoundationClientSpec:
        return FoundationClientSpec.from_mapping(
            {
                "runtime": runtime,
                "worktree": str(root),
                "gateway_port": 23030,
                "renderer_port": 23210,
                "webdriver_port": 24445,
                "storage_root": str(root / "runtime" / "storage"),
                "profile": f"foundation-{runtime}",
            }
        )

    def test_selects_canonical_make_target_and_surface(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = self.spec(root, "native-tauri")
            browser = self.spec(root, "browser")

        self.assertEqual((native.make_target, native.surface), ("desktop", "desktop"))
        self.assertEqual(native.devctl_mode, "app")
        self.assertEqual(
            (browser.make_target, browser.surface),
            ("desktop-web", "browser"),
        )
        self.assertEqual(browser.devctl_mode, "web")
        self.assertEqual(
            native.cargo_target_dir,
            root.resolve()
            / ".local"
            / "acceptance"
            / "cargo-target"
            / "agent-v2"
            / "native-tauri",
        )
        self.assertNotEqual(native.cargo_target_dir, browser.cargo_target_dir)

    def test_rejects_unknown_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                FoundationClientError,
                "unsupported Foundation client runtime",
            ):
                self.spec(Path(directory), "desktop-gateway")

    def test_launch_environment_is_manifest_bound(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = FoundationRuntimeClient(
                self.spec(root, "browser"),
                station_url="http://station.example/",
                profile_env={"PT_STATION_DEPLOY_ENV": "station-1"},
            )
            environment = client.launch_environment()

            self.assertFalse(hasattr(client, "station_url"))
            self.assertTrue(
                environment["PEERS_STATION_URL"].startswith(
                    "http://127.0.0.1:",
                )
            )
            client.stop()

        self.assertEqual(environment["PT_DEV_PROFILE"], "one")
        self.assertEqual(client.runtime_profile.name, "one.env")
        self.assertEqual(environment["PT_PROFILE"], "foundation-browser")
        self.assertEqual(environment["GATEWAY_PORT"], "23030")
        self.assertEqual(environment["WEB_PORT"], "23210")
        self.assertEqual(environment["PT_DESKTOP_E2E"], "true")
        self.assertEqual(environment["VITE_ACCEPTANCE_HARNESS"], "1")
        self.assertEqual(environment["PT_AGENT_GFE1_EXECUTOR_CONTROL"], "1")
        self.assertEqual(
            environment["CARGO_TARGET_DIR"],
            str(
                root.resolve()
                / ".local"
                / "acceptance"
                / "cargo-target"
                / "agent-v2"
                / "browser"
            ),
        )
        self.assertEqual(
            environment["PEERS_ACTOR_IDENTITY_ROOT"],
            str(root / "actor-identity"),
        )
        self.assertNotIn("PT_AGENT_PROVIDER_API_KEY", environment)
    def test_runtime_profile_filename_matches_approved_profile_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"PT_ACCEPTANCE_APPROVED_PROFILE": "chat-native-disposable"},
        ):
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "native-tauri"),
                station_url="http://station.example/",
                profile_env={
                    "PT_DEV_PROFILE": "chat-native-disposable",
                    "PT_STATION_DEPLOY_ENV": "station-1",
                },
            )

            environment = client.launch_environment()

            self.assertEqual(
                client.runtime_profile.name,
                "chat-native-disposable.env",
            )
            self.assertEqual(
                environment["PT_DEV_PROFILE"],
                "chat-native-disposable",
            )
            self.assertEqual(
                environment["PT_DEV_PROFILE_FILE"],
                str(client.runtime_profile),
            )
            client.stop()
        self.assertNotIn("PT_AGENT_PROVIDER_API_KEY", environment)

    def test_managed_launcher_clean_exit_keeps_runtime_readiness_alive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example/",
                profile_env={},
            )
            client.process = Mock()
            client.process.poll.return_value = 0
            client._managed_runtime_started = True

            self.assertTrue(client._process_alive())
            client._managed_runtime_started = False
            client.stop()

    def test_managed_launcher_failure_still_fails_fast(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example/",
                profile_env={},
            )
            client.process = Mock()
            client.process.poll.return_value = 2
            client._managed_runtime_started = True

            with self.assertRaisesRegex(
                FoundationClientError,
                "browser exited with code 2",
            ):
                client._process_alive()
            client._managed_runtime_started = False
            client.stop()

    def test_unmanaged_launcher_clean_exit_still_fails_fast(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example/",
                profile_env={},
            )
            client.process = Mock()
            client.process.poll.return_value = 0

            with self.assertRaisesRegex(
                FoundationClientError,
                "browser exited with code 0",
            ):
                client._process_alive()
            client.stop()

    def test_runtime_pair_requires_exact_native_and_browser_clients(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = {
                "runtime": "native-tauri",
                "worktree": str(root),
                "gateway_port": 23030,
                "renderer_port": 23210,
                "webdriver_port": 24445,
                "storage_root": str(root / "native" / "storage"),
                "profile": "foundation-native",
            }
            browser = {
                **native,
                "runtime": "browser",
                "gateway_port": 23031,
                "renderer_port": 23211,
                "webdriver_port": 24446,
                "storage_root": str(root / "browser" / "storage"),
                "profile": "foundation-browser",
            }
            pair = FoundationRuntimePair.from_manifest(
                {
                    "station": {"url": "http://station.example"},
                    "clients": [native, browser],
                },
                profile_env={},
            )
            pair.stop()

        self.assertEqual(pair.native.spec.runtime, "native-tauri")
        self.assertEqual(pair.browser.spec.runtime, "browser")
        self.assertEqual(
            pair.native.actor_identity_root,
            pair.browser.actor_identity_root,
        )

    def test_start_failure_releases_fault_proxy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example",
                profile_env={},
            )
            proxy_port = client._station_proxy.port
            control_port = client._fault_controller.port
            with (
                patch.object(
                    client,
                    "_write_runtime_profile",
                    side_effect=RuntimeError("profile failed"),
                ),
                patch.object(
                    client,
                    "_stop_runtime",
                    return_value={"status": "clean", "failures": []},
                ) as stop_runtime,
            ):
                with self.assertRaisesRegex(RuntimeError, "profile failed"):
                    client.start()

            stop_runtime.assert_called_once_with(
                logout=False,
                remove_storage=True,
            )
            self.assertFalse(client._station_proxy.is_alive)
            self.assertFalse(client._fault_controller.is_alive)
            with socket.socket() as probe:
                self.assertNotEqual(
                    probe.connect_ex(("127.0.0.1", proxy_port)),
                    0,
                )
            with socket.socket() as probe:
                self.assertNotEqual(
                    probe.connect_ex(("127.0.0.1", control_port)),
                    0,
                )

    def test_start_rollback_error_still_releases_fault_proxy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example",
                profile_env={},
            )
            proxy_port = client._station_proxy.port
            control_port = client._fault_controller.port
            with (
                patch.object(
                    client,
                    "_write_runtime_profile",
                    side_effect=RuntimeError("profile failed"),
                ),
                patch.object(
                    client,
                    "_stop_runtime",
                    side_effect=RuntimeError("rollback failed"),
                ),
            ):
                with self.assertRaisesRegex(
                    FoundationClientError,
                    "rollback failed",
                ):
                    client.start()

            self.assertFalse(client._station_proxy.is_alive)
            self.assertFalse(client._fault_controller.is_alive)
            with socket.socket() as probe:
                self.assertNotEqual(
                    probe.connect_ex(("127.0.0.1", proxy_port)),
                    0,
                )
            with socket.socket() as probe:
                self.assertNotEqual(
                    probe.connect_ex(("127.0.0.1", control_port)),
                    0,
                )

    def test_stop_runtime_error_still_releases_fault_proxy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example",
                profile_env={},
            )
            client._station_proxy.start()
            client._fault_controller.start()
            proxy_port = client._station_proxy.port
            control_port = client._fault_controller.port
            with patch.object(
                client,
                "_stop_runtime",
                side_effect=RuntimeError("runtime cleanup failed"),
            ):
                result = client.stop()

            self.assertEqual(result["status"], "failed")
            self.assertIn(
                "runtime cleanup: runtime cleanup failed",
                result["failures"],
            )
            self.assertFalse(client._station_proxy.is_alive)
            self.assertFalse(client._fault_controller.is_alive)
            with socket.socket() as probe:
                self.assertNotEqual(
                    probe.connect_ex(("127.0.0.1", proxy_port)),
                    0,
                )
            with socket.socket() as probe:
                self.assertNotEqual(
                    probe.connect_ex(("127.0.0.1", control_port)),
                    0,
                )

    def test_runtime_pair_rejects_missing_browser_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = {
                "runtime": "native-tauri",
                "worktree": str(root),
                "gateway_port": 23030,
                "renderer_port": 23210,
                "webdriver_port": 24445,
                "storage_root": str(root / "native" / "storage"),
                "profile": "foundation-native",
            }
            with self.assertRaisesRegex(
                FoundationClientError,
                "requires Native and Browser clients",
            ):
                FoundationRuntimePair.from_manifest(
                    {
                        "station": {"url": "http://station.example"},
                        "clients": [native],
                    },
                    profile_env={},
                )

    def test_restart_preserves_storage_and_relaunches_same_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = FoundationRuntimeClient(
                self.spec(root, "browser"),
                station_url="http://station.example",
                profile_env={},
            )
            with (
                patch.object(
                    client,
                    "_stop_runtime",
                    return_value={"status": "clean", "failures": []},
                ) as stop_runtime,
                patch.object(client, "start") as start,
            ):
                client.restart()
            client.stop()

        stop_runtime.assert_called_once_with(
            logout=False,
            remove_storage=False,
        )
        start.assert_called_once_with()

    def test_harness_error_identifies_runtime_and_method(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "native-tauri"),
                station_url="http://station.example",
                profile_env={},
            )
            client.driver = object()
            with patch(
                "tooling.acceptance.gates.agent.foundation_runtime_client."
                "call_async_harness",
                side_effect=TimeoutError("read timed out"),
            ):
                with self.assertRaisesRegex(
                    FoundationClientError,
                    "native-tauri harness foundationF06DurableReload failed: "
                    "read timed out",
                ):
                    client.harness(
                        "foundationF06DurableReload",
                        {"scenarioKey": "browser|en|AS-F06|sample-001"},
                    )
            client.driver = None
            client.stop()

    def test_f06_prepare_injects_private_fault_control_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "browser"),
                station_url="http://station.example",
                profile_env={},
            )
            with patch.object(
                client,
                "harness",
                return_value={"conversationId": "c1", "turnId": "t1"},
            ) as harness:
                result = client.prepare_foundation_f06(
                    {"scenarioKey": "browser|en|AS-F06|sample-001"},
                    timeout=300,
                )

            self.assertEqual(result["turnId"], "t1")
            payload = harness.call_args.args[1]
            self.assertEqual(
                payload["faultControlUrl"],
                client._fault_controller.cut_url,
            )
            self.assertNotEqual(
                payload["faultControlUrl"],
                client._station_url,
            )
            client.stop()

    def test_runtime_pair_releases_shared_actor_identity_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = {
                "runtime": "native-tauri",
                "worktree": str(root),
                "gateway_port": 23030,
                "renderer_port": 23210,
                "webdriver_port": 24445,
                "storage_root": str(root / "native" / "storage"),
                "profile": "foundation-native",
            }
            browser = {
                **native,
                "runtime": "browser",
                "gateway_port": 23031,
                "renderer_port": 23211,
                "webdriver_port": 24446,
                "storage_root": str(root / "browser" / "storage"),
                "profile": "foundation-browser",
            }
            pair = FoundationRuntimePair.from_manifest(
                {
                    "station": {"url": "http://station.example"},
                    "clients": [native, browser],
                },
                profile_env={},
            )
            pair.native.actor_identity_root.mkdir(parents=True)
            (pair.native.actor_identity_root / "identity.key").write_text(
                "fixture",
                encoding="utf-8",
            )

            result = pair.stop()

            self.assertTrue(result["actorIdentityReleased"])
            self.assertFalse(pair.native.actor_identity_root.exists())

    def test_runtime_pair_can_preserve_storage_for_failed_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = self.spec(root, "browser")
            spec.storage_root.mkdir(parents=True)
            journal = spec.storage_root / "Local Storage" / "capability-journal"
            journal.parent.mkdir()
            journal.write_text("retained", encoding="utf-8")
            client = FoundationRuntimeClient(
                spec,
                station_url="http://station.example",
                profile_env={},
            )

            with patch(
                "tooling.acceptance.gates.agent.foundation_runtime_client."
                "port_open",
                return_value=False,
            ):
                result = client.stop(remove_storage=False)

            self.assertEqual(result["status"], "clean")
            self.assertTrue(result["storagePreserved"])
            self.assertIsNone(result["storageReleased"])
            self.assertEqual(journal.read_text(encoding="utf-8"), "retained")

    def test_stop_runtime_uses_devctl_for_managed_children(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = FoundationRuntimeClient(
                self.spec(root, "native-tauri"),
                station_url="http://station.example",
                profile_env={},
            )
            client._managed_runtime_started = True
            with (
                patch.object(
                    foundation_runtime_client,
                    "port_open",
                    return_value=False,
                ),
                patch.object(
                    foundation_runtime_client,
                    "_native_restart_debug_env",
                    return_value=None,
                ),
                patch(
                    "tooling.acceptance.gates.agent."
                    "foundation_runtime_client.subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        args=[],
                        returncode=0,
                        stdout="",
                        stderr="",
                    ),
                ) as run,
            ):
                result = client._stop_runtime(
                    logout=False,
                    remove_storage=False,
                )

            self.assertEqual(result["status"], "clean")
            self.assertFalse(client._managed_runtime_started)
            command = run.call_args.args[0]
            self.assertEqual(
                command,
                [
                    "node",
                    "tooling/devctl/index.mjs",
                    "desktop",
                    "stop",
                    "--mode",
                    "app",
                ],
            )
            self.assertEqual(run.call_args.kwargs["cwd"], root.resolve())
            self.assertEqual(
                run.call_args.kwargs["env"]["VITE_ACCEPTANCE_HARNESS"],
                "1",
            )

    @unittest.skipUnless(os.name == "posix", "requires POSIX process groups")
    def test_stop_runtime_kills_descendants_after_group_leader_exits(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                renderer_port = int(reservation.getsockname()[1])
            spec = replace(
                self.spec(root, "browser"),
                renderer_port=renderer_port,
            )
            client = FoundationRuntimeClient(
                spec,
                station_url="http://station.example",
                profile_env={},
            )
            child_code = (
                "import signal,socket,time;"
                "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                "listener=socket.socket();"
                "listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);"
                f"listener.bind(('127.0.0.1',{renderer_port}));"
                "listener.listen();"
                "time.sleep(60)"
            )
            leader_code = (
                "import subprocess,sys;"
                "subprocess.Popen("
                "[sys.executable,'-c',sys.argv[1]],"
                "stdin=subprocess.DEVNULL,"
                "stdout=subprocess.DEVNULL,"
                "stderr=subprocess.DEVNULL,"
                "close_fds=True)"
            )
            leader = subprocess.Popen(
                [sys.executable, "-c", leader_code, child_code],
                start_new_session=True,
            )
            process_group_id = leader.pid
            client.process = leader
            client._process_group_id = process_group_id
            try:
                leader.wait(timeout=5)
                foundation_runtime_client.wait_until(
                    lambda: foundation_runtime_client.port_open(renderer_port),
                    "orphaned renderer",
                    5,
                )
                with (
                    patch.object(
                        foundation_runtime_client,
                        "PROCESS_TERMINATION_TIMEOUT_SECONDS",
                        0.05,
                    ),
                    patch.object(
                        foundation_runtime_client,
                        "PROCESS_KILL_TIMEOUT_SECONDS",
                        2.0,
                    ),
                ):
                    result = client._stop_runtime(
                        logout=False,
                        remove_storage=False,
                    )

                self.assertEqual(result["status"], "clean")
                self.assertTrue(result["portsReleased"]["renderer"])
                self.assertIsNone(client.process)
                self.assertIsNone(client._process_group_id)
                self.assertFalse(client._process_group_alive(process_group_id))
            finally:
                try:
                    os.killpg(process_group_id, signal.SIGKILL)
                except ProcessLookupError:
                    pass


if __name__ == "__main__":
    unittest.main()
