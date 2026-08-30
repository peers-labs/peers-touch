from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
    FoundationClientSpec,
    FoundationRuntimeClient,
    FoundationRuntimePair,
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
        self.assertEqual(
            (browser.make_target, browser.surface),
            ("desktop-web", "browser"),
        )

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
                station_url="https://station.example/",
                profile_env={"PT_STATION_DEPLOY_ENV": "station-1"},
            )
            environment = client.launch_environment()

        self.assertEqual(environment["PT_DEV_PROFILE"], "one")
        self.assertEqual(environment["PT_PROFILE"], "foundation-browser")
        self.assertEqual(environment["GATEWAY_PORT"], "23030")
        self.assertEqual(environment["WEB_PORT"], "23210")
        self.assertEqual(environment["PEERS_STATION_URL"], "https://station.example")
        self.assertEqual(environment["PT_DESKTOP_E2E"], "true")
        self.assertEqual(
            environment["PEERS_ACTOR_IDENTITY_ROOT"],
            str(root / "actor-identity"),
        )
        self.assertNotIn("PT_AGENT_PROVIDER_API_KEY", environment)

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
                    "station": {"url": "https://station.example"},
                    "clients": [native, browser],
                },
                profile_env={},
            )

        self.assertEqual(pair.native.spec.runtime, "native-tauri")
        self.assertEqual(pair.browser.spec.runtime, "browser")
        self.assertEqual(
            pair.native.actor_identity_root,
            pair.browser.actor_identity_root,
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
                        "station": {"url": "https://station.example"},
                        "clients": [native],
                    },
                    profile_env={},
                )

    def test_restart_preserves_storage_and_relaunches_same_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = FoundationRuntimeClient(
                self.spec(root, "browser"),
                station_url="https://station.example",
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

        stop_runtime.assert_called_once_with(
            logout=False,
            remove_storage=False,
        )
        start.assert_called_once_with()

    def test_harness_error_identifies_runtime_and_method(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = FoundationRuntimeClient(
                self.spec(Path(directory), "native-tauri"),
                station_url="https://station.example",
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
                    "station": {"url": "https://station.example"},
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
                station_url="https://station.example",
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


if __name__ == "__main__":
    unittest.main()
