from __future__ import annotations

import hashlib
import hmac
import json
import os
import plistlib
import re
import signal
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Protocol
from urllib.parse import unquote, urlparse

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

from tooling.acceptance.core import ArtifactRef, RunHandle
from tooling.acceptance.core.attestation import source_workspace_digest
from tooling.acceptance.gates.mobile.proof_contracts import validate_contract_payload


GATE_ID = "mobile-native-access-e2e"
APPLICATION_ID = "com.peers.touch.mobile"
BUILD_IDENTITY_SCHEMA = "peers-mobile-build-identity"
BUILD_CONFIGURATION = "acceptance-debug"
RELEASE_CONFIGURATION = "release"
ACCEPTANCE_VARIANT = "acceptance"
RELEASE_VARIANT = "release"
ACCEPTANCE_CARGO_FEATURE = "acceptance-harness"
ENVIRONMENT_POLICY = "empty-base-explicit-allowlist"
DEPENDENCY_POLICY = "locked-preseeded-offline"
SIGNING_POLICY = "mobile-acceptance-debug"
ANDROID_GRADLE_LOCK_REQUIREMENTS = {
    "apps/mobile/src-tauri/gen/android/buildscript-gradle.lockfile": (
        "com.android.tools.build:gradle:8.5.1",
        "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25",
    ),
    "apps/mobile/src-tauri/gen/android/buildSrc/gradle.lockfile": (
        "com.android.tools.build:gradle:8.5.1",
        "org.jetbrains.kotlin:kotlin-stdlib:1.9.23",
    ),
    "apps/mobile/src-tauri/gen/android/gradle/dependency-locks/app.lockfile": (
        "androidx.appcompat:appcompat:1.6.1",
        "androidx.webkit:webkit:1.6.1",
        "com.google.android.material:material:1.8.0",
    ),
    "apps/mobile/src-tauri/gen/android/gradle/dependency-locks/tauri-android.lockfile": (
        "org.jetbrains.kotlin:kotlin-stdlib:1.9.25",
    ),
    "apps/mobile/src-tauri/gen/android/gradle/dependency-locks/tauri-plugin-deep-link.lockfile": (
        "org.jetbrains.kotlin:kotlin-stdlib:1.9.25",
    ),
    "apps/mobile/src-tauri/gen/android/gradle/dependency-locks/tauri-plugin-opener.lockfile": (
        "org.jetbrains.kotlin:kotlin-stdlib:1.9.25",
    ),
    "apps/mobile/src-tauri/gen/android/gradle/dependency-locks/tauri-plugin-peers-secure-storage.lockfile": (
        "org.jetbrains.kotlin:kotlin-stdlib:1.9.25",
    ),
}
CARGO_CACHE_SUBTREES = (
    "registry/index",
    "registry/cache",
    "registry/src",
    "git/db",
    "git/checkouts",
)
CARGO_CACHE_ROOT_FILES = (
    ".global-cache",
    ".package-cache",
    ".package-cache-mutate",
)
CARGO_HOME_CONTROL_FILES = frozenset(
    {
        "config",
        "config.toml",
        "credentials",
        "credentials.toml",
        "token",
        "token.toml",
    }
)
ANDROID_CARGO_GRADLE_PROJECTS = (
    (":tauri-android", "tauri", "2.10.3", "mobile/android"),
    (":tauri-plugin-deep-link", "tauri-plugin-deep-link", "2.4.9", "android"),
    (":tauri-plugin-opener", "tauri-plugin-opener", "2.5.4", "android"),
)
ANDROID_LOCAL_GRADLE_PROJECTS = (
    (
        ":tauri-plugin-peers-secure-storage",
        "apps/mobile/src-tauri/plugins/secure-storage/android",
    ),
)
GRADLE_SETTINGS_SOURCE_EXCLUDED_PARTS = frozenset({"build", ".gradle"})
GRADLE_GENERATED_SOURCE_FILES = frozenset({"tauri.build.gradle.kts"})

RESOLVER_ARGUMENTS = {
    "android": {
        "pnpm": ["--offline", "--frozen-lockfile"],
        "cargo": ["--frozen"],
        "gradle": ["--offline"],
    },
    "ios": {
        "pnpm": ["--offline", "--frozen-lockfile"],
        "cargo": ["--frozen"],
        "xcode": ["-disableAutomaticPackageResolution"],
    },
}
INAPPLICABLE_RESOLVERS = {"android": ["xcode"], "ios": ["gradle"]}
CONSTRUCTED_BUILD_ENVIRONMENT = frozenset(
    {
        "ANDROID_HOME",
        "ANDROID_SDK_ROOT",
        "CARGO_HOME",
        "CARGO_TARGET_DIR",
        "DEVELOPER_DIR",
        "GRADLE_USER_HOME",
        "HOME",
        "JAVA_HOME",
        "PATH",
        "PT_MOBILE_BUILD_IDENTITY_JSON",
        "RUSTUP_HOME",
        "SDKROOT",
        "TMPDIR",
        "VITE_ACCEPTANCE_HARNESS",
    }
)
REQUIRED_BUILD_INPUT_FILES = (
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/mobile/package.json",
    "apps/mobile/index.html",
    "apps/mobile/vite.config.ts",
    "apps/mobile/src-tauri/Cargo.toml",
    "apps/mobile/src-tauri/Cargo.lock",
    "apps/mobile/src-tauri/build.rs",
    "apps/mobile/src-tauri/tauri.conf.json",
    "apps/mobile/src-tauri/icon-source.png",
    *ANDROID_GRADLE_LOCK_REQUIREMENTS,
    "tooling/scripts/proto-gen-mobile.sh",
)
REQUIRED_BUILD_INPUT_ROOTS = (
    "apps/mobile/src",
    "apps/mobile/src-tauri/capabilities",
    "apps/mobile/src-tauri/icons",
    "apps/mobile/src-tauri/src",
    "apps/mobile/src-tauri/plugins",
    "apps/mobile/src-tauri/gen/apple",
    "apps/mobile/src-tauri/gen/android",
    "model/domain/access_gate",
    "model/domain/actor",
    "model/domain/auth",
    "model/domain/oauth",
    "model/domain/peer",
    "apps/mobile/scripts",
)
EXCLUDED_BUILD_INPUT_PARTS = frozenset(
    {
        "build",
        "DerivedData",
        "Externals",
        ".gradle",
        "Pods",
        "target",
        "dist",
        "node_modules",
    }
)
SECRET_BUILD_INPUT_NAMES = frozenset(
    {
        "local.properties",
        "embedded.mobileprovision",
        "exportOptions.plist",
    }
)
SECRET_BUILD_INPUT_SUFFIXES = frozenset(
    {".jks", ".keystore", ".key", ".p12", ".pem", ".mobileprovision"}
)
PRODUCER_INPUTS = (
    "tooling/acceptance/provisioners/mobile_native_build.py",
    "tooling/acceptance/gates/mobile/proof-contract.schema.json",
    "tooling/acceptance/gates/mobile/proof_contracts.py",
)
COMMON_TOOLCHAIN_PROBES = (
    ("node", "--version"),
    ("pnpm", "--version"),
    ("protoc", "--version"),
    ("rustc", "-Vv"),
    ("cargo", "-V"),
    ("pnpm", "exec", "tauri", "--version"),
)
ANDROIDX_GRADLE_PROPERTY = "android.useAndroidX=true"
FORBIDDEN_RELEASE_ADAPTER_SYMBOLS = (
    b"oauth_acceptance_callback_replay_handle",
    b"oauth_acceptance_negative_callback",
)
NATIVE_ACCEPTANCE_HARNESS_MARKER = b"PEERS_TOUCH_MOBILE_ACCEPTANCE_HARNESS_ENABLED"
WEB_BUILD_IDENTITY_ASSET = "build-identity.json"
WEB_ACCEPTANCE_HARNESS_MARKERS = (
    b"__PEERS_MOBILE_ACCEPTANCE__",
    b"station.add",
    b"station.replace",
    b"access.submit",
    b"oauth.start",
    b"oauth.status",
    b"oauth.cancel",
    b"lifecycle.restart",
    b"native.deliverDeepLink",
    b"projection.read",
    b"cleanup",
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
BUILD_COMMAND_TIMEOUT_SECONDS = 1800.0
BUILD_COMMAND_TERMINATION_TIMEOUT_SECONDS = 5.0


class MobileNativeBuildError(RuntimeError):
    """A fail-closed source-bound Mobile build contract violation."""


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


class CommandRunner(Protocol):
    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str] | None = None,
    ) -> CommandResult:
        ...


class SubprocessCommandRunner:
    def __init__(
        self,
        *,
        timeout_seconds: float = BUILD_COMMAND_TIMEOUT_SECONDS,
        termination_timeout_seconds: float = BUILD_COMMAND_TERMINATION_TIMEOUT_SECONDS,
    ) -> None:
        if timeout_seconds <= 0 or termination_timeout_seconds <= 0:
            raise MobileNativeBuildError("build command timeouts must be positive")
        self._timeout_seconds = timeout_seconds
        self._termination_timeout_seconds = termination_timeout_seconds

    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str] | None = None,
    ) -> CommandResult:
        if not command:
            raise MobileNativeBuildError("build command must not be empty")
        if os.name != "posix":
            raise MobileNativeBuildError(
                "build command process-tree ownership requires POSIX"
            )
        try:
            process = subprocess.Popen(
                list(command),
                cwd=cwd,
                env=None if env is None else dict(env),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                shell=False,
                close_fds=True,
                start_new_session=True,
            )
        except OSError as error:
            raise MobileNativeBuildError(
                f"failed to start build command: {Path(command[0]).name}"
            ) from error

        try:
            stdout, stderr = process.communicate(timeout=self._timeout_seconds)
        except subprocess.TimeoutExpired as error:
            self._terminate_and_reap(process)
            raise MobileNativeBuildError(
                "build command timed out after "
                f"{self._timeout_seconds:g}s: {Path(command[0]).name}"
            ) from error
        except BaseException:
            self._terminate_and_reap(process)
            raise

        self._kill_remaining_process_group(process)
        return CommandResult(process.returncode, stdout, stderr)

    def _terminate_and_reap(self, process: subprocess.Popen[str]) -> None:
        self._signal_process_group(process, signal.SIGTERM)
        try:
            process.communicate(timeout=self._termination_timeout_seconds)
        except subprocess.TimeoutExpired:
            self._signal_process_group(process, signal.SIGKILL)
            self._reap_after_sigkill(process)
        except BaseException:
            self._signal_process_group(process, signal.SIGKILL)
            self._reap_after_sigkill(process)
        self._kill_remaining_process_group(process)

    def _reap_after_sigkill(self, process: subprocess.Popen[str]) -> None:
        try:
            process.communicate(timeout=self._termination_timeout_seconds)
        except subprocess.TimeoutExpired as error:
            raise MobileNativeBuildError(
                "build command process tree did not stop after SIGKILL"
            ) from error
        except BaseException as error:
            raise MobileNativeBuildError(
                "build command process could not be reaped after SIGKILL"
            ) from error

    @staticmethod
    def _signal_process_group(
        process: subprocess.Popen[str],
        process_signal: signal.Signals,
    ) -> None:
        try:
            os.killpg(process.pid, process_signal)
        except ProcessLookupError:
            return
        except OSError as error:
            raise MobileNativeBuildError(
                "build command process group could not be signalled"
            ) from error

    def _kill_remaining_process_group(
        self,
        process: subprocess.Popen[str],
    ) -> None:
        self._signal_process_group(process, signal.SIGKILL)
        deadline = time.monotonic() + self._termination_timeout_seconds
        while True:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                pass
            except OSError as error:
                raise MobileNativeBuildError(
                    "build command process-group extinction could not be verified"
                ) from error
            if time.monotonic() >= deadline:
                raise MobileNativeBuildError(
                    "build command process group survived forced termination"
                )
            time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))

@dataclass(frozen=True)
class SourceIdentity:
    source_commit: str
    workspace_state: str
    workspace_digest: str


@dataclass(frozen=True)
class ArtifactInspection:
    platform: str
    kind: str
    application_id: str
    sha256: str
    size_bytes: int
    signing: dict[str, Any]


@dataclass(frozen=True)
class ToolchainIdentity:
    digest: str
    cache_paths: dict[str, str]
    environment_paths: dict[str, str]
    executable_paths: dict[str, str]
    observations: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class CargoWrapperControl:
    path: Path
    sha256: str
    real_cargo_path: Path
    real_cargo_sha256: str
    injected_features: tuple[str, ...]


@dataclass(frozen=True)
class GradleWrapperControl:
    path: Path
    wrapper_sha256: str
    properties_path: Path
    properties_sha256: str
    distribution_path: Path
    distribution_sha256: str
    gradle_user_home: Path


_RECEIPT_AUTHORITY = object()
_RECEIPT_SEAL_KEY = os.urandom(32)


