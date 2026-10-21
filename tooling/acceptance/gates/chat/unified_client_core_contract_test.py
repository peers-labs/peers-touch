from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat import unified_client_core_contract


ROOT = Path(__file__).resolve().parents[4]


class UnifiedClientMessagingCoreContractTest(unittest.TestCase):
    def test_current_source_satisfies_mp_d16_boundary(self) -> None:
        result = unified_client_core_contract.validate_portable_core(ROOT)

        self.assertEqual(result["forbiddenApplicationFindings"], 0)
        self.assertEqual(result["forbiddenOsOwnerFindings"], 0)
        self.assertGreaterEqual(result["contractModules"], 15)
        self.assertEqual(result["nativeFilesystemMarkers"], 5)
        self.assertEqual(result["deletedDesktopOwnerFiles"], 12)

    def test_acceptance_trace_is_closed(self) -> None:
        trace = unified_client_core_contract.validate_acceptance_trace(ROOT)

        self.assertEqual(trace["feature"], "unified-client-messaging-core")
        self.assertEqual(trace["capability"], "chat-portable-messaging-core")
        self.assertEqual(trace["domain"], "chat")
        self.assertEqual(trace["gate"], "unified-client-messaging-core-contract")

    def test_forbidden_application_dependency_fails_closed(self) -> None:
        with self.contract_copy() as root:
            lifecycle = (
                root
                / "packages"
                / "messaging-core"
                / "src"
                / "engine"
                / "lifecycle.rs"
            )
            lifecycle.write_text(
                lifecycle.read_text(encoding="utf-8")
                + "\nuse tauri::Manager;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GateError,
                "imports forbidden application owners",
            ):
                unified_client_core_contract.validate_portable_core(root)

    def test_new_os_owner_fails_closed(self) -> None:
        with self.contract_copy() as root:
            lifecycle = (
                root
                / "packages"
                / "messaging-core"
                / "src"
                / "engine"
                / "lifecycle.rs"
            )
            lifecycle.write_text(
                lifecycle.read_text(encoding="utf-8") + "\nuse std::fs;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GateError,
                "imports forbidden OS owners",
            ):
                unified_client_core_contract.validate_portable_core(root)

    def test_missing_production_consumer_fails_closed(self) -> None:
        with self.contract_copy() as root:
            engine = (
                root
                / "apps"
                / "mobile"
                / "src-tauri"
                / "src"
                / "messaging"
                / "engine.rs"
            )
            engine.write_text(
                engine.read_text(encoding="utf-8").replace(
                    "DirectOutboundPreparer",
                    "RemovedOutboundPreparer",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GateError,
                "production core consumers are incomplete",
            ):
                unified_client_core_contract.validate_portable_core(root)

    @mock.patch.object(unified_client_core_contract.subprocess, "run")
    def test_contract_test_commands_are_bounded(self, run: mock.Mock) -> None:
        run.return_value = subprocess.CompletedProcess([], 0, "", "")

        unified_client_core_contract.run_portable_contract_tests(ROOT)

        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(len(commands), 2)
        self.assertEqual(commands[0][-2:], ["--offline", "engine::"])
        self.assertEqual(
            commands[1][-2:],
            [
                "--offline",
                "ambiguous_submission_waits_for_authority_reconciliation",
            ],
        )
        for call in run.call_args_list:
            self.assertIn("CARGO_TARGET_DIR", call.kwargs["env"])

    def contract_copy(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in (
            Path("packages/messaging-core"),
            Path("packages/messaging-native-filesystem"),
            Path("apps/desktop/src-tauri/src/messaging"),
            Path("apps/mobile/src-tauri/src/messaging"),
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                ROOT / relative,
                destination,
                ignore=shutil.ignore_patterns("target"),
            )
        for relative in (
            Path("docs/architecture/domains/chat/messaging/integration.md"),
            Path("docs/architecture/domains/chat/messaging/data-model.md"),
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        return _TemporaryRoot(temporary, root)


class _TemporaryRoot:
    def __init__(
        self,
        temporary: tempfile.TemporaryDirectory[str],
        root: Path,
    ) -> None:
        self.temporary = temporary
        self.root = root

    def __enter__(self) -> Path:
        return self.root

    def __exit__(self, *_args: object) -> None:
        self.temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
