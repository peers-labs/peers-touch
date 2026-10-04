#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name("impact.py")
SKILL_ROOT = SCRIPT.parents[1]
SPEC = importlib.util.spec_from_file_location("agent_development_impact", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
POLICY = MODULE.load_object(SKILL_ROOT / "impact-policy.json")
REPLAY = MODULE.load_object(SKILL_ROOT / "fixtures" / "mca-p04-replay.json")


def fingerprint(**overrides):
    value = {
        "claimId": "V2-agent-cli-provider-primary",
        "closureContractDigest": "closure-a",
        "affectedComponentDigests": {
            "stationRuntime": "station-a",
            "desktopHost": "host-a",
            "desktopUi": "ui-a",
            "sharedContract": "contract-a",
        },
        "gateImplementationDigest": "gate-a",
        "runtimeProfileDigest": "runtime-a",
        "sourceCommit": "audit-only-a",
    }
    value.update(overrides)
    return value


class AgentImpactTests(unittest.TestCase):
    def classify(self, *paths, before=None, current=None):
        return MODULE.classify_paths(
            list(paths),
            policy=POLICY,
            before=before,
            current=current,
        )

    def test_replay_contains_all_eighteen_forensic_commits(self) -> None:
        self.assertEqual(len(REPLAY["cases"]), 18)
        self.assertEqual(
            len({case["commit"] for case in REPLAY["cases"]}),
            18,
        )
        self.assertEqual(
            set(POLICY["impactClasses"]),
            {
                "STATION_RUNTIME",
                "DESKTOP_HOST",
                "DESKTOP_UI",
                "SHARED_CONTRACT",
                "ACCEPTANCE_HARNESS",
                "WORKFLOW_TOOLING",
                "DOCS_ONLY",
            },
        )
        self.assertEqual(
            set(POLICY["productImpactClasses"]),
            {
                "STATION_RUNTIME",
                "DESKTOP_HOST",
                "DESKTOP_UI",
                "SHARED_CONTRACT",
            },
        )
        self.assertEqual(
            POLICY["proofIdentityDimensions"],
            [
                "claimId",
                "closureContractDigest",
                "affectedComponentDigests",
                "gateImplementationDigest",
                "runtimeProfileDigest",
            ],
        )
        self.assertEqual(
            {
                item["classification"]
                for item in POLICY["failureSignals"]["orderedChecks"]
            },
            {
                "PRODUCT_DEFECT",
                "HARNESS_DEFECT",
                "WORKFLOW_DEFECT",
                "ENVIRONMENT_BLOCKER",
                "EVIDENCE_INTEGRITY",
            },
        )
        self.assertEqual(
            set(POLICY["classDecisions"]),
            set(POLICY["impactClasses"]),
        )
        MODULE.validate_policy(POLICY)

    def test_policy_rejects_unknown_product_class(self) -> None:
        invalid = json.loads(json.dumps(POLICY))
        invalid["productImpactClasses"].append("NEW_UNREVIEWED_CLASS")

        with self.assertRaisesRegex(
            MODULE.ImpactError,
            "declared impact classes",
        ):
            MODULE.validate_policy(invalid)

    def test_mca_p04_r2_reuses_product_proof_without_station_deploy(self) -> None:
        case = next(
            item
            for item in REPLAY["cases"]
            if item["commit"].startswith("545c165eb")
        )
        result = self.classify(*case["changedPaths"])

        self.assertEqual(
            result["changeKinds"],
            ["DOCS_ONLY", "WORKFLOW_TOOLING"],
        )
        self.assertEqual(result["kind"], "peers-touch-module-impact")
        self.assertEqual(result["moduleId"], "agent")
        self.assertEqual(result["requirements"]["targetSelectors"], [])
        self.assertFalse(result["classification"]["formalGateRequired"])
        self.assertFalse(result["classification"]["ownershipSplitRequired"])
        self.assertEqual(result["proof"]["action"], "REUSE_CANDIDATE")

    def test_mca_p04_r3_reuses_product_proof_without_station_deploy(self) -> None:
        case = next(
            item
            for item in REPLAY["cases"]
            if item["commit"].startswith("9112be8c2")
        )
        result = self.classify(*case["changedPaths"])

        self.assertEqual(
            result["changeKinds"],
            ["DOCS_ONLY", "WORKFLOW_TOOLING"],
        )
        self.assertEqual(result["requirements"]["targetSelectors"], [])
        self.assertFalse(result["classification"]["formalGateRequired"])
        self.assertFalse(result["classification"]["ownershipSplitRequired"])
        self.assertEqual(result["proof"]["action"], "REUSE_CANDIDATE")

    def test_station_change_requires_station_deploy_and_formal_proof(self) -> None:
        result = self.classify(
            "apps/station/app/subserver/agent/service/turn_service.go"
        )

        self.assertEqual(result["changeKinds"], ["STATION_RUNTIME"])
        self.assertEqual(result["requirements"]["targetSelectors"], ["station"])
        self.assertTrue(result["classification"]["formalGateRequired"])
        self.assertTrue(
            result["classification"]["sourceFreezeBeforeFormalGate"]
        )

    def test_acceptance_change_reproves_without_product_deploy(self) -> None:
        result = self.classify(
            "tooling/acceptance/gates/agent/native_agent_runner.py"
        )

        self.assertEqual(result["changeKinds"], ["ACCEPTANCE_HARNESS"])
        self.assertEqual(
            result["requirements"]["targetSelectors"],
            ["acceptance-suite-runtime"],
        )
        self.assertTrue(result["classification"]["formalGateRequired"])

    def test_generated_agent_proto_is_a_shared_contract(self) -> None:
        result = self.classify(
            "apps/desktop/src/gen/proto/domain/agent/agent_pb.ts"
        )

        self.assertEqual(result["changeKinds"], ["SHARED_CONTRACT"])
        self.assertEqual(
            result["requirements"]["targetSelectors"],
            ["desktop-native", "mobile", "station"],
        )

    def test_desktop_ui_rule_is_limited_to_agent_owned_surfaces(self) -> None:
        agent_ui = self.classify(
            "apps/desktop/src/components/settings/AgentGrowthTab.tsx",
            "apps/desktop/src/components/composer/agentCapabilityWarning.ts",
        )
        unrelated = self.classify(
            "apps/desktop/src/components/settings/About.tsx"
        )

        self.assertEqual(agent_ui["changeKinds"], ["DESKTOP_UI"])
        self.assertEqual(
            agent_ui["requirements"]["targetSelectors"],
            ["desktop-native"],
        )
        self.assertEqual(unrelated["state"], "POLICY_REQUIRED")
        self.assertEqual(
            unrelated["classification"]["unclassifiedPaths"],
            ["apps/desktop/src/components/settings/About.tsx"],
        )

    def test_generic_runtime_profile_routes_to_acceptance_owner(self) -> None:
        result = self.classify("tooling/scripts/deploy/deploy.sh")

        self.assertEqual(result["state"], "NOT_APPLICABLE")
        self.assertEqual(result["changeKinds"], [])
        self.assertEqual(result["requirements"]["targetSelectors"], [])
        self.assertEqual(result["proof"]["action"], "POLICY_REQUIRED")

    def test_workflow_change_can_reuse_matching_proof_tuple(self) -> None:
        before = fingerprint()
        current = fingerprint(sourceCommit="audit-only-b")
        result = self.classify(
            "tooling/skills/pt-agent-development/SKILL.md",
            before=before,
            current=current,
        )

        self.assertEqual(result["proof"]["action"], "REUSE_ALLOWED")
        self.assertEqual(result["proof"]["gitHeadRole"], "AUDIT_ONLY")
        self.assertFalse(result["classification"]["formalGateRequired"])

    def test_closure_digest_change_invalidates_docs_only_reuse(self) -> None:
        before = fingerprint()
        current = fingerprint(closureContractDigest="closure-b")
        result = self.classify(
            "docs/architecture/agent/modern-chat-agent/design.md",
            before=before,
            current=current,
        )

        self.assertEqual(result["proof"]["action"], "REPROVE_REQUIRED")
        self.assertEqual(
            result["proof"]["mismatchedDimensions"],
            ["closureContractDigest"],
        )
        self.assertTrue(result["classification"]["formalGateRequired"])

    def test_unchanged_station_digest_is_evidence_integrity_failure(self) -> None:
        before = fingerprint()
        current = fingerprint(sourceCommit="audit-only-b")
        result = self.classify(
            "apps/station/app/subserver/agent/service/turn_service.go",
            before=before,
            current=current,
        )

        self.assertEqual(result["state"], "POLICY_REQUIRED")
        self.assertEqual(
            result["proof"]["failureClassification"],
            "EVIDENCE_INTEGRITY",
        )
        self.assertEqual(
            result["proof"]["staleDimensions"],
            ["affectedComponentDigests.stationRuntime"],
        )

    def test_unclassified_path_fails_closed(self) -> None:
        result = self.classify("unowned/new-agent-file.txt")

        self.assertEqual(result["state"], "POLICY_REQUIRED")
        self.assertEqual(
            result["classification"]["unclassifiedPaths"],
            ["unowned/new-agent-file.txt"],
        )

    def test_non_agent_acceptance_path_is_not_claimed_by_agent_policy(self) -> None:
        result = self.classify(
            "tooling/acceptance/gates/chat/native_two_client_e2e.py"
        )

        self.assertEqual(result["state"], "POLICY_REQUIRED")
        self.assertEqual(result["changeKinds"], [])
        self.assertEqual(result["requirements"]["targetSelectors"], [])

    def test_generic_acceptance_infrastructure_routes_to_its_owner(self) -> None:
        result = self.classify("tooling/acceptance/core/runner.py")

        self.assertEqual(result["state"], "NOT_APPLICABLE")
        self.assertEqual(result["changeKinds"], [])
        self.assertEqual(result["requirements"]["targetSelectors"], [])

    def test_path_decisions_are_deduplicated_and_ordered(self) -> None:
        result = self.classify(
            "tooling/scripts/local-dev/dev-session.mjs",
            "AGENTS.md",
            "tooling/scripts/local-dev/dev-session.mjs",
        )

        self.assertEqual(
            [
                decision["path"]
                for decision in result["classification"]["pathDecisions"]
            ],
            ["AGENTS.md", "tooling/scripts/local-dev/dev-session.mjs"],
        )

    def test_noncanonical_path_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            MODULE.ImpactError,
            "canonical and repository-relative",
        ):
            self.classify(" tooling/scripts/local-dev/dev-session.mjs")

    def test_product_and_workflow_changes_require_ownership_split(self) -> None:
        result = self.classify(
            "apps/station/app/subserver/agent/service/cli/executor.go",
            "tooling/scripts/acceptance-gap-detect.py",
        )

        self.assertEqual(result["state"], "OWNERSHIP_SPLIT_REQUIRED")
        self.assertTrue(result["classification"]["ownershipSplitRequired"])
        self.assertEqual(result["requirements"]["targetSelectors"], ["station"])

    def test_product_and_acceptance_infra_changes_require_ownership_split(
        self,
    ) -> None:
        result = self.classify(
            "apps/station/app/subserver/agent/service/turn_service.go",
            "tooling/acceptance/core/runner.py",
        )

        self.assertEqual(result["state"], "OWNERSHIP_SPLIT_REQUIRED")
        self.assertTrue(result["classification"]["ownershipSplitRequired"])
        self.assertEqual(
            result["classification"]["separateOwnerRuleIds"],
            ["acceptance-infrastructure"],
        )

    def test_failure_classification_uses_first_actionable_owner(self) -> None:
        base = {
            "evidenceIntegrity": "PASS",
            "environmentReady": "PASS",
            "workflowIntegrity": "PASS",
            "harnessIntegrity": "PASS",
            "productOracle": "PASS",
        }
        cases = [
            ("evidenceIntegrity", "EVIDENCE_INTEGRITY"),
            ("environmentReady", "ENVIRONMENT_BLOCKER"),
            ("workflowIntegrity", "WORKFLOW_DEFECT"),
            ("harnessIntegrity", "HARNESS_DEFECT"),
            ("productOracle", "PRODUCT_DEFECT"),
        ]
        for signal, expected in cases:
            with self.subTest(signal=signal):
                signals = dict(base)
                signals[signal] = "FAIL"
                result = MODULE.classify_failure(signals, POLICY)
                self.assertEqual(result["classification"], expected)

        all_failed = {name: "FAIL" for name in base}
        result = MODULE.classify_failure(all_failed, POLICY)
        self.assertEqual(result["classification"], "EVIDENCE_INTEGRITY")

    def test_replay_matches_forensic_fixture(self) -> None:
        result = MODULE.replay_fixture(
            REPLAY,
            policy=POLICY,
            verify_git=False,
        )

        self.assertEqual(result["state"], "PASS", result["failures"])
        self.assertEqual(result["caseCount"], 18)

    def test_cli_replay_is_machine_readable(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "replay",
                "--fixture",
                str(SKILL_ROOT / "fixtures" / "mca-p04-replay.json"),
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout)["state"], "PASS")


if __name__ == "__main__":
    unittest.main()