class SuccessfulBuildReceipt:
    """Opaque capability minted after controlled Acceptance and release builds."""

    __slots__ = (
        "_artifact",
        "_artifact_inspection",
        "_acceptance_package_scan",
        "_build_identity",
        "_build_isolation",
        "_cargo_wrapper_control",
        "_command_digests",
        "_gradle_wrapper_control",
        "_gradle_settings",
        "_negative_adapter_scan",
        "_platform",
        "_producer_source_digest",
        "_release_artifact",
        "_release_artifact_sha256",
        "_release_build_identity",
        "_release_cargo_wrapper_control",
        "_release_gradle_wrapper_control",
        "_release_gradle_settings",
        "_repository_root",
        "_receipt_id",
        "_seal_digest",
        "_sealed",
        "_source_identity",
        "_toolchain_digest",
        "_web_build_provenance",
    )

    def __init__(
        self,
        authority: object,
        *,
        artifact: Path,
        artifact_inspection: ArtifactInspection,
        acceptance_package_scan: dict[str, Any],
        build_identity: dict[str, Any],
        build_isolation: dict[str, Any],
        cargo_wrapper_control: CargoWrapperControl,
        command_digests: tuple[str, ...],
        gradle_wrapper_control: GradleWrapperControl | None,
        gradle_settings: Path | None,
        negative_adapter_scan: dict[str, Any],
        platform: str,
        producer_source_digest: str,
        release_artifact: Path,
        release_build_identity: dict[str, Any],
        release_cargo_wrapper_control: CargoWrapperControl,
        release_gradle_wrapper_control: GradleWrapperControl | None,
        release_gradle_settings: Path | None,
        repository_root: Path,
        source_identity: SourceIdentity,
        toolchain_digest: str,
        web_build_provenance: tuple[dict[str, Any], ...],
    ) -> None:
        if authority is not _RECEIPT_AUTHORITY:
            raise MobileNativeBuildError("build receipts are producer-owned capabilities")
        object.__setattr__(self, "_artifact", artifact)
        object.__setattr__(
            self,
            "_artifact_inspection",
            ArtifactInspection(
                platform=artifact_inspection.platform,
                kind=artifact_inspection.kind,
                application_id=artifact_inspection.application_id,
                sha256=artifact_inspection.sha256,
                size_bytes=artifact_inspection.size_bytes,
                signing=json.loads(canonical_json_bytes(artifact_inspection.signing)),
            ),
        )
        object.__setattr__(
            self,
            "_acceptance_package_scan",
            json.loads(canonical_json_bytes(acceptance_package_scan)),
        )
        object.__setattr__(
            self,
            "_build_identity",
            json.loads(canonical_json_bytes(build_identity)),
        )
        expected_native_identity_digest = embedded_identity_digest(build_identity)
        if (
            acceptance_package_scan.get("embeddedIdentitySha256")
            != expected_native_identity_digest
            or not acceptance_package_scan.get("embeddedIdentityEntry")
            or acceptance_package_scan.get("webIdentityAsset", {}).get("sha256")
            != expected_native_identity_digest
        ):
            raise MobileNativeBuildError(
                "Acceptance package scan is not bound to the exact build identity"
            )
        object.__setattr__(
            self,
            "_build_isolation",
            json.loads(canonical_json_bytes(build_isolation)),
        )
        object.__setattr__(self, "_cargo_wrapper_control", cargo_wrapper_control)
        object.__setattr__(self, "_command_digests", tuple(command_digests))
        object.__setattr__(self, "_gradle_wrapper_control", gradle_wrapper_control)
        object.__setattr__(self, "_gradle_settings", gradle_settings)
        object.__setattr__(
            self,
            "_negative_adapter_scan",
            json.loads(canonical_json_bytes(negative_adapter_scan)),
        )
        if (
            negative_adapter_scan.get("webIdentityAsset", {}).get("sha256")
            != embedded_identity_digest(release_build_identity)
        ):
            raise MobileNativeBuildError(
                "release package scan is not bound to the exact build identity"
            )
        object.__setattr__(self, "_platform", platform)
        object.__setattr__(self, "_producer_source_digest", producer_source_digest)
        object.__setattr__(self, "_release_artifact", release_artifact)
        object.__setattr__(
            self,
            "_release_artifact_sha256",
            _sha256_file(release_artifact),
        )
        if (
            artifact.resolve(strict=True) == release_artifact.resolve(strict=True)
            or artifact_inspection.sha256 == self._release_artifact_sha256
        ):
            raise MobileNativeBuildError(
                "Acceptance and release artifacts must be distinct build outputs"
            )
        object.__setattr__(
            self,
            "_release_build_identity",
            json.loads(canonical_json_bytes(release_build_identity)),
        )
        object.__setattr__(
            self,
            "_release_cargo_wrapper_control",
            release_cargo_wrapper_control,
        )
        object.__setattr__(
            self,
            "_release_gradle_wrapper_control",
            release_gradle_wrapper_control,
        )
        object.__setattr__(self, "_release_gradle_settings", release_gradle_settings)
        object.__setattr__(self, "_repository_root", repository_root.resolve(strict=True))
        object.__setattr__(self, "_receipt_id", uuid.uuid4().hex)
        object.__setattr__(self, "_source_identity", source_identity)
        object.__setattr__(self, "_toolchain_digest", toolchain_digest)
        object.__setattr__(
            self,
            "_web_build_provenance",
            tuple(json.loads(canonical_json_bytes(item)) for item in web_build_provenance),
        )
        object.__setattr__(self, "_sealed", True)
        object.__setattr__(self, "_seal_digest", self._calculate_seal())

    def __setattr__(self, name: str, value: object) -> None:
        del name, value
        raise AttributeError("successful build receipts are immutable")

    def _seal_payload(self) -> dict[str, Any]:
        inspection = self._artifact_inspection
        cargo = self._cargo_wrapper_control
        gradle = self._gradle_wrapper_control
        return {
            "receiptId": self._receipt_id,
            "repositoryRoot": str(self._repository_root),
            "platform": self._platform,
            "sourceIdentity": {
                "sourceCommit": self._source_identity.source_commit,
                "workspaceState": self._source_identity.workspace_state,
                "workspaceDigest": self._source_identity.workspace_digest,
            },
            "artifact": {
                "path": str(self._artifact),
                "platform": inspection.platform,
                "kind": inspection.kind,
                "applicationId": inspection.application_id,
                "sha256": inspection.sha256,
                "sizeBytes": inspection.size_bytes,
                "signing": inspection.signing,
            },
            "acceptancePackageScan": self._acceptance_package_scan,
            "buildIdentity": self._build_identity,
            "buildIsolation": self._build_isolation,
            "cargoWrapper": {
                "path": str(cargo.path),
                "sha256": cargo.sha256,
                "realCargoPath": str(cargo.real_cargo_path),
                "realCargoSha256": cargo.real_cargo_sha256,
                "injectedFeatures": list(cargo.injected_features),
            },
            "gradleWrapper": (
                None
                if gradle is None
                else {
                    "path": str(gradle.path),
                    "wrapperSha256": gradle.wrapper_sha256,
                    "propertiesPath": str(gradle.properties_path),
                    "propertiesSha256": gradle.properties_sha256,
                    "distributionPath": str(gradle.distribution_path),
                    "distributionSha256": gradle.distribution_sha256,
                    "gradleUserHome": str(gradle.gradle_user_home),
                }
            ),
            "gradleSettingsSha256": (
                None
                if self._gradle_settings is None
                else _sha256_file(self._gradle_settings)
            ),
            "commandDigests": list(self._command_digests),
            "producerSourceDigest": self._producer_source_digest,
            "toolchainDigest": self._toolchain_digest,
            "negativeAdapterScan": self._negative_adapter_scan,
            "releaseArtifact": {
                "path": str(self._release_artifact),
                "sha256": self._release_artifact_sha256,
            },
            "releaseBuildIdentity": self._release_build_identity,
            "releaseCargoWrapper": {
                "path": str(self._release_cargo_wrapper_control.path),
                "sha256": self._release_cargo_wrapper_control.sha256,
                "realCargoPath": str(
                    self._release_cargo_wrapper_control.real_cargo_path
                ),
                "realCargoSha256": (
                    self._release_cargo_wrapper_control.real_cargo_sha256
                ),
                "injectedFeatures": list(
                    self._release_cargo_wrapper_control.injected_features
                ),
            },
            "releaseGradleWrapper": (
                None
                if self._release_gradle_wrapper_control is None
                else {
                    "path": str(self._release_gradle_wrapper_control.path),
                    "wrapperSha256": self._release_gradle_wrapper_control.wrapper_sha256,
                    "propertiesPath": str(
                        self._release_gradle_wrapper_control.properties_path
                    ),
                    "propertiesSha256": (
                        self._release_gradle_wrapper_control.properties_sha256
                    ),
                    "distributionPath": str(
                        self._release_gradle_wrapper_control.distribution_path
                    ),
                    "distributionSha256": (
                        self._release_gradle_wrapper_control.distribution_sha256
                    ),
                    "gradleUserHome": str(
                        self._release_gradle_wrapper_control.gradle_user_home
                    ),
                }
            ),
            "releaseGradleSettingsSha256": (
                None
                if self._release_gradle_settings is None
                else _sha256_file(self._release_gradle_settings)
            ),
            "webBuildProvenance": list(self._web_build_provenance),
        }

    def _calculate_seal(self) -> str:
        return hmac.new(
            _RECEIPT_SEAL_KEY,
            canonical_json_bytes(self._seal_payload()),
            hashlib.sha256,
        ).hexdigest()

    def _assert_current_outputs(self) -> None:
        if not self._sealed or not hmac.compare_digest(
            self._seal_digest,
            self._calculate_seal(),
        ):
            raise MobileNativeBuildError("successful build receipt seal is invalid")
        _assert_cargo_wrapper_control(self._cargo_wrapper_control)
        _assert_cargo_wrapper_control(self._release_cargo_wrapper_control)
        if self._gradle_wrapper_control is not None:
            _assert_gradle_wrapper_control(self._gradle_wrapper_control)
        if self._release_gradle_wrapper_control is not None:
            _assert_gradle_wrapper_control(self._release_gradle_wrapper_control)
        for settings in (self._gradle_settings, self._release_gradle_settings):
            if settings is not None and (
                settings.is_symlink() or not settings.is_file()
            ):
                raise MobileNativeBuildError(
                    "controlled Gradle settings became unsafe"
                )
        if (
            not self._artifact.is_file()
            or self._artifact.is_symlink()
        ):
            raise MobileNativeBuildError("controlled build output became unsafe")
        if _sha256_file(self._artifact) != self._artifact_inspection.sha256:
            raise MobileNativeBuildError("controlled build artifact changed after receipt")
        if (
            not self._release_artifact.is_file()
            or self._release_artifact.is_symlink()
            or _sha256_file(self._release_artifact) != self._release_artifact_sha256
        ):
            raise MobileNativeBuildError("controlled release artifact changed after receipt")
        current_acceptance_scan = _scan_acceptance_application_package(
            self._artifact,
            self._platform,
            canonical_json_bytes(self._build_identity),
        )
        if current_acceptance_scan != {
            key: value
            for key, value in self._acceptance_package_scan.items()
            if key != "webIdentityAsset"
        }:
            raise MobileNativeBuildError(
                "controlled Acceptance package scan changed after receipt"
            )
        current_scan = _scan_application_package(self._release_artifact, self._platform)
        if current_scan != {
            key: value
            for key, value in self._negative_adapter_scan.items()
            if key != "webIdentityAsset"
        }:
            raise MobileNativeBuildError("controlled package scan changed after receipt")
        current_source = capture_source_identity(self._repository_root)
        if current_source != self._source_identity:
            raise MobileNativeBuildError("source/workspace identity changed after receipt")
        if (
            _combined_build_inputs_digest(
                canonical_build_inputs_digest(self._repository_root, self._platform),
                self._gradle_settings,
            )
            != self._build_identity["buildInputsDigest"]
        ):
            raise MobileNativeBuildError("build inputs changed after receipt")
        if (
            _combined_build_inputs_digest(
                canonical_build_inputs_digest(
                    self._repository_root,
                    self._platform,
                    configuration=RELEASE_CONFIGURATION,
                    harness_enabled=False,
                ),
                self._release_gradle_settings,
            )
            != self._release_build_identity["buildInputsDigest"]
        ):
            raise MobileNativeBuildError("release build inputs changed after receipt")
        if (
            canonical_files_digest(self._repository_root, PRODUCER_INPUTS)
            != self._producer_source_digest
        ):
            raise MobileNativeBuildError("build producer changed after receipt")


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_digest(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def canonical_value_digest(value: Any) -> str:
    return sha256_digest(canonical_json_bytes(value))


def _relative_file(root: Path, relative: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts or "\x00" in relative:
        raise MobileNativeBuildError(f"build input is not repository-relative: {relative}")
    path = root.joinpath(*pure.parts)
    if not path.is_file() or path.is_symlink():
        raise MobileNativeBuildError(f"required build input is missing or unsafe: {relative}")
    return path


def _repository_relative(root: Path, path: Path) -> str:
    try:
        resolved = path.resolve(strict=True)
        repository = root.resolve(strict=True)
        relative = resolved.relative_to(repository)
    except (OSError, ValueError) as error:
        raise MobileNativeBuildError(f"build input escapes repository: {path}") from error
    return relative.as_posix()


def _is_excluded_build_input(relative: PurePosixPath) -> bool:
    if any(part in EXCLUDED_BUILD_INPUT_PARTS for part in relative.parts):
        return True
    if relative.name in SECRET_BUILD_INPUT_NAMES:
        return True
    return relative.suffix.lower() in SECRET_BUILD_INPUT_SUFFIXES


def _collect_input_tree(root: Path, relative_root: str) -> set[str]:
    directory = root / relative_root
    if not directory.is_dir() or directory.is_symlink():
        raise MobileNativeBuildError(
            f"required build input root is missing or unsafe: {relative_root}"
        )
    result: set[str] = set()
    for current, directories, files in os.walk(directory, followlinks=False):
        current_path = Path(current)
        retained_directories: list[str] = []
        for name in sorted(directories):
            candidate = current_path / name
            relative = PurePosixPath(_repository_relative(root, candidate))
            if _is_excluded_build_input(relative):
                continue
            if candidate.is_symlink():
                raise MobileNativeBuildError(
                    f"build input contains a symlink: {relative.as_posix()}"
                )
            retained_directories.append(name)
        directories[:] = retained_directories
        for name in sorted(files):
            candidate = current_path / name
            relative = PurePosixPath(_repository_relative(root, candidate))
            if _is_excluded_build_input(relative):
                continue
            if candidate.is_symlink() or not candidate.is_file():
                raise MobileNativeBuildError(
                    f"build input is not a regular file: {relative.as_posix()}"
                )
            result.add(relative.as_posix())
    return result


def _workspace_package_roots(root: Path) -> dict[str, Path]:
    workspace = _relative_file(root, "pnpm-workspace.yaml").read_text(encoding="utf-8")
    patterns = [
        line.strip().removeprefix("-").strip().strip("'\"")
        for line in workspace.splitlines()
        if line.lstrip().startswith("-")
    ]
    packages: dict[str, Path] = {}
    for pattern in patterns:
        for directory in sorted(root.glob(pattern)):
            relative_directory = PurePosixPath(directory.relative_to(root).as_posix())
            if _is_excluded_build_input(relative_directory):
                continue
            manifest = directory / "package.json"
            if not manifest.is_file() or manifest.is_symlink():
                continue
            try:
                value = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise MobileNativeBuildError(
                    f"workspace package manifest is invalid: {_repository_relative(root, manifest)}"
                ) from error
            name = value.get("name")
            if not isinstance(name, str) or not name:
                raise MobileNativeBuildError(
                    f"workspace package has no name: {_repository_relative(root, manifest)}"
                )
            if name in packages and packages[name].resolve() != directory.resolve():
                raise MobileNativeBuildError(f"duplicate workspace package name: {name}")
            packages[name] = directory
    return packages


def _package_workspace_closure(root: Path) -> set[Path]:
    packages = _workspace_package_roots(root)
    pending = [root / "apps/mobile"]
    closure: set[Path] = set()
    while pending:
        directory = pending.pop()
        resolved = directory.resolve(strict=True)
        if resolved in closure:
            continue
        closure.add(resolved)
        manifest = directory / "package.json"
        try:
            value = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise MobileNativeBuildError(
                f"package manifest is invalid: {_repository_relative(root, manifest)}"
            ) from error
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            dependencies = value.get(section, {})
            if not isinstance(dependencies, dict):
                raise MobileNativeBuildError(f"{section} must be an object in {manifest}")
            for name, specifier in dependencies.items():
                if not isinstance(specifier, str) or not specifier.startswith("workspace:"):
                    continue
                dependency = packages.get(name)
                if dependency is None:
                    raise MobileNativeBuildError(
                        f"unresolved local workspace dependency {name!r} in {manifest}"
                    )
                pending.append(dependency)
    return closure


def _cargo_path_dependencies(manifest: Path) -> set[Path]:
    try:
        value = tomllib.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise MobileNativeBuildError(f"Cargo manifest is invalid: {manifest}") from error
    dependency_tables: list[Mapping[str, Any]] = []
    for section in ("dependencies", "dev-dependencies", "build-dependencies"):
        table = value.get(section, {})
        if isinstance(table, dict):
            dependency_tables.append(table)
    targets = value.get("target", {})
    if isinstance(targets, dict):
        for target in targets.values():
            if not isinstance(target, dict):
                continue
            for section in ("dependencies", "dev-dependencies", "build-dependencies"):
                table = target.get(section, {})
                if isinstance(table, dict):
                    dependency_tables.append(table)
    result: set[Path] = set()
    for table in dependency_tables:
        for dependency in table.values():
            if isinstance(dependency, dict) and isinstance(dependency.get("path"), str):
                result.add((manifest.parent / dependency["path"]).resolve(strict=True))
    return result


def _cargo_workspace_closure(root: Path) -> set[Path]:
    pending = [(root / "apps/mobile/src-tauri").resolve(strict=True)]
    closure: set[Path] = set()
    repository = root.resolve(strict=True)
    while pending:
        directory = pending.pop()
        try:
            directory.relative_to(repository)
        except ValueError as error:
            raise MobileNativeBuildError(
                f"Cargo path dependency escapes repository: {directory}"
            ) from error
        if directory in closure:
            continue
        manifest = directory / "Cargo.toml"
        if not manifest.is_file() or manifest.is_symlink():
            raise MobileNativeBuildError(f"local Cargo dependency is unresolved: {directory}")
        closure.add(directory)
        pending.extend(_cargo_path_dependencies(manifest))
    return closure


def _source_local_package_closure(root: Path) -> set[Path]:
    package_roots: set[Path] = set()
    for relative in _collect_input_tree(root, "apps/mobile/src"):
        if Path(relative).suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        source = _relative_file(root, relative).read_text(encoding="utf-8")
        for package in re.findall(r"(?:\.\./)+packages/([^/'\"]+)", source):
            package_root = (root / "packages" / package).resolve(strict=True)
            if not (package_root / "package.json").is_file():
                raise MobileNativeBuildError(
                    f"relative local package import is unresolved: packages/{package}"
                )
            package_roots.add(package_root)
    return package_roots


def canonical_build_input_paths(root: Path) -> tuple[str, ...]:
    paths = set(REQUIRED_BUILD_INPUT_FILES)
    tsconfigs = sorted(
        _repository_relative(root, path)
        for path in (root / "apps/mobile").glob("tsconfig*.json")
        if path.is_file() and not path.is_symlink()
    )
    if not tsconfigs:
        raise MobileNativeBuildError("required apps/mobile/tsconfig*.json input is missing")
    paths.update(tsconfigs)
    for relative_root in REQUIRED_BUILD_INPUT_ROOTS:
        paths.update(_collect_input_tree(root, relative_root))
    package_roots = (
        _package_workspace_closure(root)
        | _cargo_workspace_closure(root)
        | _source_local_package_closure(root)
    )
    for package_root in package_roots:
        relative_root = _repository_relative(root, package_root)
        if relative_root in {"apps/mobile", "apps/mobile/src-tauri"}:
            continue
        paths.update(_collect_input_tree(root, relative_root))
    for relative in sorted(paths):
        _relative_file(root, relative)
    return tuple(sorted(paths))


def canonical_files_digest(root: Path, relative_paths: Sequence[str]) -> str:
    digest = hashlib.sha256()
    normalized = sorted(set(relative_paths))
    if len(normalized) != len(relative_paths):
        raise MobileNativeBuildError("build input list contains duplicate paths")
    for relative in normalized:
        path = _relative_file(root, relative)
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _canonical_directory_digest(
    directory: Path,
    *,
    excluded_file_names: frozenset[str] = frozenset(),
) -> str:
    if not directory.is_dir() or directory.is_symlink():
        raise MobileNativeBuildError(f"Gradle project source is unsafe: {directory}")
    digest = hashlib.sha256()
    file_count = 0
    for current, directories, files in os.walk(directory, followlinks=False):
        current_path = Path(current)
        retained_directories: list[str] = []
        for name in sorted(directories):
            candidate = current_path / name
            if name in GRADLE_SETTINGS_SOURCE_EXCLUDED_PARTS:
                continue
            if candidate.is_symlink():
                raise MobileNativeBuildError(
                    f"Gradle project source contains a symlink: {candidate}"
                )
            retained_directories.append(name)
        directories[:] = retained_directories
        for name in sorted(files):
            if name in excluded_file_names:
                continue
            candidate = current_path / name
            if candidate.is_symlink() or not candidate.is_file():
                raise MobileNativeBuildError(
                    f"Gradle project source contains an unsafe file: {candidate}"
                )
            relative = candidate.relative_to(directory).as_posix()
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(candidate.read_bytes())
            digest.update(b"\0")
            file_count += 1
    if file_count == 0:
        raise MobileNativeBuildError(f"Gradle project source is empty: {directory}")
    return f"sha256:{digest.hexdigest()}"


def _combined_build_inputs_digest(
    repository_inputs_digest: str,
    gradle_settings: Path | None,
) -> str:
    if gradle_settings is None:
        return repository_inputs_digest
    _assert_run_scoped_gradle_properties(gradle_settings)
    return canonical_value_digest(
        {
            "repositoryInputsDigest": repository_inputs_digest,
            "runScopedGradlePropertiesSha256": _sha256_file(
                gradle_settings.parent / "gradle.properties"
            ),
            "runScopedGradleSettingsSha256": _sha256_file(gradle_settings),
        }
    )


def canonical_build_inputs_digest(
    root: Path,
    platform: str,
    *,
    configuration: str = BUILD_CONFIGURATION,
    harness_enabled: bool = True,
) -> str:
    files = [
        {
            "path": relative,
            "sha256": _sha256_file(_relative_file(root, relative)),
        }
        for relative in canonical_build_input_paths(root)
    ]
    return canonical_value_digest(
        {
            "configuration": configuration,
            "files": files,
            "harnessEnabled": harness_enabled,
            "platform": platform,
        }
    )


def capture_source_identity(root: Path) -> SourceIdentity:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    source_commit = completed.stdout.strip().lower()
    if not GIT_COMMIT_PATTERN.fullmatch(source_commit):
        raise MobileNativeBuildError("Git did not return a full lowercase source commit")
    workspace_digest = source_workspace_digest(root)
    return SourceIdentity(
        source_commit=source_commit,
        workspace_state="clean" if workspace_digest == "clean" else "dirty",
        workspace_digest=workspace_digest,
    )


def construct_build_environment(
    *,
    platform: str,
    run_root: Path,
    executable_paths: Mapping[str, str],
    sdk_paths: Mapping[str, str],
    identity_json: str | None = None,
    acceptance_harness: bool = True,
) -> dict[str, str]:
    if platform not in RESOLVER_ARGUMENTS:
        raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}")
    for directory in (
        "home",
        "tmp",
        "cargo-home",
        "cargo-target",
        "rustup-home",
    ):
        (run_root / directory).mkdir(parents=True, exist_ok=True)
    path_entries = sorted({str(Path(path).parent) for path in executable_paths.values()})
    if not path_entries:
        raise MobileNativeBuildError("build environment has no resolved executables")
    environment = {
        "PATH": os.pathsep.join(path_entries),
        "HOME": str((run_root / "home").resolve()),
        "TMPDIR": str((run_root / "tmp").resolve()),
        "CARGO_HOME": str((run_root / "cargo-home").resolve()),
        "CARGO_TARGET_DIR": str((run_root / "cargo-target").resolve()),
        "RUSTUP_HOME": str((run_root / "rustup-home").resolve()),
    }
    if acceptance_harness:
        environment["VITE_ACCEPTANCE_HARNESS"] = "1"
    platform_names = (
        ("DEVELOPER_DIR", "SDKROOT")
        if platform == "ios"
        else ("JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT")
    )
    for name in platform_names:
        value = sdk_paths.get(name)
        if not value or not Path(value).is_dir():
            raise MobileNativeBuildError(f"required SDK path is unavailable: {name}")
        environment[name] = str(Path(value).resolve())
    if platform == "android":
        gradle_user_home = run_root / "gradle-home"
        gradle_user_home.mkdir(parents=True, exist_ok=True)
        environment["GRADLE_USER_HOME"] = str(gradle_user_home.resolve())
    if identity_json is not None:
        identity = (
            parse_build_identity(identity_json)
            if acceptance_harness
            else _parse_release_build_identity(identity_json)
        )
        environment["PT_MOBILE_BUILD_IDENTITY_JSON"] = canonical_json_bytes(
            identity
        ).decode("ascii")
    if set(environment) - CONSTRUCTED_BUILD_ENVIRONMENT:
        raise MobileNativeBuildError("build environment construction added unknown names")
    return environment


def _assert_attested_protoc(toolchain: ToolchainIdentity) -> Path:
    protoc_value = toolchain.executable_paths.get("protoc")
    if not protoc_value:
        raise MobileNativeBuildError("required build executable is unattested: protoc")
    try:
        protoc = Path(protoc_value).resolve(strict=True)
    except OSError as error:
        raise MobileNativeBuildError(
            "attested protoc executable is unavailable"
        ) from error
    if not protoc.is_file():
        raise MobileNativeBuildError("attested protoc executable is not a file")

    executable_sha256 = _sha256_file(protoc)
    executable_observations = [
        observation
        for observation in toolchain.observations
        if observation.get("executable") == "protoc"
    ]
    probe_observations = [
        observation
        for observation in toolchain.observations
        if observation.get("command") == ["protoc", "--version"]
    ]
    if executable_observations != [
        {
            "executable": "protoc",
            "path": str(protoc),
            "sha256": executable_sha256,
        }
    ]:
        raise MobileNativeBuildError("protoc executable hash is not uniquely attested")
    if (
        len(probe_observations) != 1
        or probe_observations[0].get("executableSha256") != executable_sha256
        or not (
            str(probe_observations[0].get("stdout", "")).strip()
            or str(probe_observations[0].get("stderr", "")).strip()
        )
    ):
        raise MobileNativeBuildError("protoc version probe is not attested")
    if toolchain.digest != canonical_value_digest(list(toolchain.observations)):
        raise MobileNativeBuildError("toolchain digest does not cover protoc attestation")
    return protoc


def _assert_protoc_on_sanitized_path(
    toolchain: ToolchainIdentity,
    environment: Mapping[str, str],
) -> None:
    attested_protoc = _assert_attested_protoc(toolchain)
    protoc_directory = attested_protoc.parent
    sanitized_path = environment.get("PATH", "")
    path_directories = {
        Path(entry).resolve()
        for entry in sanitized_path.split(os.pathsep)
        if entry
    }
    if protoc_directory not in path_directories:
        raise MobileNativeBuildError(
            "sanitized build PATH does not contain the attested protoc directory"
        )
    resolved_protoc_value = shutil.which("protoc", path=sanitized_path)
    if resolved_protoc_value is None:
        raise MobileNativeBuildError("sanitized build PATH does not resolve protoc")
    try:
        resolved_protoc = Path(resolved_protoc_value).resolve(strict=True)
    except OSError as error:
        raise MobileNativeBuildError(
            "sanitized build PATH resolves an unavailable protoc executable"
        ) from error
    if resolved_protoc != attested_protoc:
        raise MobileNativeBuildError(
            "sanitized build PATH does not resolve to the attested protoc executable"
        )


def _install_cargo_frozen_wrapper(
    *,
    run_root: Path,
    real_cargo: str,
    shell: str,
    injected_features: Sequence[str] = (),
) -> CargoWrapperControl:
    wrapper_directory = run_root / "resolver-bin"
    wrapper_directory.mkdir(parents=True, exist_ok=False)
    wrapper = wrapper_directory / "cargo"
    real_cargo_path = Path(real_cargo).resolve(strict=True)
    shell_path = Path(shell).resolve(strict=True)
    if (
        not real_cargo_path.is_file()
        or not os.access(real_cargo_path, os.X_OK)
        or not shell_path.is_file()
        or not os.access(shell_path, os.X_OK)
    ):
        raise MobileNativeBuildError("Cargo wrapper inputs must be executable files")
    if real_cargo_path == wrapper.resolve():
        raise MobileNativeBuildError("Cargo wrapper cannot target itself")
    features = tuple(injected_features)
    if any(
        not feature or not re.fullmatch(r"[A-Za-z0-9_./-]+", feature)
        for feature in features
    ):
        raise MobileNativeBuildError("Cargo wrapper feature injection is invalid")
    feature_arguments = (
        f" --features {shlex.quote(','.join(features))}" if features else ""
    )
    content = (
        f"#!{shell_path}\n"
        'if [ "${1:-}" = "build" ]; then\n'
        "  shift\n"
        f"  exec {shlex.quote(str(real_cargo_path))} --frozen build"
        f'{feature_arguments} "$@"\n'
        "fi\n"
        f"exec {shlex.quote(str(real_cargo_path))} --frozen \"$@\"\n"
    ).encode("utf-8")
    wrapper.write_bytes(content)
    wrapper.chmod(0o700)
    control = CargoWrapperControl(
        path=wrapper,
        sha256=_sha256_file(wrapper),
        real_cargo_path=real_cargo_path,
        real_cargo_sha256=_sha256_file(real_cargo_path),
        injected_features=features,
    )
    _assert_cargo_wrapper_control(control)
    return control


def _assert_cargo_wrapper_control(control: CargoWrapperControl) -> None:
    if (
        control.path.name != "cargo"
        or control.path.is_symlink()
        or not control.path.is_file()
        or not os.access(control.path, os.X_OK)
        or control.real_cargo_path.is_symlink()
        or not control.real_cargo_path.is_file()
        or not os.access(control.real_cargo_path, os.X_OK)
        or control.path.resolve() == control.real_cargo_path.resolve()
    ):
        raise MobileNativeBuildError("controlled Cargo wrapper became unsafe")
    if _sha256_file(control.path) != control.sha256:
        raise MobileNativeBuildError("controlled Cargo wrapper changed after installation")
    if _sha256_file(control.real_cargo_path) != control.real_cargo_sha256:
        raise MobileNativeBuildError("resolved Cargo executable changed after installation")
    content = control.path.read_text(encoding="utf-8")
    expected_feature_argument = (
        f"--features {shlex.quote(','.join(control.injected_features))}"
        if control.injected_features
        else None
    )
    if (
        (expected_feature_argument is not None and expected_feature_argument not in content)
        or (
            expected_feature_argument is None
            and "--features" in content
        )
    ):
        raise MobileNativeBuildError("controlled Cargo wrapper feature policy changed")


def _gradle_distribution_url(properties: Path) -> str:
    try:
        lines = properties.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise MobileNativeBuildError("Gradle wrapper properties are unavailable") from error
    values = [
        line.split("=", 1)[1].strip().replace(r"\:", ":")
        for line in lines
        if line.strip().startswith("distributionUrl=")
    ]
    if len(values) != 1:
        raise MobileNativeBuildError("Gradle wrapper must define one distributionUrl")
    return values[0]


def _validated_gradle_distribution(
    gradle_home: Path,
    distribution_url: str,
) -> Path:
    parsed = urlparse(distribution_url)
    distribution_name = Path(unquote(parsed.path)).name
    if not distribution_name.endswith(".zip"):
        raise MobileNativeBuildError("Gradle wrapper distribution must be a ZIP archive")
    distribution_key = distribution_name.removesuffix(".zip")
    candidates = sorted(
        path
        for path in (
            gradle_home / "wrapper" / "dists" / distribution_key
        ).glob(f"*/{distribution_name}")
        if path.is_file() and not path.is_symlink()
    )
    valid: list[Path] = []
    for candidate in candidates:
        if not zipfile.is_zipfile(candidate):
            continue
        with zipfile.ZipFile(candidate) as archive:
            executable_suffix = f"/bin/gradle"
            if any(
                not info.is_dir() and info.filename.endswith(executable_suffix)
                for info in archive.infolist()
            ):
                valid.append(candidate)
    if len(valid) != 1:
        raise MobileNativeBuildError(
            "preseeded Gradle wrapper distribution is missing or ambiguous"
        )
    return valid[0]


def _install_offline_gradle_wrapper(
    *,
    root: Path,
    run_root: Path,
    source_gradle_home: Path,
) -> GradleWrapperControl:
    source_wrapper = _relative_file(root, "apps/mobile/src-tauri/gen/android/gradlew")
    source_jar = _relative_file(
        root,
        "apps/mobile/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar",
    )
    source_properties = _relative_file(
        root,
        "apps/mobile/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
    )
    distribution = _validated_gradle_distribution(
        source_gradle_home,
        _gradle_distribution_url(source_properties),
    )

    wrapper_root = run_root / "gradle-wrapper"
    wrapper = wrapper_root / "gradlew"
    wrapper_jar = wrapper_root / "gradle/wrapper/gradle-wrapper.jar"
    properties = wrapper_root / "gradle/wrapper/gradle-wrapper.properties"
    wrapper_jar.parent.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(source_wrapper, wrapper)
    wrapper.chmod(0o700)
    shutil.copyfile(source_jar, wrapper_jar)

    distribution_root = run_root / "gradle-distribution"
    distribution_root.mkdir(parents=True, exist_ok=False)
    controlled_distribution = distribution_root / distribution.name
    shutil.copyfile(distribution, controlled_distribution)
    distribution_sha256 = _sha256_file(controlled_distribution)
    rewritten: list[str] = []
    for line in source_properties.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("distributionUrl="):
            rewritten.append(f"distributionUrl={controlled_distribution.as_uri()}")
        elif line.strip().startswith("distributionSha256Sum="):
            continue
        else:
            rewritten.append(line)
    rewritten.append(f"distributionSha256Sum={distribution_sha256.removeprefix('sha256:')}")
    properties.write_text("\n".join(rewritten) + "\n", encoding="utf-8")

    control = GradleWrapperControl(
        path=wrapper,
        wrapper_sha256=_sha256_file(wrapper),
        properties_path=properties,
        properties_sha256=_sha256_file(properties),
        distribution_path=controlled_distribution,
        distribution_sha256=distribution_sha256,
        gradle_user_home=(run_root / "gradle-home").resolve(strict=True),
    )
    _assert_gradle_wrapper_control(control)
    return control


def _assert_gradle_wrapper_control(control: GradleWrapperControl) -> None:
    if (
        control.path.name != "gradlew"
        or control.path.is_symlink()
        or not control.path.is_file()
        or not os.access(control.path, os.X_OK)
        or control.properties_path.is_symlink()
        or not control.properties_path.is_file()
        or control.distribution_path.is_symlink()
        or not control.distribution_path.is_file()
        or not control.gradle_user_home.is_dir()
        or control.gradle_user_home.is_symlink()
    ):
        raise MobileNativeBuildError("controlled Gradle wrapper became unsafe")
    if (
        _sha256_file(control.path) != control.wrapper_sha256
        or _sha256_file(control.properties_path) != control.properties_sha256
        or _sha256_file(control.distribution_path) != control.distribution_sha256
        or not zipfile.is_zipfile(control.distribution_path)
    ):
        raise MobileNativeBuildError("controlled Gradle wrapper changed after installation")
    distribution_url = _gradle_distribution_url(control.properties_path)
    if distribution_url != control.distribution_path.as_uri():
        raise MobileNativeBuildError("Gradle wrapper distribution is not run-local")
    expected_sum = f"distributionSha256Sum={control.distribution_sha256[7:]}"
    if expected_sum not in control.properties_path.read_text(encoding="utf-8").splitlines():
        raise MobileNativeBuildError("Gradle wrapper distribution digest is not pinned")


def _prepend_controlled_path(
    environment: Mapping[str, str],
    directory: Path,
) -> dict[str, str]:
    controlled_directory = str(directory.resolve(strict=True))
    existing = [
        entry
        for entry in environment.get("PATH", "").split(os.pathsep)
        if entry and Path(entry).resolve() != Path(controlled_directory)
    ]
    result = dict(environment)
    result["PATH"] = os.pathsep.join([controlled_directory, *existing])
    return result


def _toolchain_digest_with_cargo_wrapper(
    toolchain_digest: str,
    control: CargoWrapperControl,
) -> str:
    return canonical_value_digest(
        {
            "resolvedToolchainDigest": toolchain_digest,
            "cargoWrapper": {
                "arguments": ["--frozen"],
                "injectedFeatures": list(control.injected_features),
                "realCargoSha256": control.real_cargo_sha256,
                "wrapperSha256": control.sha256,
            },
        }
    )


def _toolchain_digest_with_wrappers(
    toolchain_digest: str,
    cargo: CargoWrapperControl,
    gradle: GradleWrapperControl | None,
) -> str:
    return canonical_value_digest(
        {
            "cargoControlledToolchainDigest": _toolchain_digest_with_cargo_wrapper(
                toolchain_digest,
                cargo,
            ),
            "gradleWrapper": (
                None
                if gradle is None
                else {
                    "wrapperSha256": gradle.wrapper_sha256,
                    "propertiesSha256": gradle.properties_sha256,
                    "distributionSha256": gradle.distribution_sha256,
                }
            ),
        }
    )


def allowlisted_environment_digest(environment: Mapping[str, str]) -> str:
    unexpected = set(environment) - CONSTRUCTED_BUILD_ENVIRONMENT
    if unexpected:
        raise MobileNativeBuildError(
            f"build environment contains non-allowlisted keys: {sorted(unexpected)}"
        )
    digest_values = {
        key: value
        for key, value in environment.items()
        if key != "PT_MOBILE_BUILD_IDENTITY_JSON"
    }
    return canonical_value_digest(dict(sorted(digest_values.items())))


def resolver_arguments(platform: str) -> dict[str, list[str]]:
    try:
        return {
            tool: list(arguments)
            for tool, arguments in RESOLVER_ARGUMENTS[platform].items()
        }
    except KeyError as error:
        raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}") from error


