"""One bounded native resource Journey shared by development and formal Gates."""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate, BlockedError, EnvironmentContract, GateError,
    ProvisioningState, REPO_ROOT,
)
from tooling.acceptance.provisioners.mobile_ios_resources import MobileIOSResources
from tooling.acceptance.provisioners.mobile_simulator import (
    SelectedMobileSimulatorProvisioner, SimulatorClientSpec,
)
from tooling.acceptance.provisioners.profile_ios_fixture import ProfileIOSFixture


class ResourceDependencyJourney:
    """Fixture-only decisions; each entry owns one independent native Journey."""

    def __init__(self, gate: AcceptanceGate):
        self.gate = gate
        self.events: list[dict[str, Any]] = []
        self.gate.report.runtime["steps"] = self.events

    def observe(self, requirement: str, condition: bool, value: Any) -> None:
        self.events.append({"requirement": requirement, "status": "pass" if condition else "fail",
                            "observation": value})
        self.gate.assert_condition(requirement, condition)

    def expect_blocked(self, requirement: str, operation, code: str) -> None:
        try:
            operation()
        except BlockedError as error:
            self.observe(requirement, code in str(error), {"reason": error.reason})
        else:
            raise GateError(f"{requirement}: operation was not refused")

    def discovery_journey(self, fixture: ProfileIOSFixture) -> None:
        first, second = fixture.owned.values()
        fixture.bridge.call("resource-detach", fixture.profiles[0], "--resource-id", second["id"])
        other = fixture.share(second["id"])
        current = fixture.bridge.call("resource-inspect", fixture.profiles[0])
        self.observe("LDCP-R02:equal-count-distinct", len(current["devices"]) == len(other["devices"]) == 1
                     and current["devices"][0]["id"] != other["devices"][0]["id"],
                     {"first": current["devices"][0]["id"], "second": other["devices"][0]["id"]})
        fixture.bridge.call("resource-assign", fixture.profiles[0], "--names-json",
                            json.dumps([second["name"]]), "--purpose", "Restored fixture reference")
        fixture.bridge.call("resource-detach", fixture.profiles[1], "--resource-id", second["id"])
        before = fixture.bridge.call("resource-discover", fixture.profiles[0])
        selection = next(item for item in before["devices"] if item["id"] == first["id"])
        duplicate = f"Resource proof duplicate {fixture.tag}"
        try:
            fixture.rename(first["id"], duplicate)
            fixture.rename(second["id"], duplicate)
            self.expect_blocked("LDCP-R10:ambiguous-name",
                lambda: fixture.bridge.call("resource-assign", fixture.profiles[1],
                    "--names-json", json.dumps([duplicate]), "--purpose", "Ambiguous fixture"),
                "RESOURCE_NAME_AMBIGUOUS")
            self.expect_blocked("LDCP-R10:renamed-snapshot",
                lambda: fixture.bridge.call("resource-assign", fixture.profiles[1],
                    "--selection-keys-json", json.dumps([selection["selectionKey"]]),
                    "--snapshot", before["snapshot"], "--purpose", "Renamed fixture"),
                "RESOURCE_SELECTION_STALE")
            binding = fixture.bridge.call("resource-binding", fixture.profiles[0], "--selector", first["name"])
            self.observe("LDCP-R10:renamed-identity", binding["id"] == first["id"]
                         and binding["providerId"] == first["providerId"], binding["observation"]["name"])
        finally:
            for device in (first, second):
                fixture.rename(device["id"], device["preparation"]["providerName"])

    def partial_lock_journey(self, fixture: ProfileIOSFixture) -> None:
        lower, upper = sorted(fixture.owned.values(), key=lambda device: device["providerId"])
        for device in (lower, upper):
            fixture.share(device["id"])
        holder = MobileIOSResources(REPO_ROOT, {"upper": fixture.selection(upper["id"])}, os.environ)
        contender = MobileIOSResources(REPO_ROOT, {
            "lower": fixture.selection(lower["id"], profile=fixture.profiles[1]),
            "upper": fixture.selection(upper["id"], profile=fixture.profiles[1]),
        }, os.environ)
        retry = MobileIOSResources(REPO_ROOT, {"lower": fixture.selection(lower["id"])}, os.environ)
        try:
            holder.acquire(["upper"])
            self.expect_blocked("LDCP-R03:partial-acquisition", lambda: contender.acquire(["lower", "upper"]),
                                "PHYSICAL_RESOURCE_CONFLICT")
            self.observe("LDCP-R07:partial-lease-owned", len(contender.leases) == 1, list(contender.leases))
            contender.release()
            retry.acquire(["lower"])
            self.observe("LDCP-R07:partial-lease-release", len(retry.leases) == 1, list(retry.leases))
        finally:
            retry.release()
            contender.release()
            holder.release()
        # Restore the desired sharing arrangement after the contention exercise.
        for device in (lower, upper):
            fixture.bridge.call("resource-detach", fixture.profiles[1], "--resource-id", device["id"])

    def exercise(self, kind: str, *, formal: bool) -> dict[str, Any]:
        fixture = ProfileIOSFixture()
        source = fixture.binding["source"]
        # The source fence precedes fixture creation. Current dirty development
        # can run a functional Journey, never a clean-source formal proof.
        observed = subprocess.run(
            ["git", "status", "--porcelain"], cwd=REPO_ROOT,
            text=True, capture_output=True, check=True, timeout=15,
        ).stdout
        if formal and observed:
            raise BlockedError(reason="Native formal resource proof requires current clean source; uncommitted source remains development evidence",
                               resource="profile-resource:formal-source")
        runtime = None
        session = None
        result = {}
        with tempfile.TemporaryDirectory(prefix="pt-resource-native-") as directory:
            scratch = Path(directory)
            try:
                fixture.prepare()
                preparation = fixture.interrupt("preparation", scratch)
                self.observe("LDCP-R04:preparation-process-loss",
                             len(fixture.owned) == 2 and all(not item["providerId"] for item in fixture.owned.values()),
                             preparation)
                created = fixture.interrupt("create", scratch)
                inventory = fixture.inventory()
                names = {item["preparation"]["providerName"] for item in fixture.owned.values()}
                self.observe("LDCP-R04:create-before-publication",
                             len([item for item in inventory.values() if item["name"] in names]) == 1
                             and all(not item["providerId"] for item in fixture.owned.values()), created)
                fixture.create()
                first = next(iter(fixture.owned.values()))
                resource_id = first["id"]
                self.observe("LDCP-R01:explicit-count", len(fixture.owned) == 2, {
                    "profile": fixture.profiles[0], "devices": [
                        {"id": device["id"], "name": device["name"], "providerId": device["providerId"]}
                        for device in fixture.owned.values()
                    ],
                })
                fixture.create()
                self.observe("LDCP-R04:preparation-retry", len(fixture.owned) == 2, fixture.preparation_id)
                self.discovery_journey(fixture)
                self.partial_lock_journey(fixture)
                lease_recovery = fixture.interrupt_lease_owner(resource_id)
                self.observe("LDCP-R04:lease-owner-process-loss",
                             lease_recovery["reacquiredProviderId"] == first["providerId"], lease_recovery)
                ordinary = fixture.ordinary_entry(list(fixture.owned)[1], scratch)
                self.gate.report.runtime["ordinaryMobileEntry"] = ordinary
                self.gate.report.add_evidence_file("ordinary-mobile-entry", Path(ordinary["log"]))
                if ordinary["status"] == "BLOCKED":
                    self.gate.report.runtime["unprovenRequirements"] = [
                        "LDCP-R06:full ordinary Mobile launch is blocked by an existing foreign dev endpoint",
                    ]
                else:
                    self.observe("LDCP-R06:ordinary-native-entry",
                                 ordinary["binding"]["content"]["verified"] is True, ordinary["binding"]["content"])
                shared = fixture.share(resource_id)
                self.observe("LDCP-R02:same-instance", shared["devices"][0]["providerId"] == first["providerId"],
                             shared["devices"][0]["sharedProfiles"])
                discovery = fixture.bridge.call("resource-discover", fixture.profiles[1])
                selected = next(item for item in discovery["devices"] if item["id"] == resource_id)
                self.observe("LDCP-R10:readable-discovery", bool(selected["name"]) and len(selected["sharedProfiles"]) == 2,
                             {"name": selected["name"], "sharedProfiles": selected["sharedProfiles"]})
                self.expect_blocked(
                    "LDCP-R10:stale-selection",
                    lambda: fixture.bridge.call("resource-assign", fixture.profiles[1],
                        "--selection-keys-json", json.dumps([selected["selectionKey"]]),
                        "--snapshot", "stale", "--purpose", "Stale fixture request"),
                    "RESOURCE_SELECTION_STALE",
                )

                environment = {
                    "PT_IOS_RESOURCE_SELECTIONS_JSON": json.dumps({
                        "resource-proof": fixture.selection(resource_id),
                    }),
                }
                runtime = SelectedMobileSimulatorProvisioner(
                    EnvironmentContract.from_yaml(REPO_ROOT / "tooling/acceptance/environments/mobile-simulator.yaml"),
                    clients=[SimulatorClientSpec("resource-proof", "ios", "resource-proof",
                        "tauri-ios-simulator", ("wda-local", "mjpeg", "webview"), "resource-proof")],
                    runtime_source_commit=source["head"],
                    build_environment=environment,
                )
                manifest = runtime.provision(self.gate.gate_id)
                self.gate.report.runtime["nativeManifest"] = manifest.to_dict()
                if manifest.state != ProvisioningState.FIXTURE_READY:
                    raise BlockedError(reason=f"Original iOS Provisioner blocked: {manifest.to_dict()}",
                                       resource="profile-resource:native-runtime")
                native_source = runtime._ios_resources.build_source()
                application = manifest.simulator_resources["applications"]["ios"]
                installed = fixture.bridge.call("resource-binding", fixture.profiles[0], "--selector", first["name"])
                self.observe("LDCP-R02:native-content", installed["content"]["verified"] is True,
                             {"content": installed["content"], "source": native_source})
                self.expect_blocked(
                    "LDCP-R03:physical-lock",
                    lambda: MobileIOSResources(REPO_ROOT, {"other": fixture.selection(resource_id, profile=fixture.profiles[1])},
                        os.environ).acquire(["other"]),
                    "PHYSICAL_RESOURCE_CONFLICT",
                )
                session = runtime.create_appium_session(manifest, "resource-proof")
                session.start()
                session.wait_for_ready()
                session.switch_to_app_webview()
                session.require_harness(["build.identity", "runtime.prepareActorIdentity"])
                identity = session.call_action("build.identity")
                self.observe("LDCP-R02:native-source", identity["sourceCommit"] == native_source["head"]
                    and identity["workspaceDigest"] == native_source["workspaceDigest"]
                    and identity["applicationId"] == "com.peers.touch.mobile", identity)
                key = "mobile-crypto-identity.v1.identity." + os.urandom(16).hex()
                self.observe("LDCP-R05:fresh-keychain", not fixture.keychain_record(resource_id, key)["present"], {"present": False})
                prepared = session.call_action("runtime.prepareActorIdentity", {
                    "storageKey": key, "seedBase64": base64.b64encode(os.urandom(32)).decode("ascii"),
                })
                retained = fixture.keychain_record(resource_id, key)
                self.observe("LDCP-R05:native-keychain", prepared == {"prepared": True} and retained["present"], retained)
                screenshot = scratch / "native.png"
                screenshot.write_bytes(session.screenshot_bytes())
                self.gate.report.add_evidence_file("resource-native-screenshot", screenshot)
                session.stop()
                session = None
                app_copy = scratch / "Peers.app"
                shutil.copytree(application["artifact"], app_copy, symlinks=True)
                runtime.cleanup()
                runtime = None
                self.observe("LDCP-R07:release-retains", fixture.keychain_record(resource_id, key) == retained,
                             fixture.keychain_record(resource_id, key))
                target_file = scratch / "target.json"
                target_file.write_text(json.dumps({
                    "bundleId": "com.peers.touch.mobile", "source": native_source, "purpose": "Replacement fixture",
                }), encoding="utf-8")
                refused = fixture.propose(resource_id, "install", target_file=target_file,
                                          app_path=str(app_copy), profile=fixture.profiles[1])
                self.observe("LDCP-R08:notice", refused["status"] == "pending"
                    and len(refused["impact"]["sharedProfiles"]) == 2, refused["impact"])
                fixture.decide(refused, "decline")
                self.observe("LDCP-R08:decline-retains", fixture.keychain_record(resource_id, key) == retained,
                             fixture.keychain_record(resource_id, key))
                if kind in {"sharing", "overwrite", "all"}:
                    operation = fixture.propose(resource_id, "install", target_file=target_file,
                                                app_path=str(app_copy), profile=fixture.profiles[1])
                    operation = fixture.decide(operation, "force")
                    # A reference change after confirmation must invalidate force.
                    fixture.share(resource_id, purpose="Changed reader purpose")
                    self.expect_blocked("LDCP-R09:reference-race", lambda: fixture.execute(operation),
                                        "RESOURCE_DECISION_STALE")
                    for phase in ("install-begin", "install-provider"):
                        operation = fixture.propose(resource_id, "install", target_file=target_file,
                                                    app_path=str(app_copy), profile=fixture.profiles[1])
                        operation = fixture.decide(operation, "force")
                        fault = fixture.interrupt(phase, scratch, operation=operation)
                        after = fixture.bridge.call("resource-recover", fixture.profiles[1],
                                                    "--operation-id", operation["id"], timeout=360)
                        self.observe(f"LDCP-R04:{phase}-recovery", not after.get("activeOperation")
                                     and after["content"]["verified"] is False, fault)
                        self.observe(f"LDCP-R05:{phase}-retains", fixture.keychain_record(resource_id, key) == retained,
                                     fixture.keychain_record(resource_id, key))
                    stale = fixture.propose(resource_id, "install", target_file=target_file,
                                            app_path=str(app_copy), profile=fixture.profiles[1])
                    stale = fixture.decide(stale, "force")
                    self.expect_blocked("LDCP-R09:no-lock-bypass",
                        lambda: fixture.bridge.call("resource-mutate", fixture.profiles[1],
                            "--operation-id", stale["id"]), "PT_MACHINE_LEASE_FD")
                    operation = fixture.propose(resource_id, "install", target_file=target_file,
                                                app_path=str(app_copy), profile=fixture.profiles[1])
                    operation = fixture.decide(operation, "force")
                    after = fixture.execute(operation)
                    self.observe("LDCP-R08:force-exact", after["content"]["verified"] is True
                        and after["lastWriter"]["profile"] == fixture.profiles[1], after["content"])
                    self.observe("LDCP-R05:install-retains-keychain", fixture.keychain_record(resource_id, key) == retained,
                                 fixture.keychain_record(resource_id, key))
                    self.expect_blocked("LDCP-R09:content-race", lambda: fixture.execute(stale),
                                        "RESOURCE_DECISION_STALE")
                    if kind in {"overwrite", "all"}:
                        reset = fixture.propose(resource_id, "reset", profile=fixture.profiles[1])
                        reset = fixture.decide(reset, "force")
                        fixture.execute(reset)
                        self.observe("LDCP-R05:explicit-reset", not fixture.keychain_record(resource_id, key)["present"],
                                     fixture.keychain_record(resource_id, key))
                if kind == "sharing":
                    fixture.bridge.call("resource-detach", fixture.profiles[1], "--resource-id", resource_id)
                    self.observe("LDCP-R07:detach-retains", fixture.keychain_record(resource_id, key) == retained,
                                 fixture.keychain_record(resource_id, key))
                result = {"source": native_source, "nativeIdentity": identity,
                          "journey": kind, "verificationClass": "FUNCTIONAL_CHECK",
                          "formalSource": formal, "observedRequirements": [event["requirement"] for event in self.events]}
            finally:
                failures = []
                if session:
                    try:
                        session.stop()
                    except Exception as error:
                        failures.append(f"Appium session: {error}")
                if runtime:
                    try:
                        runtime.cleanup()
                    except Exception as error:
                        failures.append(f"Original iOS Provisioner: {error}")
                try:
                    cleanup = fixture.cleanup()
                except Exception as error:
                    cleanup = {"status": "FAILED", "reason": str(error)}
                    failures.append(f"Fixture: {error}")
                self.gate.report.runtime["resourceCleanup"] = cleanup
                record = scratch / "journey.json"
                record.write_text(json.dumps({"steps": self.events, "cleanup": cleanup}, sort_keys=True), encoding="utf-8")
                self.gate.report.add_evidence_file("resource-provider-native-journey", record)
                if failures:
                    raise GateError("Resource Journey cleanup failed: " + "; ".join(failures))
                if fixture.owned:
                    self.observe("LDCP-R07:owned-delete", cleanup["status"] == "CLEANED", cleanup)
        if self.gate.report.runtime.get("unprovenRequirements"):
            raise BlockedError(
                reason="Ordinary native Mobile launch was refused because a foreign installed app uses this workspace's dev endpoint; its app and server were preserved",
                resource="profile-resource:ordinary-dev-endpoint",
            )
        return result


class FunctionalGate(AcceptanceGate):
    gate_id = "profile-resource-native-functional"

    def run(self) -> dict[str, Any]:
        if self.e2e_preflight["executionPolicy"] != "development":
            raise BlockedError(reason="Functional entry requires the original runner's development execution policy",
                               resource="profile-resource:development-policy")
        return ResourceDependencyJourney(self).exercise("all", formal=False)


def main() -> int:
    return FunctionalGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
