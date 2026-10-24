"""Social-owned Search injection contract; native proof remains separate."""
from __future__ import annotations

import json
from tooling.acceptance.core import AcceptanceGate, REPO_ROOT


def read(path: str) -> str:
    return (REPO_ROOT / path).read_text()


def document(path: str) -> dict:
    return json.loads(read(f"tooling/acceptance/{path}"))


class SocialContentSearchContractGate(AcceptanceGate):
    gate_id = "social-content-search-contract"
    spec = ("social-content-search",)
    phase = "Social content Search contract"

    def run(self) -> dict:
        feature = document("features/social-content-search.yaml")
        capability = next(item for item in document("capabilities/social.yaml")["capabilities"]
                          if item["id"] == feature["id"])
        rule = next(item for item in document("registry.yaml")["rules"] if item["id"] == feature["id"])
        gates = set(feature["required_gates"])
        self.assert_condition("injection_graph",
                              feature["id"] in document("domains/social.yaml")["capabilities"]
                              and capability["features"] == [feature["id"]]
                              and set(capability["required_gates"]) == set(rule["require"]) == gates)
        catalog = document("gates.yaml")["gates"]
        self.assert_condition("native_runtime_owners",
                              catalog["social-content-search-desktop-native-e2e"]["provisioner"]
                              == "chat-storage-native"
                              and catalog["social-content-search-mobile-native-e2e"]["provisioner"]
                              == "chat-mobile-search-simulator")
        service = read("apps/station/app/subserver/social/application/public_search_hydration.go")
        policy = read("apps/station/app/subserver/social/application/private_read_policy.go")
        self.assert_condition("original_read_owner", "NewPublicReadPort" in service
                              and "validatePrivateContentViewer" in policy
                              and "store.CheckMomentReadPolicy" in policy)
        wire = read("model/domain/search/search.proto")
        self.assert_condition("source_and_read_metadata", all(marker in wire for marker in (
            "source_id", "no_store", "owner_check_required", "ResourceAnchor",
            "policy_revision", "content_revision", "SOCIAL_COMMENT",
        )))
        for platform, path in (
            ("desktop", "apps/desktop/src/runtimes/searchInvalidations.ts"),
            ("mobile", "apps/mobile/src/runtimes/searchInvalidations.ts"),
        ):
            self.assert_condition(f"{platform}_owner_invalidation",
                                  all(source in read(path) for source in (
                                      "device.social", "station.social.public", "device.messaging",
                                  )))
        self.assert_condition("governed_knowledge", (
            REPO_ROOT / "docs/knowledge/invariants/search-original-authority-and-source-bound-open.md"
        ).is_file())
        return {"verificationClass": "SOURCE_CONTRACT", "nativeProof": "UNPROVEN"}


if __name__ == "__main__":
    raise SystemExit(SocialContentSearchContractGate().execute())
