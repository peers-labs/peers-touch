from __future__ import annotations

import hashlib
import json
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from unittest.mock import patch

from tooling.acceptance.core import ArtifactRef, EvidenceStore
from tooling.acceptance.provisioners.mobile_native_build import (
    ACCEPTANCE_CARGO_FEATURE,
    ACCEPTANCE_VARIANT,
    ANDROID_CARGO_GRADLE_PROJECTS,
    ANDROID_GRADLE_LOCK_REQUIREMENTS,
    ANDROIDX_GRADLE_PROPERTY,
    APPLICATION_ID,
    CARGO_CACHE_ROOT_FILES,
    CARGO_CACHE_SUBTREES,
    FORBIDDEN_RELEASE_ADAPTER_SYMBOLS,
    NATIVE_ACCEPTANCE_HARNESS_MARKER,
    WEB_BUILD_IDENTITY_ASSET,
    ArtifactInspection,
    CommandResult,
    MobileNativeBuildError,
    RELEASE_VARIANT,
    SourceIdentity,
    SuccessfulBuildReceipt,
    ToolchainIdentity,
    WEB_ACCEPTANCE_HARNESS_MARKERS,
    _assert_attested_protoc,
    _assert_cargo_wrapper_control,
    _assert_gradle_wrapper_control,
    _assert_protoc_on_sanitized_path,
    _assert_run_scoped_gradle_properties,
    _build_isolation,
    _fresh_web_build_provenance,
    _generate_run_scoped_gradle_settings,
    _install_cargo_frozen_wrapper,
    _install_offline_gradle_wrapper,
    _preseed_dependency_caches,
    _prepend_controlled_path,
    _producer_commands,
    _require_dependency_manager_locks,
    _remove_stale_ios_external_outputs,
    _remove_stale_web_dist,
    _scan_acceptance_application_package,
    _scan_application_package,
    _scan_packaged_web_identity,
    _toolchain_digest_with_cargo_wrapper,
    _validate_variant_command_contract,
    allowlisted_environment_digest,
    canonical_build_input_paths,
    canonical_files_digest,
    canonical_json_bytes,
    canonical_value_digest,
    construct_build_environment,
    create_build_identity,
    embedded_identity_digest,
    execute_source_bound_build,
    fresh_install_inputs,
    inspect_android_apk,
    inspect_ios_ipa,
    orchestrate_source_bound_build,
    parse_build_identity,
    produce_build_attestation,
    require_tool_native_offline_controls,
    resolver_arguments,
    resolver_digest,
    runtime_identity_inputs,
    verify_release_negative_adapter_absence,
)


RUN_ID = "20260829T120000000000Z-" + ("1" * 32)
WORKSPACE_ID = "a" * 16
SHA256 = "sha256:" + ("b" * 64)
REPO_ROOT = Path(__file__).resolve().parents[3]


class FakeRunner:
    def __init__(
        self,
        responses: dict[tuple[str, ...], CommandResult] | None = None,
        effect: Callable[[tuple[str, ...], Mapping[str, str]], None] | None = None,
    ) -> None:
        self.responses = responses or {}
        self.effect = effect
        self.commands: list[tuple[str, ...]] = []
        self.environments: list[dict[str, str]] = []

    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str] | None = None,
    ) -> CommandResult:
        del cwd
        command_tuple = tuple(command)
        environment = dict(env or {})
        self.commands.append(command_tuple)
        self.environments.append(environment)
        if self.effect is not None:
            self.effect(command_tuple, environment)
        if "--extract-certificates" in command:
            prefix = Path(command[command.index("--extract-certificates") + 1])
            Path(f"{prefix}0").write_bytes(b"certificate")
        key = tuple(command[:-1]) if command and Path(command[-1]).exists() else command_tuple
        return self.responses.get(key, self.responses.get(command_tuple, CommandResult(0)))


class FakeRun:
    run_id = RUN_ID

    def __init__(self) -> None:
        self.values: dict[str, bytes | dict[str, Any]] = {}

    def write_bytes(
        self,
        path: str,
        value: bytes,
        *,
        media_type: str,
        role: str,
    ) -> ArtifactRef:
        self.values[role] = value
        return artifact_ref(path, value, media_type=media_type)

    def write_json(
        self,
        path: str,
        value: dict[str, Any],
        *,
        role: str | None = None,
    ) -> ArtifactRef:
        self.values[role or path] = value
        return artifact_ref(path, canonical_json_bytes(value), media_type="application/json")


class BuildReceiptStub:
    def __init__(self, artifact: Path, platform: str) -> None:
        kind = "ipa" if platform == "ios" else "apk"
        artifact_sha256 = "sha256:" + hashlib.sha256(artifact.read_bytes()).hexdigest()
        signing = {
            "policyId": "mobile-acceptance-debug",
            "certificateSha256": SHA256,
            "applicationIdentifier": APPLICATION_ID,
            "debuggable": True,
        }
        if platform == "ios":
            signing.update(
                {
                    "teamIdentifier": "TEAM123",
                    "applicationIdentifierEntitlement": f"TEAM123.{APPLICATION_ID}",
                    "cdHash": {
                        "source": "codesign",
                        "algorithm": "sha256",
                        "valueHex": "c" * 40,
                        "candidateFullValueHex": "c" * 64,
                    },
                }
            )
        else:
            signing.update(
                {
                    "signerCertificateSha256": SHA256,
                    "enabledSigningSchemes": ["v2", "v3"],
                }
            )
        self._artifact = artifact
        self._artifact_inspection = ArtifactInspection(
            platform=platform,
            kind=kind,
            application_id=APPLICATION_ID,
            sha256=artifact_sha256,
            size_bytes=artifact.stat().st_size,
            signing=signing,
        )
        self._build_identity = identity(platform)
        self._build_isolation = _build_isolation(platform)
        self._producer_source_digest = SHA256
        self._toolchain_digest = SHA256

    def _assert_current_outputs(self) -> None:
        return


def artifact_ref(
    path: str,
    value: bytes = b"value",
    *,
    media_type: str = "application/json",
) -> ArtifactRef:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id="mobile-native-access-e2e",
        run_id=RUN_ID,
        path=path,
        sha256=hashlib.sha256(value).hexdigest(),
        media_type=media_type,
    )


def identity(platform: str = "ios") -> dict[str, Any]:
    return create_build_identity(
        build_id=f"build-{platform}",
        platform=platform,
        source=SourceIdentity("1" * 40, "dirty", "sha256:" + ("2" * 64)),
        build_inputs_digest="sha256:" + ("3" * 64),
        environment_digest="sha256:" + ("4" * 64),
    )