def resolver_digest(platform: str) -> str:
    return canonical_value_digest(
        {
            "arguments": resolver_arguments(platform),
            "cacheMissPolicy": "BLOCK",
            "dependencyPolicy": DEPENDENCY_POLICY,
            "inapplicableResolvers": INAPPLICABLE_RESOLVERS[platform],
        }
    )


def require_tool_native_offline_controls(
    platform: str,
    commands: Mapping[str, Sequence[str]],
) -> None:
    expected = RESOLVER_ARGUMENTS.get(platform)
    if expected is None:
        raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}")
    if set(commands) != set(expected):
        raise MobileNativeBuildError(
            f"{platform} resolver command set is incomplete: {sorted(commands)}"
        )
    for tool, required in expected.items():
        command = list(commands[tool])
        if not command or Path(command[0]).name not in {
            tool,
            "pnpm.cjs" if tool == "pnpm" else tool,
            "gradlew" if tool == "gradle" else tool,
            "xcodebuild" if tool == "xcode" else tool,
        }:
            raise MobileNativeBuildError(f"{tool} command uses an unexpected executable")
        positions = [command.index(argument) if argument in command else -1 for argument in required]
        if -1 in positions or positions != sorted(positions):
            raise MobileNativeBuildError(
                f"{tool} command is missing ordered offline controls: {required}"
            )


