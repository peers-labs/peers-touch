from __future__ import annotations

import copy
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tooling/scripts/review/agent-d11-entrypoints.py"
FIXTURE = REPO_ROOT / "tooling/acceptance/fixtures/agent_d11_entrypoints.yaml"


def load_module():
    spec = importlib.util.spec_from_file_location("agent_d11_entrypoints", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class AgentD11EntrypointsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_inventory_mode_passes_without_known_route_defects(self) -> None:
        report = self.module.Checker(REPO_ROOT, FIXTURE, True).run()

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["mode"], "inventory-only")
        self.assertEqual(report["atelierAliasCount"], 29)
        self.assertEqual(report["knownDefectCount"], 0)
        self.assertEqual(report["knownDefects"], [])

    def test_default_mode_passes_with_all_pre_effect_guards(self) -> None:
        report = self.module.Checker(REPO_ROOT, FIXTURE, False).run()

        self.assertEqual(report["status"], "pass")
        codes = [issue["code"] for issue in report["issues"]]
        self.assertNotIn("KNOWN_ROUTE_DEFECT", codes)
        self.assertNotIn("GUARD_ENFORCEMENT", codes)

    def test_fixture_has_exact_aliases_and_amended_dispositions(self) -> None:
        data = yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))
        aliases = {
            item["alias"]: item for item in data["atelier_aliases"]["entries"]
        }

        self.assertEqual(len(aliases), 29)
        self.assertEqual(
            aliases["provider.capabilities"]["disposition"],
            "allowed-nonexecution-mutation",
        )
        self.assertEqual(
            aliases["workspace.open"]["disposition"],
            "allowed-nonexecution-mutation",
        )

    def test_schema_rejects_unknown_disposition_and_wrong_alias_count(self) -> None:
        data = yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))
        broken = copy.deepcopy(data)
        broken["entrypoints"][0]["disposition"] = "allowed-maybe"
        broken["atelier_aliases"]["entries"].pop()

        _, issues = self.module.validate_schema(broken)
        codes = {issue.code for issue in issues}
        self.assertIn("SCHEMA_DISPOSITION", codes)
        self.assertIn("SCHEMA_ALIAS_COUNT", codes)

    def test_discovery_rejects_unregistered_station_route(self) -> None:
        checker = self.module.Checker(REPO_ROOT, FIXTURE, True)
        checker.load()
        source = "apps/station/app/subserver/agent/agent.go"
        checker._cache[source] = (
            (REPO_ROOT / source).read_text(encoding="utf-8")
            + '\nvar _ = "/agent/collaboration/unregistered-start"\n'
        )

        checker.validate_discovered_routes()

        self.assertTrue(
            any(
                issue.code == "DISCOVERY_UNREGISTERED"
                and "unregistered-start" in issue.message
                for issue in checker.issues
            )
        )

    def test_guard_order_distinguishes_before_after_and_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scope.go"
            checker = self.module.Checker(root, Path("unused.yaml"), False)
            guard = {
                "scope_source": "scope.go",
                "scope_symbol": "Run",
                "first_effect": "firstEffect()",
                "current_state": "before-effect",
            }

            source.write_text(
                "func Run() { enforce_canvas_single_agent_readiness(); firstEffect() }\n",
                encoding="utf-8",
            )
            self.assertEqual(
                checker.guard_state(
                    guard, "enforce_canvas_single_agent_readiness", "run"
                ),
                "before-effect",
            )

            checker._cache.clear()
            source.write_text(
                "func Run() { firstEffect(); enforce_canvas_single_agent_readiness() }\n",
                encoding="utf-8",
            )
            self.assertEqual(
                checker.guard_state(
                    guard, "enforce_canvas_single_agent_readiness", "run"
                ),
                "after-effect",
            )

            checker._cache.clear()
            source.write_text("func Run() { firstEffect() }\n", encoding="utf-8")
            self.assertEqual(
                checker.guard_state(
                    guard, "enforce_canvas_single_agent_readiness", "run"
                ),
                "absent",
            )

    def test_guard_order_follows_private_core_to_original_first_effect(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scope.go"
            checker = self.module.Checker(root, Path("unused.yaml"), False)
            guard = {
                "scope_source": "scope.go",
                "scope_symbol": "Run",
                "core_symbol": "runAfterReadiness",
                "first_effect": "firstEffect()",
                "current_state": "before-effect",
            }

            source.write_text(
                "func Run() { enforce_canvas_single_agent_readiness(); runAfterReadiness() }\n"
                "func runAfterReadiness() { firstEffect() }\n",
                encoding="utf-8",
            )
            self.assertEqual(
                checker.guard_state(
                    guard, "enforce_canvas_single_agent_readiness", "run"
                ),
                "before-effect",
            )

            checker._cache.clear()
            source.write_text(
                "func Run() { runAfterReadiness(); enforce_canvas_single_agent_readiness() }\n"
                "func runAfterReadiness() { firstEffect() }\n",
                encoding="utf-8",
            )
            self.assertEqual(
                checker.guard_state(
                    guard, "enforce_canvas_single_agent_readiness", "run"
                ),
                "after-effect",
            )

            checker._cache.clear()
            source.write_text(
                "func Run() { enforce_canvas_single_agent_readiness(); runAfterReadiness() }\n"
                "func runAfterReadiness() {}\n",
                encoding="utf-8",
            )
            self.assertEqual(
                checker.guard_state(
                    guard, "enforce_canvas_single_agent_readiness", "run"
                ),
                "absent",
            )
            self.assertTrue(
                any(issue.code == "FIRST_EFFECT_MISSING" for issue in checker.issues)
            )


if __name__ == "__main__":
    unittest.main()
