"""Source-only Search injection and ownership checks; no native proof claim."""
from __future__ import annotations

import ast
import json
import re

from tooling.acceptance.core import AcceptanceGate, REPO_ROOT

FEATURE = "chat-device-search"
GATES = {"chat-device-search-contract", "chat-device-search-native-e2e",
         "chat-mobile-device-search-native-e2e"}


def read(path: str) -> str:
    return (REPO_ROOT / path).read_text()


def document(path: str) -> dict:
    return json.loads(read(f"tooling/acceptance/{path}"))


class DeviceSearchContractGate(AcceptanceGate):
    gate_id = "chat-device-search-contract"
    spec = (FEATURE,)
    phase = "chat-device-search-contract"

    def run(self) -> dict:
        feature = document(f"features/{FEATURE}.yaml")
        capabilities = document("capabilities/chat.yaml")["capabilities"]
        capability = next(item for item in capabilities if item["id"] == FEATURE)
        rule = next(item for item in document("registry.yaml")["rules"] if item["id"] == FEATURE)
        mobile = document("features/chat-mobile-device-search.yaml")
        mobile_rule = next(item for item in document("registry.yaml")["rules"]
                           if item["id"] == mobile["id"])
        self.assert_condition("injection_graph", FEATURE in document("domains/chat.yaml")["capabilities"]
                              and set(capability["features"]) == {FEATURE, mobile["id"]}
                              and set(feature["required_gates"]) == set(rule["require"])
                              and set(mobile["required_gates"]) == set(mobile_rule["require"])
                              and set(capability["required_gates"]) == (
                                  set(feature["required_gates"]) | set(mobile["required_gates"])) == GATES)
        native = document("gates.yaml")["gates"]["chat-device-search-native-e2e"]
        self.assert_condition("native_environment_reused",
                              native["environment"] == native["provisioner"] == "chat-storage-native"
                              and "device_search_runner" in native["command"]
                              and "device_search_e2e" in native["command"]
                              and "chat-device-search-native-e2e" in read(
                                  "tooling/acceptance/provisioners/chat_storage_native.py"))
        ports = read("packages/search-core/src/ports.rs")
        self.assert_condition("contributor_contract", all(
            re.search(r"\bfn\s+" + method + r"(?:<[^>]*>)?\s*\(", ports)
            for method in ("query", "hydrate", "resolve")
        ))
        cache = read("packages/search-core/src/cache.rs")
        self.assert_condition("cache_authority_boundary", all(
            name in cache for name in ("read_scope", "invalidate", "fresh_until", "validator")
        ))
        proto = read("model/domain/search/search.proto")
        self.assert_condition("wire_authority_and_hydration", all(name in proto for name in (
            "authority_namespace", "content_revision", "ResourceAnchor",
            "UnchangedProjection", "UnavailableResource", "RetryableRead", "ReadValidity",
        )))
        runtime = read("apps/desktop/src/runtimes/searchRuntime.ts")
        queries = read("apps/desktop/src/runtimes/searchQueries.ts")
        service = read("apps/desktop/src/services/search.ts")
        invalidations = read("apps/desktop/src/runtimes/searchInvalidations.ts")
        self.assert_condition("runtime_scope_and_validity", all(name in runtime + queries + service + invalidations for name in (
            "sessionEpoch", "readScope", "sourceRevision", "expiresAtUnixMs",
            "leaseUntilUnixMs", "messaging:projection-changed", "clearSearchQueries",
        )) and "client.clear()" in queries and all(name in queries for name in (
            "QueryClient", "QueryObserver", "keepPreviousData",
        )))
        runner = read("tooling/acceptance/gates/chat/device_search_runner.py")
        tree = ast.parse(runner)
        self.assert_condition("journey_has_one_runtime", sum(
            isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id == "selected_native_runtime" for node in ast.walk(tree)
        ) == 1 and "prove_direction(" not in runner and "finally:" in runner
            and "cleanup_clients()" in runner)
        self.assert_condition("no_source_state_fixture_substitute", not any(
            name in runner for name in ("sqlite3", "sqlcipher_fixture", "INSERT INTO", "UPDATE messaging_")
        ))
        validator = read("tooling/acceptance/gates/chat/device_search_e2e.py")
        self.assert_condition("native_evidence_required", all(name in validator for name in (
            "validate_report(", "expected_journey=JOURNEY_ID", "UI_ASSERTIONS",
            "source_ref.run_id", "read_counts(lines[:length])", "errorCode",
        )))
        self.assert_condition("retired_search_page_absent", not any(
            (REPO_ROOT / "apps/desktop/src/pages" / name).exists()
            for name in ("SearchPage.tsx", "SearchPageContainer.tsx", "useActiveSearchStore.ts")
        ))
        return {"verificationClass": "SOURCE_CONTRACT", "nativeProof": "UNPROVEN"}


if __name__ == "__main__":
    raise SystemExit(DeviceSearchContractGate().execute())
