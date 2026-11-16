"""Acceptance caller of the canonical Machine Dev iOS owner.

Selections are explicit Profile/readable-selector references. This module
never allocates, adopts, erases, uninstalls, shuts down or deletes a device.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence

from tooling.acceptance.core import BlockedError
from tooling.acceptance.core.reset_authority import _machine_lease_owner


class MobileIOSResources:
    def __init__(self, repo_root: Path, selections: Mapping[str, Any], env: Mapping[str, str]):
        self.repo_root = repo_root
        self.selections = selections
        self.env = dict(env)
        self.bindings: dict[str, dict[str, Any]] = {}
        self.leases: dict[str, Any] = {}

    @classmethod
    def from_environment(cls, repo_root: Path, env: Mapping[str, str]):
        try:
            selections = json.loads(env.get("PT_IOS_RESOURCE_SELECTIONS_JSON", "{}"))
        except json.JSONDecodeError as error:
            raise BlockedError(reason="iOS resource selections are invalid JSON", resource="mobile-simulator:resource-selection") from error
        if not isinstance(selections, dict):
            raise BlockedError(reason="iOS resource selections must map client labels to Profile and readable selector", resource="mobile-simulator:resource-selection")
        return cls(repo_root, selections, env)

    def command(self, action: str, profile: str, *args: str) -> list[str]:
        command = ["node", str(self.repo_root / "tooling/scripts/local-dev/machine-dev.mjs"),
                   action, "--workspace-root", str(self.repo_root), "--target-profile", profile]
        if self.env.get("PT_ENV_REPO"):
            command += ["--env-repo", self.env["PT_ENV_REPO"]]
        return [*command, *args]

    def call(self, action: str, profile: str, *args: str, lease=None, timeout: float = 180) -> dict[str, Any]:
        environment = {**self.env, **(lease.environment if lease else {})}
        descriptors = tuple(int(item["fd"]) for item in json.loads(environment.get("PT_MACHINE_LEASE_STACK_JSON", "[]")))
        result = subprocess.run(self.command(action, profile, *args), cwd=self.repo_root,
                                env=environment, pass_fds=descriptors, capture_output=True,
                                text=True, check=False, timeout=timeout)
        if result.returncode:
            try:
                reason = json.loads(result.stderr)
            except json.JSONDecodeError:
                reason = {"message": result.stderr}
            raise BlockedError(reason=f"Machine Dev {action}: {json.dumps(reason, ensure_ascii=False)}",
                               resource="mobile-simulator:machine-resource")
        return json.loads(result.stdout)

    def acquire(self, client_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        for client_id in client_ids:
            selection = self.selections.get(client_id)
            if not isinstance(selection, dict) or set(selection) != {"profile", "selector"} or not all(
                isinstance(selection[field], str) and selection[field].strip() for field in ("profile", "selector")
            ):
                raise BlockedError(reason=f"Select a Profile and readable resource name/purpose for iOS client {client_id!r} using PT_IOS_RESOURCE_SELECTIONS_JSON",
                                   resource="mobile-simulator:resource-selection")
            self.bindings[client_id] = self.call("resource-binding", selection["profile"], "--selector", selection["selector"])
        ids = [binding["providerId"] for binding in self.bindings.values()]
        if len(set(ids)) != len(ids):
            raise BlockedError(reason="Concurrent iOS clients require distinct assigned devices; sharing across Profiles remains allowed",
                               resource="mobile-simulator:concurrent-device")
        # A partial acquisition remains in self.leases and is released by the
        # original Provisioner's already-registered cleanup callback.
        for client_id, binding in sorted(self.bindings.items(), key=lambda item: item[1]["providerId"]):
            profile = self.selections[client_id]["profile"]
            command = self.command("validate-lease", profile, "--resource-kind", "simulator.ios",
                                   "--resource-id", binding["providerId"], "--budget-seconds", "7200")
            request = self.call("validate-lease", profile, "--resource-kind", "simulator.ios",
                                "--resource-id", binding["providerId"], "--budget-seconds", "7200")
            command += ["--expected-branch", request["source"]["branch"], "--expected-head", request["source"]["head"],
                        "--expected-workspace-digest", request["source"]["workspaceDigest"]]
            try:
                self.leases[client_id] = _machine_lease_owner().MachineLease(request, command).acquire()
            except _machine_lease_owner().MachineLeaseError as error:
                raise BlockedError(reason=f"Machine Dev iOS lease: {error.code}: {error}",
                                   resource="mobile-simulator:physical-device") from error
        return {
            client_id: {**binding, "udid": binding["providerId"], "name": binding["name"],
                        "runtime": binding["observation"]["runtimeName"]}
            for client_id, binding in self.bindings.items()
        }

    def mutate(self, client_id: str, action: str, *, target_file: Path | None = None, app_path: str | None = None):
        binding = self.bindings[client_id]
        profile = self.selections[client_id]["profile"]
        lease = self.leases[client_id]
        arguments = ["--resource-id", binding["id"], "--resource-action", action]
        if target_file is not None:
            arguments += ["--target-file", str(target_file)]
        if app_path is not None:
            arguments += ["--app-path", app_path]
        operation = self.call("resource-propose", profile, *arguments, lease=lease)
        if operation["status"] != "ready":
            raise BlockedError(reason=f"Specific overwrite decision required: {json.dumps(operation, ensure_ascii=False)}",
                               resource="mobile-simulator:resource-overwrite")
        return self.call("resource-mutate", profile, "--operation-id", operation["id"], lease=lease, timeout=360)

    def boot(self, client_id: str):
        return self.mutate(client_id, "boot")

    def build_source(self):
        sources = [binding["source"] for binding in self.bindings.values()]
        if not sources or any(source != sources[0] for source in sources):
            raise BlockedError(reason="iOS clients must bind the same current workspace source",
                               resource="mobile-simulator:native-source")
        return sources[0]

    def child_environment(self):
        frames = json.loads(self.env.get("PT_MACHINE_LEASE_STACK_JSON", "[]"))
        for lease in self.leases.values():
            frame = json.loads(lease.environment["PT_MACHINE_LEASE_STACK_JSON"])[-1]
            frames.append(frame)
        return {"PT_MACHINE_LEASE_STACK_JSON": json.dumps(frames)}

    def install(self, udid: str, app_path: str, bundle_id: str, target_file: Path):
        client_id = next(key for key, value in self.bindings.items() if value["providerId"] == udid)
        target_file.write_text(json.dumps({"bundleId": bundle_id, "source": self.bindings[client_id]["source"],
                                           "purpose": "Acceptance"}, sort_keys=True), encoding="utf-8")
        return self.mutate(client_id, "install", target_file=target_file, app_path=app_path)

    def release(self):
        failures = []
        for client_id in reversed(tuple(self.leases)):
            try:
                self.leases[client_id].release()
                del self.leases[client_id]
            except Exception as error:
                failures.append(f"{client_id}: {error}")
        if failures:
            raise RuntimeError("iOS lease release failed: " + "; ".join(failures))
