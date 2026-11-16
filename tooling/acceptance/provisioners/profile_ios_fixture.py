"""Task-owned iOS fixtures using canonical Machine Dev assignments and locks."""

from __future__ import annotations

import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
import uuid
from hashlib import sha256
from pathlib import Path
from typing import Any

from tooling.acceptance.core import BlockedError, GateError, REPO_ROOT
from .mobile_ios_resources import MobileIOSResources


class ProfileIOSFixture:
    """No private registry, provider allocator, or automatic foreign cleanup."""

    def __init__(self, *, repo_root: Path = REPO_ROOT):
        self.root = repo_root
        self.env = dict(os.environ)
        if self.env.get("PT_MACHINE_DEV_ROOT"):
            raise BlockedError(reason="Native resource proof requires the canonical machine owner",
                               resource="profile-resource:machine-owner")
        self.bridge = MobileIOSResources(repo_root, {}, self.env)
        self.tag = uuid.uuid4().hex[:12]
        self.profiles = [f"res-{self.tag}-a", f"res-{self.tag}-b"]
        self.files: list[Path] = []
        self.owned: dict[str, dict[str, Any]] = {}
        self.preparation_id = f"res-{self.tag}"
        self.initial = self.inventory()
        self.binding = self.bridge.call("check", self.bound_profile())

    def bound_profile(self) -> str:
        command = ["node", str(self.root / "tooling/scripts/local-dev/machine-dev.mjs"),
                   "check", "--workspace-root", str(self.root)]
        result = subprocess.run(command, cwd=self.root, env=self.env, capture_output=True,
                                text=True, timeout=30, check=True)
        return json.loads(result.stdout)["profile"]["profile"]

    def inventory(self) -> dict[str, dict[str, Any]]:
        result = subprocess.run(["xcrun", "simctl", "list", "--json"], capture_output=True,
                                text=True, timeout=30, check=True)
        value = json.loads(result.stdout)
        return {
            item["udid"]: {**item, "runtime": runtime}
            for runtime, items in value["devices"].items() for item in items
        }

    def prepare(self) -> None:
        available = [
            item for item in self.initial.values()
            if item.get("isAvailable") and item.get("deviceTypeIdentifier")
        ]
        if not available:
            raise BlockedError(reason="No available iOS runtime/model for a task-owned fixture",
                               resource="profile-resource:ios-runtime")
        chosen = sorted(available, key=lambda item: (item["runtime"], item["deviceTypeIdentifier"]))[-1]
        for profile in self.profiles:
            file = self.root / ".local/dev/profiles" / f"{profile}.env"
            if not file.parent.is_dir():
                raise BlockedError(reason="Original worktree-local Profile directory is unavailable",
                                   resource="profile-resource:profile-parent")
            values = {
                "PT_DEV_PROFILE": profile,
                "PT_STATION_MODE": self.binding["profile"]["stationMode"],
                "PT_STATION_URL": self.binding["profile"]["stationUrl"],
                "PT_MOBILE_IOS_RUNTIME": chosen["runtime"],
                "PT_MOBILE_IOS_DEVICE_TYPE": chosen["deviceTypeIdentifier"],
                "PT_MOBILE_IOS_DATA": "preserve",
            }
            descriptor = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write("".join(f"{key}={value}\n" for key, value in values.items()))
            self.files.append(file)

    def collect_owned(self) -> dict[str, Any]:
        partial = self.bridge.call("resource-inspect", self.profiles[0])
        for device in partial["devices"]:
            if device.get("preparation", {}).get("requestId") == self.preparation_id:
                if device["providerId"] in self.initial:
                    raise GateError("Fixture creation resolved a preexisting device")
                self.owned[device["id"]] = device
        return partial

    def create(self) -> dict[str, Any]:
        try:
            result = self.bridge.call(
                "resource-assign", self.profiles[0], "--count", "2",
                "--purpose", f"Resource proof {self.tag}", "--create", "true",
                "--preparation-id", self.preparation_id,
            )
        finally:
            # A provider can fail after persisting or creating the first device.
            # Cleanup derives ownership from the original preparation record.
            self.collect_owned()
        for device in result["devices"]:
            if device.get("preparation", {}).get("requestId") != self.preparation_id:
                raise GateError("Fixture assignment includes a device not created by this request")
            if device["providerId"] in self.initial:
                raise GateError("Fixture creation resolved a preexisting device")
            self.owned[device["id"]] = device
        if len(self.owned) != 2:
            raise GateError("Explicit fixture count did not produce exactly two identities")
        return result

    def interrupt(self, phase: str, scratch: Path, *, operation=None) -> dict[str, Any]:
        request = scratch / f"{phase}.json"
        profile = operation["profile"] if operation else self.profiles[0]
        request.write_text(json.dumps({
            "workspaceRoot": str(self.root), "profile": profile, "tag": self.tag,
            "phase": phase, "operationId": operation["id"] if operation else None,
        }), encoding="utf-8")
        command = ["node", str(self.root / "tooling/scripts/local-dev/fixtures/resource-native-boundary.mjs"), str(request)]
        if operation:
            self.require_owned(operation["resourceId"])
            command = self.bridge.command(
                "lease", profile, "--resource-kind", "simulator.ios",
                "--resource-id", operation["providerId"], "--budget-seconds", "360",
                "--", *command,
            )
        result = subprocess.run(command, cwd=self.root, env=self.env,
                                text=True, capture_output=True, timeout=360)
        self.collect_owned()
        if result.returncode != 86:
            raise GateError(f"Native {phase} interruption did not reach boundary: {result.returncode}: {result.stderr}")
        return {"phase": phase, "exitCode": result.returncode,
                "devices": list(self.owned.values())}

    def rename(self, resource_id: str, name: str) -> None:
        device = self.require_owned(resource_id)
        holder = MobileIOSResources(self.root, {"rename": self.selection(resource_id)}, self.env)
        try:
            holder.acquire(["rename"])
            subprocess.run(["xcrun", "simctl", "rename", device["providerId"], name],
                           check=True, capture_output=True, text=True, timeout=30)
        finally:
            holder.release()

    def interrupt_lease_owner(self, resource_id: str) -> dict[str, Any]:
        self.require_owned(resource_id)
        result = subprocess.run([
            sys.executable, "-B", "-c",
            "import json,os,sys; from pathlib import Path; "
            "from tooling.acceptance.provisioners.mobile_ios_resources import MobileIOSResources; "
            "owner=MobileIOSResources(Path(sys.argv[1]), {'release':json.loads(sys.argv[2])},os.environ); "
            "owner.acquire(['release']); os._exit(86)",
            str(self.root), json.dumps(self.selection(resource_id)),
        ], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=30)
        if result.returncode != 86:
            raise GateError(f"Lease owner did not reach process-loss boundary: {result.stderr}")
        retry = MobileIOSResources(self.root, {"release": self.selection(resource_id)}, self.env)
        try:
            retry.acquire(["release"])
            return {"exitCode": 86, "reacquiredProviderId": retry.bindings["release"]["providerId"]}
        finally:
            retry.release()

    def ordinary_entry(self, resource_id: str, scratch: Path) -> dict[str, Any]:
        device = self.require_owned(resource_id)
        environment = {**self.env, "PT_DEV_TARGET_PROFILE": self.profiles[0],
                       "PT_IOS_RESOURCE": device["name"]}
        log = scratch / "ordinary-mobile-entry.log"
        with log.open("w", encoding="utf-8") as output:
            process = subprocess.Popen(
                ["/bin/bash", str(self.root / "tooling/scripts/local-dev/mobile-ios-sim.sh")],
                cwd=self.root, env=environment, stdout=output, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 1800
                while time.monotonic() < deadline:
                    text = log.read_text(encoding="utf-8")
                    if "Mobile installed on the assigned device." in text:
                        binding = self.bridge.call("resource-binding", self.profiles[0],
                                                   "--selector", device["name"])
                        return {"status": "READY", "log": str(log), "binding": binding}
                    if process.poll() is not None:
                        if process.returncode == 2 and "RESOURCE_ENDPOINT_CONFLICT" in text:
                            return {"status": "BLOCKED", "code": "RESOURCE_ENDPOINT_CONFLICT",
                                    "log": str(log), "foreignEndpointPreserved": True}
                        raise GateError(f"Ordinary Mobile fixture entry failed: {process.returncode}: {text[-4000:]}")
                    time.sleep(0.5)
                raise GateError("Ordinary Mobile fixture entry exceeded its bounded observation")
            finally:
                # Only this test's process tree; never a listener/device owner.
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)

    def share(self, resource_id: str, *, purpose: str = "Shared reader") -> dict[str, Any]:
        device = self.require_owned(resource_id)
        return self.bridge.call(
            "resource-assign", self.profiles[1], "--names-json",
            json.dumps([device["name"]]), "--purpose", purpose,
        )

    def require_owned(self, resource_id: str) -> dict[str, Any]:
        if resource_id not in self.owned:
            raise GateError("Fixture operation cannot target an unowned device")
        return self.owned[resource_id]

    def selection(self, resource_id: str, *, profile: str | None = None) -> dict[str, str]:
        device = self.require_owned(resource_id)
        return {"profile": profile or self.profiles[0], "selector": device["name"]}

    def propose(self, resource_id: str, action: str, *, target_file: Path | None = None,
                app_path: str | None = None, profile: str | None = None,
                lease=None) -> dict[str, Any]:
        self.require_owned(resource_id)
        args = ["--resource-id", resource_id, "--resource-action", action]
        if target_file:
            args += ["--target-file", str(target_file)]
        if app_path:
            args += ["--app-path", app_path]
        return self.bridge.call("resource-propose", profile or self.profiles[0], *args, lease=lease)

    def decide(self, operation: dict[str, Any], decision: str, *, lease=None) -> dict[str, Any]:
        self.require_owned(operation["resourceId"])
        if operation["profile"] not in self.profiles:
            raise GateError("Fixture decision belongs to another Profile")
        return self.bridge.call(
            "resource-decide", operation["profile"], "--operation-id", operation["id"],
            "--decision", decision, "--impact-digest", operation["impactDigest"], lease=lease,
        )

    def execute(self, operation: dict[str, Any], *, lease=None) -> dict[str, Any]:
        self.require_owned(operation["resourceId"])
        return self.bridge.call(
            "resource-mutate" if lease else "resource-execute", operation["profile"],
            "--operation-id", operation["id"], lease=lease, timeout=360,
        )

    def keychain_record(self, resource_id: str, key: str) -> dict[str, Any]:
        """Read the native owner's exact scoped row without exposing credentials."""
        device = self.require_owned(resource_id)
        database = Path.home() / "Library/Developer/CoreSimulator/Devices" / device["providerId"] / "data/Library/Keychains/keychain-2.db"
        if not database.exists():
            return {"present": False, "digest": None}
        with sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True) as connection:
            rows = connection.execute(
                "SELECT data FROM genp WHERE CAST(acct AS TEXT)=? AND CAST(svce AS TEXT)=?",
                (key, "com.peers.touch.mobile.secure-storage"),
            ).fetchall()
        if len(rows) > 1:
            raise GateError("Native scoped Keychain row is ambiguous")
        return {"present": bool(rows), "digest": sha256(bytes(rows[0][0])).hexdigest() if rows else None}

    def cleanup(self) -> dict[str, Any]:
        failures = []
        # Native/data fixture deletion has its own current impact and exact
        # fixture-only decision; normal Suite release never deletes a device.
        for resource_id in reversed(tuple(self.owned)):
            try:
                current = self.bridge.call("resource-inspect", self.profiles[0])
                instance = next(item for item in current["devices"] if item["id"] == resource_id)
                if not instance["providerId"]:
                    # Retry the exact durable intent; no new allocation request.
                    self.create()
                    current = self.bridge.call("resource-inspect", self.profiles[0])
                    instance = next(item for item in current["devices"] if item["id"] == resource_id)
                if instance.get("activeOperation"):
                    # Operation ownership may be the sharing Profile.
                    for profile in self.profiles:
                        try:
                            self.bridge.call("resource-recover", profile,
                                             "--operation-id", instance["activeOperation"], timeout=360)
                            break
                        except Exception:
                            if profile == self.profiles[-1]:
                                raise
                    current = self.bridge.call("resource-inspect", self.profiles[0])
                    instance = next(item for item in current["devices"] if item["id"] == resource_id)
                if instance["progress"] != "removed":
                    operation = self.propose(resource_id, "delete")
                    operation = self.decide(operation, "force")
                    after = self.execute(operation)
                    if after["progress"] != "removed" or after["observation"]["directoryExists"]:
                        raise GateError("Provider deletion was not independently observed")
                for profile in self.profiles:
                    assigned = self.bridge.call("resource-inspect", profile)
                    if any(item["id"] == resource_id for item in assigned["devices"]):
                        self.bridge.call("resource-detach", profile, "--resource-id", resource_id)
            except Exception as error:
                failures.append(f"{resource_id}: {error}")
        after = self.inventory()
        for provider_id, before in self.initial.items():
            if provider_id not in after or after[provider_id].get("state") != before.get("state"):
                failures.append(f"Foreign simulator changed: {provider_id}")
        if not failures:
            for file in self.files:
                file.unlink()
        if failures:
            raise GateError("Fixture cleanup failed: " + "; ".join(failures))
        return {"status": "CLEANED", "deletedOwnedDevices": len(self.owned),
                "foreignDevicesPreserved": len(self.initial)}
