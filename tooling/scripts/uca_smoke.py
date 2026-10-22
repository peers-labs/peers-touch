#!/usr/bin/env python3
"""Focused current-source smoke checks for the Unified Client Architecture."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
MOBILE_ROOT = REPO_ROOT / "apps" / "mobile"
MOBILE_TAURI_ROOT = MOBILE_ROOT / "src-tauri"
DESKTOP_TAURI_ROOT = REPO_ROOT / "apps" / "desktop" / "src-tauri"
APPLICATION_ID = "com.peers.touch.mobile"
ANDROID_ACTIVITY = f"{APPLICATION_ID}/.MainActivity"
DEFAULT_ANDROID_AVD = "peers_touch_mwpu_android_alice"
DEFAULT_IOS_DEVICE = "iPhone 17"
HOMEBREW_ANDROID_SDK = Path("/opt/homebrew/share/android-commandlinetools")


class SmokeError(RuntimeError):
    pass


def run(
    command: Sequence[str],
    *,
    cwd: Path = REPO_ROOT,
    env: dict[str, str] | None = None,
    timeout: int = 3600,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(command), flush=True)
    completed = subprocess.run(
        list(command),
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        detail = re.sub(r"\x1b\[[0-9;]*m", "", detail)
        detail = re.sub(r"Io\(Env\([^\n]*", "[build environment omitted]", detail)
        raise SmokeError(
            f"command failed ({completed.returncode}): {' '.join(command)}\n{detail[-8000:]}"
        )
    return completed


def git_output(*arguments: str) -> str:
    return run(("git", *arguments), timeout=30).stdout.strip()


def source_identity(platform: str) -> str:
    commit = git_output("rev-parse", "HEAD")
    status = run(
        ("git", "status", "--porcelain", "--untracked-files=no"),
        timeout=30,
    ).stdout
    if status.strip():
        raise SmokeError("UCA smoke requires a tracked-clean checkpoint")
    digest = hashlib.sha256(git_output("ls-files", "-s").encode("utf-8")).hexdigest()
    environment_digest = hashlib.sha256(
        json.dumps(
            {
                name: os.environ.get(name, "")
                for name in ("ANDROID_HOME", "ANDROID_SDK_ROOT", "NDK_HOME", "SDKROOT")
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    identity = {
        "allowlistedEnvironmentDigest": f"sha256:{environment_digest}",
        "applicationId": APPLICATION_ID,
        "buildId": f"uca-smoke-{platform}-{commit[:12]}",
        "buildInputsDigest": f"sha256:{digest}",
        "configuration": "acceptance-debug",
        "harnessEnabled": True,
        "platform": platform,
        "schema": "peers-mobile-build-identity",
        "sourceCommit": commit,
        "workspaceDigest": "clean",
        "workspaceState": "clean",
    }
    return json.dumps(identity, sort_keys=True, separators=(",", ":"))


def wait_for_process(process: subprocess.Popen[str], seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        return_code = process.poll()
        if return_code is not None:
            stdout, stderr = process.communicate()
            raise SmokeError(
                f"smoke process exited early ({return_code})\n"
                f"{stderr or stdout}"
            )
        time.sleep(0.25)


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def locate_desktop_binary() -> Path:
    candidates = (
        DESKTOP_TAURI_ROOT / "target" / "debug" / "peers-touch-desktop",
        REPO_ROOT / "target" / "debug" / "peers-touch-desktop",
    )
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise SmokeError("Desktop debug binary was not produced")


def smoke_desktop() -> dict[str, Any]:
    from tooling.acceptance.drivers.tauri import (
        resolve_smoke_port,
        tauri_driver_session,
    )

    commit = git_output("rev-parse", "HEAD")
    run(("pnpm", "--dir", "apps/desktop", "run", "check"))
    run(
        (
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "--bin",
            "peers-touch-desktop",
            "system_health_reports_compiled_desktop_identity",
            "--offline",
        )
    )
    environment = dict(os.environ)
    environment["PT_BUILD_SOURCE_COMMIT"] = commit
    environment["VITE_ACCEPTANCE_HARNESS"] = "1"
    environment["TAURI_CONFIG"] = '{"app":{"withGlobalTauri":true}}'
    run(("pnpm", "--dir", "apps/desktop", "run", "build"), env=environment)
    run(
        (
            "cargo",
            "build",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "--bin",
            "peers-touch-desktop",
            "--features",
            "acceptance-webdriver",
            "--offline",
        ),
        env=environment,
    )
    binary = locate_desktop_binary()
    with tauri_driver_session(
        app_binary=str(binary),
        port=resolve_smoke_port(0),
    ) as driver:
        renderer = driver.wait_for_ready()
        response = driver.driver.execute_async_script(
            "const done = arguments[arguments.length - 1];"
            "window.__TAURI_INTERNALS__.invoke('system_health')"
            ".then(done).catch(error => done({error: String(error)}));"
        )
        if not isinstance(response, dict) or response.get("ok") is not True:
            raise SmokeError(f"Desktop health bridge failed: {response}")
        health = json.loads(response["data"]["status"])
        if health.get("sourceCommit") != commit:
            raise SmokeError("Desktop runtime does not match the current commit")
    return {
        "platform": "desktop",
        "binary": str(binary.relative_to(REPO_ROOT)),
        "sourceCommit": commit,
        "checks": ["typescript", "compiled-identity", "native-dom", "tauri-bridge"],
        "renderer": renderer,
        "health": health,
        "cleanup": "native-driver-session-and-storage-released",
    }


def android_sdk_roots() -> list[Path]:
    roots = [
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        str(Path.home() / "Library" / "Android" / "sdk"),
        str(HOMEBREW_ANDROID_SDK),
    ]
    return [Path(root) for root in roots if root and Path(root).is_dir()]


def android_sdk_tool(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    relative = Path("emulator") / name if name == "emulator" else Path("platform-tools") / name
    for root in android_sdk_roots():
        candidate = root / relative
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise SmokeError(f"Android SDK tool is unavailable: {name}")


def android_build_environment() -> dict[str, str]:
    environment = dict(os.environ)
    candidates = [
        (
            root,
            sorted(path for path in (root / "ndk").glob("*") if path.is_dir()),
        )
        for root in android_sdk_roots()
    ]
    selected = next(
        (
            (root, ndk_versions)
            for root, ndk_versions in candidates
            if ndk_versions
        ),
        None,
    )
    if selected is None:
        roots = ", ".join(str(root) for root, _ in candidates) or "none"
        raise SmokeError(f"Android SDK with NDK is unavailable; checked: {roots}")
    root, ndk_versions = selected
    ndk = ndk_versions[-1]
    toolchain_bins = list((ndk / "toolchains" / "llvm" / "prebuilt").glob("*/bin"))
    if len(toolchain_bins) != 1:
        raise SmokeError(f"Android NDK LLVM toolchain is unavailable under {ndk}")
    toolchain_bin = toolchain_bins[0]
    shim_root = (
        Path(tempfile.gettempdir())
        / f"peers-uca-android-toolchain-{ndk.name}"
    )
    shim_root.mkdir(parents=True, exist_ok=True)
    for triple in (
        "aarch64-linux-android",
        "arm-linux-androideabi",
        "i686-linux-android",
        "x86_64-linux-android",
    ):
        for tool in ("ar", "ranlib"):
            source = toolchain_bin / f"llvm-{tool}"
            target = shim_root / f"{triple}-{tool}"
            if not source.is_file():
                raise SmokeError(f"Android NDK tool is unavailable: {source}")
            if target.exists() or target.is_symlink():
                target.unlink()
            target.symlink_to(source)
    environment["ANDROID_HOME"] = str(root)
    environment["ANDROID_SDK_ROOT"] = str(root)
    environment["NDK_HOME"] = str(ndk)
    environment["PATH"] = os.pathsep.join(
        (str(shim_root), str(toolchain_bin), environment.get("PATH", ""))
    )
    return environment


def android_emulators(adb: str) -> list[str]:
    completed = run((adb, "devices"), timeout=30)
    devices: list[str] = []
    for line in completed.stdout.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 2 and fields[0].startswith("emulator-") and fields[1] == "device":
            devices.append(fields[0])
    return devices


def wait_for_android_boot(adb: str, serial: str, process: subprocess.Popen[str] | None) -> None:
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise SmokeError("Android Emulator exited before boot completed")
        completed = run(
            (adb, "-s", serial, "shell", "getprop", "sys.boot_completed"),
            timeout=15,
            check=False,
        )
        if completed.returncode == 0 and completed.stdout.strip() == "1":
            return
        time.sleep(2)
    raise SmokeError("Android Emulator did not finish booting")


def start_android_emulator(adb: str) -> tuple[str, subprocess.Popen[str] | None]:
    running = android_emulators(adb)
    if running:
        return running[0], None
    emulator = android_sdk_tool("emulator")
    listed = run((emulator, "-list-avds"), timeout=30).stdout.splitlines()
    available = [value.strip() for value in listed if value.strip()]
    if not available:
        raise SmokeError("No Android AVD is installed")
    requested = os.environ.get("PT_UCA_ANDROID_AVD", DEFAULT_ANDROID_AVD)
    avd = requested if requested in available else available[0]
    log_path = Path(tempfile.gettempdir()) / "peers-uca-android-emulator.log"
    log_stream = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        [
            emulator,
            "-avd",
            avd,
            "-no-snapshot-save",
            "-no-boot-anim",
            "-no-audio",
        ],
        cwd=REPO_ROOT,
        stdout=log_stream,
        stderr=subprocess.STDOUT,
        text=True,
    )
    log_stream.close()
    serial = ""
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        candidates = android_emulators(adb)
        if candidates:
            serial = candidates[0]
            break
        if process.poll() is not None:
            raise SmokeError(f"Android Emulator failed to start; log: {log_path}")
        time.sleep(1)
    if not serial:
        stop_process(process)
        raise SmokeError("Android Emulator did not register with adb")
    wait_for_android_boot(adb, serial, process)
    return serial, process


def locate_android_apk() -> Path:
    root = MOBILE_TAURI_ROOT / "gen" / "android" / "app" / "build" / "outputs" / "apk"
    candidates = [
        path
        for path in root.rglob("*.apk")
        if "androidTest" not in path.parts and "unaligned" not in path.name
    ]
    if not candidates:
        raise SmokeError("Android debug APK was not produced")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def normalize_android_generated_manifest() -> None:
    manifest = (
        MOBILE_TAURI_ROOT
        / "gen"
        / "android"
        / "app"
        / "src"
        / "main"
        / "AndroidManifest.xml"
    )
    source = manifest.read_text(encoding="utf-8")
    normalized = re.sub(
        r'(<data android:path="/callback" />)\n(?:[ \t]*\n)+([ \t]*</intent-filter>)',
        r"\1\n\2",
        source,
    )
    if normalized != source:
        manifest.write_text(normalized, encoding="utf-8")


def require_android_pid(adb: str, serial: str) -> str:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        result = run(
            (adb, "-s", serial, "shell", "pidof", APPLICATION_ID),
            timeout=15,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        time.sleep(1)
    raise SmokeError("Android application did not remain running")


def smoke_android(*, retain_devices: bool) -> dict[str, Any]:
    adb = android_sdk_tool("adb")
    serial, emulator_process = start_android_emulator(adb)
    try:
        environment = android_build_environment()
        environment["PT_MOBILE_BUILD_IDENTITY_JSON"] = source_identity("android")
        run(
            (
                "pnpm", "--dir", "apps/mobile", "run", "tauri:android:build",
                "--target", "aarch64", "--apk",
                "--features", "acceptance-harness",
            ),
            env=environment,
            timeout=5400,
        )
        apk = locate_android_apk()
        run((adb, "-s", serial, "install", "-r", str(apk)), timeout=180)
        run((adb, "-s", serial, "shell", "am", "start", "-W", "-n", ANDROID_ACTIVITY))
        first_pid = require_android_pid(adb, serial)
        run(
            (
                adb,
                "-s",
                serial,
                "shell",
                "pm",
                "grant",
                APPLICATION_ID,
                "android.permission.CAMERA",
            ),
            check=False,
        )
        permission = run(
            (adb, "-s", serial, "shell", "dumpsys", "package", APPLICATION_ID),
            timeout=60,
        ).stdout
        if "android.permission.CAMERA: granted=true" not in permission:
            raise SmokeError("Android camera permission was not projected as granted")
        run((adb, "-s", serial, "shell", "am", "force-stop", APPLICATION_ID))
        run((adb, "-s", serial, "shell", "am", "start", "-W", "-n", ANDROID_ACTIVITY))
        second_pid = require_android_pid(adb, serial)
        return {
            "platform": "android",
            "device": serial,
            "artifact": str(apk.relative_to(REPO_ROOT)),
            "sourceCommit": git_output("rev-parse", "HEAD"),
            "checks": ["build", "install", "launch", "camera-permission", "force-stop", "relaunch"],
            "processChanged": first_pid != second_pid,
        }
    finally:
        normalize_android_generated_manifest()
        run((adb, "-s", serial, "shell", "am", "force-stop", APPLICATION_ID), check=False)
        if emulator_process is not None and not retain_devices:
            run((adb, "-s", serial, "emu", "kill"), check=False)
            try:
                emulator_process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                stop_process(emulator_process)


def ios_devices() -> dict[str, Any]:
    completed = run(
        ("xcrun", "simctl", "list", "devices", "available", "--json"),
        timeout=60,
    )
    return json.loads(completed.stdout)["devices"]


def select_ios_device() -> tuple[str, bool]:
    requested = os.environ.get("PT_UCA_IOS_DEVICE", DEFAULT_IOS_DEVICE)
    candidates: list[dict[str, Any]] = []
    for devices in ios_devices().values():
        candidates.extend(
            device
            for device in devices
            if device.get("isAvailable") is True
            and requested.lower() in str(device.get("name", "")).lower()
        )
    if not candidates:
        raise SmokeError(f"No available iOS Simulator matches {requested!r}")
    device = candidates[0]
    was_booted = device.get("state") == "Booted"
    udid = str(device["udid"])
    if not was_booted:
        run(("xcrun", "simctl", "boot", udid), check=False)
        run(("xcrun", "simctl", "bootstatus", udid, "-b"), timeout=240)
    return udid, was_booted


def ios_scheme(project: Path) -> str:
    completed = run(
        ("xcodebuild", "-list", "-json", "-project", str(project)),
        cwd=project.parent,
        timeout=120,
    )
    value = json.loads(completed.stdout)
    schemes = value.get("project", {}).get("schemes", [])
    for scheme in schemes:
        if str(scheme).endswith("_iOS"):
            return str(scheme)
    if schemes:
        return str(schemes[0])
    raise SmokeError("iOS Xcode project has no build scheme")


def locate_ios_app(derived_data: Path) -> Path:
    candidates = list(
        (derived_data / "Build" / "Products").glob("*-iphonesimulator/*.app")
    )
    if not candidates:
        raise SmokeError("iOS Simulator application was not produced")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def ios_bundle_id(application: Path) -> str:
    with (application / "Info.plist").open("rb") as stream:
        value = plistlib.load(stream)
    bundle_id = value.get("CFBundleIdentifier")
    if not isinstance(bundle_id, str) or not bundle_id:
        raise SmokeError("iOS application bundle identifier is missing")
    return bundle_id


def smoke_ios(*, retain_devices: bool) -> dict[str, Any]:
    udid, was_booted = select_ios_device()
    project = MOBILE_TAURI_ROOT / "gen" / "apple" / "peers-touch-mobile.xcodeproj"
    derived_data = MOBILE_TAURI_ROOT / "target" / "uca-smoke-ios"
    environment = dict(os.environ)
    environment["PT_MOBILE_BUILD_IDENTITY_JSON"] = source_identity("ios")
    environment["MOBILE_TAURI_STATIC_BUNDLE_BUILD"] = "1"
    assets = project.parent / "assets"
    asset_backup = tempfile.TemporaryDirectory(prefix="uca-apple-assets-")
    backup = Path(asset_backup.name) / "assets"
    had_assets = assets.exists()
    if had_assets:
        shutil.copytree(assets, backup)
    try:
        run(("pnpm", "--dir", "apps/mobile", "run", "build"), env=environment)
        if assets.exists():
            shutil.rmtree(assets)
        shutil.copytree(MOBILE_ROOT / "dist", assets)
        run(
            (
                "xcodebuild",
                "-project",
                str(project),
                "-scheme",
                ios_scheme(project),
                "-sdk",
                "iphonesimulator",
                "-configuration",
                "debug",
                "-derivedDataPath",
                str(derived_data),
                "CODE_SIGNING_ALLOWED=NO",
                "build",
            ),
            cwd=project.parent,
            env=environment,
            timeout=5400,
        )
        application = locate_ios_app(derived_data)
        if not (application / "assets" / "index.html").is_file():
            raise SmokeError("iOS bundle is missing the Mobile index.html resource")
        bundle_id = ios_bundle_id(application)
        run(("xcrun", "simctl", "install", udid, str(application)), timeout=180)
        run(("xcrun", "simctl", "launch", udid, bundle_id), timeout=60)
        run(("xcrun", "simctl", "privacy", udid, "grant", "photos", bundle_id))
        run(
            ("xcrun", "simctl", "launch", "--terminate-running-process", udid, bundle_id),
            timeout=60,
        )
        run(("xcrun", "simctl", "terminate", udid, bundle_id))
        relaunched = run(
            ("xcrun", "simctl", "launch", udid, bundle_id),
            timeout=60,
        ).stdout.strip()
        return {
            "platform": "ios",
            "device": udid,
            "artifact": str(application.relative_to(REPO_ROOT)),
            "sourceCommit": git_output("rev-parse", "HEAD"),
            "checks": ["build", "install", "launch", "photo-permission", "terminate", "relaunch"],
            "relaunch": relaunched,
        }
    finally:
        run(("xcrun", "simctl", "terminate", udid, APPLICATION_ID), check=False)
        if not was_booted and not retain_devices:
            run(("xcrun", "simctl", "shutdown", udid), check=False)
        if assets.exists():
            shutil.rmtree(assets)
        if had_assets:
            shutil.copytree(backup, assets)
        asset_backup.cleanup()


def smoke_platform(platform: str, *, retain_devices: bool) -> dict[str, Any]:
    if platform == "desktop":
        return smoke_desktop()
    if platform == "android":
        return smoke_android(retain_devices=retain_devices)
    if platform == "ios":
        return smoke_ios(retain_devices=retain_devices)
    raise SmokeError(f"unsupported platform: {platform}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--platform",
        choices=("desktop", "android", "ios", "all"),
        required=True,
    )
    parser.add_argument("--retain-devices", action="store_true")
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args(argv)
    platforms = (
        ("desktop", "android", "ios")
        if arguments.platform == "all"
        else (arguments.platform,)
    )
    report = {
        "kind": "peers-touch-uca-smoke-report",
        "sourceCommit": git_output("rev-parse", "HEAD"),
        "platforms": [
            smoke_platform(platform, retain_devices=arguments.retain_devices)
            for platform in platforms
        ],
        "nonClaims": [
            "push-provider-delivery",
            "physical-device-behavior",
            "full-acceptance",
            "release-readiness",
        ],
    }
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if arguments.report is not None:
        destination = arguments.report.expanduser().resolve()
        if destination.is_relative_to(REPO_ROOT):
            raise SmokeError("Smoke diagnostics must be stored outside the repository")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SmokeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print(f"UCA smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1)
