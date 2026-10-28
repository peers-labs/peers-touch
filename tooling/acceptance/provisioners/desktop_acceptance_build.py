"""Canonical exact-source Desktop Acceptance binary producer."""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Iterator

from tooling.acceptance.core.errors import (
    BlockedError, EphemeralLaunchCleanupFailed, EphemeralLaunchError,
)
from tooling.acceptance.core.evidence_store import (
    current_artifact_ref, source_identity, write_current_artifact,
)
from tooling.acceptance.core.execution_budget import (
    ExecutionDeadline, deadline, digest, positive_seconds,
)
from tooling.acceptance.core.launch_context import GateLaunchSpec, GateProcessLauncher
from tooling.acceptance.core.redaction import redact_text, redact_value
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.input_owners.native_toolchain import macos_sdk_installation
from tooling.acceptance.input_owners.rust_toolchain import rust_installation


DEFAULT_BUILD_SECONDS = 130.0
BUILD_OWNER = "tooling/acceptance/provisioners/desktop_acceptance_build.py"
BUILD_RESOURCE = "desktop-acceptance-binary"
TAURI_CONFIG = '{"app":{"withGlobalTauri":true}}'


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


class DesktopAcceptanceBuild:
    """Reuse a build only after source, configuration, tools and bytes match."""

    def __init__(
        self,
        source_root: Path,
        *,
        binary: Path | None = None,
        timeout_seconds: float = DEFAULT_BUILD_SECONDS,
    ) -> None:
        self.root = source_root.resolve()
        self.state = self.root / ".local" / "acceptance" / "desktop-build"
        self.binary = binary or self.root / ".local/acceptance/bin/peers-touch-desktop"
        if not self.binary.is_absolute():
            self.binary = self.root / self.binary
        self.binary = self.binary.resolve()
        if not self.binary.is_relative_to((self.root / ".local").resolve()):
            raise ValueError("Acceptance binary must be in worktree-local .local")
        self.timeout = positive_seconds(timeout_seconds, "Desktop build timeout")
        self.environment = dict(os.environ)
        self.environment.update(
            VITE_ACCEPTANCE_HARNESS="1", TAURI_CONFIG=TAURI_CONFIG,
        )
        self.observation: dict[str, Any] = {}
        self._ends = 0.0
        self._attempt: Path | None = None

    def _blocked(self, reason: str) -> BlockedError:
        return BlockedError(
            reason=reason,
            resource=BUILD_RESOURCE,
            diagnostic=ResourceDiagnostic(
                owner=BUILD_OWNER,
                recovery_action=(
                    "Resolve the recorded build stage at its owner, then run "
                    "make acceptance-driver-build from the frozen candidate. "
                    "Keep the current Gate budget."
                ),
                resource_checks=[{
                    "resource": BUILD_RESOURCE,
                    "expected": "integrity-verified exact-source acceptance-webdriver binary",
                    "state": "OBSERVED",
                    "observed": dict(self.observation),
                }],
            ),
        )

    def _run(
        self, argv: tuple[str, ...], *, cwd: Path | None = None,
        stage: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        started = time.monotonic()
        remaining = self._ends - time.monotonic()
        if remaining <= 0:
            raise self._blocked("Desktop Acceptance build exhausted its deadline")

        def capture(stdout: str, stderr: str) -> None:
            if stage is not None and self._attempt is not None:
                for name, text in (("stdout", stdout), ("stderr", stderr)):
                    (self._attempt / f"{stage}-{name}.log").write_text(
                        redact_text(text), encoding="utf-8",
                    )
                    if self.environment.get("PT_ACCEPTANCE_RUN_ID"):
                        relative = (
                            f"runtime/desktop-build/{self._attempt.name}/{stage}-{name}.log"
                        )
                        write_current_artifact(
                            relative, text.encode("utf-8"),
                            repo_root=self.root, environment=self.environment,
                        )
                        self.observation.setdefault("logs", []).append(
                            current_artifact_ref(
                                relative, repo_root=self.root, environment=self.environment,
                            ).to_dict()
                        )

        try:
            completed = GateProcessLauncher(
                cwd=str(cwd or self.root),
                environment=self.environment,
                termination_timeout_seconds=1.0,
            ).run(
                GateLaunchSpec(argv, remaining, ()), None,
                capture_output=capture if stage else None,
            )
        finally:
            if stage:
                self.observation.setdefault("stages", []).append({
                    "stage": stage,
                    "durationSeconds": round(time.monotonic() - started, 6),
                })
        if completed.returncode:
            self.observation["exitCode"] = completed.returncode
            raise self._blocked(
                f"Desktop Acceptance {stage or 'identity probe'} failed"
            )
        return completed

    def _identity(self) -> dict[str, Any]:
        source = source_identity(self.root)
        commit = source["commit"]
        tree = self._run(("git", "rev-parse", "HEAD^{tree}")).stdout.strip()
        projected_commit = self.environment.get("PT_BUILD_SOURCE_COMMIT")
        if projected_commit is not None and projected_commit != commit:
            self.observation["sourceProjection"] = {
                "expected": commit,
                "observedSha256": hashlib.sha256(projected_commit.encode()).hexdigest(),
            }
            raise self._blocked("Desktop build source projection conflicts with checked HEAD")
        self.environment["PT_BUILD_SOURCE_COMMIT"] = commit
        interpreter = self.environment.get("PT_ACCEPTANCE_PYTHON") or sys.executable
        if not Path(interpreter).is_absolute():
            interpreter = shutil.which(interpreter, path=self.environment.get("PATH")) or ""
        if not interpreter or not Path(interpreter).is_file() or not os.access(interpreter, os.X_OK):
            raise self._blocked("Selected Desktop build Python interpreter is unavailable")
        self.environment["PT_ACCEPTANCE_PYTHON"] = interpreter
        # Make owns the repository tool search path. Direct Cell callers use
        # that same exported path and selected Python environment. A policy
        # caller that already prepended that interpreter has identical inputs.
        exported = json.loads(self._run((
            "make", "--no-print-directory", "--silent",
            "acceptance-driver-build-environment",
        )).stdout)
        if not isinstance(exported, dict) or not isinstance(exported.get("path"), str):
            raise self._blocked("Make did not publish its build tool search path")
        self.environment["PATH"] = os.pathsep.join(
            dict.fromkeys((str(Path(interpreter).parent), *exported["path"].split(os.pathsep)))
        )
        tools = {}
        native_installations = {}
        if platform.system() == "Darwin":
            remaining = self._ends - time.monotonic()
            if remaining <= 0:
                raise self._blocked("Desktop build deadline expired before installed-input observation")
            with deadline(remaining, ExecutionDeadline(
                "desktop-acceptance-build", "installed-native-inputs", "work",
            )):
                self.observation["stage"] = "installed-rust-inputs"
                native_installations["rust"] = rust_installation(
                    self.root / "apps/desktop/src-tauri", self.environment,
                )
                self.observation["stage"] = "installed-sdk-inputs"
                native_installations["sdk"] = macos_sdk_installation(
                    self.root / "apps/desktop/src-tauri", self.environment,
                )
        for name, options in (
            ("python3", ("--version",)),
            ("node", ("--version",)), ("pnpm", ("--version",)),
            ("cargo", ("--version",)), ("rustc", ("-vV",)),
        ):
            if name in {"cargo", "rustc"} and "rust" in native_installations:
                tools[name] = native_installations["rust"]["tools"][name]
                continue
            executable = shutil.which(name, path=self.environment.get("PATH"))
            if not executable:
                self.observation["missingTool"] = name
                raise self._blocked(f"Desktop Acceptance tool {name} is unavailable")
            tools[name] = {
                "path": str(Path(executable).resolve()),
                "version": self._run((executable, *options)).stdout.strip(),
                "sha256": file_digest(Path(executable)),
            }
        for name in ("protoc", "sccache", "cc", "c++", "ar", "ranlib"):
            executable = shutil.which(name, path=self.environment.get("PATH"))
            if executable:
                tools[name] = {
                    "path": str(Path(executable).resolve()),
                    "sha256": file_digest(Path(executable)),
                }
        for name in ("PROTOC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "CC", "CXX", "AR", "RANLIB"):
            configured = self.environment.get(name)
            if configured:
                executable = shutil.which(configured, path=self.environment.get("PATH"))
                if executable is None:
                    self.observation["missingTool"] = name
                    raise self._blocked(f"Configured Desktop build tool {name} is unavailable")
                tools[name] = {
                    "path": str(Path(executable).resolve()),
                    "sha256": file_digest(Path(executable)),
                }
        if platform.system() == "Darwin":
            tools["xcode"] = self._run(("xcodebuild", "-version")).stdout.strip()
            tools["developerDirectory"] = self._run(("xcode-select", "-p")).stdout.strip()
        # Build-affecting ambient configuration is hashed, never serialized.
        build_environment = {
            name: value for name, value in self.environment.items()
            if name.startswith((
                "CARGO_", "RUST", "TAURI_", "VITE_", "npm_config_", "PNPM_",
                "CC_", "CXX_", "AR_", "CFLAGS_", "LDFLAGS_", "OPENSSL_",
                "SCCACHE_", "PROTOC",
            )) or name in {
                "PATH", "NODE_OPTIONS", "NODE_ENV", "CC", "CXX", "AR",
                "CFLAGS", "CXXFLAGS", "LDFLAGS", "SDKROOT", "DEVELOPER_DIR",
                "MACOSX_DEPLOYMENT_TARGET", "RANLIB",
                "PT_BUILD_SOURCE_COMMIT", "PT_DESKTOP_E2E", "PEERS_STATION_URL",
                "PEERS_TOUCH_EXTERNAL_LYNX_APPLETS",
            }
        }
        cargo_home = Path(self.environment.get("CARGO_HOME", str(Path.home() / ".cargo")))
        paths = {
            cargo_home / "config", cargo_home / "config.toml",
            self.root / ".npmrc",
            self.root / "node_modules/.modules.yaml",
            self.root / "node_modules/.pnpm/lock.yaml",
        }
        for directory in (self.root, self.root / "apps/desktop", self.root / "apps/desktop/src-tauri"):
            paths.update(directory.glob(".env*"))
            paths.update((directory / ".cargo").glob("config*"))
        include_root = self.environment.get("PROTOC_INCLUDE")
        if include_root:
            include_path = Path(include_root)
            if not include_path.is_absolute():
                include_path = self.root / "apps/desktop/src-tauri" / include_path
            paths.update(include_path.resolve().rglob("*"))
        local_inputs = {
            str(path): file_digest(path) for path in sorted(paths)
            if path.is_file()
        }
        self.observation["stage"] = "applet-inputs"
        try:
            applet_inputs = json.loads(self._run((
                "node", "packages/applets/build.js", "--build-inputs",
            )).stdout)
        except ValueError as error:
            raise self._blocked("Applet build owner returned invalid source inputs") from error
        if (
            not isinstance(applet_inputs, dict)
            or not isinstance(applet_inputs.get("inputs"), dict)
            or not isinstance(applet_inputs.get("externalSources"), list)
        ):
            raise self._blocked("Applet build owner did not publish its source inputs")
        return {
            "worktree": str(self.root), "commit": commit, "tree": tree,
            "workspaceDigest": source["workspaceDigest"],
            "canonicalWorktreeHash": source["canonicalWorktreeHash"],
            "platform": platform.platform(),
            "tools": tools, "configurationDigest": digest(build_environment),
            "nativeInstallations": native_installations,
            "localInputs": local_inputs, "binary": str(self.binary),
            "appletInputs": applet_inputs,
            "features": ["acceptance-webdriver"], "tauriConfig": TAURI_CONFIG,
        }

    @contextlib.contextmanager
    def _lock(self) -> Iterator[None]:
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (self.state / "build.lock").open("a") as lock:
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= self._ends:
                        raise self._blocked("Desktop Acceptance build lock timed out")
                    time.sleep(min(0.05, max(0, self._ends - time.monotonic())))
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _frontend_outputs(self) -> dict[str, str]:
        directory = self.root / "apps/desktop/dist"
        if not directory.is_dir() or directory.is_symlink():
            return {}
        outputs = {}
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                return {}
            if path.is_file():
                outputs[str(path.relative_to(directory))] = file_digest(path)
        return outputs

    def _publish_receipt(self, path: Path, receipt: dict[str, Any]) -> None:
        temporary = self.state / f"{uuid.uuid4().hex}.tmp"
        try:
            temporary.write_text(json.dumps(receipt, sort_keys=True) + "\n")
            if time.monotonic() >= self._ends:
                raise self._blocked("Desktop build deadline expired before receipt publication")
            os.replace(temporary, path)
            if time.monotonic() >= self._ends:
                raise self._blocked("Desktop build deadline expired during receipt publication")
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        finally:
            temporary.unlink(missing_ok=True)

    def _write_observation(self) -> None:
        if self._attempt is not None and self._attempt.is_dir():
            (self._attempt / "observation.json").write_text(
                json.dumps(redact_value(self.observation), sort_keys=True) + "\n",
                encoding="utf-8",
            )

    def _ready(self, *, reuse: str, stage: str) -> Path:
        self.observation.update(status="READY", reuse=reuse, stage=stage)
        self.observation["durationSeconds"] = round(
            self.timeout - (self._ends - time.monotonic()), 6,
        )
        self._write_observation()
        if time.monotonic() >= self._ends:
            raise self._blocked("Desktop build deadline expired during READY publication")
        return self.binary

    def ensure(self) -> Path:
        started = time.monotonic()
        self._ends = started + self.timeout
        self.observation = {
            "artifactKind": "desktop-acceptance-build-observation",
            "owner": BUILD_OWNER, "stage": "lock", "status": "PREPARING",
            "deadlineSeconds": self.timeout,
        }
        self._attempt = self.state / "attempts" / uuid.uuid4().hex
        cancellation = ExecutionDeadline(
            "desktop-acceptance-build", "build", "work",
            constraints=[{
                "kind": "owner-operation", "owner": BUILD_OWNER,
                "source": "DesktopAcceptanceBuild.timeout",
                "deadlineSeconds": self.timeout,
            }],
        )
        try:
            remaining = self._ends - time.monotonic()
            if remaining <= 0:
                raise cancellation
            with deadline(remaining, cancellation), self._lock():
                self._attempt.mkdir(mode=0o700, parents=True)
                self.observation["stage"] = "identity"
                identity = self._identity()
                self.observation["source"] = {
                    "commit": identity["commit"],
                    "workspaceDigest": identity["workspaceDigest"],
                }
                self.observation["inputDigest"] = digest(identity)
                self.observation["identity"] = identity
                receipt_path = self.state / "receipt.json"
                try:
                    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    receipt = {}
                if (
                    isinstance(receipt, dict) and receipt.get("identity") == identity
                    and self.binary.is_file() and os.access(self.binary, os.X_OK)
                    and receipt.get("binarySha256") == file_digest(self.binary)
                    and receipt.get("frontendOutputs") == self._frontend_outputs()
                    and bool(receipt.get("frontendOutputs"))
                ):
                    return self._ready(reuse="VERIFIED_BUILD", stage="verified")
                self.observation["reuse"] = "COLD_BUILD"
                receipt_path.unlink(missing_ok=True)
                self.observation["stage"] = "frontend"
                frontend_receipt_path = self.state / "frontend-receipt.json"
                try:
                    frontend_receipt = json.loads(frontend_receipt_path.read_text())
                except (OSError, ValueError):
                    frontend_receipt = {}
                outputs = self._frontend_outputs()
                if (
                    isinstance(frontend_receipt, dict)
                    and frontend_receipt.get("artifactKind") == "desktop-frontend-build-receipt"
                    and frontend_receipt.get("identity") == identity
                    and isinstance(frontend_receipt.get("producer"), dict)
                    and outputs
                    and frontend_receipt.get("outputs") == outputs
                ):
                    self.observation["frontendReuse"] = "VERIFIED_STAGE"
                    self.observation["frontendProducer"] = frontend_receipt["producer"]
                else:
                    frontend_receipt_path.unlink(missing_ok=True)
                    self._run(
                        ("pnpm", "--dir", "apps/desktop", "run", "build"),
                        stage="frontend",
                    )
                    if self._identity() != identity:
                        raise self._blocked("Desktop source or build inputs changed during build")
                    outputs = self._frontend_outputs()
                    if not outputs:
                        raise self._blocked("Desktop frontend produced no closed output inventory")
                    self._publish_receipt(frontend_receipt_path, {
                        "artifactKind": "desktop-frontend-build-receipt",
                        "identity": identity, "outputs": outputs,
                        "producer": {
                            "attemptId": self._attempt.name,
                            "durationSeconds": self.observation["stages"][-1]["durationSeconds"],
                            "logs": self.observation.get("logs", []),
                        },
                    })
                    self.observation["frontendReuse"] = "BUILT_STAGE"
                self.observation["stage"] = "rust"
                built = self._run((
                    "cargo", "build", "--locked", "--features", "acceptance-webdriver",
                    "--message-format=json-render-diagnostics",
                ), cwd=self.root / "apps/desktop/src-tauri", stage="rust")
                executable = None
                for line in built.stdout.splitlines():
                    try:
                        item = json.loads(line)
                    except ValueError:
                        continue
                    if (
                        isinstance(item, dict) and item.get("reason") == "compiler-artifact"
                        and item.get("target", {}).get("name") == "peers-touch-desktop"
                        and item.get("executable")
                    ):
                        executable = Path(item["executable"])
                if executable is None or not executable.is_file():
                    raise self._blocked("Cargo did not produce the Acceptance executable")
                self.observation["stage"] = "source-recheck"
                if self._identity() != identity:
                    raise self._blocked("Desktop source or build inputs changed during build")
                self.observation["stage"] = "output-recheck"
                if self._frontend_outputs() != outputs:
                    raise self._blocked("Desktop source or build inputs changed during build")
                self.observation["stage"] = "binary-publication"
                self.binary.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                temporary = self.binary.with_name(f"{self.binary.name}.{uuid.uuid4().hex}.tmp")
                try:
                    shutil.copyfile(executable, temporary)
                    temporary.chmod(0o755)
                    os.replace(temporary, self.binary)
                finally:
                    temporary.unlink(missing_ok=True)
                receipt = {
                    "artifactKind": "desktop-acceptance-build-receipt",
                    "identity": identity, "binarySha256": file_digest(self.binary),
                    "frontendOutputs": outputs,
                }
                self.observation["stage"] = "receipt-publication"
                self._publish_receipt(receipt_path, receipt)
                return self._ready(reuse="COLD_BUILD", stage="published")
        except BaseException as error:
            self.observation.update(status="FAILED", errorType=type(error).__name__)
            self.observation["durationSeconds"] = round(time.monotonic() - started, 6)
            if self.observation.get("reuse") == "COLD_BUILD":
                (self.state / "receipt.json").unlink(missing_ok=True)
            if isinstance(error, EphemeralLaunchCleanupFailed):
                raise
            if isinstance(error, ExecutionDeadline):
                self.observation["deadline"] = {
                    "gateId": error.gate_id, "stage": error.stage,
                    "phase": error.phase, "constraints": error.constraints,
                }
                if error is cancellation:
                    reason = (
                        "Desktop Acceptance build lock timed out"
                        if self.observation["stage"] == "lock" else str(error)
                    )
                    raise self._blocked(reason) from error
                error.resource = BUILD_RESOURCE
                error.diagnostic = self._blocked(str(error)).diagnostic
                raise
            if isinstance(error, (BlockedError, EphemeralLaunchError, OSError)):
                # Capture the terminal observation, including elapsed cost.
                raise self._blocked(
                    error.reason if isinstance(error, BlockedError) else str(error)
                ) from error
            raise
        finally:
            self.observation["durationSeconds"] = round(time.monotonic() - started, 6)
            if self.observation["status"] == "READY" and time.monotonic() >= self._ends:
                self.observation.update(status="FAILED", errorType="ExecutionDeadline")
                if self.observation["reuse"] == "COLD_BUILD":
                    (self.state / "receipt.json").unlink(missing_ok=True)
                self._write_observation()
                raise self._blocked("Desktop build deadline expired before returning READY")
            if self.observation["status"] != "READY":
                self._write_observation()
