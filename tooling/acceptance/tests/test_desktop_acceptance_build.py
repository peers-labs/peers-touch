"""Synthetic build producer checks; these do not claim Desktop product proof."""

from __future__ import annotations

from contextlib import ExitStack
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import (
    BlockedError, EphemeralLaunchCleanupFailed, EphemeralLaunchTimeout,
)
from tooling.acceptance.core.execution_budget import ExecutionDeadline, deadline
from tooling.acceptance.input_owners.native_toolchain import native_tool_observation
from tooling.acceptance.provisioners.desktop_acceptance_build import (
    BUILD_RESOURCE,
    DesktopAcceptanceBuild,
)
from tooling.acceptance.tests.synthetic_git import (
    run_synthetic_git, synthetic_git_environment,
)


class DesktopAcceptanceBuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        self.root = directory / "repo"
        self.root.mkdir()
        (self.root / "apps/desktop/src-tauri").mkdir(parents=True)
        self.tools = directory / "tools"
        self.tools.mkdir()
        self.git_environment = synthetic_git_environment()
        (self.root / ".gitignore").write_text(".local/\napps/desktop/dist/\n")
        (self.root / "Makefile").write_text(
            "export PATH := /usr/bin:/bin:$(PATH)\n"
            "acceptance-driver-build-environment:\n"
            f"\t@\"{sys.executable}\" -c "
            "'import json,os; print(json.dumps({\"path\": os.environ[\"PATH\"]}))'\n"
        )
        (self.root / "source.txt").write_text("first source")
        self.git("init", "-q")
        self.git("add", ".gitignore", "source.txt", "Makefile")
        self.commit()
        self.frontend = """
from pathlib import Path
root = Path(ROOT)
state = root / '.local'
state.mkdir(exist_ok=True)
count = state / 'count'
count.write_text(str(int(count.read_text()) + 1 if count.exists() else 1))
(state / 'compiler-binary').write_bytes((root / 'source.txt').read_bytes())
dist = root / 'apps/desktop/dist'
dist.mkdir(parents=True, exist_ok=True)
(dist / 'index.html').write_bytes((root / 'source.txt').read_bytes())
"""
        self.tool("pnpm", self.frontend)
        self.tool("cargo", """
import json
print(json.dumps({
    'reason': 'compiler-artifact', 'target': {'name': 'peers-touch-desktop'},
    'executable': ROOT + '/.local/compiler-binary',
}))
""")
        self.tool("node", "print('{\"inputs\": {}, \"externalSources\": []}')\n")
        self.tool("rustc", "")
        self.environment = patch.dict(os.environ, {
            **self.git_environment,
            "PATH": f"{self.tools}:{self.git_environment['PATH']}:{os.environ['PATH']}",
            "PT_ACCEPTANCE_RUN_ID": "",
        }, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.platform = patch(
            "tooling.acceptance.provisioners.desktop_acceptance_build.platform.system",
            return_value="Linux",
        )
        self.platform.start()
        self.addCleanup(self.platform.stop)

    def git(self, *argv: str) -> None:
        run_synthetic_git(self.root, *argv, environment=self.git_environment)

    def commit(self) -> None:
        self.git(
            "-c", "user.name=Synthetic Build", "-c", "user.email=build@example.invalid",
            "commit", "-qm", "synthetic source",
        )

    def tool(self, name: str, body: str, version: str = "1.0") -> None:
        path = self.tools / name
        path.write_text(
            f"#!{sys.executable}\nimport sys\n"
            f"ROOT = {str(self.root)!r}\n"
            f"if sys.argv[1:] in [['--version'], ['-vV']]:\n"
            f"    print({version!r}); raise SystemExit(0)\n"
            + body,
        )
        path.chmod(0o755)

    def count(self) -> int:
        return int((self.root / ".local/count").read_text())

    @unittest.skipUnless(sys.platform == "darwin", "actual macOS installed input owner")
    def test_native_installation_drift_invalidates_both_build_receipts(self) -> None:
        prefix = "tooling.acceptance.provisioners.desktop_acceptance_build"
        native_source = self.tools / "native.c"
        native_source.write_text("int main(void) { return 0; }\n")
        native_binary = self.tools / "native"
        subprocess.run(
            ["/usr/bin/xcrun", "clang", str(native_source), "-o", str(native_binary)],
            check=True, capture_output=True, timeout=10,
        )
        installed = {"rust": {"bytes": "compiler1"}, "sdk": {"bytes": "sdk1"}}
        rust = {
            "installation": installed["rust"],
            "tools": {"cargo": {"delegate": "cargo"}, "rustc": {"delegate": "rustc"}},
        }
        observed_environments = []

        def acquire_sdk(cwd, environment):
            self.assertEqual(cwd, (self.root / "apps/desktop/src-tauri").resolve())
            observed_environments.append(dict(environment))
            return {
                "installation": installed["sdk"],
                "tools": {"native": native_tool_observation(
                    native_binary, [], cwd=cwd, environment=environment,
                )},
            }

        with patch(prefix + ".platform.system", return_value="Darwin"), patch(
            prefix + ".rust_installation", side_effect=lambda cwd, env: {
                **rust, "installation": dict(installed["rust"]),
            },
        ) as compiler, patch(
            prefix + ".macos_sdk_installation", side_effect=acquire_sdk,
        ):
            first = DesktopAcceptanceBuild(self.root)
            original = first._run

            def execute(argv, **kwargs):
                if argv[0] in {"xcodebuild", "xcode-select"}:
                    return subprocess.CompletedProcess(argv, 0, "synthetic Xcode", "")
                return original(argv, **kwargs)

            with patch.object(first, "_run", side_effect=execute):
                first.ensure()
                first.ensure()
                self.assertEqual(self.count(), 1)
                self.assertEqual(first.observation["reuse"], "VERIFIED_BUILD")
                installed["rust"] = {"bytes": "compiler2"}
                first.ensure()
                self.assertEqual(self.count(), 2)
                self.assertEqual(first.observation["frontendReuse"], "BUILT_STAGE")
                installed["sdk"] = {"bytes": "sdk2"}
                first.ensure()
                self.assertEqual(self.count(), 3)
                self.assertEqual(first.observation["frontendReuse"], "BUILT_STAGE")
            compiler.assert_called()
            self.assertTrue(observed_environments)
            self.assertTrue(all(
                env["PATH"].split(os.pathsep)[0] == str(Path(sys.executable).parent)
                and env["PT_ACCEPTANCE_PYTHON"] == sys.executable
                for env in observed_environments
            ))

    def test_synthetic_source_commits_do_not_invoke_operator_hooks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            hooks = directory / "hooks"
            hooks.mkdir()
            marker = directory / "operator-hook-ran"
            hook = hooks / "post-commit"
            hook.write_text(
                f"#!{sys.executable}\nfrom pathlib import Path\n"
                f"Path({str(marker)!r}).touch()\n"
            )
            hook.chmod(0o755)
            configuration = directory / "gitconfig"
            trace = directory / "operator-trace"
            configuration.write_text(
                f"[core]\n\thooksPath = {hooks}\n"
                f"[trace2]\n\teventTarget = {trace}\n"
            )
            fixture = DesktopAcceptanceBuildTests()
            try:
                with patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": str(configuration)}):
                    fixture.setUp()
                    (fixture.root / "source.txt").write_text("next synthetic source")
                    fixture.git("add", "source.txt")
                    fixture.commit()
                    self.assertFalse(marker.exists())
                    self.assertFalse(trace.exists())
                    self.assertTrue((fixture.root / ".git").is_dir())
                    self.assertFalse((fixture.root / ".git/ai").exists())
            finally:
                fixture.doCleanups()

    def test_cold_then_verified_reuse_and_integrity_source_config_tool_invalidation(self) -> None:
        cold = DesktopAcceptanceBuild(self.root)
        binary = cold.ensure()
        self.assertEqual(cold.observation["reuse"], "COLD_BUILD")
        warm = DesktopAcceptanceBuild(self.root)
        self.assertEqual(warm.ensure(), binary)
        self.assertEqual(warm.observation["reuse"], "VERIFIED_BUILD")
        self.assertEqual(self.count(), 1)
        with patch.dict(os.environ, {"PATH": "/usr/bin:/bin:" + os.environ["PATH"]}):
            make_environment = DesktopAcceptanceBuild(self.root)
            make_environment.ensure()
            self.assertEqual(make_environment.observation["reuse"], "VERIFIED_BUILD")
            self.assertEqual(self.count(), 1)

        binary.write_bytes(b"tampered")
        DesktopAcceptanceBuild(self.root).ensure()
        self.assertEqual(binary.read_bytes(), b"first source")
        self.assertEqual(self.count(), 1)

        (self.root / "source.txt").write_text("next source")
        dirty = DesktopAcceptanceBuild(self.root)
        dirty.ensure()
        self.assertEqual(binary.read_bytes(), b"next source")
        self.assertRegex(dirty.observation["source"]["workspaceDigest"], r"^sha256:[0-9a-f]{64}$")
        warm_dirty = DesktopAcceptanceBuild(self.root)
        warm_dirty.ensure()
        self.assertEqual(warm_dirty.observation["reuse"], "VERIFIED_BUILD")
        self.assertEqual(self.count(), 2)
        self.git("add", "source.txt")
        self.commit()
        DesktopAcceptanceBuild(self.root).ensure()
        self.assertEqual(binary.read_bytes(), b"next source")
        self.assertEqual(self.count(), 3)

        with patch.dict(os.environ, {"RUSTFLAGS": "--cfg synthetic"}):
            DesktopAcceptanceBuild(self.root).ensure()
            self.assertEqual(self.count(), 4)
            DesktopAcceptanceBuild(self.root).ensure()
            self.assertEqual(self.count(), 4)
            self.tool("node", "print('{\"inputs\": {}, \"externalSources\": []}')\n", version="2.0")
            DesktopAcceptanceBuild(self.root).ensure()
            self.assertEqual(self.count(), 5)
        receipt = json.loads((cold.state / "receipt.json").read_text())
        self.assertEqual(receipt["identity"]["workspaceDigest"], "clean")
        self.assertNotIn("RUSTFLAGS", json.dumps(receipt))

    def test_failed_rust_preserves_only_verified_frontend_stage(self) -> None:
        failed = DesktopAcceptanceBuild(self.root)
        run = failed._run

        def fail_rust(argv, **kwargs):
            if kwargs.get("stage") == "rust":
                raise EphemeralLaunchTimeout(
                    "synthetic Rust deadline", operation="gate_process",
                    resource="gate-command-process",
                )
            return run(argv, **kwargs)

        with patch.object(failed, "_run", side_effect=fail_rust):
            with self.assertRaises(BlockedError):
                failed.ensure()
        self.assertFalse((failed.state / "receipt.json").exists())
        self.assertTrue((failed.state / "frontend-receipt.json").is_file())
        resumed = DesktopAcceptanceBuild(self.root)
        resumed.ensure()
        self.assertEqual(resumed.observation["frontendReuse"], "VERIFIED_STAGE")
        self.assertEqual(self.count(), 1)
        self.assertEqual(resumed.observation["frontendProducer"]["attemptId"], failed._attempt.name)

        (self.root / "apps/desktop/dist/index.html").write_text("tampered output")
        rebuilt = DesktopAcceptanceBuild(self.root)
        rebuilt.ensure()
        self.assertEqual(rebuilt.observation["frontendReuse"], "BUILT_STAGE")
        self.assertEqual(self.count(), 2)

    def test_staged_untracked_and_build_time_source_drift_are_bound(self) -> None:
        (self.root / "source.txt").write_text("staged source")
        self.git("add", "source.txt")
        extra = self.root / "new-source.txt"
        extra.write_text("new source")
        first = DesktopAcceptanceBuild(self.root)
        first.ensure()
        original_digest = first.observation["source"]["workspaceDigest"]
        extra.write_text("changed new source")
        changed = DesktopAcceptanceBuild(self.root)
        changed.ensure()
        self.assertNotEqual(changed.observation["source"]["workspaceDigest"], original_digest)
        self.assertEqual(self.count(), 2)
        self.tool("pnpm", self.frontend + "\n(root / 'source.txt').write_text('concurrent drift')\n")
        with self.assertRaisesRegex(BlockedError, "changed during build"):
            DesktopAcceptanceBuild(self.root).ensure()
        self.assertFalse((first.state / "receipt.json").exists())

    def test_make_and_policy_python_prefix_reuse_the_same_verified_build(self) -> None:
        direct = DesktopAcceptanceBuild(self.root)
        direct.ensure()
        with patch.dict(os.environ, {
            "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ["PATH"],
            "PT_ACCEPTANCE_PYTHON": sys.executable,
        }):
            policy = DesktopAcceptanceBuild(self.root)
            policy.ensure()
        self.assertEqual(policy.observation["reuse"], "VERIFIED_BUILD")
        self.assertEqual(direct.observation["identity"], policy.observation["identity"])
        self.assertIn("python3", policy.observation["identity"]["tools"])
        self.assertEqual(self.count(), 1)

    def test_source_projection_conflict_is_rejected_before_frontend(self) -> None:
        with patch.dict(os.environ, {"PT_BUILD_SOURCE_COMMIT": "f" * 40}):
            with self.assertRaisesRegex(BlockedError, "projection conflicts"):
                DesktopAcceptanceBuild(self.root).ensure()
        self.assertFalse((self.root / ".local/count").exists())

    def test_external_sources_and_desktop_environment_invalidate_reuse(self) -> None:
        DesktopAcceptanceBuild(self.root).ensure()
        for index, name in enumerate((
            "PT_DESKTOP_E2E", "PEERS_STATION_URL", "PEERS_TOUCH_EXTERNAL_LYNX_APPLETS",
        ), 2):
            with patch.dict(os.environ, {name: "synthetic-build-input"}):
                build = DesktopAcceptanceBuild(self.root)
                build.ensure()
                self.assertEqual(build.observation["reuse"], "COLD_BUILD")
                self.assertEqual(self.count(), index)
                DesktopAcceptanceBuild(self.root).ensure()
                self.assertEqual(self.count(), index)
        self.tool("node", "print('{\"inputs\": {}, \"externalSources\": [{\"sha256\": \"changed\"}]}')\n")
        build = DesktopAcceptanceBuild(self.root)
        build.ensure()
        self.assertEqual(build.observation["reuse"], "COLD_BUILD")
        self.assertEqual(self.count(), 5)

    def test_build_timeout_retains_output_and_does_not_publish_a_receipt(self) -> None:
        # Build-owner persistence must not depend on cold interpreter startup
        # beating a short clock; the Launcher owns real process cancellation.
        def timeout_after_output(spec, _context, *, capture_output) -> None:
            self.assertEqual(spec.argv, ("pnpm", "--dir", "apps/desktop", "run", "build"))
            self.assertGreater(spec.timeout_seconds, 0)
            self.assertLessEqual(spec.timeout_seconds, 1.5)
            capture_output("synthetic frontend waiting\n", "")
            raise EphemeralLaunchTimeout(
                "synthetic command deadline", operation="gate_process",
                resource="gate-command-process",
            )

        build = DesktopAcceptanceBuild(self.root, timeout_seconds=1.5)
        with patch.object(build, "_identity", return_value={
            "commit": "synthetic-source", "workspaceDigest": "clean",
        }), patch(
            "tooling.acceptance.provisioners.desktop_acceptance_build.GateProcessLauncher.run",
            side_effect=timeout_after_output,
        ), self.assertRaises(BlockedError) as caught:
            build.ensure()
        self.assertEqual(caught.exception.resource, BUILD_RESOURCE)
        self.assertEqual(build.observation["stage"], "frontend")
        self.assertEqual(build.observation["errorType"], "EphemeralLaunchTimeout")
        self.assertFalse((build.state / "receipt.json").exists())
        logs = list(build.state.glob("attempts/*/frontend-stdout.log"))
        self.assertEqual(len(logs), 1)
        self.assertIn("synthetic frontend waiting", logs[0].read_text())
        self.assertEqual(
            caught.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]["status"],
            "FAILED",
        )

    def test_failed_process_cleanup_preserves_exception_and_terminal_observation(self) -> None:
        error = EphemeralLaunchCleanupFailed(
            "build child did not stop", operation="gate_process",
        )
        build = DesktopAcceptanceBuild(self.root)
        with patch(
            "tooling.acceptance.provisioners.desktop_acceptance_build.GateProcessLauncher.run",
            side_effect=error,
        ), self.assertRaises(EphemeralLaunchCleanupFailed) as caught:
            build.ensure()
        self.assertIs(caught.exception, error)
        self.assertEqual(build.observation["status"], "FAILED")
        self.assertEqual(build.observation["errorType"], "EphemeralLaunchCleanupFailed")
        self.assertFalse((build.state / "receipt.json").exists())
        observation = json.loads((build._attempt / "observation.json").read_text())
        self.assertEqual(observation["errorType"], "EphemeralLaunchCleanupFailed")

    def test_relative_protoc_include_uses_cargo_build_directory(self) -> None:
        includes = self.root / ".local/proto-include"
        includes.mkdir(parents=True)
        definition = includes / "included.proto"
        definition.write_text("first include")
        with patch.dict(os.environ, {"PROTOC_INCLUDE": "../../../.local/proto-include"}):
            DesktopAcceptanceBuild(self.root).ensure()
            warm = DesktopAcceptanceBuild(self.root)
            warm.ensure()
            self.assertEqual(warm.observation["reuse"], "VERIFIED_BUILD")
            definition.write_text("changed include")
            invalidated = DesktopAcceptanceBuild(self.root)
            invalidated.ensure()
            self.assertEqual(invalidated.observation["reuse"], "COLD_BUILD")
            self.assertEqual(self.count(), 2)

    def test_outer_gate_cancellation_preserves_typed_deadline_and_owner_diagnostic(self) -> None:
        self.tool("pnpm", "import time\ntime.sleep(30)\n")
        build = DesktopAcceptanceBuild(self.root)
        with patch.object(build, "_identity", return_value={
            "commit": "synthetic-source", "workspaceDigest": "clean",
        }), self.assertRaises(ExecutionDeadline) as caught:
            with deadline(1.5, ExecutionDeadline("synthetic", "runtime-cell", "work")):
                build.ensure()
        self.assertEqual(caught.exception.stage, "runtime-cell")
        self.assertEqual(caught.exception.resource, BUILD_RESOURCE)
        self.assertIsNotNone(caught.exception.diagnostic)
        self.assertFalse((build.state / "receipt.json").exists())

    def test_public_deadline_covers_synchronous_verification_and_commit(self) -> None:
        for boundary in (
            "normal", "warm-read", "output-read", "binary-copy", "receipt", "outer", "observation",
        ):
            with self.subTest(boundary=boundary):
                build = DesktopAcceptanceBuild(
                    self.root, timeout_seconds=(
                        130 if boundary == "normal" else 8 if boundary == "outer" else 3
                    ),
                )
                if build.state.exists():
                    shutil.rmtree(build.state)
                retained_receipt = None
                if boundary == "warm-read":
                    DesktopAcceptanceBuild(self.root).ensure()
                    retained_receipt = (build.state / "receipt.json").read_bytes()
                original_read, original_open = Path.read_text, Path.open
                original_copy, original_replace = shutil.copyfile, os.replace
                delayed = []

                def pause(name):
                    delayed.append(name)
                    time.sleep(max(0, build._ends - time.monotonic()) + 0.2)

                def read(path, *args, **kwargs):
                    if boundary == "warm-read" and path == build.state / "receipt.json":
                        pause("warm-read")
                    return original_read(path, *args, **kwargs)

                def open_file(path, *args, **kwargs):
                    if (
                        boundary == "observation" and path == build._attempt / "observation.json"
                        and not delayed
                    ):
                        pause("observation")
                    if (
                        boundary == "output-read"
                        and path == build.root / "apps/desktop/dist/index.html"
                        and any(stage["stage"] == "rust"
                                for stage in build.observation.get("stages", []))
                    ):
                        pause("output-read")
                    return original_open(path, *args, **kwargs)

                def copy(source, target, *args, **kwargs):
                    if boundary == "binary-copy":
                        pause("binary-copy")
                    return original_copy(source, target, *args, **kwargs)

                def replace(source, target, *args, **kwargs):
                    if boundary in {"receipt", "outer"} and target == build.state / "receipt.json":
                        pause("receipt")
                    return original_replace(source, target, *args, **kwargs)

                outer = ExecutionDeadline("synthetic", "receipt-commit", "work")
                with ExitStack() as stack:
                    stack.enter_context(patch.object(Path, "read_text", new=read))
                    stack.enter_context(patch.object(Path, "open", new=open_file))
                    stack.enter_context(patch.object(shutil, "copyfile", new=copy))
                    stack.enter_context(patch.object(os, "replace", new=replace))
                    if boundary == "outer":
                        stack.enter_context(deadline(3, outer))
                    if boundary == "normal":
                        self.assertTrue(build.ensure().is_file())
                        self.assertEqual(build.observation["status"], "READY")
                        self.assertFalse(delayed)
                        continue
                    expected_error = ExecutionDeadline if boundary == "outer" else BlockedError
                    with self.assertRaises(expected_error) as caught:
                        build.ensure()
                self.assertEqual(len(delayed), 1)
                self.assertEqual(build.observation["status"], "FAILED")
                self.assertEqual(caught.exception.resource, BUILD_RESOURCE)
                self.assertIsNotNone(caught.exception.diagnostic)
                if boundary == "outer":
                    self.assertIs(caught.exception, outer)
                receipt = build.state / "receipt.json"
                if retained_receipt is not None:
                    self.assertEqual(receipt.read_bytes(), retained_receipt)
                else:
                    self.assertFalse(receipt.exists())
                self.assertFalse(list(build.state.glob("*.tmp")))
                self.assertFalse(list(build.binary.parent.glob("*.tmp")))
                with (build.state / "build.lock").open("a") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(lock, fcntl.LOCK_UN)
                persisted = json.loads((build._attempt / "observation.json").read_text())
                self.assertEqual(persisted["status"], "FAILED")

    def test_lock_wait_is_bounded_and_does_not_start_another_build(self) -> None:
        build = DesktopAcceptanceBuild(self.root, timeout_seconds=0.1)
        build.state.mkdir(parents=True)
        with (build.state / "build.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.assertRaisesRegex(BlockedError, "lock timed out"):
                build.ensure()
        self.assertFalse((self.root / ".local/count").exists())


if __name__ == "__main__":
    unittest.main()