def execute_source_bound_build(
    *,
    root: Path,
    platform: str,
    commands: Mapping[str, Sequence[str]],
    environment: Mapping[str, str],
    identity: Mapping[str, Any],
    runner: CommandRunner | None = None,
) -> dict[str, Any]:
    require_tool_native_offline_controls(platform, commands)
    identity_json = canonical_json_bytes(dict(identity)).decode("ascii")
    parse_build_identity(identity_json)
    if environment.get("PT_MOBILE_BUILD_IDENTITY_JSON") != identity_json:
        raise MobileNativeBuildError("build environment is not bound to the exact identity")
    if set(environment) - CONSTRUCTED_BUILD_ENVIRONMENT:
        raise MobileNativeBuildError("build environment contains ambient names")
    command_runner = runner or SubprocessCommandRunner()
    command_digests: list[str] = []
    for tool in RESOLVER_ARGUMENTS[platform]:
        command = list(commands[tool])
        result = command_runner.run(command, cwd=root, env=environment)
        if result.returncode != 0:
            raise MobileNativeBuildError(
                f"{tool} offline build failed; network fallback is forbidden"
            )
        command_digests.append(canonical_value_digest(command))
    return {
        "resolverDigest": resolver_digest(platform),
        "allowlistedEnvironmentDigest": allowlisted_environment_digest(environment),
        "commandDigests": command_digests,
    }


def create_build_identity(
    *,
    build_id: str,
    platform: str,
    source: SourceIdentity,
    build_inputs_digest: str,
    environment_digest: str,
    application_id: str = APPLICATION_ID,
) -> dict[str, Any]:
    if not build_id or any(character.isspace() for character in build_id):
        raise MobileNativeBuildError("build ID must be non-empty and whitespace-free")
    for name, digest in (
        ("build inputs", build_inputs_digest),
        ("environment", environment_digest),
    ):
        if not digest.startswith("sha256:") or not SHA256_PATTERN.fullmatch(digest[7:]):
            raise MobileNativeBuildError(f"{name} digest is invalid")
    identity = {
        "schema": BUILD_IDENTITY_SCHEMA,
        "buildId": build_id,
        "platform": platform,
        "configuration": BUILD_CONFIGURATION,
        "sourceCommit": source.source_commit,
        "workspaceState": source.workspace_state,
        "workspaceDigest": source.workspace_digest,
        "buildInputsDigest": build_inputs_digest,
        "allowlistedEnvironmentDigest": environment_digest,
        "applicationId": application_id,
        "harnessEnabled": True,
    }
    parse_build_identity(canonical_json_bytes(identity).decode("ascii"))
    return identity


def _create_release_build_identity(
    *,
    build_id: str,
    platform: str,
    source: SourceIdentity,
    build_inputs_digest: str,
    environment_digest: str,
    application_id: str = APPLICATION_ID,
) -> dict[str, Any]:
    identity = create_build_identity(
        build_id=build_id,
        platform=platform,
        source=source,
        build_inputs_digest=build_inputs_digest,
        environment_digest=environment_digest,
        application_id=application_id,
    )
    identity["configuration"] = RELEASE_CONFIGURATION
    identity["harnessEnabled"] = False
    _parse_release_build_identity(canonical_json_bytes(identity).decode("ascii"))
    return identity


def _parse_identity(
    raw: str,
    *,
    configuration: str,
    harness_enabled: bool,
) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise MobileNativeBuildError("embedded build identity is not valid JSON") from error
    required = {
        "schema",
        "buildId",
        "platform",
        "configuration",
        "sourceCommit",
        "workspaceState",
        "workspaceDigest",
        "buildInputsDigest",
        "allowlistedEnvironmentDigest",
        "applicationId",
        "harnessEnabled",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise MobileNativeBuildError("embedded build identity has invalid fields")
    if canonical_json_bytes(value).decode("ascii") != raw:
        raise MobileNativeBuildError("embedded build identity is not canonical JSON")
    if (
        value["schema"] != BUILD_IDENTITY_SCHEMA
        or value["platform"] not in RESOLVER_ARGUMENTS
        or value["configuration"] != configuration
        or value["workspaceState"] not in {"clean", "dirty"}
        or value["harnessEnabled"] is not harness_enabled
        or value["applicationId"] != APPLICATION_ID
        or not isinstance(value["buildId"], str)
        or not value["buildId"]
        or any(character.isspace() for character in value["buildId"])
        or not GIT_COMMIT_PATTERN.fullmatch(str(value["sourceCommit"]))
    ):
        raise MobileNativeBuildError("embedded build identity has invalid values")
    if value["workspaceState"] == "clean" and value["workspaceDigest"] != "clean":
        raise MobileNativeBuildError("clean identity must use workspaceDigest='clean'")
    if value["workspaceState"] == "dirty":
        workspace_digest = str(value["workspaceDigest"])
        if not workspace_digest.startswith("sha256:") or not SHA256_PATTERN.fullmatch(
            workspace_digest[7:]
        ):
            raise MobileNativeBuildError("dirty identity must use a workspace digest")
    for field in ("buildInputsDigest", "allowlistedEnvironmentDigest"):
        digest = str(value[field])
        if not digest.startswith("sha256:") or not SHA256_PATTERN.fullmatch(digest[7:]):
            raise MobileNativeBuildError(f"embedded build identity has invalid {field}")
    return value


def parse_build_identity(raw: str) -> dict[str, Any]:
    return _parse_identity(
        raw,
        configuration=BUILD_CONFIGURATION,
        harness_enabled=True,
    )


def _parse_release_build_identity(raw: str) -> dict[str, Any]:
    return _parse_identity(
        raw,
        configuration=RELEASE_CONFIGURATION,
        harness_enabled=False,
    )


def embedded_identity_digest(identity: Mapping[str, Any]) -> str:
    return sha256_digest(canonical_json_bytes(dict(identity)))


def _run_required(
    runner: CommandRunner,
    command: Sequence[str],
    *,
    cwd: Path,
    environment: Mapping[str, str] | None = None,
) -> CommandResult:
    result = runner.run(command, cwd=cwd, env={} if environment is None else environment)
    if result.returncode != 0:
        raise MobileNativeBuildError(f"artifact inspection command failed: {command[0]}")
    return result


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _require_archive(path: Path, suffix: str) -> None:
    if path.suffix.lower() != suffix or not path.is_file() or path.is_symlink():
        raise MobileNativeBuildError(f"expected a controlled {suffix} artifact")
    if not zipfile.is_zipfile(path):
        raise MobileNativeBuildError(f"{suffix} artifact is not a ZIP container")


def _safe_package_entries(package: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    entries: dict[str, zipfile.ZipInfo] = {}
    for entry in package.infolist():
        relative = PurePosixPath(entry.filename)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or entry.filename in entries
            or entry.flag_bits & 0x1
        ):
            raise MobileNativeBuildError("application package contains an unsafe entry")
        entries[entry.filename] = entry
    return entries


def _package_executable_entries(
    package: zipfile.ZipFile,
    platform: str,
) -> tuple[zipfile.ZipInfo, ...]:
    entries = _safe_package_entries(package)
    if platform == "android":
        executable_entries = tuple(
            entry
            for name, entry in sorted(entries.items())
            if not entry.is_dir()
            and (
                re.fullmatch(r"classes(?:[2-9][0-9]*)?\.dex", name) is not None
                or re.fullmatch(
                    r"lib/(?:arm64-v8a|armeabi-v7a|x86|x86_64)/[^/]+\.so",
                    name,
                )
                is not None
            )
        )
    elif platform == "ios":
        info_entries = [
            entry
            for name, entry in sorted(entries.items())
            if not entry.is_dir()
            and re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name) is not None
        ]
        if len(info_entries) != 1:
            raise MobileNativeBuildError("IPA must contain exactly one application Info.plist")
        try:
            info = plistlib.loads(package.read(info_entries[0]))
        except plistlib.InvalidFileException as error:
            raise MobileNativeBuildError("IPA Info.plist is malformed") from error
        if not isinstance(info, dict):
            raise MobileNativeBuildError("IPA Info.plist is not an object")
        executable_name = info.get("CFBundleExecutable")
        if (
            not isinstance(executable_name, str)
            or not executable_name
            or PurePosixPath(executable_name).name != executable_name
        ):
            raise MobileNativeBuildError(
                "IPA Info.plist has an invalid CFBundleExecutable"
            )
        executable_path = str(
            PurePosixPath(info_entries[0].filename).parent / executable_name
        )
        executable = entries.get(executable_path)
        executable_entries = (
            ()
            if executable is None or executable.is_dir()
            else (executable,)
        )
    else:
        raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}")
    if not executable_entries:
        raise MobileNativeBuildError(
            f"{platform} application package contains no executable-bearing entries"
        )
    return executable_entries


def _scan_package_bytes(
    artifact: Path,
    platform: str,
    *,
    required_markers: Sequence[bytes],
    forbidden_markers: Sequence[bytes],
    expected_identity: bytes | None = None,
) -> dict[str, Any]:
    expected_suffix = ".apk" if platform == "android" else ".ipa"
    _require_archive(artifact, expected_suffix)
    checked_entries: list[dict[str, Any]] = []
    located_required_markers: dict[bytes, str] = {}
    identity_entry: str | None = None
    all_markers = tuple(required_markers) + tuple(forbidden_markers)
    if expected_identity is not None:
        all_markers += (expected_identity,)
    maximum_marker_length = max(map(len, all_markers), default=1)
    with zipfile.ZipFile(artifact) as package:
        for entry in _package_executable_entries(package, platform):
            digest = hashlib.sha256()
            size = 0
            tail = b""
            forbidden_present: set[str] = set()
            with package.open(entry) as content:
                while chunk := content.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
                    searchable = tail + chunk
                    forbidden_present.update(
                        symbol.decode("ascii", errors="strict")
                        for symbol in forbidden_markers
                        if symbol in searchable
                    )
                    for marker in required_markers:
                        if marker in searchable:
                            located_required_markers.setdefault(marker, entry.filename)
                    if expected_identity is not None and expected_identity in searchable:
                        identity_entry = identity_entry or entry.filename
                    tail = searchable[-(maximum_marker_length - 1) :]
            if forbidden_present:
                raise MobileNativeBuildError(
                    "application package contains forbidden Acceptance adapters "
                    f"in {entry.filename}: {sorted(forbidden_present)}"
                )
            checked_entries.append(
                {
                    "path": entry.filename,
                    "sha256": f"sha256:{digest.hexdigest()}",
                    "sizeBytes": size,
                }
            )
    if not checked_entries:
        raise MobileNativeBuildError("application package contains no inspectable entries")
    missing_markers = [
        marker.decode("ascii", errors="strict")
        for marker in required_markers
        if marker not in located_required_markers
    ]
    if missing_markers:
        raise MobileNativeBuildError(
            "Acceptance application package is missing native harness markers: "
            f"{sorted(missing_markers)}"
        )
    if expected_identity is not None and identity_entry is None:
        raise MobileNativeBuildError(
            "Acceptance application package executable is missing the exact "
            "canonical native build identity"
        )
    result = {
        "status": "PASS",
        "platform": platform,
        "packageSha256": _sha256_file(artifact),
        "checkedEntries": checked_entries,
        "requiredMarkers": {
            marker.decode("ascii", errors="strict"): located_required_markers[marker]
            for marker in sorted(located_required_markers)
        },
        "forbiddenSymbols": sorted(
            symbol.decode("ascii", errors="strict")
            for symbol in forbidden_markers
        ),
    }
    if expected_identity is not None:
        result["embeddedIdentitySha256"] = sha256_digest(expected_identity)
        result["embeddedIdentityEntry"] = identity_entry
    return result


def _scan_application_package(artifact: Path, platform: str) -> dict[str, Any]:
    return _scan_package_bytes(
        artifact,
        platform,
        required_markers=(),
        forbidden_markers=(
            *FORBIDDEN_RELEASE_ADAPTER_SYMBOLS,
            NATIVE_ACCEPTANCE_HARNESS_MARKER,
        ),
    )