def tauri_codegen_representation(value: bytes) -> bytes:
    completed = subprocess.run(
        [
            "node",
            "-e",
            (
                "const z=require('node:zlib');const c=[];"
                "process.stdin.on('data',x=>c.push(x));"
                "process.stdin.on('end',()=>process.stdout.write("
                "z.brotliCompressSync(Buffer.concat(c),{params:{"
                "[z.constants.BROTLI_PARAM_QUALITY]:2}})))"
            ),
        ],
        input=value,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(
            f"failed to encode Tauri test asset: {completed.stderr!r}"
        )
    return completed.stdout


def write_tauri_codegen_asset(
    target: Path,
    profile: str,
    identity_bytes: bytes,
    *,
    representation: bytes | None = None,
) -> bytes:
    embedded_bytes = (
        tauri_codegen_representation(identity_bytes)
        if representation is None
        else representation
    )
    digest = hashlib.sha256(identity_bytes).hexdigest()
    cache = (
        target
        / profile
        / "build/mobile/out/tauri-codegen-assets"
        / f"{digest}.json"
    )
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(embedded_bytes)
    return embedded_bytes


def write_apk(
    path: Path,
    payload: bytes = b"controlled-bytecode",
    *,
    extra_entries: Mapping[str, bytes] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("AndroidManifest.xml", b"controlled-manifest")
        archive.writestr("classes.dex", payload)
        for name, value in (extra_entries or {}).items():
            archive.writestr(name, value)


def android_runner(
    *,
    schemes: tuple[str, ...] = ("v2", "v3"),
    signers: int = 1,
    effect: Callable[[tuple[str, ...], Mapping[str, str]], None] | None = None,
) -> FakeRunner:
    scheme_lines = "\n".join(
        f"Verified using v{number} scheme: {'true' if f'v{number}' in schemes else 'false'}"
        for number in range(1, 5)
    )
    signer_lines = "\n".join(
        f"Signer #{number} certificate SHA-256 digest: {'AB:' * 31}AB"
        for number in range(1, signers + 1)
    )
    return FakeRunner(
        {
            ("apkanalyzer", "manifest", "application-id"): CommandResult(
                0, f"{APPLICATION_ID}\n"
            ),
            ("apkanalyzer", "manifest", "debuggable"): CommandResult(0, "true\n"),
            ("apksigner", "verify", "--verbose", "--print-certs"): CommandResult(
                0, f"{scheme_lines}\n{signer_lines}\n"
            ),
        },
        effect=effect,
    )


def write_ipa(
    path: Path,
    payload: bytes = b"controlled-binary",
    *,
    info_values: Mapping[str, Any] | None = None,
    extra_entries: Mapping[str, bytes] | None = None,
) -> None:
    info = plistlib.dumps(
        {
            "CFBundleExecutable": "Peers",
            "CFBundleIdentifier": APPLICATION_ID,
            **dict(info_values or {}),
        }
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("Payload/Peers.app/Info.plist", info)
        archive.writestr("Payload/Peers.app/Peers", payload)
        archive.writestr("Payload/Peers.app/embedded.mobileprovision", b"profile")
        for name, value in (extra_entries or {}).items():
            archive.writestr(name, value)


def ios_runner(*, profile_certificate: bytes = b"certificate") -> FakeRunner:
    candidate = "c" * 64
    application_identifier = f"TEAM123.{APPLICATION_ID}"
    entitlements = plistlib.dumps(
        {"application-identifier": application_identifier, "get-task-allow": True}
    ).decode()
    profile = plistlib.dumps(
        {
            "DeveloperCertificates": [profile_certificate],
            "Entitlements": {"application-identifier": application_identifier},
            "TeamIdentifier": ["TEAM123"],
        }
    ).decode()
    return FakeRunner(
        {
            ("codesign", "-d", "--verbose=4"): CommandResult(
                0,
                stderr=(
                    "TeamIdentifier=TEAM123\n"
                    f"CDHash={candidate[:40]}\n"
                    f"CandidateCDHashFull sha256={candidate}\n"
                ),
            ),
            ("codesign", "-d", "--entitlements", ":-"): CommandResult(0, stdout=entitlements),
            ("security", "cms", "-D", "-i"): CommandResult(0, stdout=profile),
        }
    )


def fake_toolchain(root: Path) -> ToolchainIdentity:
    bin_root = root / "tools"
    bin_root.mkdir(parents=True)
    executables: dict[str, str] = {}
    for name in ("pnpm", "cargo", "gradle", "protoc"):
        path = bin_root / name
        path.write_text(name, encoding="utf-8")
        path.chmod(0o700)
        executables[name] = str(path)
    executables["sh"] = "/bin/sh"
    sdk = root / "android-sdk"
    java = root / "java-home"
    cargo_cache = root / "cargo-cache"
    pnpm_cache = root / "pnpm-cache"
    gradle_cache = root / "gradle-cache"
    sdk.mkdir()
    java.mkdir()
    cargo_cache.mkdir()
    pnpm_cache.mkdir()
    (gradle_cache / "caches").mkdir(parents=True)
    for relative in ("registry/index", "registry/cache", "registry/src"):
        subtree = cargo_cache.joinpath(*Path(relative).parts)
        subtree.mkdir(parents=True)
        (subtree / "cache-entry").write_text(relative, encoding="utf-8")
    for _, crate_name, crate_version, relative_project in (
        (
            ":tauri-android",
            "tauri",
            "2.10.3",
            "mobile/android",
        ),
        (
            ":tauri-plugin-deep-link",
            "tauri-plugin-deep-link",
            "2.4.9",
            "android",
        ),
        (
            ":tauri-plugin-opener",
            "tauri-plugin-opener",
            "2.5.4",
            "android",
        ),
    ):
        project = (
            cargo_cache
            / "registry/src/controlled-index"
            / f"{crate_name}-{crate_version}"
            / relative_project
        )
        project.mkdir(parents=True)
        (project / "build.gradle.kts").write_text(
            f"// {crate_name} {crate_version}\n",
            encoding="utf-8",
        )
    local_plugin = (
        root / "apps/mobile/src-tauri/plugins/secure-storage/android"
    )
    local_plugin.mkdir(parents=True)
    (local_plugin / "build.gradle.kts").write_text(
        "// local secure storage plugin\n",
        encoding="utf-8",
    )
    android_app = root / "apps/mobile/src-tauri/gen/android/app"
    android_app.mkdir(parents=True, exist_ok=True)
    (android_app / "build.gradle.kts").write_text(
        "// controlled Android application\n",
        encoding="utf-8",
    )
    (android_app.parent / "gradle.properties").write_text(
        ANDROIDX_GRADLE_PROPERTY + "\n",
        encoding="utf-8",
    )
    build_src = root / "apps/mobile/src-tauri/gen/android/buildSrc"
    build_src.mkdir()
    (build_src / "settings.gradle.kts").write_text(
        'rootProject.name = "buildSrc"\n',
        encoding="utf-8",
    )
    distribution = (
        gradle_cache
        / "wrapper/dists/gradle-8.9-bin/controlled/gradle-8.9-bin.zip"
    )
    distribution.parent.mkdir(parents=True)
    with zipfile.ZipFile(distribution, "w") as archive:
        archive.writestr("gradle-8.9/bin/gradle", b"controlled-gradle")
    wrapper = root / "apps/mobile/src-tauri/gen/android/gradle/wrapper"
    wrapper.mkdir(parents=True)
    (wrapper / "gradle-wrapper.jar").write_bytes(b"controlled-wrapper")
    (wrapper / "gradle-wrapper.properties").write_text(
        "distributionBase=GRADLE_USER_HOME\n"
        "distributionUrl=https\\://services.gradle.org/distributions/"
        "gradle-8.9-bin.zip\n"
        "distributionPath=wrapper/dists\n"
        "zipStorePath=wrapper/dists\n"
        "zipStoreBase=GRADLE_USER_HOME\n",
        encoding="utf-8",
    )
    gradlew = wrapper.parents[1] / "gradlew"
    gradlew.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    gradlew.chmod(0o700)
    protoc = Path(executables["protoc"]).resolve()
    protoc_sha256 = "sha256:" + hashlib.sha256(protoc.read_bytes()).hexdigest()
    observations = (
        {
            "executable": "protoc",
            "path": str(protoc),
            "sha256": protoc_sha256,
        },
        {
            "command": ["protoc", "--version"],
            "executableSha256": protoc_sha256,
            "stderr": "",
            "stdout": "libprotoc test",
        },
    )
    return ToolchainIdentity(
        digest=canonical_value_digest(list(observations)),
        cache_paths={
            "cargo": str(cargo_cache),
            "gradle": str(gradle_cache),
            "pnpm": str(pnpm_cache),
        },
        environment_paths={
            "ANDROID_HOME": str(sdk),
            "ANDROID_SDK_ROOT": str(sdk),
            "JAVA_HOME": str(java),
        },
        executable_paths=executables,
        observations=observations,
    )


def android_build_effect(
    root: Path,
    acceptance_payload: Callable[[], bytes],
    release_payload: Callable[[], bytes] | None = None,
    *,
    acceptance_web_payload: Callable[[str], bytes] | None = None,
    release_web_payload: Callable[[str], bytes] | None = None,
    packaged_web_identity_payload: Callable[[str], bytes] | None = None,
    omit_packaged_web_identity: bool = False,
    include_native_marker: bool = True,
    include_native_identity: bool = True,
    native_identity_payload: Callable[[str], bytes] | None = None,
) -> Callable[[tuple[str, ...], Mapping[str, str]], None]:
    release_bytes = release_payload or (lambda: b"release-package-native-content")

    def effect(command: tuple[str, ...], environment: Mapping[str, str]) -> None:
        if len(command) >= 2 and command[-2:] == ("run", "build"):
            dist = root / "apps/mobile/dist"
            dist.mkdir(parents=True, exist_ok=True)
            identity_json = environment["PT_MOBILE_BUILD_IDENTITY_JSON"]
            vite_identity_literal = json.dumps(
                identity_json,
                ensure_ascii=True,
                separators=(",", ":"),
            ).encode("ascii")
            is_acceptance = environment.get("VITE_ACCEPTANCE_HARNESS") == "1"
            payload_factory = (
                acceptance_web_payload if is_acceptance else release_web_payload
            )
            if payload_factory is not None:
                web_bytes = payload_factory(identity_json)
            else:
                web_bytes = vite_identity_literal
                if is_acceptance:
                    web_bytes += b":" + b":".join(WEB_ACCEPTANCE_HARNESS_MARKERS)
            (dist / "index.html").write_bytes(web_bytes)
            (dist / WEB_BUILD_IDENTITY_ASSET).write_bytes(
                identity_json.encode("ascii")
            )
        if ":app:assembleArm64Debug" in command:
            payload = acceptance_payload()
            if include_native_marker:
                payload += b":" + NATIVE_ACCEPTANCE_HARNESS_MARKER
            if include_native_identity:
                identity_json = environment["PT_MOBILE_BUILD_IDENTITY_JSON"]
                payload += b":" + (
                    native_identity_payload(identity_json)
                    if native_identity_payload is not None
                    else identity_json.encode("ascii")
                )
            web_identity = environment["PT_MOBILE_BUILD_IDENTITY_JSON"]
            identity_bytes = web_identity.encode("ascii")
            embedded_web_identity = write_tauri_codegen_asset(
                Path(environment["CARGO_TARGET_DIR"]),
                "debug",
                identity_bytes,
            )
            if not omit_packaged_web_identity:
                packaged_identity = (
                    packaged_web_identity_payload(web_identity)
                    if packaged_web_identity_payload is not None
                    else identity_bytes
                )
                payload += (
                    b":"
                    + WEB_BUILD_IDENTITY_ASSET.encode("ascii")
                    + b":"
                    + tauri_codegen_representation(packaged_identity)
                )
            write_apk(
                root
                / "apps/mobile/src-tauri/gen/android/app/build/outputs/apk/"
                "arm64/debug/mobile.apk",
                payload,
            )
            self_target = Path(environment["CARGO_TARGET_DIR"])
            self_target.mkdir(parents=True, exist_ok=True)
        if ":app:assembleArm64Release" in command:
            web_identity = environment["PT_MOBILE_BUILD_IDENTITY_JSON"]
            identity_bytes = web_identity.encode("ascii")
            write_tauri_codegen_asset(
                Path(environment["CARGO_TARGET_DIR"]),
                "release",
                identity_bytes,
            )
            release_package_bytes = release_bytes()
            if not omit_packaged_web_identity:
                packaged_identity = (
                    packaged_web_identity_payload(web_identity)
                    if packaged_web_identity_payload is not None
                    else identity_bytes
                )
                release_package_bytes += (
                    b":"
                    + WEB_BUILD_IDENTITY_ASSET.encode("ascii")
                    + b":"
                    + tauri_codegen_representation(packaged_identity)
                )
            write_apk(
                root
                / "apps/mobile/src-tauri/gen/android/app/build/outputs/apk/"
                "arm64/release/mobile.apk",
                release_package_bytes,
            )
            self_target = Path(environment["CARGO_TARGET_DIR"])
            self_target.mkdir(parents=True, exist_ok=True)

    return effect


def orchestrate_fake_android(
    *,
    root: Path,
    run_root: Path,
    runner: FakeRunner,
) -> SuccessfulBuildReceipt:
    with (
        patch(
            "tooling.acceptance.provisioners.mobile_native_build."
            "_require_dependency_manager_locks"
        ),
        patch(
            "tooling.acceptance.provisioners.mobile_native_build."
            "capture_source_identity",
            return_value=SourceIdentity("1" * 40, "clean", "clean"),
        ),
        patch(
            "tooling.acceptance.provisioners.mobile_native_build."
            "canonical_build_inputs_digest",
            return_value=SHA256,
        ),
        patch(
            "tooling.acceptance.provisioners.mobile_native_build."
            "canonical_files_digest",
            return_value=SHA256,
        ),
        patch(
            "tooling.acceptance.provisioners.mobile_native_build."
            "resolve_toolchain_identity",
            return_value=fake_toolchain(root),
        ),
        patch(
            "tooling.acceptance.provisioners.mobile_native_build."
            "SubprocessCommandRunner",
            return_value=runner,
        ),
    ):
        return orchestrate_source_bound_build(
            root=root,
            platform="android",
            run_root=run_root,
        )


class MobileNativeBuildTest(unittest.TestCase):
    def test_canonical_file_digest_is_order_independent_and_path_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "a").write_bytes(b"same")
            (root / "b").write_bytes(b"same")
            first = canonical_files_digest(root, ["b", "a"])
            self.assertEqual(first, canonical_files_digest(root, ["a", "b"]))
            (root / "b").write_bytes(b"different")
            self.assertNotEqual(first, canonical_files_digest(root, ["a", "b"]))

    def test_canonical_file_digest_rejects_missing_duplicate_and_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "input").write_text("value", encoding="utf-8")
            for paths in (["missing"], ["input", "input"], ["../input"]):
                with self.subTest(paths=paths), self.assertRaises(MobileNativeBuildError):
                    canonical_files_digest(root, paths)

    def test_canonical_inputs_cover_the_accepted_roots_and_local_closure(self) -> None:
        paths = set(canonical_build_input_paths(REPO_ROOT))
        expected = {
            "pnpm-workspace.yaml",
            "apps/mobile/src/main.tsx",
            "apps/mobile/src-tauri/gen/android/gradlew",
            "apps/mobile/src-tauri/gen/apple/Podfile",
            "model/domain/oauth/mobile_oauth.proto",
            "tooling/scripts/proto-gen-mobile.sh",
            "packages/client-chat-core/package.json",
            "packages/client-media-security/package.json",
            "packages/client-storage/package.json",
            "packages/locales/package.json",
            "packages/messaging-core/Cargo.toml",
        }
        self.assertTrue(expected.issubset(paths), expected - paths)
        self.assertFalse(any("/build/" in path or "/.gradle/" in path for path in paths))

    def test_canonical_inputs_reject_a_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            outside = root.parent / "outside-mobile-input"
            outside.write_text("escape", encoding="utf-8")
            (source / "escape").symlink_to(outside)
            from tooling.acceptance.provisioners.mobile_native_build import _collect_input_tree

            with self.assertRaises(MobileNativeBuildError):
                _collect_input_tree(root, "source")
            outside.unlink()

    def test_environment_is_constructed_with_exact_names_and_run_scoped_homes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tools = root / "tools"
            sdk = root / "sdk"
            java = root / "java"
            tools.mkdir()
            sdk.mkdir()
            java.mkdir()
            executable = tools / "tool"
            executable.write_text("tool", encoding="utf-8")
            environment = construct_build_environment(
                platform="android",
                run_root=root / "run",
                executable_paths={"tool": str(executable)},
                sdk_paths={
                    "ANDROID_HOME": str(sdk),
                    "ANDROID_SDK_ROOT": str(sdk),
                    "JAVA_HOME": str(java),
                },
                identity_json=canonical_json_bytes(identity("android")).decode(),
            )
        self.assertEqual(
            set(environment),
            {
                "ANDROID_HOME",
                "ANDROID_SDK_ROOT",
                "CARGO_HOME",
                "CARGO_TARGET_DIR",
                "GRADLE_USER_HOME",
                "HOME",
                "JAVA_HOME",
                "PATH",
                "PT_MOBILE_BUILD_IDENTITY_JSON",
                "RUSTUP_HOME",
                "TMPDIR",
                "VITE_ACCEPTANCE_HARNESS",
            },
        )
        self.assertRegex(allowlisted_environment_digest(environment), r"^sha256:[0-9a-f]{64}$")

    def test_protoc_must_be_resolved_attested_and_present_on_sanitized_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            toolchain = fake_toolchain(root)
            protoc = _assert_attested_protoc(toolchain)
            environment = construct_build_environment(
                platform="android",
                run_root=root / "run",
                executable_paths=toolchain.executable_paths,
                sdk_paths=toolchain.environment_paths,
            )
            _assert_protoc_on_sanitized_path(toolchain, environment)
            resolved_protoc = shutil.which("protoc", path=environment["PATH"])
            self.assertIsNotNone(resolved_protoc)
            self.assertEqual(
                Path(resolved_protoc).resolve(strict=True),
                protoc,
            )
            self.assertIn(
                protoc.parent,
                {
                    Path(entry).resolve()
                    for entry in environment["PATH"].split(os.pathsep)
                },
            )

            missing = ToolchainIdentity(
                digest=toolchain.digest,
                cache_paths=toolchain.cache_paths,
                environment_paths=toolchain.environment_paths,
                executable_paths={
                    name: path
                    for name, path in toolchain.executable_paths.items()
                    if name != "protoc"
                },
                observations=toolchain.observations,
            )
            with self.assertRaisesRegex(MobileNativeBuildError, "unattested: protoc"):
                _assert_attested_protoc(missing)

    def test_protoc_shadowing_attested_executable_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            toolchain = fake_toolchain(root)
            environment = construct_build_environment(
                platform="android",
                run_root=root / "run",
                executable_paths=toolchain.executable_paths,
                sdk_paths=toolchain.environment_paths,
            )
            shadow_directory = root / "shadow-bin"
            shadow_directory.mkdir()
            shadow_protoc = shadow_directory / "protoc"
            shadow_protoc.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            shadow_protoc.chmod(0o700)
            environment["PATH"] = os.pathsep.join(
                (str(shadow_directory), environment["PATH"])
            )

            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "does not resolve to the attested protoc executable",
            ):
                _assert_protoc_on_sanitized_path(toolchain, environment)

    def test_protoc_without_hash_version_or_digest_attestation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            toolchain = fake_toolchain(Path(temporary))
            cases = (
                (
                    "hash",
                    tuple(
                        observation
                        for observation in toolchain.observations
                        if observation.get("executable") != "protoc"
                    ),
                    "executable hash",
                ),
                (
                    "version",
                    tuple(
                        observation
                        for observation in toolchain.observations
                        if observation.get("command") != ["protoc", "--version"]
                    ),
                    "version probe",
                ),
            )
            for name, observations, expected in cases:
                with self.subTest(name=name):
                    unattested = ToolchainIdentity(
                        digest=canonical_value_digest(list(observations)),
                        cache_paths=toolchain.cache_paths,
                        environment_paths=toolchain.environment_paths,
                        executable_paths=toolchain.executable_paths,
                        observations=observations,
                    )
                    with self.assertRaisesRegex(MobileNativeBuildError, expected):
                        _assert_attested_protoc(unattested)

            digest_mismatch = ToolchainIdentity(
                digest=SHA256,
                cache_paths=toolchain.cache_paths,
                environment_paths=toolchain.environment_paths,
                executable_paths=toolchain.executable_paths,
                observations=toolchain.observations,
            )
            with self.assertRaisesRegex(MobileNativeBuildError, "toolchain digest"):
                _assert_attested_protoc(digest_mismatch)

    def test_cargo_cache_seed_copies_only_explicit_non_secret_subtrees(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cargo_home = root / "source-cargo"
            for relative in CARGO_CACHE_SUBTREES:
                subtree = cargo_home.joinpath(*Path(relative).parts)
                subtree.mkdir(parents=True)
                (subtree / "cache-entry").write_text(relative, encoding="utf-8")
            (cargo_home / "credentials.toml").write_text(
                "[registry]\ntoken = 'credentials-canary'\n",
                encoding="utf-8",
            )
            (cargo_home / "config.toml").write_text(
                "[net]\noffline = false\n",
                encoding="utf-8",
            )
            (cargo_home / "bin").mkdir()
            (cargo_home / "bin/rustup").write_text("tool-canary", encoding="utf-8")
            for name in CARGO_CACHE_ROOT_FILES:
                (cargo_home / name).write_text(f"{name}-cache", encoding="utf-8")
            pnpm_store = root / "pnpm-store"
            pnpm_store.mkdir()
            (pnpm_store / "package").write_text("cached", encoding="utf-8")

            destinations = _preseed_dependency_caches(
                root / "run",
                {
                    "cargo": str(cargo_home),
                    "pnpm": str(pnpm_store),
                },
            )

            seeded_cargo = destinations["cargo"]
            self.assertEqual(
                {path.name for path in seeded_cargo.iterdir()},
                {"git", "registry", *CARGO_CACHE_ROOT_FILES},
            )
            self.assertFalse((seeded_cargo / "credentials.toml").exists())
            self.assertFalse((seeded_cargo / "config.toml").exists())
            self.assertFalse((seeded_cargo / "bin/rustup").exists())
            self.assertNotIn(
                b"credentials-canary",
                b"".join(
                    path.read_bytes()
                    for path in seeded_cargo.rglob("*")
                    if path.is_file()
                ),
            )
            for name in CARGO_CACHE_ROOT_FILES:
                self.assertEqual(
                    (seeded_cargo / name).read_text(encoding="utf-8"),
                    f"{name}-cache",
                )

    def test_cargo_cache_seed_rejects_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cargo_home = root / "source-cargo"
            for relative in ("registry/index", "registry/cache", "registry/src"):
                cargo_home.joinpath(*Path(relative).parts).mkdir(parents=True)
            outside = root / "credential-canary"
            outside.write_text("secret", encoding="utf-8")
            (cargo_home / "registry/cache/escape").symlink_to(outside)
            pnpm_store = root / "pnpm-store"
            pnpm_store.mkdir()

            with self.assertRaisesRegex(MobileNativeBuildError, "symlink"):
                _preseed_dependency_caches(
                    root / "run",
                    {
                        "cargo": str(cargo_home),
                        "pnpm": str(pnpm_store),
                    },
                )

    def test_cargo_cache_seed_rejects_symlink_in_each_subtree_ancestor(self) -> None:
        for relative, symlink_component in (
            ("registry/index", "registry"),
            ("registry/index", "registry/index"),
            ("registry/cache", "registry/cache"),
            ("registry/src", "registry/src"),
            ("git/db", "git"),
            ("git/db", "git/db"),
            ("git/checkouts", "git/checkouts"),
        ):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                cargo_home = root / "source-cargo"
                cargo_home.mkdir()
                outside = root / "outside"
                outside.mkdir()
                component = cargo_home / symlink_component
                component.parent.mkdir(parents=True, exist_ok=True)
                component.symlink_to(
                    outside,
                    target_is_directory=True,
                )
                pnpm_store = root / "pnpm-store"
                pnpm_store.mkdir()

                with self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "symlink component",
                ):
                    _preseed_dependency_caches(
                        root / "run",
                        {
                            "cargo": str(cargo_home),
                            "pnpm": str(pnpm_store),
                        },
                    )

    def test_android_preflight_requires_androidx_and_exact_gradle_lock_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wrapper = (
                root
                / "apps/mobile/src-tauri/gen/android/gradle/wrapper/"
                "gradle-wrapper.properties"
            )
            wrapper.parent.mkdir(parents=True)
            wrapper.write_text("distributionUrl=file:///gradle.zip\n", encoding="utf-8")
            gradle_properties = (
                root / "apps/mobile/src-tauri/gen/android/gradle.properties"
            )
            gradle_properties.write_text(
                "android.useAndroidX=true\n",
                encoding="utf-8",
            )
            root_build = root / "apps/mobile/src-tauri/gen/android/build.gradle.kts"
            root_build.write_text(
                "buildscript {\n"
                "  configurations.classpath {\n"
                "    resolutionStrategy.activateDependencyLocking()\n"
                "  }\n"
                "}\n"
                "allprojects {\n"
                "  dependencyLocking {\n"
                "    lockAllConfigurations()\n"
                '    lockFile = rootProject.file("gradle/dependency-locks/'
                '$projectLockName.lockfile")\n'
                "  }\n"
                "}\n",
                encoding="utf-8",
            )
            build_src = (
                root / "apps/mobile/src-tauri/gen/android/buildSrc/build.gradle.kts"
            )
            build_src.parent.mkdir(parents=True)
            build_src.write_text(
                "dependencyLocking {\n  lockAllConfigurations()\n}\n",
                encoding="utf-8",
            )
            for relative, required_modules in ANDROID_GRADLE_LOCK_REQUIREMENTS.items():
                lockfile = root / relative
                lockfile.parent.mkdir(parents=True, exist_ok=True)
                lockfile.write_text(
                    "\n".join(
                        [f"{module}=controlled" for module in required_modules]
                        + ["empty="]
                    )
                    + "\n",
                    encoding="utf-8",
                )

            _require_dependency_manager_locks(root, "android")

            gradle_properties.unlink()
            with self.assertRaisesRegex(MobileNativeBuildError, "gradle.properties"):
                _require_dependency_manager_locks(root, "android")

            gradle_properties.write_text(
                "android.useAndroidX=false\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(MobileNativeBuildError, "AndroidX"):
                _require_dependency_manager_locks(root, "android")

            gradle_properties.write_text(
                "android.useAndroidX=true\n",
                encoding="utf-8",
            )
            missing = root / next(iter(ANDROID_GRADLE_LOCK_REQUIREMENTS))
            missing.unlink()
            with self.assertRaisesRegex(MobileNativeBuildError, "lock set"):
                _require_dependency_manager_locks(root, "android")

            missing.write_text("empty=\n", encoding="utf-8")
            with self.assertRaisesRegex(MobileNativeBuildError, "lock state"):
                _require_dependency_manager_locks(root, "android")

            missing.write_text(
                "\n".join(
                    [f"{module}=controlled" for module in next(
                        requirements
                        for path, requirements in ANDROID_GRADLE_LOCK_REQUIREMENTS.items()
                        if path == next(iter(ANDROID_GRADLE_LOCK_REQUIREMENTS))
                    )]
                    + ["empty="]
                )
                + "\n",
                encoding="utf-8",
            )
            build_src.write_text("plugins { `kotlin-dsl` }\n", encoding="utf-8")
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "buildSrc dependency locking",
            ):
                _require_dependency_manager_locks(root, "android")

    def test_android_build_enables_locking_for_buildscript_and_all_projects(self) -> None:
        build_script = (
            REPO_ROOT / "apps/mobile/src-tauri/gen/android/build.gradle.kts"
        ).read_text(encoding="utf-8")
        self.assertIn("resolutionStrategy.activateDependencyLocking()", build_script)
        self.assertIn("allprojects {", build_script)
        self.assertIn("lockAllConfigurations()", build_script)
        self.assertIn(
            'rootProject.file("gradle/dependency-locks/$projectLockName.lockfile")',
            build_script,
        )
        build_src_script = (
            REPO_ROOT / "apps/mobile/src-tauri/gen/android/buildSrc/build.gradle.kts"
        ).read_text(encoding="utf-8")
        self.assertIn("dependencyLocking {", build_src_script)
        self.assertIn("lockAllConfigurations()", build_src_script)
        self.assertIn(
            "apps/mobile/src-tauri/gen/android/buildSrc/gradle.lockfile",
            ANDROID_GRADLE_LOCK_REQUIREMENTS,
        )

    def test_run_scoped_gradle_settings_bind_only_copied_cargo_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            toolchain = fake_toolchain(root)
            run_root = Path(temporary) / "run"
            copied = _preseed_dependency_caches(
                run_root,
                toolchain.cache_paths,
            )
            settings = _generate_run_scoped_gradle_settings(
                root=root,
                run_root=run_root,
                cargo_home=copied["cargo"],
            )
            content = settings.read_text(encoding="utf-8")
            self.assertNotIn(str(Path.home() / ".cargo"), content)
            self.assertIn(str(copied["cargo"] / "registry/src"), content)
            self.assertIn("// referencedSourceDigest=sha256:", content)
            run_scoped_app = settings.parent / "app"
            self.assertIn(str(run_scoped_app), content)
            self.assertTrue(
                (run_scoped_app / "tauri.build.gradle.kts").is_file()
            )
            self.assertNotIn(
                str(root / "apps/mobile/src-tauri/gen/android/app"),
                content,
            )
            self.assertEqual(
                (settings.parent / "gradle.properties").read_text(encoding="utf-8"),
                ANDROIDX_GRADLE_PROPERTY + "\n",
            )
            _assert_run_scoped_gradle_properties(settings)

            cargo = _install_cargo_frozen_wrapper(
                run_root=run_root,
                real_cargo=toolchain.executable_paths["cargo"],
                shell="/bin/sh",
                injected_features=(ACCEPTANCE_CARGO_FEATURE,),
            )
            gradle = _install_offline_gradle_wrapper(
                root=root,
                run_root=run_root,
                source_gradle_home=Path(toolchain.cache_paths["gradle"]),
            )
            commands = _producer_commands(
                root,
                "android",
                toolchain,
                run_root,
                copied,
                gradle,
                settings,
            )
            self.assertEqual(
                Path(
                    commands["gradle"][
                        commands["gradle"].index("--settings-file") + 1
                    ]
                ).resolve(),
                settings.resolve(),
            )
            self.assertFalse(
                any(
                    argument.startswith("-Pandroid.useAndroidX")
                    for argument in commands["gradle"]
                )
            )

            properties = settings.parent / "gradle.properties"
            properties.write_text("android.useAndroidX=false\n", encoding="utf-8")
            with self.assertRaisesRegex(MobileNativeBuildError, "AndroidX"):
                _validate_variant_command_contract(
                    root=root,
                    platform="android",
                    variant=ACCEPTANCE_VARIANT,
                    commands=commands,
                    environment=_prepend_controlled_path(
                        construct_build_environment(
                            platform="android",
                            run_root=run_root,
                            executable_paths=toolchain.executable_paths,
                            sdk_paths=toolchain.environment_paths,
                            identity_json=canonical_json_bytes(
                                identity("android")
                            ).decode(),
                        ),
                        cargo.path.parent,
                    ),
                    cargo_wrapper=cargo,
                )

    def test_real_offline_gradle_dependencies_uses_run_scoped_androidx_property(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            run_root = Path(temporary)
            cargo_home = run_root / "cargo-home"
            for _, crate_name, crate_version, relative_project in (
                ANDROID_CARGO_GRADLE_PROJECTS
            ):
                matches = list(
                    (Path.home() / ".cargo/registry/src").glob(
                        f"*/{crate_name}-{crate_version}/{relative_project}"
                    )
                )
                self.assertEqual(
                    len(matches),
                    1,
                    f"missing unique offline Cargo source for {crate_name} {crate_version}",
                )
                destination = (
                    cargo_home
                    / "registry/src/controlled-index"
                    / f"{crate_name}-{crate_version}"
                    / relative_project
                )
                shutil.copytree(matches[0], destination)

            settings = _generate_run_scoped_gradle_settings(
                root=REPO_ROOT,
                run_root=run_root,
                cargo_home=cargo_home,
            )
            command = [
                str(REPO_ROOT / "apps/mobile/src-tauri/gen/android/gradlew"),
                "--offline",
                "--no-daemon",
                "--settings-file",
                str(settings),
                "--project-dir",
                str(REPO_ROOT / "apps/mobile/src-tauri/gen/android"),
                ":app:dependencies",
            ]
            self.assertFalse(
                any(argument.startswith("-Pandroid.useAndroidX") for argument in command)
            )
            environment = dict(os.environ)
            environment["GRADLE_USER_HOME"] = str(Path.home() / ".gradle")
            result = subprocess.run(
                command,
                cwd=REPO_ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            self.assertEqual(
                result.returncode,
                0,
                f"{result.stdout}\n{result.stderr}",
            )

    def test_nested_android_and_ios_cargo_use_immutable_frozen_wrapper(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real_cargo = root / "real-bin/cargo"
            real_cargo.parent.mkdir()
            real_cargo.write_text(
                '#!/bin/sh\nprintf "%s\\n" "$@" > '
                f'"{root / "cargo-arguments"}"\n',
                encoding="utf-8",
            )
            real_cargo.chmod(0o700)

            for platform in ("android", "ios"):
                with self.subTest(platform=platform):
                    run_root = root / platform
                    control = _install_cargo_frozen_wrapper(
                        run_root=run_root,
                        real_cargo=str(real_cargo),
                        shell="/bin/sh",
                        injected_features=(ACCEPTANCE_CARGO_FEATURE,),
                    )
                    sdk = run_root / "sdk"
                    sdk.mkdir()
                    sdk_paths = (
                        {"DEVELOPER_DIR": str(sdk), "SDKROOT": str(sdk)}
                        if platform == "ios"
                        else {
                            "ANDROID_HOME": str(sdk),
                            "ANDROID_SDK_ROOT": str(sdk),
                            "JAVA_HOME": str(sdk),
                        }
                    )
                    environment = construct_build_environment(
                        platform=platform,
                        run_root=run_root,
                        executable_paths={"cargo": str(real_cargo)},
                        sdk_paths=sdk_paths,
                    )
                    environment = _prepend_controlled_path(
                        environment,
                        control.path.parent,
                    )
                    completed = subprocess.run(
                        ["cargo", "build", "--manifest-path", "nested/Cargo.toml"],
                        env=environment,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    self.assertEqual(
                        (root / "cargo-arguments").read_text(encoding="utf-8").splitlines(),
                        [
                            "--frozen",
                            "build",
                            "--features",
                            ACCEPTANCE_CARGO_FEATURE,
                            "--manifest-path",
                            "nested/Cargo.toml",
                        ],
                    )
                    self.assertEqual(
                        environment["PATH"].split(":")[0],
                        str(control.path.parent.resolve()),
                    )
                    self.assertNotEqual(
                        _toolchain_digest_with_cargo_wrapper(SHA256, control),
                        SHA256,
                    )
                    _assert_cargo_wrapper_control(control)

                    release_root = root / f"{platform}-release"
                    release_control = _install_cargo_frozen_wrapper(
                        run_root=release_root,
                        real_cargo=str(real_cargo),
                        shell="/bin/sh",
                    )
                    release_environment = construct_build_environment(
                        platform=platform,
                        run_root=release_root,
                        executable_paths={"cargo": str(real_cargo)},
                        sdk_paths=sdk_paths,
                        acceptance_harness=False,
                    )
                    release_environment = _prepend_controlled_path(
                        release_environment,
                        release_control.path.parent,
                    )
                    completed = subprocess.run(
                        ["cargo", "build", "--manifest-path", "nested/Cargo.toml"],
                        env=release_environment,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    self.assertEqual(
                        (root / "cargo-arguments").read_text(encoding="utf-8").splitlines(),
                        ["--frozen", "build", "--manifest-path", "nested/Cargo.toml"],
                    )
                    self.assertEqual(release_control.injected_features, ())

    def test_identity_validation_rejects_noncanonical_and_semantic_drift(self) -> None:
        value = identity()
        raw = canonical_json_bytes(value).decode("ascii")
        self.assertEqual(parse_build_identity(raw), value)
        self.assertEqual(
            embedded_identity_digest(value),
            "sha256:" + hashlib.sha256(raw.encode()).hexdigest(),
        )
        invalid_values = (
            {**value, "buildId": "build id"},
            {**value, "configuration": "release"},
            {**value, "applicationId": "com.example.other"},
            {**value, "workspaceDigest": "dirty"},
        )
        for invalid in invalid_values:
            with self.subTest(invalid=invalid), self.assertRaises(MobileNativeBuildError):
                parse_build_identity(canonical_json_bytes(invalid).decode())
        with self.assertRaises(MobileNativeBuildError):
            parse_build_identity(json.dumps(value, indent=2))

    def test_resolver_contract_has_no_network_fallback(self) -> None:
        android = {
            "pnpm": ["pnpm", "install", "--offline", "--frozen-lockfile"],
            "cargo": ["cargo", "build", "--frozen"],
            "gradle": ["gradlew", "assembleDebug", "--offline"],
        }
        require_tool_native_offline_controls("android", android)
        self.assertEqual(set(resolver_arguments("ios")), {"pnpm", "cargo", "xcode"})
        self.assertRegex(resolver_digest("android"), r"^sha256:[0-9a-f]{64}$")
        android["pnpm"] = ["pnpm", "install", "--frozen-lockfile"]
        with self.assertRaises(MobileNativeBuildError):
            require_tool_native_offline_controls("android", android)

    def test_source_bound_build_rejects_ambient_or_mismatched_identity(self) -> None:
        commands = {
            "pnpm": ["pnpm", "install", "--offline", "--frozen-lockfile"],
            "cargo": ["cargo", "build", "--frozen"],
            "gradle": ["gradlew", "assembleDebug", "--offline"],
        }
        identity_value = identity("android")
        environment = {
            "PATH": "/controlled/bin",
            "PT_MOBILE_BUILD_IDENTITY_JSON": canonical_json_bytes(identity_value).decode(),
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = execute_source_bound_build(
                root=root,
                platform="android",
                commands=commands,
                environment=environment,
                identity=identity_value,
                runner=FakeRunner(),
            )
            self.assertEqual(len(result["commandDigests"]), 3)
            with self.assertRaises(MobileNativeBuildError):
                execute_source_bound_build(
                    root=root,
                    platform="android",
                    commands=commands,
                    environment={**environment, "TOKEN": "ambient"},
                    identity=identity_value,
                    runner=FakeRunner(),
                )
            with self.assertRaises(MobileNativeBuildError):
                execute_source_bound_build(
                    root=root,
                    platform="android",
                    commands=commands,
                    environment={
                        **environment,
                        "PT_MOBILE_BUILD_IDENTITY_JSON": canonical_json_bytes(
                            {**identity_value, "buildId": "other"}
                        ).decode(),
                    },
                    identity=identity_value,
                    runner=FakeRunner(),
                )

    def test_apk_inspection_requires_exact_schemes_and_one_signer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / "mobile.apk"
            write_apk(apk)
            inspection = inspect_android_apk(apk, android_runner())
            self.assertEqual(inspection.signing["enabledSigningSchemes"], ["v2", "v3"])
            for runner in (
                android_runner(schemes=("v1", "v2", "v3")),
                android_runner(schemes=("v2",)),
                android_runner(signers=2),
            ):
                with self.subTest(commands=runner.responses), self.assertRaises(
                    MobileNativeBuildError
                ):
                    inspect_android_apk(apk, runner)

    def test_ipa_inspection_verifies_deep_strict_and_actual_leaf(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            ipa = Path(temporary) / "mobile.ipa"
            write_ipa(ipa)
            runner = ios_runner()
            inspection = inspect_ios_ipa(ipa, runner)
            self.assertTrue(
                any(command[:4] == ("codesign", "--verify", "--deep", "--strict") for command in runner.commands)
            )
            self.assertEqual(
                inspection.signing["applicationIdentifierEntitlement"],
                f"TEAM123.{APPLICATION_ID}",
            )
            with self.assertRaises(MobileNativeBuildError):
                inspect_ios_ipa(ipa, ios_runner(profile_certificate=b"other"))

    def test_attestation_and_release_scan_require_same_opaque_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            run_root = Path(temporary) / "run"
            toolchain = fake_toolchain(root)
            package_payload = [b"oauth_acceptance_negative_callback"]
            runner = android_runner(
                effect=android_build_effect(root, lambda: package_payload[0])
            )
            with (
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "_require_dependency_manager_locks"
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "capture_source_identity",
                    return_value=SourceIdentity("1" * 40, "clean", "clean"),
                ) as source_identity_mock,
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "canonical_build_inputs_digest",
                    return_value=SHA256,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "canonical_files_digest",
                    return_value=SHA256,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "resolve_toolchain_identity",
                    return_value=toolchain,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "SubprocessCommandRunner",
                    return_value=runner,
                ),
            ):
                receipt = orchestrate_source_bound_build(
                    root=root,
                    platform="android",
                    run_root=run_root,
                )
                run = FakeRun()
                payload, reference = produce_build_attestation(
                    run=run,  # type: ignore[arg-type]
                    receipt=receipt,
                    created_at="2026-08-29T12:00:00Z",
                )
                absence = verify_release_negative_adapter_absence(receipt)
                self.assertEqual(reference.path, "runtime/mobile/builds/android.json")
                self.assertRegex(payload["toolchainDigest"], r"^sha256:[0-9a-f]{64}$")
                self.assertEqual(payload["toolchainDigest"], receipt._toolchain_digest)
                self.assertEqual(absence["platform"], "android")
                self.assertEqual(
                    absence["packageSha256"],
                    receipt._release_artifact_sha256,
                )
                self.assertNotEqual(
                    receipt._release_artifact_sha256,
                    receipt._artifact_inspection.sha256,
                )
                self.assertEqual(
                    receipt._acceptance_package_scan["requiredMarkers"],
                    {
                        NATIVE_ACCEPTANCE_HARNESS_MARKER.decode("ascii"):
                        "classes.dex"
                    },
                )
                self.assertEqual(
                    receipt._acceptance_package_scan["embeddedIdentitySha256"],
                    embedded_identity_digest(receipt._build_identity),
                )
                self.assertEqual(
                    receipt._acceptance_package_scan["embeddedIdentityEntry"],
                    "classes.dex",
                )
                self.assertIn(
                    "classes.dex",
                    {entry["path"] for entry in absence["checkedEntries"]},
                )
                self.assertEqual(
                    receipt._artifact.parent,
                    run_root / ACCEPTANCE_VARIANT / "output",
                )
                self.assertEqual(
                    receipt._release_artifact.parent,
                    run_root / RELEASE_VARIANT / "output",
                )
                self.assertEqual(
                    receipt._cargo_wrapper_control.injected_features,
                    (ACCEPTANCE_CARGO_FEATURE,),
                )
                self.assertEqual(
                    receipt._release_cargo_wrapper_control.injected_features,
                    (),
                )
                self.assertEqual(
                    {item["variant"] for item in receipt._web_build_provenance},
                    {ACCEPTANCE_VARIANT, RELEASE_VARIANT},
                )
                self.assertEqual(
                    {
                        item["variant"]: item["embeddedIdentitySha256"]
                        for item in receipt._web_build_provenance
                    },
                    {
                        ACCEPTANCE_VARIANT: embedded_identity_digest(
                            receipt._build_identity
                        ),
                        RELEASE_VARIANT: embedded_identity_digest(
                            receipt._release_build_identity
                        ),
                    },
                )
                acceptance_web = next(
                    item
                    for item in receipt._web_build_provenance
                    if item["variant"] == ACCEPTANCE_VARIANT
                )
                release_web = next(
                    item
                    for item in receipt._web_build_provenance
                    if item["variant"] == RELEASE_VARIANT
                )
                self.assertEqual(
                    set(acceptance_web["harnessMarkers"]),
                    {
                        marker.decode("ascii")
                        for marker in WEB_ACCEPTANCE_HARNESS_MARKERS
                    },
                )
                self.assertEqual(release_web["harnessMarkers"], {})
                web_commands = [
                    (command, command_environment)
                    for command, command_environment in zip(
                        runner.commands,
                        runner.environments,
                    )
                    if len(command) >= 2 and command[-2:] == ("run", "build")
                ]
                self.assertEqual(len(web_commands), 2)
                self.assertEqual(
                    [
                        command_environment.get("VITE_ACCEPTANCE_HARNESS")
                        for _, command_environment in web_commands
                    ],
                    ["1", None],
                )
                web_identities = [
                    json.loads(
                        command_environment["PT_MOBILE_BUILD_IDENTITY_JSON"]
                    )
                    for _, command_environment in web_commands
                ]
                self.assertEqual(
                    [
                        (
                            value["configuration"],
                            value["harnessEnabled"],
                            value["platform"],
                        )
                        for value in web_identities
                    ],
                    [
                        ("acceptance-debug", True, "android"),
                        ("release", False, "android"),
                    ],
                )
                self.assertEqual(
                    web_identities[0],
                    receipt._build_identity,
                )
                self.assertEqual(
                    web_identities[1],
                    receipt._release_build_identity,
                )
                debug_index = next(
                    index
                    for index, command in enumerate(runner.commands)
                    if ":app:assembleArm64Debug" in command
                )
                release_index = next(
                    index
                    for index, command in enumerate(runner.commands)
                    if ":app:assembleArm64Release" in command
                )
                self.assertLess(
                    next(
                        index
                        for index, (command, _) in enumerate(
                            zip(runner.commands, runner.environments)
                        )
                        if command[-2:] == ("run", "build")
                    ),
                    debug_index,
                )
                self.assertLess(debug_index, release_index)
                self.assertFalse(
                    (
                        root
                        / "apps/mobile/src-tauri/gen/android/app/build/outputs/apk"
                    ).exists()
                )
                self.assertFalse((root / "apps/mobile/src-tauri/target").exists())
                with self.assertRaises(AttributeError):
                    receipt._toolchain_digest = "sha256:" + ("0" * 64)
                with self.assertRaises(MobileNativeBuildError):
                    produce_build_attestation(  # type: ignore[arg-type]
                        run=run,
                        receipt=object(),
                        created_at="2026-08-29T12:00:00Z",
                    )

                signing_policy = receipt._artifact_inspection.signing["policyId"]
                receipt._artifact_inspection.signing["policyId"] = "tampered"
                with self.assertRaisesRegex(MobileNativeBuildError, "receipt seal"):
                    produce_build_attestation(
                        run=run,  # type: ignore[arg-type]
                        receipt=receipt,
                        created_at="2026-08-29T12:00:00Z",
                    )
                receipt._artifact_inspection.signing["policyId"] = signing_policy

                isolation_policy = receipt._build_isolation["environmentPolicy"]
                receipt._build_isolation["environmentPolicy"] = "tampered"
                with self.assertRaisesRegex(MobileNativeBuildError, "receipt seal"):
                    produce_build_attestation(
                        run=run,  # type: ignore[arg-type]
                        receipt=receipt,
                        created_at="2026-08-29T12:00:00Z",
                    )
                receipt._build_isolation["environmentPolicy"] = isolation_policy

                build_id = receipt._build_identity["buildId"]
                receipt._build_identity["buildId"] = "tampered"
                with self.assertRaisesRegex(MobileNativeBuildError, "receipt seal"):
                    produce_build_attestation(
                        run=run,  # type: ignore[arg-type]
                        receipt=receipt,
                        created_at="2026-08-29T12:00:00Z",
                    )
                receipt._build_identity["buildId"] = build_id

                source_identity_mock.return_value = SourceIdentity(
                    "1" * 40,
                    "dirty",
                    "sha256:" + ("9" * 64),
                )
                with self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "source/workspace identity changed after receipt",
                ):
                    produce_build_attestation(
                        run=run,  # type: ignore[arg-type]
                        receipt=receipt,
                        created_at="2026-08-29T12:00:00Z",
                    )
                source_identity_mock.return_value = SourceIdentity(
                    "1" * 40,
                    "clean",
                    "clean",
                )

                artifact_bytes = receipt._artifact.read_bytes()
                write_apk(receipt._artifact, b"changed-package")
                with self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "build artifact changed",
                ):
                    produce_build_attestation(
                        run=run,  # type: ignore[arg-type]
                        receipt=receipt,
                        created_at="2026-08-29T12:00:00Z",
                    )
                receipt._artifact.write_bytes(artifact_bytes)
                receipt._cargo_wrapper_control.path.write_text(
                    "#!/bin/sh\nexit 0\n",
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "Cargo wrapper changed",
                ):
                    produce_build_attestation(
                        run=run,  # type: ignore[arg-type]
                        receipt=receipt,
                        created_at="2026-08-29T12:00:00Z",
                    )

    def test_real_run_registers_both_platform_attestations_by_canonical_path(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            ios_artifact = temporary_root / "mobile.ipa"
            android_artifact = temporary_root / "mobile.apk"
            ios_artifact.write_bytes(b"ios-application")
            android_artifact.write_bytes(b"android-application")

            store = EvidenceStore(
                temporary_root / "evidence",
                worktree=REPO_ROOT,
            )
            run = store.begin_run(
                "mobile-native-access-e2e",
                source={"commit": "1" * 40, "workspaceDigest": "clean"},
                run_id=RUN_ID,
            )
            self.addCleanup(run.close)

            with patch(
                "tooling.acceptance.provisioners.mobile_native_build."
                "SuccessfulBuildReceipt",
                BuildReceiptStub,
            ):
                _, ios_reference = produce_build_attestation(
                    run=run,
                    receipt=BuildReceiptStub(ios_artifact, "ios"),  # type: ignore[arg-type]
                    created_at="2026-08-29T12:00:00Z",
                )
                _, android_reference = produce_build_attestation(
                    run=run,
                    receipt=BuildReceiptStub(android_artifact, "android"),  # type: ignore[arg-type]
                    created_at="2026-08-29T12:00:01Z",
                )

            self.assertEqual(
                ios_reference.path,
                "runtime/mobile/builds/ios.json",
            )
            self.assertEqual(
                android_reference.path,
                "runtime/mobile/builds/android.json",
            )
            self.assertNotEqual(ios_reference.path, android_reference.path)
            self.assertNotEqual(ios_reference.sha256, android_reference.sha256)

            manifest = run.finalize(result={"status": "PASS"})
            self.assertEqual(
                ArtifactRef.from_dict(
                    manifest["artifacts"]["runtime/mobile/builds/ios.json"]
                ),
                ios_reference,
            )
            self.assertEqual(
                ArtifactRef.from_dict(
                    manifest["artifacts"]["runtime/mobile/builds/android.json"]
                ),
                android_reference,
            )
            self.assertEqual(
                store.read_json(ios_reference)["buildIdentity"]["platform"],
                "ios",
            )
            self.assertEqual(
                store.read_json(android_reference)["buildIdentity"]["platform"],
                "android",
            )

    def test_gradle_wrapper_uses_validated_run_local_distribution(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            toolchain = fake_toolchain(root)
            run_root = Path(temporary) / "run"
            (run_root / "gradle-home").mkdir(parents=True)
            control = _install_offline_gradle_wrapper(
                root=root,
                run_root=run_root,
                source_gradle_home=Path(toolchain.cache_paths["gradle"]),
            )
            properties = control.properties_path.read_text(encoding="utf-8")
            self.assertIn(
                f"distributionUrl={control.distribution_path.as_uri()}",
                properties,
            )
            self.assertIn(
                f"distributionSha256Sum={control.distribution_sha256[7:]}",
                properties,
            )
            self.assertNotIn("https://", properties.replace(r"\:", ":"))
            _assert_gradle_wrapper_control(control)
            control.distribution_path.write_bytes(b"tampered")
            with self.assertRaisesRegex(MobileNativeBuildError, "Gradle wrapper changed"):
                _assert_gradle_wrapper_control(control)

    def test_android_command_contract_rejects_cross_variant_target_or_feature(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            toolchain = fake_toolchain(root)
            run_root = Path(temporary) / ACCEPTANCE_VARIANT
            (run_root / "gradle-home").mkdir(parents=True)
            cargo = _install_cargo_frozen_wrapper(
                run_root=run_root,
                real_cargo=toolchain.executable_paths["cargo"],
                shell="/bin/sh",
                injected_features=(ACCEPTANCE_CARGO_FEATURE,),
            )
            gradle = _install_offline_gradle_wrapper(
                root=root,
                run_root=run_root,
                source_gradle_home=Path(toolchain.cache_paths["gradle"]),
            )
            environment = construct_build_environment(
                platform="android",
                run_root=run_root,
                executable_paths=toolchain.executable_paths,
                sdk_paths=toolchain.environment_paths,
                identity_json=canonical_json_bytes(identity("android")).decode(),
            )
            environment = _prepend_controlled_path(environment, cargo.path.parent)
            commands = _producer_commands(
                root,
                "android",
                toolchain,
                run_root,
                {"pnpm": root / "pnpm-cache", "gradle": run_root / "gradle-home"},
                gradle,
                _generate_run_scoped_gradle_settings(
                    root=root,
                    run_root=run_root,
                    cargo_home=Path(toolchain.cache_paths["cargo"]),
                ),
            )
            _validate_variant_command_contract(
                root=root,
                platform="android",
                variant=ACCEPTANCE_VARIANT,
                commands=commands,
                environment=environment,
                cargo_wrapper=cargo,
            )

            wrong_target = {name: list(command) for name, command in commands.items()}
            wrong_target["gradle"][-1] = ":app:assembleX86Debug"
            with self.assertRaisesRegex(MobileNativeBuildError, "target/configuration"):
                _validate_variant_command_contract(
                    root=root,
                    platform="android",
                    variant=ACCEPTANCE_VARIANT,
                    commands=wrong_target,
                    environment=environment,
                    cargo_wrapper=cargo,
                )

            with self.assertRaisesRegex(MobileNativeBuildError, "feature policy"):
                _validate_variant_command_contract(
                    root=root,
                    platform="android",
                    variant=RELEASE_VARIANT,
                    commands=commands,
                    environment=environment,
                    cargo_wrapper=cargo,
                )

    def test_ios_commands_and_cleanup_exclude_repository_rust_reuse(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            toolchain = fake_toolchain(root)
            xcodebuild = root / "tools/xcodebuild"
            xcodebuild.write_text("xcodebuild", encoding="utf-8")
            xcodebuild.chmod(0o700)
            toolchain.executable_paths["xcodebuild"] = str(xcodebuild)
            run_root = Path(temporary) / "run"
            run_root.mkdir()
            external = root / "apps/mobile/src-tauri/gen/apple/Externals/arm64/debug"
            external.mkdir(parents=True)
            (external / "libapp.a").write_bytes(b"stale")
            _remove_stale_ios_external_outputs(root)
            self.assertFalse(external.exists())
            commands = _producer_commands(
                root,
                "ios",
                toolchain,
                run_root,
                {"pnpm": root / "pnpm-cache"},
                None,
            )
            self.assertIn("aarch64-apple-ios", commands["cargo"])
            self.assertIn("--frozen", commands["cargo"])
            self.assertIn(ACCEPTANCE_CARGO_FEATURE, ",".join(commands["cargo"]))
            release_commands = _producer_commands(
                root,
                "ios",
                toolchain,
                run_root,
                {"pnpm": root / "pnpm-cache"},
                None,
                variant=RELEASE_VARIANT,
            )
            self.assertNotIn(
                ACCEPTANCE_CARGO_FEATURE,
                ",".join(release_commands["cargo"]),
            )
            self.assertIn("--release", release_commands["cargo"])
            self.assertEqual(
                release_commands["xcode"][
                    release_commands["xcode"].index("-configuration") + 1
                ],
                "release",
            )
            environment = construct_build_environment(
                platform="ios",
                run_root=run_root,
                executable_paths=toolchain.executable_paths,
                sdk_paths={
                    "DEVELOPER_DIR": str(root / "android-sdk"),
                    "SDKROOT": str(root / "android-sdk"),
                },
            )
            cargo = _install_cargo_frozen_wrapper(
                run_root=run_root,
                real_cargo=toolchain.executable_paths["cargo"],
                shell="/bin/sh",
                injected_features=(ACCEPTANCE_CARGO_FEATURE,),
            )
            environment = _prepend_controlled_path(environment, cargo.path.parent)
            _validate_variant_command_contract(
                root=root,
                platform="ios",
                variant=ACCEPTANCE_VARIANT,
                commands=commands,
                environment=environment,
                cargo_wrapper=cargo,
            )
            wrong_target = {name: list(command) for name, command in commands.items()}
            target_index = wrong_target["cargo"].index("aarch64-apple-ios")
            wrong_target["cargo"][target_index] = "x86_64-apple-ios"
            with self.assertRaisesRegex(MobileNativeBuildError, "iOS Cargo target"):
                _validate_variant_command_contract(
                    root=root,
                    platform="ios",
                    variant=ACCEPTANCE_VARIANT,
                    commands=wrong_target,
                    environment=environment,
                    cargo_wrapper=cargo,
                )
            self.assertEqual(
                environment["CARGO_TARGET_DIR"],
                str((run_root / "cargo-target").resolve()),
            )

    def test_package_scan_covers_target_archive_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / "mobile.apk"
            write_apk(apk, b"prefix-oauth_acceptance_callback_replay_handle-suffix")
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "classes.dex",
            ):
                _scan_application_package(apk, "android")

    def test_native_marker_policy_scans_both_target_package_formats(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            packages = (
                ("android", root / "mobile.apk", write_apk),
                ("ios", root / "mobile.ipa", write_ipa),
            )
            for platform, package, writer in packages:
                with self.subTest(platform=platform):
                    identity_bytes = canonical_json_bytes(identity(platform))
                    writer(
                        package,
                        b"native:"
                        + NATIVE_ACCEPTANCE_HARNESS_MARKER
                        + b":"
                        + identity_bytes,
                    )
                    positive = _scan_acceptance_application_package(
                        package,
                        platform,
                        identity_bytes,
                    )
                    self.assertEqual(
                        positive["requiredMarkers"][
                            NATIVE_ACCEPTANCE_HARNESS_MARKER.decode("ascii")
                        ],
                        (
                            "classes.dex"
                            if platform == "android"
                            else "Payload/Peers.app/Peers"
                        ),
                    )
                    with self.assertRaisesRegex(
                        MobileNativeBuildError,
                        "forbidden Acceptance adapters",
                    ):
                        _scan_application_package(package, platform)

    def test_native_marker_does_not_replace_exact_identity_on_either_platform(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            packages = (
                ("android", root / "mobile.apk", write_apk),
                ("ios", root / "mobile.ipa", write_ipa),
            )
            for platform, package, writer in packages:
                expected_identity = identity(platform)
                expected_bytes = canonical_json_bytes(expected_identity)
                wrong_bytes = canonical_json_bytes(
                    {**expected_identity, "buildId": "stale-build"}
                )
                for name, payload in (
                    ("absent", b"native:" + NATIVE_ACCEPTANCE_HARNESS_MARKER),
                    (
                        "wrong",
                        b"native:"
                        + NATIVE_ACCEPTANCE_HARNESS_MARKER
                        + b":"
                        + wrong_bytes,
                    ),
                ):
                    with self.subTest(platform=platform, identity=name):
                        writer(package, payload)
                        with self.assertRaisesRegex(
                            MobileNativeBuildError,
                            "exact canonical native build identity",
                        ):
                            _scan_acceptance_application_package(
                                package,
                                platform,
                                expected_bytes,
                            )

    def test_native_marker_in_non_executable_asset_cannot_satisfy_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            apk = root / "mobile.apk"
            ipa = root / "mobile.ipa"
            write_apk(
                apk,
                extra_entries={
                    "assets/identity.txt": NATIVE_ACCEPTANCE_HARNESS_MARKER,
                },
            )
            write_ipa(
                ipa,
                info_values={
                    "AcceptanceMarkerDecoy": (
                        NATIVE_ACCEPTANCE_HARNESS_MARKER.decode("ascii")
                    ),
                },
                extra_entries={
                    "Payload/Peers.app/Assets/identity.txt": (
                        NATIVE_ACCEPTANCE_HARNESS_MARKER
                    ),
                },
            )
            for platform, package in (("android", apk), ("ios", ipa)):
                with self.subTest(platform=platform), self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "missing native harness markers",
                ):
                    _scan_acceptance_application_package(
                        package,
                        platform,
                        canonical_json_bytes(identity(platform)),
                    )

    def test_android_native_shared_library_is_an_executable_marker_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / "mobile.apk"
            write_apk(
                apk,
                extra_entries={
                    "lib/arm64-v8a/libpeers_touch_mobile.so": b"native:"
                    + NATIVE_ACCEPTANCE_HARNESS_MARKER
                    + b":"
                    + canonical_json_bytes(identity("android")),
                },
            )
            scan = _scan_acceptance_application_package(
                apk,
                "android",
                canonical_json_bytes(identity("android")),
            )
            self.assertEqual(
                scan["requiredMarkers"][
                    NATIVE_ACCEPTANCE_HARNESS_MARKER.decode("ascii")
                ],
                "lib/arm64-v8a/libpeers_touch_mobile.so",
            )
            self.assertEqual(
                [entry["path"] for entry in scan["checkedEntries"]],
                [
                    "classes.dex",
                    "lib/arm64-v8a/libpeers_touch_mobile.so",
                ],
            )

    def test_android_scan_ignores_non_abi_library_decoys(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / "mobile.apk"
            identity_bytes = canonical_json_bytes(identity("android"))
            write_apk(
                apk,
                b"native:"
                + NATIVE_ACCEPTANCE_HARNESS_MARKER
                + b":"
                + identity_bytes,
                extra_entries={
                    "lib/not-an-abi/libdecoy.so": b":".join(
                        (
                            NATIVE_ACCEPTANCE_HARNESS_MARKER,
                            canonical_json_bytes(
                                {**identity("android"), "buildId": "stale-build"}
                            ),
                        )
                    ),
                },
            )
            scan = _scan_acceptance_application_package(
                apk,
                "android",
                identity_bytes,
            )
            self.assertEqual(
                [entry["path"] for entry in scan["checkedEntries"]],
                ["classes.dex"],
            )

    def test_release_scan_ignores_non_executable_asset_and_plist_decoys(self) -> None:
        decoy = b":".join(
            (
                NATIVE_ACCEPTANCE_HARNESS_MARKER,
                *FORBIDDEN_RELEASE_ADAPTER_SYMBOLS,
            )
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            apk = root / "mobile.apk"
            ipa = root / "mobile.ipa"
            write_apk(apk, extra_entries={"assets/decoy.txt": decoy})
            write_ipa(
                ipa,
                info_values={"AcceptanceMarkerDecoy": decoy.decode("ascii")},
                extra_entries={"Payload/Peers.app/Assets/decoy.txt": decoy},
            )
            android = _scan_application_package(apk, "android")
            ios = _scan_application_package(ipa, "ios")
            self.assertEqual(
                [entry["path"] for entry in android["checkedEntries"]],
                ["classes.dex"],
            )
            self.assertEqual(
                [entry["path"] for entry in ios["checkedEntries"]],
                ["Payload/Peers.app/Peers"],
            )

    def test_ios_scan_resolves_executable_from_info_plist(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            ipa = Path(temporary) / "mobile.ipa"
            write_ipa(
                ipa,
                b"main-executable",
                info_values={"CFBundleExecutable": "PeersRuntime"},
                extra_entries={
                    "Payload/Peers.app/PeersRuntime": b"native:"
                    + NATIVE_ACCEPTANCE_HARNESS_MARKER
                    + b":"
                    + canonical_json_bytes(identity("ios")),
                },
            )
            scan = _scan_acceptance_application_package(
                ipa,
                "ios",
                canonical_json_bytes(identity("ios")),
            )
            self.assertEqual(
                scan["requiredMarkers"][
                    NATIVE_ACCEPTANCE_HARNESS_MARKER.decode("ascii")
                ],
                "Payload/Peers.app/PeersRuntime",
            )
            self.assertEqual(
                [entry["path"] for entry in scan["checkedEntries"]],
                ["Payload/Peers.app/PeersRuntime"],
            )

    def test_stale_dist_identity_asset_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dist = root / "apps/mobile/dist"
            dist.mkdir(parents=True)
            expected = identity("android")
            (dist / WEB_BUILD_IDENTITY_ASSET).write_bytes(
                canonical_json_bytes({**expected, "buildId": "stale-build"})
            )
            (dist / "index.js").write_bytes(
                b":".join(WEB_ACCEPTANCE_HARNESS_MARKERS)
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "exact canonical build identity",
            ):
                _fresh_web_build_provenance(
                    root,
                    identity=expected,
                    harness_enabled=True,
                )

    def test_omitted_dist_identity_asset_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dist = root / "apps/mobile/dist"
            dist.mkdir(parents=True)
            (dist / "index.js").write_bytes(
                b":".join(WEB_ACCEPTANCE_HARNESS_MARKERS)
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                WEB_BUILD_IDENTITY_ASSET,
            ):
                _fresh_web_build_provenance(
                    root,
                    identity=identity("android"),
                    harness_enabled=True,
                )

    def test_harness_marker_and_action_set_cannot_be_split_across_dist_files(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dist = root / "apps/mobile/dist"
            dist.mkdir(parents=True)
            identity_value = identity("android")
            literal = json.dumps(
                canonical_json_bytes(identity_value).decode("ascii"),
                ensure_ascii=True,
                separators=(",", ":"),
            ).encode("ascii")
            midpoint = len(WEB_ACCEPTANCE_HARNESS_MARKERS) // 2
            (dist / "index.js").write_bytes(
                literal + b":" + b":".join(WEB_ACCEPTANCE_HARNESS_MARKERS[:midpoint])
            )
            (dist / "chunk.js").write_bytes(
                b":".join(WEB_ACCEPTANCE_HARNESS_MARKERS[midpoint:])
            )
            (dist / WEB_BUILD_IDENTITY_ASSET).write_bytes(
                canonical_json_bytes(identity_value)
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "exact Acceptance Harness marker/action set",
            ):
                _fresh_web_build_provenance(
                    root,
                    identity=identity_value,
                    harness_enabled=True,
                )

    def test_identity_asset_provenance_uses_exact_canonical_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dist = root / "apps/mobile/dist"
            dist.mkdir(parents=True)
            identity_value = identity("android")
            canonical_identity = canonical_json_bytes(identity_value)
            (dist / "index.js").write_bytes(
                b":".join(WEB_ACCEPTANCE_HARNESS_MARKERS)
            )
            (dist / WEB_BUILD_IDENTITY_ASSET).write_bytes(canonical_identity)
            provenance = _fresh_web_build_provenance(
                root,
                identity=identity_value,
                harness_enabled=True,
            )
            self.assertEqual(
                provenance["identityAssetPath"],
                WEB_BUILD_IDENTITY_ASSET,
            )
            self.assertEqual(
                provenance["identityAssetSha256"],
                embedded_identity_digest(identity_value),
            )
            self.assertEqual(
                provenance["identityAssetSizeBytes"],
                len(canonical_identity),
            )
            self.assertEqual(
                set(provenance["harnessMarkers"]),
                {
                    marker.decode("ascii")
                    for marker in WEB_ACCEPTANCE_HARNESS_MARKERS
                },
            )

    def test_packaged_web_identity_omission_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    omit_packaged_web_identity=True,
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "omitted, stale, swapped, or duplicated",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_stale_packaged_web_identity_cannot_mint_a_receipt(self) -> None:
        def stale_identity(raw: str) -> bytes:
            value = json.loads(raw)
            value["buildId"] = "stale-build"
            return canonical_json_bytes(value)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    packaged_web_identity_payload=stale_identity,
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "omitted, stale, swapped, or duplicated",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_duplicate_packaged_web_identity_assets_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            apk = root / "mobile.apk"
            identity_bytes = canonical_json_bytes(identity("android"))
            embedded_bytes = write_tauri_codegen_asset(
                target,
                "debug",
                identity_bytes,
            )
            write_apk(
                apk,
                WEB_BUILD_IDENTITY_ASSET.encode("ascii")
                + b":"
                + embedded_bytes
                + b":"
                + embedded_bytes,
            )
            provenance = {
                "identityAssetPath": WEB_BUILD_IDENTITY_ASSET,
                "identityAssetSha256": embedded_identity_digest(identity("android")),
                "identityAssetSizeBytes": len(identity_bytes),
            }
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "2 representations",
            ):
                _scan_packaged_web_identity(
                    apk,
                    "android",
                    expected_identity=identity_bytes,
                    web_provenance=provenance,
                    cargo_target_dir=target,
                )

    def test_exact_packaged_web_identity_is_verified_for_apk_and_ipa(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for platform, artifact, writer, entry in (
                (
                    "android",
                    root / "mobile.apk",
                    write_apk,
                    "classes.dex",
                ),
                (
                    "ios",
                    root / "mobile.ipa",
                    write_ipa,
                    "Payload/Peers.app/Peers",
                ),
            ):
                with self.subTest(platform=platform):
                    identity_value = identity(platform)
                    identity_bytes = canonical_json_bytes(identity_value)
                    target = root / f"{platform}-target"
                    embedded_bytes = write_tauri_codegen_asset(
                        target,
                        "debug",
                        identity_bytes,
                    )
                    writer(
                        artifact,
                        (
                            WEB_BUILD_IDENTITY_ASSET.encode("ascii")
                            + b":"
                            + embedded_bytes
                        ),
                    )
                    provenance = {
                        "identityAssetPath": WEB_BUILD_IDENTITY_ASSET,
                        "identityAssetSha256": embedded_identity_digest(
                            identity_value
                        ),
                        "identityAssetSizeBytes": len(identity_bytes),
                    }
                    scan = _scan_packaged_web_identity(
                        artifact,
                        platform,
                        expected_identity=identity_bytes,
                        web_provenance=provenance,
                        cargo_target_dir=target,
                    )
                    self.assertEqual(scan["packageEntry"], entry)
                    self.assertEqual(scan["representation"], "tauri-embedded")

    def test_stale_codegen_cache_and_stale_package_cannot_mint_a_receipt(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity_value = identity("android")
            identity_bytes = canonical_json_bytes(identity_value)
            digest = hashlib.sha256(identity_bytes).hexdigest()
            stale_identity = canonical_json_bytes(
                {**identity_value, "buildId": "stale-build"}
            )
            stale_representation = tauri_codegen_representation(stale_identity)
            cache = (
                root
                / "target/debug/build/mobile/out/tauri-codegen-assets"
                / f"{digest}.json"
            )
            cache.parent.mkdir(parents=True)
            cache.write_bytes(stale_representation)
            apk = root / "mobile.apk"
            write_apk(
                apk,
                b"native:"
                + WEB_BUILD_IDENTITY_ASSET.encode("ascii")
                + b":"
                + stale_representation,
            )
            provenance = {
                "identityAssetPath": WEB_BUILD_IDENTITY_ASSET,
                "identityAssetSha256": f"sha256:{digest}",
                "identityAssetSizeBytes": len(identity_bytes),
            }
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "does not map to the exact canonical identity bytes",
            ):
                _scan_packaged_web_identity(
                    apk,
                    "android",
                    expected_identity=identity_bytes,
                    web_provenance=provenance,
                    cargo_target_dir=root / "target",
                )

    def test_structurally_malformed_codegen_metadata_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity_value = identity("android")
            identity_bytes = canonical_json_bytes(identity_value)
            digest = hashlib.sha256(identity_bytes).hexdigest()
            cache = (
                root
                / "target/debug/build/mobile/out/tauri-codegen-assets"
                / f"{digest}.json"
            )
            cache.parent.mkdir(parents=True)
            cache.write_bytes(b"not-a-brotli-representation")
            apk = root / "mobile.apk"
            write_apk(
                apk,
                WEB_BUILD_IDENTITY_ASSET.encode("ascii")
                + b":not-a-brotli-representation",
            )
            provenance = {
                "identityAssetPath": WEB_BUILD_IDENTITY_ASSET,
                "identityAssetSha256": f"sha256:{digest}",
                "identityAssetSizeBytes": len(identity_bytes),
            }
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "structurally malformed",
            ):
                _scan_packaged_web_identity(
                    apk,
                    "android",
                    expected_identity=identity_bytes,
                    web_provenance=provenance,
                    cargo_target_dir=root / "target",
                )

    def test_codegen_metadata_without_digest_address_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity_value = identity("android")
            identity_bytes = canonical_json_bytes(identity_value)
            representation = tauri_codegen_representation(identity_bytes)
            cache = (
                root
                / "target/debug/build/mobile/out/tauri-codegen-assets"
                / "identity.json"
            )
            cache.parent.mkdir(parents=True)
            cache.write_bytes(representation)
            apk = root / "mobile.apk"
            write_apk(
                apk,
                WEB_BUILD_IDENTITY_ASSET.encode("ascii") + b":" + representation,
            )
            provenance = {
                "identityAssetPath": WEB_BUILD_IDENTITY_ASSET,
                "identityAssetSha256": embedded_identity_digest(identity_value),
                "identityAssetSizeBytes": len(identity_bytes),
            }
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "missing the digest-bound Web identity representation",
            ):
                _scan_packaged_web_identity(
                    apk,
                    "android",
                    expected_identity=identity_bytes,
                    web_provenance=provenance,
                    cargo_target_dir=root / "target",
                )

    def test_release_web_provenance_rejects_any_harness_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dist = root / "apps/mobile/dist"
            dist.mkdir(parents=True)
            identity_value = identity("android")
            (dist / WEB_BUILD_IDENTITY_ASSET).write_bytes(
                canonical_json_bytes(identity_value)
            )
            (dist / "index.js").write_bytes(WEB_ACCEPTANCE_HARNESS_MARKERS[-1])
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "contains Acceptance Harness markers",
            ):
                _fresh_web_build_provenance(
                    root,
                    identity=identity_value,
                    harness_enabled=False,
                )

    def test_web_output_without_harness_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    acceptance_web_payload=lambda raw: json.dumps(
                        raw,
                        ensure_ascii=True,
                        separators=(",", ":"),
                    ).encode("ascii"),
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "missing the exact Acceptance Harness marker/action set",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_acceptance_package_without_native_marker_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    include_native_marker=False,
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "missing native harness markers",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_native_marker_without_exact_identity_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    include_native_identity=False,
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "exact canonical native build identity",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_native_marker_with_wrong_identity_cannot_mint_a_receipt(self) -> None:
        def wrong_identity(raw: str) -> bytes:
            value = json.loads(raw)
            value["buildId"] = "stale-build"
            return canonical_json_bytes(value)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    native_identity_payload=wrong_identity,
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "exact canonical native build identity",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_acceptance_marked_release_package_cannot_mint_a_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"acceptance-native",
                    lambda: b"release-native:" + NATIVE_ACCEPTANCE_HARNESS_MARKER,
                )
            )
            with self.assertRaisesRegex(
                MobileNativeBuildError,
                "forbidden Acceptance adapters",
            ):
                orchestrate_fake_android(
                    root=root,
                    run_root=Path(temporary) / "run",
                    runner=runner,
                )

    def test_acceptance_symbols_are_allowed_but_release_symbols_block_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            toolchain = fake_toolchain(root)
            runner = android_runner(
                effect=android_build_effect(
                    root,
                    lambda: b"oauth_acceptance_negative_callback",
                    lambda: b"oauth_acceptance_callback_replay_handle",
                )
            )
            with (
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "_require_dependency_manager_locks"
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "capture_source_identity",
                    return_value=SourceIdentity("1" * 40, "clean", "clean"),
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "canonical_build_inputs_digest",
                    return_value=SHA256,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "canonical_files_digest",
                    return_value=SHA256,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "resolve_toolchain_identity",
                    return_value=toolchain,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "SubprocessCommandRunner",
                    return_value=runner,
                ),
            ):
                with self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "application package contains forbidden Acceptance adapters",
                ):
                    orchestrate_source_bound_build(
                        root=root,
                        platform="android",
                        run_root=Path(temporary) / "run",
                    )

    def test_noop_build_cannot_reuse_stale_repository_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            stale_apk = (
                root
                / "apps/mobile/src-tauri/gen/android/app/build/outputs/apk/"
                "arm64/debug/mobile.apk"
            )
            stale_release = (
                root
                / "apps/mobile/src-tauri/target/release/"
                "libpeers_touch_mobile_lib.a"
            )
            write_apk(stale_apk)
            stale_release.parent.mkdir(parents=True)
            stale_release.write_bytes(b"stale-linked-release")
            stale_dist = root / "apps/mobile/dist/index.html"
            stale_dist.parent.mkdir(parents=True)
            stale_dist.write_text("stale-web-output", encoding="utf-8")
            toolchain = fake_toolchain(root)
            with (
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "_require_dependency_manager_locks"
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "capture_source_identity",
                    return_value=SourceIdentity("1" * 40, "clean", "clean"),
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "canonical_build_inputs_digest",
                    return_value=SHA256,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "canonical_files_digest",
                    return_value=SHA256,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "resolve_toolchain_identity",
                    return_value=toolchain,
                ),
                patch(
                    "tooling.acceptance.provisioners.mobile_native_build."
                    "SubprocessCommandRunner",
                    return_value=android_runner(),
                ),
            ):
                with self.assertRaisesRegex(
                    MobileNativeBuildError,
                    "fresh Mobile Web build produced no dist directory",
                ):
                    orchestrate_source_bound_build(
                        root=root,
                        platform="android",
                        run_root=Path(temporary) / "run",
                    )
            self.assertFalse(stale_apk.exists())
            self.assertFalse(stale_dist.exists())
            self.assertEqual(stale_release.read_bytes(), b"stale-linked-release")

    def test_provenance_drift_blocks_receipt_minting(self) -> None:
        stable_source = SourceIdentity("1" * 40, "dirty", "sha256:" + ("2" * 64))
        changed_source = SourceIdentity("1" * 40, "dirty", "sha256:" + ("9" * 64))
        changed_digest = "sha256:" + ("9" * 64)
        cases = (
            (
                "workspace",
                [stable_source, changed_source],
                SHA256,
                SHA256,
                "source/workspace identity changed during build",
            ),
            (
                "build-input",
                stable_source,
                [SHA256, SHA256, changed_digest, SHA256],
                SHA256,
                "build inputs changed during build",
            ),
            (
                "producer",
                stable_source,
                SHA256,
                [SHA256, changed_digest],
                "build producer changed during build",
            ),
        )
        for name, source_values, input_values, producer_values, expected in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "repo"
                root.mkdir()
                toolchain = fake_toolchain(root)
                runner = android_runner(
                    effect=android_build_effect(root, lambda: b"target-package")
                )
                source_patch = (
                    patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "capture_source_identity",
                        side_effect=source_values,
                    )
                    if isinstance(source_values, list)
                    else patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "capture_source_identity",
                        return_value=source_values,
                    )
                )
                input_patch = (
                    patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "canonical_build_inputs_digest",
                        side_effect=input_values,
                    )
                    if isinstance(input_values, list)
                    else patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "canonical_build_inputs_digest",
                        return_value=input_values,
                    )
                )
                producer_patch = (
                    patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "canonical_files_digest",
                        side_effect=producer_values,
                    )
                    if isinstance(producer_values, list)
                    else patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "canonical_files_digest",
                        return_value=producer_values,
                    )
                )
                with (
                    patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "_require_dependency_manager_locks"
                    ),
                    source_patch,
                    input_patch,
                    producer_patch,
                    patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "resolve_toolchain_identity",
                        return_value=toolchain,
                    ),
                    patch(
                        "tooling.acceptance.provisioners.mobile_native_build."
                        "SubprocessCommandRunner",
                        return_value=runner,
                    ),
                ):
                    with self.assertRaisesRegex(MobileNativeBuildError, expected):
                        orchestrate_source_bound_build(
                            root=root,
                            platform="android",
                            run_root=Path(temporary) / "run",
                        )

    def test_fresh_install_and_runtime_inputs_are_artifact_ref_bound(self) -> None:
        device = artifact_ref("runtime/mobile/leases/devices/alice-ios.json")
        build = artifact_ref("runtime/mobile/builds/ios.json")
        install = artifact_ref("evidence/mobile/runtime/alice-ios/install.json")
        fresh = fresh_install_inputs(
            client_id="alice-ios",
            platform="ios",
            device_lease=device,
            build_attestation=build,
            application_id=APPLICATION_ID,
            artifact_sha256=SHA256,
        )
        runtime = runtime_identity_inputs(
            client_id="alice-ios",
            platform="ios",
            build_attestation=build,
            fresh_install_trace=install,
            expected_build_id="build-ios",
            expected_application_id=APPLICATION_ID,
            expected_embedded_identity_sha256=SHA256,
        )
        self.assertEqual(fresh["installPolicy"], "fresh-uninstall-readback-install")
        self.assertEqual(runtime["action"], "build.identity")
        self.assertEqual(runtime["buildAttestation"], fresh["buildAttestation"])

if __name__ == "__main__":
    unittest.main()
