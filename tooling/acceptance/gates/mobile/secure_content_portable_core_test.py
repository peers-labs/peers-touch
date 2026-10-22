from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile import secure_content_portable_core


ROOT = Path(__file__).resolve().parents[4]


class SecureContentPortableCoreContractTest(unittest.TestCase):
    def test_current_source_satisfies_sc_d30_boundary(self) -> None:
        result = secure_content_portable_core.validate_portable_core(ROOT)

        self.assertEqual(result["forbiddenDependencyFindings"], 0)
        self.assertEqual(
            result["productionConsumers"],
            len(secure_content_portable_core.REQUIRED_PRODUCTION_CONSUMERS),
        )
        self.assertGreaterEqual(result["operationModules"], 10)

    def test_acceptance_trace_is_closed(self) -> None:
        trace = secure_content_portable_core.validate_acceptance_trace(ROOT)

        self.assertEqual(trace["feature"], "unified-client-secure-content-core")
        self.assertEqual(
            trace["capability"],
            "mobile-secure-content-portable-core",
        )
        self.assertEqual(trace["domain"], "mobile")
        self.assertEqual(trace["gate"], "secure-content-portable-core")

    def test_forbidden_platform_dependency_fails_closed(self) -> None:
        with self.contract_copy() as root:
            lib = root / "packages" / "secure-content-core" / "src" / "lib.rs"
            lib.write_text(
                lib.read_text(encoding="utf-8") + "\nuse reqwest::Client;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GateError,
                "imports forbidden owners: HTTP client",
            ):
                secure_content_portable_core.validate_portable_core(root)

    def test_missing_production_consumer_fails_closed(self) -> None:
        with self.contract_copy() as root:
            runtime = (
                root
                / "apps"
                / "mobile"
                / "src-tauri"
                / "src"
                / "secure_content"
                / "runtime.rs"
            )
            runtime.write_text(
                runtime.read_text(encoding="utf-8").replace(
                    "decide_unknown_outcome",
                    "retired_unknown_outcome",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GateError,
                "consumer contract is incomplete",
            ):
                secure_content_portable_core.validate_portable_core(root)

    @mock.patch.object(secure_content_portable_core.subprocess, "run")
    def test_operation_test_command_is_bounded(self, run: mock.Mock) -> None:
        run.return_value = subprocess.CompletedProcess([], 0, "", "")

        secure_content_portable_core.run_operation_tests(ROOT)

        command = run.call_args.args[0]
        self.assertEqual(command[:3], ["cargo", "test", "--manifest-path"])
        self.assertTrue(command[3].endswith("packages/secure-content-core/Cargo.toml"))
        self.assertEqual(command[4:], ["--offline", "operation::"])
        self.assertIn("CARGO_TARGET_DIR", run.call_args.kwargs["env"])

    def contract_copy(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in (
            Path("packages/secure-content-core"),
            Path("apps/desktop/src-tauri/src/secure_content"),
            Path("apps/mobile/src-tauri/src/secure_content"),
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                ROOT / relative,
                destination,
                ignore=shutil.ignore_patterns("target"),
            )
        integration = Path(
            "docs/architecture/shared/security/secure-content/integration.md"
        )
        (root / integration).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / integration, root / integration)
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