def _tauri_embedded_asset_bytes(
    cargo_target_dir: Path,
    *,
    expected_identity: bytes,
    asset_path: str,
) -> bytes:
    asset_suffix = PurePosixPath(asset_path).suffix
    if not asset_suffix:
        raise MobileNativeBuildError(
            "Tauri Web identity asset path has no file extension"
        )
    expected_filename = (
        hashlib.sha256(expected_identity).hexdigest() + asset_suffix
    )
    candidates = sorted(
        path
        for path in cargo_target_dir.glob(
            f"**/tauri-codegen-assets/{expected_filename}"
        )
        if path.is_file()
    )
    if not candidates:
        raise MobileNativeBuildError(
            "Tauri codegen metadata is missing the digest-bound Web identity "
            f"representation {expected_filename}"
        )
    if any(candidate.is_symlink() for candidate in candidates):
        raise MobileNativeBuildError(
            "Tauri codegen metadata for the Web identity asset is a symlink"
        )

    node = shutil.which("node")
    if node is None:
        raise MobileNativeBuildError(
            "Node.js is required to verify Tauri codegen Web identity metadata"
        )
    representations: set[bytes] = set()
    for candidate in candidates:
        representation = candidate.read_bytes()
        try:
            decoded = subprocess.run(
                [
                    node,
                    "-e",
                    (
                        "const z=require('node:zlib');const c=[];"
                        "process.stdin.on('data',x=>c.push(x));"
                        "process.stdin.on('end',()=>{try{process.stdout.write("
                        "z.brotliDecompressSync(Buffer.concat(c)))}catch{"
                        "process.exitCode=2}})"
                    ),
                ],
                input=representation,
                capture_output=True,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise MobileNativeBuildError(
                "Tauri codegen Web identity metadata could not be decoded"
            ) from error
        if decoded.returncode != 0:
            raise MobileNativeBuildError(
                "Tauri codegen Web identity metadata is structurally malformed"
            )
        if decoded.stdout != expected_identity:
            raise MobileNativeBuildError(
                "Tauri codegen Web identity metadata does not map to the exact "
                "canonical identity bytes"
            )
        representations.add(representation)
    if len(representations) != 1:
        raise MobileNativeBuildError(
            "application package omits the Web identity asset or its Tauri build "
            "output does not contain one deterministic representation"
        )
    return representations.pop()


def _scan_packaged_web_identity(
    artifact: Path,
    platform: str,
    *,
    expected_identity: bytes,
    web_provenance: Mapping[str, Any],
    cargo_target_dir: Path | None = None,
) -> dict[str, Any]:
    expected_digest = sha256_digest(expected_identity)
    if (
        web_provenance.get("identityAssetPath") != WEB_BUILD_IDENTITY_ASSET
        or web_provenance.get("identityAssetSha256") != expected_digest
        or web_provenance.get("identityAssetSizeBytes") != len(expected_identity)
    ):
        raise MobileNativeBuildError(
            "Web build provenance is not bound to the exact identity asset"
        )

    expected_suffix = ".apk" if platform == "android" else ".ipa"
    _require_archive(artifact, expected_suffix)
    if cargo_target_dir is None:
        raise MobileNativeBuildError(
            "Tauri build output is required to verify the packaged Web identity asset"
        )
    embedded_bytes = _tauri_embedded_asset_bytes(
        cargo_target_dir,
        expected_identity=expected_identity,
        asset_path=WEB_BUILD_IDENTITY_ASSET,
    )
    asset_key = WEB_BUILD_IDENTITY_ASSET.encode("ascii")
    with zipfile.ZipFile(artifact) as package:
        matching_entries: list[str] = []
        representation_count = 0
        asset_key_count = 0
        for entry in _package_executable_entries(package, platform):
            content = package.read(entry)
            representation_occurrences = content.count(embedded_bytes)
            asset_key_occurrences = content.count(asset_key)
            if representation_occurrences and asset_key_occurrences:
                matching_entries.append(entry.filename)
            representation_count += representation_occurrences
            asset_key_count += asset_key_occurrences
        if representation_count != 1 or asset_key_count != 1 or len(matching_entries) != 1:
            raise MobileNativeBuildError(
                "application package has an omitted, stale, swapped, or duplicated "
                "Tauri-embedded Web identity asset; expected exactly one asset and "
                "key, found "
                f"{representation_count} representations and {asset_key_count} keys"
            )
        package_entry = matching_entries[0]

    return {
        "path": WEB_BUILD_IDENTITY_ASSET,
        "sha256": expected_digest,
        "sizeBytes": len(expected_identity),
        "packageEntry": package_entry,
        "representation": "tauri-embedded",
    }


def _scan_acceptance_application_package(
    artifact: Path,
    platform: str,
    expected_identity: bytes,
) -> dict[str, Any]:
    parse_build_identity(expected_identity.decode("ascii"))
    return _scan_package_bytes(
        artifact,
        platform,
        required_markers=(NATIVE_ACCEPTANCE_HARNESS_MARKER,),
        forbidden_markers=(),
        expected_identity=expected_identity,
    )


def inspect_android_apk(
    artifact: Path,
    runner: CommandRunner,
    *,
    expected_application_id: str = APPLICATION_ID,
    environment: Mapping[str, str] | None = None,
    executables: Mapping[str, str] | None = None,
) -> ArtifactInspection:
    _require_archive(artifact, ".apk")
    tools = executables or {}
    application = _run_required(
        runner,
        [tools.get("apkanalyzer", "apkanalyzer"), "manifest", "application-id", str(artifact)],
        cwd=artifact.parent,
        environment=environment,
    ).stdout.strip()
    debuggable = _run_required(
        runner,
        [tools.get("apkanalyzer", "apkanalyzer"), "manifest", "debuggable", str(artifact)],
        cwd=artifact.parent,
        environment=environment,
    ).stdout.strip().lower()
    verification = _run_required(
        runner,
        [
            tools.get("apksigner", "apksigner"),
            "verify",
            "--verbose",
            "--print-certs",
            str(artifact),
        ],
        cwd=artifact.parent,
        environment=environment,
    )
    output = f"{verification.stdout}\n{verification.stderr}"
    certificates = re.findall(
        r"Signer #(\d+) certificate SHA-256 digest:\s*([0-9A-Fa-f:]{64,95})",
        output,
    )
    scheme_values = re.findall(
        r"Verified using v(\d+) scheme[^:]*:\s*(true|false)",
        output,
        re.IGNORECASE,
    )
    if application != expected_application_id:
        raise MobileNativeBuildError("APK application ID does not match build identity")
    if debuggable != "true":
        raise MobileNativeBuildError("Acceptance APK must be debuggable")
    if len(certificates) != 1 or certificates[0][0] != "1":
        raise MobileNativeBuildError("APK must contain exactly one signer")
    enabled_schemes = {
        f"v{scheme}"
        for scheme, enabled in scheme_values
        if enabled.lower() == "true"
    }
    if enabled_schemes != {"v2", "v3"}:
        raise MobileNativeBuildError(
            f"APK signing schemes do not match policy: {sorted(enabled_schemes)}"
        )
    if not scheme_values:
        raise MobileNativeBuildError("APK signing metadata is incomplete")
    certificate_hex = certificates[0][1].replace(":", "").lower()
    if not SHA256_PATTERN.fullmatch(certificate_hex):
        raise MobileNativeBuildError("APK signer certificate digest is invalid")
    digest = f"sha256:{certificate_hex}"
    return ArtifactInspection(
        platform="android",
        kind="apk",
        application_id=application,
        sha256=_sha256_file(artifact),
        size_bytes=artifact.stat().st_size,
        signing={
            "policyId": SIGNING_POLICY,
            "certificateSha256": digest,
            "applicationIdentifier": application,
            "debuggable": True,
            "signerCertificateSha256": digest,
            "enabledSigningSchemes": sorted(enabled_schemes),
        },
    )


def _safe_extract_archive(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            relative = PurePosixPath(member.filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise MobileNativeBuildError("IPA contains an unsafe archive path")
            target = destination.joinpath(*relative.parts)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(member) as source, target.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)


def _plist_from_command(result: CommandResult) -> dict[str, Any]:
    combined = f"{result.stdout}\n{result.stderr}".encode("utf-8")
    start = combined.find(b"<?xml")
    end = combined.rfind(b"</plist>")
    if start < 0 or end < 0:
        raise MobileNativeBuildError("codesign did not return a plist")
    try:
        value = plistlib.loads(combined[start : end + len(b"</plist>")])
    except plistlib.InvalidFileException as error:
        raise MobileNativeBuildError("codesign returned malformed plist data") from error
    if not isinstance(value, dict):
        raise MobileNativeBuildError("codesign plist is not an object")
    return value


def inspect_ios_ipa(
    artifact: Path,
    runner: CommandRunner,
    *,
    expected_application_id: str = APPLICATION_ID,
    environment: Mapping[str, str] | None = None,
    executables: Mapping[str, str] | None = None,
) -> ArtifactInspection:
    _require_archive(artifact, ".ipa")
    tools = executables or {}
    with tempfile.TemporaryDirectory(prefix="pt-mobile-ipa-") as temporary:
        destination = Path(temporary)
        _safe_extract_archive(artifact, destination)
        applications = sorted((destination / "Payload").glob("*.app"))
        if len(applications) != 1:
            raise MobileNativeBuildError("IPA must contain exactly one application")
        application = applications[0]
        try:
            info = plistlib.loads((application / "Info.plist").read_bytes())
        except (OSError, plistlib.InvalidFileException) as error:
            raise MobileNativeBuildError("IPA Info.plist is unavailable") from error
        application_id = str(info.get("CFBundleIdentifier", ""))
        if application_id != expected_application_id:
            raise MobileNativeBuildError("IPA application ID does not match build identity")

        _run_required(
            runner,
            [
                tools.get("codesign", "codesign"),
                "--verify",
                "--deep",
                "--strict",
                str(application),
            ],
            cwd=destination,
            environment=environment,
        )
        details = _run_required(
            runner,
            [tools.get("codesign", "codesign"), "-d", "--verbose=4", str(application)],
            cwd=destination,
            environment=environment,
        )
        detail_output = f"{details.stdout}\n{details.stderr}"
        team = re.search(r"TeamIdentifier=([A-Za-z0-9]+)", detail_output)
        cd_hash = re.search(r"CDHash=([0-9a-fA-F]{40})", detail_output)
        candidate = re.search(
            r"CandidateCDHashFull sha256=([0-9a-fA-F]{64})",
            detail_output,
        )
        if team is None or cd_hash is None or candidate is None:
            raise MobileNativeBuildError("IPA codesign identity is incomplete")
        value_hex = cd_hash.group(1).lower()
        candidate_hex = candidate.group(1).lower()
        if not candidate_hex.startswith(value_hex):
            raise MobileNativeBuildError("IPA CDHash is not the full candidate prefix")

        entitlements_result = _run_required(
            runner,
            [
                tools.get("codesign", "codesign"),
                "-d",
                "--entitlements",
                ":-",
                str(application),
            ],
            cwd=destination,
            environment=environment,
        )
        entitlements = _plist_from_command(entitlements_result)
        application_entitlement = str(entitlements.get("application-identifier", ""))
        if (
            application_entitlement != f"{team.group(1)}.{application_id}"
            or entitlements.get("get-task-allow") is not True
        ):
            raise MobileNativeBuildError("IPA entitlements do not match Acceptance signing")

        profile_result = _run_required(
            runner,
            [
                tools.get("security", "security"),
                "cms",
                "-D",
                "-i",
                str(application / "embedded.mobileprovision"),
            ],
            cwd=destination,
            environment=environment,
        )
        profile = _plist_from_command(profile_result)
        certificates = profile.get("DeveloperCertificates")
        profile_teams = profile.get("TeamIdentifier")
        profile_entitlements = profile.get("Entitlements")
        if (
            not isinstance(certificates, list)
            or not certificates
            or not all(isinstance(certificate, bytes) for certificate in certificates)
            or not isinstance(profile_teams, list)
            or team.group(1) not in profile_teams
            or not isinstance(profile_entitlements, dict)
            or profile_entitlements.get("application-identifier")
            != application_entitlement
        ):
            raise MobileNativeBuildError("IPA provisioning profile does not match signing")
        certificate_prefix = destination / "codesign-leaf"
        _run_required(
            runner,
            [
                tools.get("codesign", "codesign"),
                "-d",
                "--extract-certificates",
                str(certificate_prefix),
                str(application),
            ],
            cwd=destination,
            environment=environment,
        )
        leaf_certificate = Path(f"{certificate_prefix}0")
        if not leaf_certificate.is_file() or leaf_certificate.is_symlink():
            raise MobileNativeBuildError("codesign did not expose the leaf signer certificate")
        leaf_bytes = leaf_certificate.read_bytes()
        if leaf_bytes not in certificates:
            raise MobileNativeBuildError(
                "actual leaf signer certificate is absent from provisioning profile"
            )
        certificate_digest = sha256_digest(leaf_bytes)

    return ArtifactInspection(
        platform="ios",
        kind="ipa",
        application_id=application_id,
        sha256=_sha256_file(artifact),
        size_bytes=artifact.stat().st_size,
        signing={
            "policyId": SIGNING_POLICY,
            "certificateSha256": certificate_digest,
            "applicationIdentifier": application_id,
            "debuggable": True,
            "teamIdentifier": team.group(1),
            "applicationIdentifierEntitlement": application_entitlement,
            "cdHash": {
                "source": "codesign",
                "algorithm": "sha256",
                "valueHex": value_hex,
                "candidateFullValueHex": candidate_hex,
            },
        },
    )


def inspect_application_artifact(
    platform: str,
    artifact: Path,
    runner: CommandRunner | None = None,
    *,
    expected_application_id: str = APPLICATION_ID,
    environment: Mapping[str, str] | None = None,
    executables: Mapping[str, str] | None = None,
) -> ArtifactInspection:
    command_runner = runner or SubprocessCommandRunner()
    if platform == "android":
        return inspect_android_apk(
            artifact,
            command_runner,
            expected_application_id=expected_application_id,
            environment=environment,
            executables=executables,
        )
    if platform == "ios":
        return inspect_ios_ipa(
            artifact,
            command_runner,
            expected_application_id=expected_application_id,
            environment=environment,
            executables=executables,
        )
    raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}")


def _build_isolation(platform: str) -> dict[str, Any]:
    return {
        "environmentPolicy": ENVIRONMENT_POLICY,
        "dependencyPolicy": DEPENDENCY_POLICY,
        "resolverArguments": resolver_arguments(platform),
        "inapplicableResolvers": list(INAPPLICABLE_RESOLVERS[platform]),
        "cacheMissPolicy": "BLOCK",
        "ambientEnvironmentInherited": False,
    }


def _require_dependency_manager_locks(root: Path, platform: str) -> None:
    if platform == "ios":
        project = _relative_file(
            root,
            "apps/mobile/src-tauri/gen/apple/peers-touch-mobile.xcodeproj/project.pbxproj",
        ).read_text(encoding="utf-8")
        has_swift_packages = any(
            marker in project
            for marker in (
                "XCRemoteSwiftPackageReference",
                "XCLocalSwiftPackageReference",
                "packageReferences",
            )
        )
        resolved = root / (
            "apps/mobile/src-tauri/gen/apple/"
            "peers-touch-mobile.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/"
            "Package.resolved"
        )
        if has_swift_packages and (not resolved.is_file() or resolved.is_symlink()):
            raise MobileNativeBuildError(
                "Xcode Swift packages require a committed Package.resolved"
            )
        podfile = root / "apps/mobile/src-tauri/gen/apple/Podfile"
        if podfile.is_file():
            active_pods = re.search(
                r"^\s*pod\s+['\"]",
                podfile.read_text(encoding="utf-8"),
                re.MULTILINE,
            )
            if active_pods and not (
                root / "apps/mobile/src-tauri/gen/apple/Podfile.lock"
            ).is_file():
                raise MobileNativeBuildError(
                    "CocoaPods dependencies require a committed Podfile.lock"
                )
    elif platform == "android":
        _relative_file(
            root,
            "apps/mobile/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
        )
        android_root = root / "apps/mobile/src-tauri/gen/android"
        _canonical_androidx_gradle_property(root)
        root_build = _relative_file(
            root,
            "apps/mobile/src-tauri/gen/android/build.gradle.kts",
        ).read_text(encoding="utf-8")
        build_src_build = _relative_file(
            root,
            "apps/mobile/src-tauri/gen/android/buildSrc/build.gradle.kts",
        ).read_text(encoding="utf-8")
        required_locking_sources = (
            (
                "Android buildscript",
                root_build,
                (
                    "configurations.classpath",
                    "resolutionStrategy.activateDependencyLocking()",
                    "allprojects {",
                    "lockAllConfigurations()",
                    'rootProject.file("gradle/dependency-locks/$projectLockName.lockfile")',
                ),
            ),
            (
                "Android buildSrc",
                build_src_build,
                (
                    "dependencyLocking {",
                    "lockAllConfigurations()",
                ),
            ),
        )
        for owner, source, required_fragments in required_locking_sources:
            if any(fragment not in source for fragment in required_fragments):
                raise MobileNativeBuildError(
                    f"{owner} dependency locking is not producer-enforced"
                )
        actual_lockfiles = {
            _repository_relative(root, path)
            for path in android_root.rglob("*.lockfile")
            if ".gradle" not in path.parts
        }
        expected_lockfiles = set(ANDROID_GRADLE_LOCK_REQUIREMENTS)
        if actual_lockfiles != expected_lockfiles:
            raise MobileNativeBuildError(
                "Android Gradle dependency lock set is incomplete or unexpected: "
                f"expected {sorted(expected_lockfiles)}, found {sorted(actual_lockfiles)}"
            )
        for relative, required_modules in ANDROID_GRADLE_LOCK_REQUIREMENTS.items():
            lockfile = _relative_file(root, relative)
            lines = lockfile.read_text(encoding="utf-8").splitlines()
            locked_modules = {
                line.split("=", 1)[0]
                for line in lines
                if line and not line.startswith("#") and "=" in line
            }
            if "empty" not in locked_modules or not set(required_modules).issubset(
                locked_modules
            ):
                raise MobileNativeBuildError(
                    f"Android Gradle dependency lock state is incomplete: {relative}"
                )
    else:
        raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}")


def _resolved_executable(name: str, search_path: str) -> str:
    resolved = shutil.which(name, path=search_path)
    if resolved is None:
        raise MobileNativeBuildError(f"required build executable is unavailable: {name}")
    path = Path(resolved).resolve(strict=True)
    if not path.is_file():
        raise MobileNativeBuildError(f"resolved executable is not a file: {name}")
    return str(path)


def _canonical_androidx_gradle_property(root: Path) -> str:
    gradle_properties = _relative_file(
        root,
        "apps/mobile/src-tauri/gen/android/gradle.properties",
    ).read_text(encoding="utf-8")
    assignments = [
        line.strip()
        for line in gradle_properties.splitlines()
        if line.strip().startswith("android.useAndroidX")
    ]
    if assignments != [ANDROIDX_GRADLE_PROPERTY]:
        raise MobileNativeBuildError(
            "AndroidX configuration is not producer-enforced: "
            f"expected {ANDROIDX_GRADLE_PROPERTY}"
        )
    return ANDROIDX_GRADLE_PROPERTY


def _sdk_identity(root: Path, name: str, path: str) -> dict[str, Any]:
    sdk_root = Path(path).resolve(strict=True)
    candidates = (
        ("release", "source.properties")
        if name == "JAVA_HOME"
        else ("SDKSettings.plist", "version.plist", "source.properties")
    )
    metadata = []
    for candidate_name in candidates:
        for candidate in sorted(sdk_root.glob(f"**/{candidate_name}")):
            if candidate.is_file() and not candidate.is_symlink():
                metadata.append(
                    {
                        "path": _repository_relative(sdk_root, candidate),
                        "sha256": _sha256_file(candidate),
                    }
                )
    if not metadata:
        raise MobileNativeBuildError(f"resolved SDK has no identity metadata: {name}")
    return {
        "sdk": name,
        "path": str(sdk_root),
        "metadataDigest": canonical_value_digest(metadata),
    }


def resolve_toolchain_identity(
    root: Path,
    platform: str,
    runner: CommandRunner | None = None,
) -> ToolchainIdentity:
    command_runner = runner or SubprocessCommandRunner()
    search_path = os.environ.get("PATH", os.defpath)
    names = ["node", "pnpm", "protoc", "rustup", "sh"]
    names.extend(
        ["xcodebuild", "swiftc", "xcode-select", "xcrun", "codesign", "security"]
        if platform == "ios"
        else ["java", "adb", "apkanalyzer", "apksigner"]
    )
    executable_paths = {name: _resolved_executable(name, search_path) for name in names}
    for rust_tool in ("rustc", "cargo"):
        resolved = command_runner.run(
            [executable_paths["rustup"], "which", rust_tool],
            cwd=root,
            env={"PATH": search_path},
        )
        if resolved.returncode != 0:
            raise MobileNativeBuildError(f"Rust toolchain discovery failed: {rust_tool}")
        executable_paths[rust_tool] = str(Path(resolved.stdout.strip()).resolve(strict=True))
    tauri = root / "apps/mobile/node_modules/.bin/tauri"
    if not tauri.exists():
        raise MobileNativeBuildError("required Tauri CLI executable is unavailable")
    executable_paths["tauri"] = str(tauri.resolve(strict=True))
    if platform == "android":
        gradlew = _relative_file(root, "apps/mobile/src-tauri/gen/android/gradlew")
        executable_paths["gradle"] = str(gradlew.resolve())
    probe_environment = {
        "PATH": os.pathsep.join(
            sorted({str(Path(path).parent) for path in executable_paths.values()})
        )
    }
    pnpm_store = command_runner.run(
        [executable_paths["pnpm"], "store", "path"],
        cwd=root,
        env={"PATH": search_path},
    )
    cargo_home = Path.home() / ".cargo"
    if (
        pnpm_store.returncode != 0
        or not Path(pnpm_store.stdout.strip()).is_dir()
        or not cargo_home.is_dir()
    ):
        raise MobileNativeBuildError("preseeded offline dependency caches are unavailable")
    cache_paths = {
        "cargo": str(cargo_home.resolve()),
        "pnpm": str(Path(pnpm_store.stdout.strip()).resolve()),
    }
    if platform == "android":
        gradle_home = Path.home() / ".gradle"
        if not gradle_home.is_dir() or gradle_home.is_symlink():
            raise MobileNativeBuildError("preseeded Gradle cache is unavailable")
        _validated_gradle_distribution(
            gradle_home,
            _gradle_distribution_url(
                _relative_file(
                    root,
                    "apps/mobile/src-tauri/gen/android/gradle/wrapper/"
                    "gradle-wrapper.properties",
                )
            ),
        )
        cache_paths["gradle"] = str(gradle_home.resolve())
    sdk_paths: dict[str, str]
    if platform == "ios":
        developer = command_runner.run(
            [executable_paths["xcode-select"], "-p"],
            cwd=root,
            env=probe_environment,
        )
        sdk = command_runner.run(
            [executable_paths["xcrun"], "--sdk", "iphoneos", "--show-sdk-path"],
            cwd=root,
            env=probe_environment,
        )
        if developer.returncode != 0 or sdk.returncode != 0:
            raise MobileNativeBuildError("Apple SDK discovery failed")
        sdk_paths = {
            "DEVELOPER_DIR": developer.stdout.strip(),
            "SDKROOT": sdk.stdout.strip(),
        }
    else:
        java_home = command_runner.run(
            ["/usr/libexec/java_home"],
            cwd=root,
            env=probe_environment,
        )
        if java_home.returncode != 0:
            raise MobileNativeBuildError("Java SDK discovery failed")
        adb = Path(executable_paths["adb"])
        android_home = adb.parent.parent
        sdk_paths = {
            "JAVA_HOME": java_home.stdout.strip(),
            "ANDROID_HOME": str(android_home),
            "ANDROID_SDK_ROOT": str(android_home),
        }
    for name, value in sdk_paths.items():
        if not value or not Path(value).is_dir():
            raise MobileNativeBuildError(f"resolved SDK path is invalid: {name}")
    observations: list[dict[str, Any]] = []
    observations.extend(
        {
            "executable": name,
            "path": path,
            "sha256": _sha256_file(Path(path)),
        }
        for name, path in sorted(executable_paths.items())
    )
    probes = list(COMMON_TOOLCHAIN_PROBES)
    probes.extend(
        [("xcodebuild", "-version"), ("swiftc", "--version")]
        if platform == "ios"
        else [("java", "-version"), ("adb", "version")]
    )
    for probe in probes:
        executable = executable_paths[probe[0]]
        command = [executable, *probe[1:]]
        result = command_runner.run(command, cwd=root, env=probe_environment)
        if result.returncode != 0:
            raise MobileNativeBuildError(f"toolchain identity command failed: {probe[0]}")
        observations.append(
            {
                "command": list(probe),
                "executableSha256": _sha256_file(Path(executable)),
                "stderr": result.stderr.strip(),
                "stdout": result.stdout.strip(),
            }
        )
    unique_sdks: set[Path] = set()
    for name, path in sorted(sdk_paths.items()):
        resolved_sdk = Path(path).resolve()
        if resolved_sdk in unique_sdks:
            continue
        unique_sdks.add(resolved_sdk)
        observations.append(_sdk_identity(root, name, path))
    if platform == "android":
        distribution = _validated_gradle_distribution(
            Path(cache_paths["gradle"]),
            _gradle_distribution_url(
                _relative_file(
                    root,
                    "apps/mobile/src-tauri/gen/android/gradle/wrapper/"
                    "gradle-wrapper.properties",
                )
            ),
        )
        observations.append(
            {
                "gradleDistribution": distribution.name,
                "sha256": _sha256_file(distribution),
            }
        )
    toolchain = ToolchainIdentity(
        digest=canonical_value_digest(observations),
        cache_paths=cache_paths,
        environment_paths=sdk_paths,
        executable_paths=executable_paths,
        observations=tuple(observations),
    )
    _assert_attested_protoc(toolchain)
    return toolchain


def _copy_cache_tree_without_symlinks(
    source: Path,
    destination: Path,
    *,
    excluded_directory_names: frozenset[str] = frozenset(),
    excluded_file_names: frozenset[str] = frozenset(),
) -> None:
    if not source.is_dir() or source.is_symlink():
        raise MobileNativeBuildError(f"dependency cache subtree is unsafe: {source}")
    destination.mkdir(parents=True, exist_ok=False)
    for current, directories, files in os.walk(source, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(source)
        target_root = destination / relative
        retained_directories: list[str] = []
        for name in sorted(directories):
            candidate = current_path / name
            if name in excluded_directory_names:
                continue
            if candidate.is_symlink():
                raise MobileNativeBuildError(
                    f"dependency cache subtree contains a symlink: {candidate}"
                )
            (target_root / name).mkdir()
            retained_directories.append(name)
        directories[:] = retained_directories
        for name in sorted(files):
            if name in excluded_file_names:
                continue
            candidate = current_path / name
            if candidate.is_symlink():
                raise MobileNativeBuildError(
                    f"dependency cache subtree contains a symlink: {candidate}"
                )
            if not candidate.is_file():
                raise MobileNativeBuildError(
                    f"dependency cache subtree contains an unsafe file: {candidate}"
                )
            shutil.copyfile(candidate, target_root / name)


def _assert_cache_subtree_components(source: Path, relative: str) -> Path:
    if not source.is_dir() or source.is_symlink():
        raise MobileNativeBuildError("dependency cache is missing or unsafe: cargo")
    current = source
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise MobileNativeBuildError(
                f"dependency cache subtree has a symlink component: {current}"
            )
        if not current.exists():
            return current
        if not current.is_dir():
            raise MobileNativeBuildError(
                f"dependency cache subtree component is not a directory: {current}"
            )
    return current


def _preseed_cargo_cache(source: Path, destination: Path) -> None:
    if not source.is_dir() or source.is_symlink():
        raise MobileNativeBuildError("dependency cache is missing or unsafe: cargo")
    destination.mkdir(parents=True, exist_ok=False)
    copied_subtrees: list[str] = []
    for relative in CARGO_CACHE_SUBTREES:
        subtree = _assert_cache_subtree_components(source, relative)
        if not subtree.exists():
            continue
        _copy_cache_tree_without_symlinks(
            subtree,
            destination.joinpath(*PurePosixPath(relative).parts),
            excluded_directory_names=(
                GRADLE_SETTINGS_SOURCE_EXCLUDED_PARTS
                if relative == "registry/src"
                else frozenset()
            ),
        )
        copied_subtrees.append(relative)
    copied_root_files: list[str] = []
    for name in CARGO_CACHE_ROOT_FILES:
        artifact = source / name
        if not artifact.exists():
            continue
        if artifact.is_symlink() or not artifact.is_file():
            raise MobileNativeBuildError(
                f"Cargo global cache artifact is unsafe: {artifact}"
            )
        shutil.copyfile(artifact, destination / name)
        copied_root_files.append(name)
    required_registry = {"registry/index", "registry/cache", "registry/src"}
    if not required_registry.issubset(copied_subtrees):
        raise MobileNativeBuildError(
            "preseeded Cargo registry cache is incomplete for offline build"
        )
    forbidden = [
        name
        for name in CARGO_HOME_CONTROL_FILES
        if (destination / name).exists()
    ]
    allowed_root_entries = {"registry", "git", *copied_root_files}
    if forbidden or set(path.name for path in destination.iterdir()) - allowed_root_entries:
        raise MobileNativeBuildError(
            "run-scoped Cargo cache contains non-cache control or credential files"
        )


def _run_scoped_cargo_project(
    cargo_home: Path,
    *,
    crate_name: str,
    crate_version: str,
    relative_project: str,
) -> Path:
    source_root = _assert_cache_subtree_components(cargo_home, "registry/src")
    candidates = sorted(
        index_root / f"{crate_name}-{crate_version}" / relative_project
        for index_root in source_root.iterdir()
        if index_root.is_dir() and not index_root.is_symlink()
    )
    candidates = [candidate for candidate in candidates if candidate.is_dir()]
    if len(candidates) != 1:
        raise MobileNativeBuildError(
            "run-scoped Cargo source project is missing or ambiguous: "
            f"{crate_name} {crate_version} {relative_project}"
        )
    project = candidates[0]
    _assert_cache_subtree_components(
        cargo_home,
        project.relative_to(cargo_home).as_posix(),
    )
    return project


def _generate_run_scoped_gradle_settings(
    *,
    root: Path,
    run_root: Path,
    cargo_home: Path,
) -> Path:
    android_root = root / "apps/mobile/src-tauri/gen/android"
    projects: list[tuple[str, Path, str]] = []
    for project_id, crate_name, crate_version, relative_project in (
        ANDROID_CARGO_GRADLE_PROJECTS
    ):
        project = _run_scoped_cargo_project(
            cargo_home,
            crate_name=crate_name,
            crate_version=crate_version,
            relative_project=relative_project,
        )
        projects.append((project_id, project, _canonical_directory_digest(project)))
    for project_id, relative in ANDROID_LOCAL_GRADLE_PROJECTS:
        project = root / relative
        projects.append((project_id, project, _canonical_directory_digest(project)))
    app_source = android_root / "app"
    app_source_digest = _canonical_directory_digest(
        app_source,
        excluded_file_names=GRADLE_GENERATED_SOURCE_FILES,
    )
    build_src = android_root / "buildSrc"
    build_src_digest = _canonical_directory_digest(build_src)

    source_digest = canonical_value_digest(
        [
            {
                "projectId": project_id,
                "sourceDigest": digest,
            }
            for project_id, _, digest in projects
        ]
        + [
            {"projectId": "app", "sourceDigest": app_source_digest},
            {"projectId": "buildSrc", "sourceDigest": build_src_digest},
        ]
    )
    settings_root = run_root / "gradle-project"
    settings_root.mkdir(parents=True, exist_ok=False)
    _copy_cache_tree_without_symlinks(
        build_src,
        settings_root / "buildSrc",
        excluded_directory_names=GRADLE_SETTINGS_SOURCE_EXCLUDED_PARTS,
    )
    run_scoped_app = settings_root / "app"
    _copy_cache_tree_without_symlinks(
        app_source,
        run_scoped_app,
        excluded_directory_names=GRADLE_SETTINGS_SOURCE_EXCLUDED_PARTS,
        excluded_file_names=GRADLE_GENERATED_SOURCE_FILES,
    )
    generated_dependencies = "\n".join(
        f"  implementation(project({json.dumps(project_id)}))"
        for project_id, _, _ in projects
    )
    (run_scoped_app / "tauri.build.gradle.kts").write_text(
        "// Generated by the source-bound Mobile build producer.\n"
        "val implementation by configurations\n"
        "dependencies {\n"
        f"{generated_dependencies}\n"
        "}\n",
        encoding="utf-8",
    )
    settings = settings_root / "settings.gradle"
    gradle_properties = settings_root / "gradle.properties"
    gradle_properties.write_text(
        _canonical_androidx_gradle_property(root) + "\n",
        encoding="utf-8",
    )
    lines = [
        "// Generated by the source-bound Mobile build producer.",
        f"// referencedSourceDigest={source_digest}",
        f"rootProject.projectDir = new File({json.dumps(str(android_root.resolve(strict=True)))})",
        "include ':app'",
        (
            "project(':app').projectDir = new File("
            f"{json.dumps(str(run_scoped_app.resolve(strict=True)))})"
        ),
    ]
    for project_id, project, _ in projects:
        lines.extend(
            (
                f"include {json.dumps(project_id)}",
                (
                    f"project({json.dumps(project_id)}).projectDir = new File("
                    f"{json.dumps(str(project.resolve(strict=True)))})"
                ),
            )
        )
    settings.write_text("\n".join(lines) + "\n", encoding="utf-8")
    content = settings.read_text(encoding="utf-8")
    ambient_cargo = str((Path.home() / ".cargo").resolve())
    if ambient_cargo in content or str(Path.home()) + "/.cargo" in content:
        raise MobileNativeBuildError(
            "run-scoped Gradle settings retain an ambient Cargo source path"
        )
    return settings


def _assert_run_scoped_gradle_properties(settings: Path) -> None:
    properties = settings.parent / "gradle.properties"
    if (
        properties.is_symlink()
        or not properties.is_file()
        or properties.read_text(encoding="utf-8")
        != ANDROIDX_GRADLE_PROPERTY + "\n"
    ):
        raise MobileNativeBuildError(
            "run-scoped Gradle settings do not carry canonical AndroidX configuration"
        )


def _preseed_dependency_caches(
    run_root: Path,
    cache_paths: Mapping[str, str],
) -> dict[str, Path]:
    destinations = {
        "cargo": run_root / "cargo-home",
        "pnpm": run_root / "pnpm-store",
    }
    if "gradle" in cache_paths:
        destinations["gradle"] = run_root / "gradle-home"
    if set(cache_paths) != set(destinations):
        raise MobileNativeBuildError("dependency cache set is incomplete")
    for name, destination in destinations.items():
        source = Path(cache_paths[name])
        if not source.is_dir() or source.is_symlink():
            raise MobileNativeBuildError(f"dependency cache is missing or unsafe: {name}")
        if name == "cargo":
            _preseed_cargo_cache(source, destination)
        elif name == "gradle":
            destination.mkdir(parents=True, exist_ok=False)
            caches = source / "caches"
            if not caches.is_dir() or caches.is_symlink():
                raise MobileNativeBuildError(
                    "preseeded Gradle dependency cache is missing or unsafe"
                )
            shutil.copytree(caches, destination / "caches", symlinks=False)
        else:
            shutil.copytree(source, destination, symlinks=False)
    return destinations


def _producer_commands(
    root: Path,
    platform: str,
    toolchain: ToolchainIdentity,
    run_root: Path,
    cache_roots: Mapping[str, Path],
    gradle_wrapper: GradleWrapperControl | None,
    gradle_settings: Path | None = None,
    *,
    variant: str = ACCEPTANCE_VARIANT,
) -> dict[str, list[str]]:
    if variant not in {ACCEPTANCE_VARIANT, RELEASE_VARIANT}:
        raise MobileNativeBuildError(f"unsupported Mobile build variant: {variant}")
    is_acceptance = variant == ACCEPTANCE_VARIANT
    pnpm = toolchain.executable_paths["pnpm"]
    cargo = toolchain.executable_paths["cargo"]
    commands = {
        "pnpm": [
            pnpm,
            "install",
            "--offline",
            "--frozen-lockfile",
            "--store-dir",
            str(cache_roots["pnpm"]),
        ],
        "web": [
            pnpm,
            "--dir",
            str(root / "apps/mobile"),
            "run",
            "build",
        ],
    }
    if platform == "ios":
        cargo_features = ["tauri/rustls-tls"]
        if is_acceptance:
            cargo_features.insert(0, ACCEPTANCE_CARGO_FEATURE)
        commands["cargo"] = [
            cargo,
            "build",
            "--package",
            "peers-touch-mobile",
            "--manifest-path",
            str(root / "apps/mobile/src-tauri/Cargo.toml"),
            "--target",
            "aarch64-apple-ios",
            "--features",
            ",".join(cargo_features),
            "--lib",
            "--no-default-features",
            "--frozen",
        ]
        if not is_acceptance:
            commands["cargo"].append("--release")
    else:
        commands["cargo"] = [
            cargo,
            "fetch",
            "--manifest-path",
            str(root / "apps/mobile/src-tauri/Cargo.toml"),
            "--frozen",
        ]
    if platform == "android":
        gradle_cache = cache_roots.get("gradle")
        if (
            gradle_wrapper is None
            or gradle_cache is None
            or gradle_cache.resolve(strict=True) != gradle_wrapper.gradle_user_home
            or gradle_settings is None
            or not gradle_settings.is_file()
            or gradle_settings.is_symlink()
        ):
            raise MobileNativeBuildError(
                "Android build has no controlled Gradle wrapper/settings"
            )
        commands["gradle"] = [
            str(gradle_wrapper.path),
            "--offline",
            "--no-daemon",
            "--settings-file",
            str(gradle_settings.resolve(strict=True)),
            "--project-dir",
            str(root / "apps/mobile/src-tauri/gen/android"),
            (
                ":app:assembleArm64Debug"
                if is_acceptance
                else ":app:assembleArm64Release"
            ),
        ]
    else:
        commands["xcode"] = [
            toolchain.executable_paths["xcodebuild"],
            "-project",
            str(
                root
                / "apps/mobile/src-tauri/gen/apple/peers-touch-mobile.xcodeproj"
            ),
            "-scheme",
            "peers-touch-mobile_iOS",
            "-configuration",
            "debug" if is_acceptance else "release",
            "-sdk",
            "iphoneos",
            "-archivePath",
            str(run_root / "mobile.xcarchive"),
            "-disableAutomaticPackageResolution",
            "archive",
        ]
    return commands


def _remove_stale_web_dist(root: Path) -> None:
    dist = root / "apps/mobile/dist"
    if dist.is_symlink():
        raise MobileNativeBuildError("Mobile Web dist directory is a symlink")
    if dist.exists():
        if not dist.is_dir():
            raise MobileNativeBuildError("Mobile Web dist path is not a directory")
        shutil.rmtree(dist)


def _fresh_web_build_provenance(
    root: Path,
    *,
    identity: Mapping[str, Any],
    harness_enabled: bool,
) -> dict[str, Any]:
    dist = root / "apps/mobile/dist"
    if not dist.is_dir() or dist.is_symlink():
        raise MobileNativeBuildError("fresh Mobile Web build produced no dist directory")
    entries: list[dict[str, Any]] = []
    canonical_identity = canonical_json_bytes(dict(identity))
    identity_asset: bytes | None = None
    harness_locations: dict[bytes, list[str]] = {
        marker: [] for marker in WEB_ACCEPTANCE_HARNESS_MARKERS
    }
    for path in sorted(dist.rglob("*")):
        if path.is_symlink():
            raise MobileNativeBuildError("fresh Mobile Web build contains a symlink")
        if path.is_file():
            content = path.read_bytes()
            relative = path.relative_to(dist).as_posix()
            if relative == WEB_BUILD_IDENTITY_ASSET:
                identity_asset = content
            for marker in WEB_ACCEPTANCE_HARNESS_MARKERS:
                if marker in content:
                    harness_locations[marker].append(relative)
            entries.append(
                {
                    "path": relative,
                    "sha256": sha256_digest(content),
                    "sizeBytes": len(content),
                }
            )
    if not entries:
        raise MobileNativeBuildError("fresh Mobile Web build produced no files")
    if identity_asset is None:
        raise MobileNativeBuildError(
            f"fresh Mobile Web build is missing {WEB_BUILD_IDENTITY_ASSET}"
        )
    if identity_asset != canonical_identity:
        raise MobileNativeBuildError(
            "fresh Mobile Web identity asset is not the exact canonical build identity"
        )
    marker_paths = {
        marker: tuple(paths)
        for marker, paths in harness_locations.items()
        if paths
    }
    if not harness_enabled and marker_paths:
        raise MobileNativeBuildError(
            "release Mobile Web build contains Acceptance Harness markers"
        )
    if harness_enabled and (
        len(marker_paths) != len(WEB_ACCEPTANCE_HARNESS_MARKERS)
        or len({paths for paths in marker_paths.values()}) != 1
        or len(next(iter(marker_paths.values()), ())) != 1
    ):
        raise MobileNativeBuildError(
            "fresh Mobile Web build is missing the exact Acceptance Harness "
            "marker/action set"
        )
    harness_path = (
        None
        if not marker_paths
        else next(iter(marker_paths.values()))[0]
    )
    return {
        "outputDigest": canonical_value_digest(entries),
        "fileCount": len(entries),
        "identityAssetPath": WEB_BUILD_IDENTITY_ASSET,
        "identityAssetSha256": sha256_digest(identity_asset),
        "identityAssetSizeBytes": len(identity_asset),
        "harnessEnabled": harness_enabled,
        "harnessMarkers": (
            {}
            if harness_path is None
            else {
                marker.decode("ascii", errors="strict"): harness_path
                for marker in sorted(WEB_ACCEPTANCE_HARNESS_MARKERS)
            }
        ),
    }


def _option_value(command: Sequence[str], option: str) -> str:
    positions = [index for index, value in enumerate(command) if value == option]
    if len(positions) != 1 or positions[0] + 1 >= len(command):
        raise MobileNativeBuildError(f"build command has invalid {option} binding")
    return command[positions[0] + 1]


def _validate_variant_command_contract(
    *,
    root: Path,
    platform: str,
    variant: str,
    commands: Mapping[str, Sequence[str]],
    environment: Mapping[str, str],
    cargo_wrapper: CargoWrapperControl,
) -> None:
    if platform not in RESOLVER_ARGUMENTS:
        raise MobileNativeBuildError(f"unsupported Mobile platform: {platform}")
    if variant not in {ACCEPTANCE_VARIANT, RELEASE_VARIANT}:
        raise MobileNativeBuildError(f"unsupported Mobile build variant: {variant}")
    platform_tool = "gradle" if platform == "android" else "xcode"
    expected_commands = {"pnpm", "web", "cargo", platform_tool}
    if set(commands) != expected_commands:
        raise MobileNativeBuildError(
            f"{variant} command set is incomplete: {sorted(commands)}"
        )
    expected_harness = variant == ACCEPTANCE_VARIANT
    expected_features = (
        (ACCEPTANCE_CARGO_FEATURE,) if expected_harness else ()
    )
    _assert_cargo_wrapper_control(cargo_wrapper)
    if cargo_wrapper.injected_features != expected_features:
        raise MobileNativeBuildError(
            f"{variant} nested Cargo feature policy is invalid"
        )
    path_entries = environment.get("PATH", "").split(os.pathsep)
    if not path_entries[0] or Path(path_entries[0]).resolve() != (
        cargo_wrapper.path.parent.resolve()
    ):
        raise MobileNativeBuildError(
            f"{variant} nested Cargo wrapper is not first on PATH"
        )
    expected_target_dir = cargo_wrapper.path.parent.parent / "cargo-target"
    if Path(environment.get("CARGO_TARGET_DIR", "")).resolve() != (
        expected_target_dir.resolve()
    ):
        raise MobileNativeBuildError(
            f"{variant} Cargo target directory is not variant-isolated"
        )
    web = list(commands["web"])
    if web[1:] != [
        "--dir",
        str(root / "apps/mobile"),
        "run",
        "build",
    ]:
        raise MobileNativeBuildError(f"{variant} Mobile Web build command is invalid")
    cargo = list(commands["cargo"])
    manifest = str(root / "apps/mobile/src-tauri/Cargo.toml")
    if _option_value(cargo, "--manifest-path") != manifest:
        raise MobileNativeBuildError(f"{variant} Cargo manifest binding is invalid")
    if platform == "ios":
        if _option_value(cargo, "--target") != "aarch64-apple-ios":
            raise MobileNativeBuildError(f"{variant} iOS Cargo target is invalid")
        cargo_features = set(_option_value(cargo, "--features").split(","))
        expected_cargo_features = {"tauri/rustls-tls"}
        if expected_harness:
            expected_cargo_features.add(ACCEPTANCE_CARGO_FEATURE)
        if cargo_features != expected_cargo_features:
            raise MobileNativeBuildError(
                f"{variant} iOS Cargo feature set is invalid"
            )
        if ("--release" in cargo) != (variant == RELEASE_VARIANT):
            raise MobileNativeBuildError(f"{variant} iOS Cargo profile is invalid")
        xcode = list(commands["xcode"])
        if (
            _option_value(xcode, "-configuration")
            != ("debug" if expected_harness else "release")
            or _option_value(xcode, "-sdk") != "iphoneos"
            or Path(_option_value(xcode, "-archivePath")).resolve()
            != (cargo_wrapper.path.parent.parent / "mobile.xcarchive").resolve()
        ):
            raise MobileNativeBuildError(
                f"{variant} Xcode target/configuration binding is invalid"
            )
    else:
        expected_task = (
            ":app:assembleArm64Debug"
            if expected_harness
            else ":app:assembleArm64Release"
        )
        gradle = list(commands["gradle"])
        settings_file = Path(_option_value(gradle, "--settings-file"))
        if (
            len(cargo) < 2
            or cargo[1] != "fetch"
            or not settings_file.is_file()
            or settings_file.is_symlink()
            or any(argument.startswith("-Pandroid.useAndroidX") for argument in gradle)
            or str((Path.home() / ".cargo").resolve())
            in settings_file.read_text(encoding="utf-8")
            or gradle.count(expected_task) != 1
            or any(
                argument.startswith(":app:assemble") and argument != expected_task
                for argument in gradle
            )
        ):
            raise MobileNativeBuildError(
                f"{variant} Android target/configuration binding is invalid"
            )
        _assert_run_scoped_gradle_properties(settings_file)


def _execute_build_variant(
    *,
    root: Path,
    platform: str,
    variant: str,
    commands: Mapping[str, Sequence[str]],
    environment: Mapping[str, str],
    identity: Mapping[str, Any],
    cargo_wrapper: CargoWrapperControl,
    runner: CommandRunner,
) -> tuple[tuple[dict[str, Any], ...], dict[str, Any]]:
    platform_tool = "gradle" if platform == "android" else "xcode"
    _validate_variant_command_contract(
        root=root,
        platform=platform,
        variant=variant,
        commands=commands,
        environment=environment,
        cargo_wrapper=cargo_wrapper,
    )
    require_tool_native_offline_controls(
        platform,
        {
            "pnpm": commands["pnpm"],
            "cargo": commands["cargo"],
            platform_tool: commands[platform_tool],
        },
    )
    identity_json = canonical_json_bytes(dict(identity)).decode("ascii")
    if variant == ACCEPTANCE_VARIANT:
        parse_build_identity(identity_json)
    else:
        _parse_release_build_identity(identity_json)
    if environment.get("PT_MOBILE_BUILD_IDENTITY_JSON") != identity_json:
        raise MobileNativeBuildError(
            f"{variant} build environment is not bound to the exact identity"
        )
    expected_harness = variant == ACCEPTANCE_VARIANT
    if (environment.get("VITE_ACCEPTANCE_HARNESS") == "1") != expected_harness:
        raise MobileNativeBuildError(
            f"{variant} build has the wrong Acceptance harness environment"
        )
    if set(environment) - CONSTRUCTED_BUILD_ENVIRONMENT:
        raise MobileNativeBuildError(f"{variant} build environment contains ambient names")

    provenance: list[dict[str, Any]] = []
    web_result: dict[str, Any] | None = None
    for phase in ("pnpm", "web", "cargo", platform_tool):
        if phase == "web":
            _remove_stale_web_dist(root)
        command = list(commands[phase])
        result = runner.run(command, cwd=root, env=environment)
        if result.returncode != 0:
            raise MobileNativeBuildError(
                f"{variant} {phase} build failed; network fallback is forbidden"
            )
        command_record = {
            "variant": variant,
            "phase": phase,
            "commandDigest": canonical_value_digest(command),
            "environmentDigest": allowlisted_environment_digest(environment),
            "embeddedIdentitySha256": embedded_identity_digest(identity),
        }
        if phase == "cargo":
            command_record["acceptanceFeatureEnabled"] = (
                cargo_wrapper.injected_features == (ACCEPTANCE_CARGO_FEATURE,)
                or ACCEPTANCE_CARGO_FEATURE in command
                or ACCEPTANCE_CARGO_FEATURE in ",".join(command)
            )
        if phase == "gradle":
            settings_file = Path(_option_value(command, "--settings-file"))
            command_record["settingsFileSha256"] = _sha256_file(settings_file)
            source_digest_lines = [
                line.removeprefix("// referencedSourceDigest=")
                for line in settings_file.read_text(encoding="utf-8").splitlines()
                if line.startswith("// referencedSourceDigest=")
            ]
            if len(source_digest_lines) != 1:
                raise MobileNativeBuildError(
                    "run-scoped Gradle settings have no unique source digest"
                )
            command_record["settingsSourceDigest"] = source_digest_lines[0]
        if phase == "web":
            web_result = {
                **command_record,
                **_fresh_web_build_provenance(
                    root,
                    identity=identity,
                    harness_enabled=expected_harness,
                ),
            }
            command_record = web_result
        provenance.append(command_record)
    if web_result is None:
        raise MobileNativeBuildError(f"{variant} build did not execute a Web build")
    return tuple(provenance), web_result


def _package_ios_archive(run_root: Path) -> None:
    applications = sorted(
        (run_root / "mobile.xcarchive/Products/Applications").glob("*.app")
    )
    if len(applications) != 1 or applications[0].is_symlink():
        raise MobileNativeBuildError("controlled Xcode archive has no unique application")
    output = run_root / "output"
    payload = output / "Payload"
    payload.mkdir(parents=True, exist_ok=False)
    shutil.copytree(applications[0], payload / applications[0].name, symlinks=False)
    archive = output / "mobile.ipa"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(payload.rglob("*")):
            if path.is_symlink():
                raise MobileNativeBuildError("controlled Xcode archive contains a symlink")
            if path.is_file():
                bundle.write(path, path.relative_to(output).as_posix())


def _android_apk_output_root(root: Path) -> Path:
    return root / "apps/mobile/src-tauri/gen/android/app/build/outputs/apk"


def _remove_stale_android_apk_outputs(root: Path) -> None:
    output_root = _android_apk_output_root(root)
    if output_root.is_symlink():
        raise MobileNativeBuildError("Android APK output directory is a symlink")
    if output_root.exists():
        if not output_root.is_dir():
            raise MobileNativeBuildError("Android APK output path is not a directory")
        shutil.rmtree(output_root)


def _remove_stale_ios_external_outputs(root: Path) -> None:
    external_root = root / "apps/mobile/src-tauri/gen/apple/Externals"
    if external_root.is_symlink():
        raise MobileNativeBuildError("iOS Externals output directory is a symlink")
    if external_root.exists():
        if not external_root.is_dir():
            raise MobileNativeBuildError("iOS Externals output path is not a directory")
        shutil.rmtree(external_root)


def _single_controlled_output(
    root: Path,
    run_root: Path,
    platform: str,
    *,
    variant: str = ACCEPTANCE_VARIANT,
) -> Path:
    if platform == "android":
        build_type = "debug" if variant == ACCEPTANCE_VARIANT else "release"
        candidates = sorted(
            _android_apk_output_root(root).glob(f"**/{build_type}/*.apk")
        )
    else:
        candidates = sorted((run_root / "output").glob("*.ipa"))
    candidates = [
        candidate
        for candidate in candidates
        if candidate.is_file() and not candidate.is_symlink()
    ]
    if len(candidates) != 1:
        raise MobileNativeBuildError(
            f"controlled {platform} build produced {len(candidates)} application artifacts"
        )
    if platform == "android":
        output = run_root / "output"
        output.mkdir(parents=True, exist_ok=False)
        artifact = output / "mobile.apk"
        shutil.copyfile(candidates[0], artifact)
        _remove_stale_android_apk_outputs(root)
        return artifact
    return candidates[0]


def orchestrate_source_bound_build(
    *,
    root: Path,
    platform: str,
    run_root: Path,
) -> SuccessfulBuildReceipt:
    repository = root.resolve(strict=True)
    resolved_run_root = run_root.resolve()
    if resolved_run_root == repository or repository in resolved_run_root.parents:
        raise MobileNativeBuildError("controlled build root must be outside the repository")
    if run_root.exists() and any(run_root.iterdir()):
        raise MobileNativeBuildError("controlled build root must start empty")
    _require_dependency_manager_locks(root, platform)
    command_runner = SubprocessCommandRunner()
    source = capture_source_identity(root)
    producer_digest = canonical_files_digest(root, PRODUCER_INPUTS)
    toolchain = resolve_toolchain_identity(root, platform, command_runner)
    _assert_attested_protoc(toolchain)
    acceptance_root = run_root / ACCEPTANCE_VARIANT
    release_root = run_root / RELEASE_VARIANT
    acceptance_cache_roots = _preseed_dependency_caches(
        acceptance_root,
        toolchain.cache_paths,
    )
    release_cache_roots = _preseed_dependency_caches(
        release_root,
        toolchain.cache_paths,
    )
    gradle_settings = (
        _generate_run_scoped_gradle_settings(
            root=root,
            run_root=acceptance_root,
            cargo_home=acceptance_cache_roots["cargo"],
        )
        if platform == "android"
        else None
    )
    release_gradle_settings = (
        _generate_run_scoped_gradle_settings(
            root=root,
            run_root=release_root,
            cargo_home=release_cache_roots["cargo"],
        )
        if platform == "android"
        else None
    )
    input_digest = _combined_build_inputs_digest(
        canonical_build_inputs_digest(root, platform),
        gradle_settings,
    )
    release_input_digest = _combined_build_inputs_digest(
        canonical_build_inputs_digest(
            root,
            platform,
            configuration=RELEASE_CONFIGURATION,
            harness_enabled=False,
        ),
        release_gradle_settings,
    )
    cargo_wrapper = _install_cargo_frozen_wrapper(
        run_root=acceptance_root,
        real_cargo=toolchain.executable_paths["cargo"],
        shell=toolchain.executable_paths["sh"],
        injected_features=(ACCEPTANCE_CARGO_FEATURE,),
    )
    release_cargo_wrapper = _install_cargo_frozen_wrapper(
        run_root=release_root,
        real_cargo=toolchain.executable_paths["cargo"],
        shell=toolchain.executable_paths["sh"],
    )
    gradle_wrapper = (
        _install_offline_gradle_wrapper(
            root=root,
            run_root=acceptance_root,
            source_gradle_home=Path(toolchain.cache_paths["gradle"]),
        )
        if platform == "android"
        else None
    )
    release_gradle_wrapper = (
        _install_offline_gradle_wrapper(
            root=root,
            run_root=release_root,
            source_gradle_home=Path(toolchain.cache_paths["gradle"]),
        )
        if platform == "android"
        else None
    )
    environment_without_identity = construct_build_environment(
        platform=platform,
        run_root=acceptance_root,
        executable_paths=toolchain.executable_paths,
        sdk_paths=toolchain.environment_paths,
    )
    environment_without_identity = _prepend_controlled_path(
        environment_without_identity,
        cargo_wrapper.path.parent,
    )
    _assert_protoc_on_sanitized_path(toolchain, environment_without_identity)
    release_environment_without_identity = construct_build_environment(
        platform=platform,
        run_root=release_root,
        executable_paths=toolchain.executable_paths,
        sdk_paths=toolchain.environment_paths,
        acceptance_harness=False,
    )
    release_environment_without_identity = _prepend_controlled_path(
        release_environment_without_identity,
        release_cargo_wrapper.path.parent,
    )
    _assert_protoc_on_sanitized_path(
        toolchain,
        release_environment_without_identity,
    )
    environment_digest = allowlisted_environment_digest(environment_without_identity)
    release_environment_digest = allowlisted_environment_digest(
        release_environment_without_identity
    )
    identity = create_build_identity(
        build_id=uuid.uuid4().hex,
        platform=platform,
        source=source,
        build_inputs_digest=input_digest,
        environment_digest=environment_digest,
    )
    release_identity = _create_release_build_identity(
        build_id=f"{identity['buildId']}-release",
        platform=platform,
        source=source,
        build_inputs_digest=release_input_digest,
        environment_digest=release_environment_digest,
    )
    environment = construct_build_environment(
        platform=platform,
        run_root=acceptance_root,
        executable_paths=toolchain.executable_paths,
        sdk_paths=toolchain.environment_paths,
        identity_json=canonical_json_bytes(identity).decode("ascii"),
    )
    environment = _prepend_controlled_path(environment, cargo_wrapper.path.parent)
    _assert_protoc_on_sanitized_path(toolchain, environment)
    commands = _producer_commands(
        root,
        platform,
        toolchain,
        acceptance_root,
        acceptance_cache_roots,
        gradle_wrapper,
        gradle_settings,
        variant=ACCEPTANCE_VARIANT,
    )
    release_environment = construct_build_environment(
        platform=platform,
        run_root=release_root,
        executable_paths=toolchain.executable_paths,
        sdk_paths=toolchain.environment_paths,
        identity_json=canonical_json_bytes(release_identity).decode("ascii"),
        acceptance_harness=False,
    )
    release_environment = _prepend_controlled_path(
        release_environment,
        release_cargo_wrapper.path.parent,
    )
    _assert_protoc_on_sanitized_path(toolchain, release_environment)
    release_commands = _producer_commands(
        root,
        platform,
        toolchain,
        release_root,
        release_cache_roots,
        release_gradle_wrapper,
        release_gradle_settings,
        variant=RELEASE_VARIANT,
    )
    if platform == "android":
        _remove_stale_android_apk_outputs(root)
    else:
        _remove_stale_ios_external_outputs(root)
    acceptance_provenance, acceptance_web = _execute_build_variant(
        root=root,
        platform=platform,
        variant=ACCEPTANCE_VARIANT,
        commands=commands,
        environment=environment,
        identity=identity,
        cargo_wrapper=cargo_wrapper,
        runner=command_runner,
    )
    if platform == "ios":
        _package_ios_archive(acceptance_root)
        _remove_stale_ios_external_outputs(root)
    artifact = _single_controlled_output(
        root,
        acceptance_root,
        platform,
        variant=ACCEPTANCE_VARIANT,
    )
    inspection = inspect_application_artifact(
        platform,
        artifact,
        command_runner,
        expected_application_id=identity["applicationId"],
        environment=environment,
        executables=toolchain.executable_paths,
    )
    acceptance_package_scan = _scan_acceptance_application_package(
        artifact,
        platform,
        canonical_json_bytes(identity),
    )
    acceptance_package_scan["webIdentityAsset"] = _scan_packaged_web_identity(
        artifact,
        platform,
        expected_identity=canonical_json_bytes(identity),
        web_provenance=acceptance_web,
        cargo_target_dir=Path(environment["CARGO_TARGET_DIR"]),
    )

    if platform == "android":
        _remove_stale_android_apk_outputs(root)
    else:
        _remove_stale_ios_external_outputs(root)
    release_provenance, release_web = _execute_build_variant(
        root=root,
        platform=platform,
        variant=RELEASE_VARIANT,
        commands=release_commands,
        environment=release_environment,
        identity=release_identity,
        cargo_wrapper=release_cargo_wrapper,
        runner=command_runner,
    )
    if platform == "ios":
        _package_ios_archive(release_root)
        _remove_stale_ios_external_outputs(root)
    release_artifact = _single_controlled_output(
        root,
        release_root,
        platform,
        variant=RELEASE_VARIANT,
    )
    negative_adapter_scan = _scan_application_package(release_artifact, platform)
    negative_adapter_scan["webIdentityAsset"] = _scan_packaged_web_identity(
        release_artifact,
        platform,
        expected_identity=canonical_json_bytes(release_identity),
        web_provenance=release_web,
        cargo_target_dir=Path(release_environment["CARGO_TARGET_DIR"]),
    )
    final_source = capture_source_identity(root)
    final_input_digest = _combined_build_inputs_digest(
        canonical_build_inputs_digest(root, platform),
        gradle_settings,
    )
    final_release_input_digest = _combined_build_inputs_digest(
        canonical_build_inputs_digest(
            root,
            platform,
            configuration=RELEASE_CONFIGURATION,
            harness_enabled=False,
        ),
        release_gradle_settings,
    )
    final_producer_digest = canonical_files_digest(root, PRODUCER_INPUTS)
    if final_source != source:
        raise MobileNativeBuildError("source/workspace identity changed during build")
    if final_input_digest != input_digest:
        raise MobileNativeBuildError("build inputs changed during build")
    if final_release_input_digest != release_input_digest:
        raise MobileNativeBuildError("release build inputs changed during build")
    if final_producer_digest != producer_digest:
        raise MobileNativeBuildError("build producer changed during build")

    receipt = SuccessfulBuildReceipt(
        _RECEIPT_AUTHORITY,
        artifact=artifact,
        artifact_inspection=inspection,
        acceptance_package_scan=acceptance_package_scan,
        build_identity=identity,
        build_isolation=_build_isolation(platform),
        cargo_wrapper_control=cargo_wrapper,
        command_digests=tuple(
            record["commandDigest"]
            for record in (*acceptance_provenance, *release_provenance)
        ),
        gradle_wrapper_control=gradle_wrapper,
        gradle_settings=gradle_settings,
        negative_adapter_scan=negative_adapter_scan,
        platform=platform,
        producer_source_digest=producer_digest,
        release_artifact=release_artifact,
        release_build_identity=release_identity,
        release_cargo_wrapper_control=release_cargo_wrapper,
        release_gradle_wrapper_control=release_gradle_wrapper,
        release_gradle_settings=release_gradle_settings,
        repository_root=repository,
        source_identity=source,
        toolchain_digest=canonical_value_digest(
            {
                "acceptanceToolchainDigest": _toolchain_digest_with_wrappers(
                    toolchain.digest,
                    cargo_wrapper,
                    gradle_wrapper,
                ),
                "releaseToolchainDigest": _toolchain_digest_with_wrappers(
                    toolchain.digest,
                    release_cargo_wrapper,
                    release_gradle_wrapper,
                ),
                "commandProvenance": [
                    *acceptance_provenance,
                    *release_provenance,
                ],
            }
        ),
        web_build_provenance=(acceptance_web, release_web),
    )
    receipt._assert_current_outputs()
    return receipt


def produce_build_attestation(
    *,
    run: RunHandle,
    receipt: SuccessfulBuildReceipt,
    created_at: str,
) -> tuple[dict[str, Any], ArtifactRef]:
    if not isinstance(receipt, SuccessfulBuildReceipt):
        raise MobileNativeBuildError("attestation requires a successful build receipt")
    receipt._assert_current_outputs()
    identity = json.loads(canonical_json_bytes(receipt._build_identity))
    inspection = receipt._artifact_inspection
    build_isolation = json.loads(canonical_json_bytes(receipt._build_isolation))
    signing = json.loads(canonical_json_bytes(inspection.signing))
    artifact = receipt._artifact
    platform = inspection.platform
    artifact_path = f"runtime/mobile/builds/{platform}.{inspection.kind}"
    artifact_reference = run.write_bytes(
        artifact_path,
        artifact.read_bytes(),
        media_type="application/octet-stream",
        role=f"mobile-application-{inspection.kind}",
    )
    if f"sha256:{artifact_reference.sha256}" != inspection.sha256:
        raise MobileNativeBuildError("persisted artifact digest differs from inspection")
    payload = {
        "artifactKind": "mobile-application-build-attestation",
        "runId": run.run_id,
        "gateId": GATE_ID,
        "producer": "mobile-native-build",
        "producerSourceDigest": receipt._producer_source_digest,
        "toolchainDigest": receipt._toolchain_digest,
        "buildIsolation": build_isolation,
        "buildIdentity": identity,
        "embeddedIdentitySha256": embedded_identity_digest(identity),
        "artifact": {
            "kind": inspection.kind,
            "sha256": inspection.sha256,
            "sizeBytes": inspection.size_bytes,
            "artifactRef": artifact_reference.to_dict(),
        },
        "signing": signing,
        "createdAt": created_at,
    }
    typed_payload = validate_contract_payload(
        payload,
        expected_kind="mobile-application-build-attestation",
        expected_run_id=run.run_id,
        expected_gate_id=GATE_ID,
        expected_workspace_id=artifact_reference.workspace_id,
    )
    receipt._assert_current_outputs()
    attestation_reference = run.write_json(
        f"runtime/mobile/builds/{platform}.json",
        typed_payload,
    )
    return typed_payload, attestation_reference


def fresh_install_inputs(
    *,
    client_id: str,
    platform: str,
    device_lease: ArtifactRef,
    build_attestation: ArtifactRef,
    application_id: str,
    artifact_sha256: str,
) -> dict[str, Any]:
    return {
        "clientId": client_id,
        "platform": platform,
        "physicalDeviceLease": device_lease.to_dict(),
        "buildAttestation": build_attestation.to_dict(),
        "applicationId": application_id,
        "artifactSha256": artifact_sha256,
        "installPolicy": "fresh-uninstall-readback-install",
    }


def runtime_identity_inputs(
    *,
    client_id: str,
    platform: str,
    build_attestation: ArtifactRef,
    fresh_install_trace: ArtifactRef,
    expected_build_id: str,
    expected_application_id: str,
    expected_embedded_identity_sha256: str,
) -> dict[str, Any]:
    return {
        "clientId": client_id,
        "platform": platform,
        "buildAttestation": build_attestation.to_dict(),
        "freshInstallTrace": fresh_install_trace.to_dict(),
        "expectedBuildId": expected_build_id,
        "expectedApplicationId": expected_application_id,
        "expectedEmbeddedIdentitySha256": expected_embedded_identity_sha256,
        "action": "build.identity",
    }


def verify_release_negative_adapter_absence(
    receipt: SuccessfulBuildReceipt,
) -> dict[str, Any]:
    if not isinstance(receipt, SuccessfulBuildReceipt):
        raise MobileNativeBuildError("release scan requires a successful build receipt")
    receipt._assert_current_outputs()
    current_scan = _scan_application_package(
        receipt._release_artifact,
        receipt._platform,
    )
    if current_scan != {
        key: value
        for key, value in receipt._negative_adapter_scan.items()
        if key != "webIdentityAsset"
    }:
        raise MobileNativeBuildError("sealed package scan no longer matches")
    return json.loads(canonical_json_bytes(receipt._negative_adapter_scan))
