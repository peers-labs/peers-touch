from __future__ import annotations

import hashlib
import io
import inspect
import json
import re
import shutil
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack, redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, Mapping
from unittest.mock import MagicMock, call, patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.fixtures.secure_content_w7 import (
    W7FixtureBinding,
    W7FixtureCapabilityHandler,
    W7FixtureOwner,
    W7_FIXTURE_OPERATIONS,
    W7_FIXTURE_OWNERS,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
)
from tooling.acceptance.provisioners.secure_content_remote_recipient import (
    RemotePrivateRecipientProvisioner,
)
from tooling.development.secure_content import runtime_manifest
from tooling.development.secure_content import runtime_owner as runtime_owner_module
from tooling.development.secure_content.scenarios import desktop_pilot
from tooling.development.secure_content.platform_runtime import (
    load_platform_runtime_contract,
)
from tooling.development.secure_content.run import RunnerError, ScenarioContext
from tooling.development.secure_content.runtime_owner import (
    BROWSER_JOURNEY,
    DESKTOP_CLIENTS,
    REQUIRED_FIXTURE_CAPABILITIES,
    SOCIAL_ACCEPTANCE_IDS,
    SOCIAL_ACCEPTANCE_RUNTIME_REUSE,
    W7_RUNTIME_REUSE,
    W8_RUNTIME_REUSE,
    W8_SCENARIOS,
    W9_RUNTIME_REUSE,
    RuntimeOwnerBlocked,
    W8_REMOTE_RECIPIENT_CAPABILITY,
    W8_REMOTE_RECIPIENT_OPERATION,
    W8RemoteRecipientFixtureOwner,
    W7RuntimeOwner,
    _StationEndpoint,
    _activate_scenario_journey,
    _authenticate_running_client,
    _bind_reusable_actor_identity,
    _build_fixture_owner,
    _client_payload,
    _close_fixture_action_channel,
    _continuation_run_id,
    _continuation_services,
    _copy_immutable,
    _error_message_with_cleanup,
    _generate_mobile_recovery_phrase,
    _make_client,
    _manifest_payload,
    _maintain_current_recovery_prekeys,
    _open_station_tunnels,
    _prepare_accepted_friendship,
    _prepare_mobile_private_content_keys,
    _prepare_portable_recovery,
    _prepare_private_content_keys,
    _parse_args,
    _publish_result_generation,
    _publish_canonical_private_schema_attestation,
    _provision_runtime_accounts,
    _register_runtime_account,
    _require_mobile_private_runtime,
    _require_mobile_write_admission,
    _restore_w8_invalidated_fixtures,
    _runtime_account_search_query,
    _resolve_canonical_private_schema_attestation,
    _restart_lease,
    _runtime_cleanup_scope,
    _service_payload,
    _stage_child_result,
    _stage_continuation_evidence,
    _start_client,
    _start_mobile_client,
    _stop_client_or_raise,
    _storage_identity,
    _validate_fixture,
    _wait_for_mls_readiness,
    _verify_live_canonical_private_schema_attestation,
    _wait_for_moments_snapshot,
    _write_browser_runtime_manifest_with_recovery,
    _receiver_ui_probe,
    main,
)


COMMIT = "6" * 40
IDENTITY = {
    "root": "/tmp/peers-touch",
    "workspaceId": "9eb2cb904c9ae460",
    "head": COMMIT,
    "worktreeSetDigest": "7" * 64,
}
RECOVERY_PHRASE = " ".join((*("abandon",) * 23, "art"))


def fixture_payload() -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": 1,
        "kind": runtime_manifest.FIXTURE_MANIFEST_KIND,
        "fixture_set_id": "w7-owner-fixture",
        "source_checkpoint": COMMIT,
        "handles": [
            {
                "kind": f"{capability}-fixture",
                "opaque_id": f"observed-{index}",
                "owner": W7_FIXTURE_OWNERS[capability],
                "capability": capability,
                "expected_identity_digest": str(index + 1) * 64,
                **(
                    {"secret_channel_ref": "w7-recovery-secret-channel"}
                    if capability == "historical-recovery-epoch"
                    else {}
                ),
            }
            for index, capability in enumerate(
                sorted(REQUIRED_FIXTURE_CAPABILITIES)
            )
        ],
    }
    payload["manifest_digest"] = runtime_manifest.canonical_digest(payload)
    return payload


class RuntimeOwnerTest(unittest.TestCase):
    def test_w7_desktop_suite_contract_excludes_other_runtimes(self) -> None:
        self.assertEqual(
            ("desktop-pre-restart", "desktop-continuity"),
            W7_RUNTIME_REUSE.scenario_ids,
        )
        self.assertEqual(1, W7_RUNTIME_REUSE.max_provisioning_runs)
        self.assertEqual(4, W7_RUNTIME_REUSE.max_client_launches)
        self.assertEqual(0.5, W7_RUNTIME_REUSE.min_warm_reuse_rate)
        self.assertTrue(W7_RUNTIME_REUSE.allow_client_replacement)

        source = inspect.getsource(
            W7RuntimeOwner.run_w7_desktop_suite
        )
        self.assertNotIn("BROWSER_", source)
        self.assertNotIn('runtime_kind="browser"', source)
        self.assertNotIn('runtime="browser"', source)
        self.assertNotIn('runtime="mobile"', source)

    def test_w7_desktop_suite_publishes_after_ui_proof_and_cleanup(
        self,
    ) -> None:
        source = inspect.getsource(
            W7RuntimeOwner.run_w7_desktop_suite
        )

        self.assertEqual(4, source.count("result_root=raw_result_root"))
        self.assertNotRegex(
            source,
            r"(?<!final_)result_root=self\.result_root",
        )
        self.assertEqual(2, source.count("_receiver_ui_probe("))
        self.assertEqual(2, source.count("_stage_child_result("))
        self.assertLess(
            source.index("_receiver_ui_probe("),
            source.index("_stage_child_result("),
        )
        self.assertLess(
            source.index("SuiteRuntimeAction.CLEANUP_COMPLETE"),
            source.index("_publish_result_generation("),
        )
        self.assertNotIn(
            'call("clearLocalState")',
            inspect.getsource(desktop_pilot._execute),
        )

    def test_w8_suite_contract_closes_all_scenarios(self) -> None:
        self.assertEqual(
            tuple(spec.scenario_id for spec in W8_SCENARIOS),
            W8_RUNTIME_REUSE.scenario_ids,
        )
        self.assertEqual(
            {
                "comment",
                "audience",
                "subtype",
                "object",
                "delete-block",
                "bounds",
            },
            {spec.variant_id for spec in W8_SCENARIOS},
        )
        self.assertEqual(1, W8_RUNTIME_REUSE.max_provisioning_runs)
        self.assertEqual(4, W8_RUNTIME_REUSE.max_client_launches)
        self.assertTrue(W8_RUNTIME_REUSE.require_attach_only_scenarios)
        self.assertTrue(W8_RUNTIME_REUSE.require_receiver_visible_proof)
        self.assertFalse(W8_RUNTIME_REUSE.allow_client_replacement)
        self.assertEqual(
            {"private-comment"},
            {
                spec.scenario_id
                for spec in W8_SCENARIOS
                if spec.click_content
            },
        )
        self.assertEqual(
            {"social-delete-block": ("local-mutual-friendship",)},
            {
                spec.scenario_id: spec.invalidated_fixture_ids
                for spec in W8_SCENARIOS
                if spec.invalidated_fixture_ids
            },
        )

    def test_social_desktop_acceptance_suite_contract_is_bounded(self) -> None:
        self.assertEqual(
            (
                "desktop-pre-restart",
                "desktop-continuity",
                "private-comment",
                "social-expansion",
                "social-subtype",
                "social-object",
                "social-delete-block",
                "social-bounds",
            ),
            SOCIAL_ACCEPTANCE_RUNTIME_REUSE.scenario_ids,
        )
        self.assertEqual(
            1,
            SOCIAL_ACCEPTANCE_RUNTIME_REUSE.max_provisioning_runs,
        )
        self.assertEqual(
            5,
            SOCIAL_ACCEPTANCE_RUNTIME_REUSE.max_client_launches,
        )
        self.assertTrue(
            SOCIAL_ACCEPTANCE_RUNTIME_REUSE.allow_client_replacement
        )
        self.assertEqual(14, len(SOCIAL_ACCEPTANCE_IDS))
        source = inspect.getsource(W7RuntimeOwner._run_w8_suite)
        self.assertLess(
            source.index(
                'purpose="W8 remote recipient identity preparation"'
            ),
            source.index("eve_client = _make_client("),
        )
        self.assertIn("_run_social_acceptance_pre_restart(", source)
        self.assertIn("_social_acceptance_scenario_registry(", source)

    def test_w8_suite_restores_declared_shared_fixtures(self) -> None:
        clients = {
            DESKTOP_CLIENTS[0][0]: MagicMock(name="alice"),
            DESKTOP_CLIENTS[1][0]: MagicMock(name="bob"),
            DESKTOP_CLIENTS[2][0]: MagicMock(name="eve"),
        }
        delete_block = next(
            spec
            for spec in W8_SCENARIOS
            if spec.scenario_id == "social-delete-block"
        )
        bounds = next(
            spec
            for spec in W8_SCENARIOS
            if spec.scenario_id == "social-bounds"
        )

        with patch(
            "tooling.development.secure_content.runtime_owner."
            "_prepare_accepted_friendship"
        ) as prepare:
            self.assertEqual(
                ("local-mutual-friendship",),
                _restore_w8_invalidated_fixtures(delete_block, clients),
            )
            prepare.assert_called_once_with(
                clients[DESKTOP_CLIENTS[0][0]],
                clients[DESKTOP_CLIENTS[1][0]],
            )
            prepare.reset_mock()
            self.assertEqual(
                (),
                _restore_w8_invalidated_fixtures(bounds, clients),
            )
            prepare.assert_not_called()

    def test_w8_suite_provisions_before_attach_only_scenario_loop(self) -> None:
        source = inspect.getsource(W7RuntimeOwner._run_w8_suite)
        scenario_loop = source.index("for spec in W8_SCENARIOS:")
        execution_loop = source.rindex("for spec in W8_SCENARIOS:")
        execution_source = source[execution_loop:]

        self.assertEqual(1, source.count("_provision_runtime_accounts("))
        self.assertLess(
            source.index("_provision_runtime_accounts("),
            scenario_loop,
        )
        self.assertNotIn("_start_client(", source[scenario_loop:])
        self.assertNotIn("_make_client(", source[scenario_loop:])
        self.assertEqual(
            1,
            source.count("SuiteRuntimeAction.PROVISION"),
        )
        self.assertIn(
            "SuiteRuntimeAction.CLEANUP_COMPLETE",
            source,
        )
        self.assertEqual(1, source.count("_open_station_tunnels("))
        self.assertEqual(
            1,
            execution_source.count("station_endpoints.refresh()"),
        )
        self.assertLess(
            execution_source.index("station_endpoints.refresh()"),
            execution_source.index("SuiteRuntimeAction.SCENARIO_START"),
        )
        self.assertLess(
            execution_source.index("_receiver_ui_probe("),
            execution_source.index("_restore_w8_invalidated_fixtures("),
        )
        self.assertLess(
            execution_source.index("_restore_w8_invalidated_fixtures("),
            execution_source.index("SuiteRuntimeAction.SCENARIO_END"),
        )

    def test_w8_suite_publishes_results_after_receiver_proof_and_cleanup(
        self,
    ) -> None:
        source = inspect.getsource(W7RuntimeOwner._run_w8_suite)
        execution_loop = source.rindex("for spec in W8_SCENARIOS:")
        execution_source = source[execution_loop:]

        self.assertIn("result_root=raw_result_root", execution_source)
        self.assertNotRegex(
            execution_source,
            r"(?<!final_)result_root=self\.result_root",
        )
        self.assertLess(
            execution_source.index("_receiver_ui_probe("),
            execution_source.index("_stage_child_result("),
        )
        self.assertLess(
            source.index("SuiteRuntimeAction.CLEANUP_COMPLETE"),
            source.index("_publish_result_generation("),
        )

    def test_w8_result_generation_is_hidden_until_atomic_publication(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_root = root / "raw"
            publish_root = root / "publish"
            final_root = root / "final"
            run_id = "w8-suite-test"
            relative = (
                Path("W8")
                / COMMIT
                / "subtype"
                / run_id
                / "result.json"
            )
            raw_result_path = raw_root / relative
            raw_result_path.parent.mkdir(parents=True)
            raw_result_path.write_text("{}\n", encoding="utf-8")
            runtime_manifest_path = root / "runtime.json"
            runtime_manifest_path.write_text("{}\n", encoding="utf-8")
            supporting_path = raw_result_path.parent / "supporting.json"
            supporting_path.write_text("{}\n", encoding="utf-8")
            ui_evidence_path = root / "receiver-visible-evidence.json"
            ui_evidence_path.write_text("{}\n", encoding="utf-8")
            result = {
                "workstreamId": "W8",
                "generationId": COMMIT,
                "variantId": "subtype",
                "runId": run_id,
                "artifactRefs": [
                    str(raw_result_path),
                    str(supporting_path),
                    str(runtime_manifest_path),
                ],
                "result": "PASS",
                "resultDigest": "0" * 64,
                "startedAt": "2026-10-01T08:00:00.000Z",
                "completedAt": "2026-10-01T08:00:01.000Z",
                "durationMs": 1000,
            }

            staged = _stage_child_result(
                result,
                workstream_id="W8",
                raw_result_root=raw_root,
                publish_root=publish_root,
                final_result_root=final_root,
                ui_evidence_paths=(ui_evidence_path,),
            )

            final_result_path = final_root / relative
            staged_result_path = publish_root / relative
            self.assertFalse(final_result_path.exists())
            self.assertTrue(staged_result_path.is_file())
            self.assertEqual(
                str(final_result_path.resolve()),
                staged["artifactRefs"][0],
            )
            self.assertIn(
                str(ui_evidence_path.resolve()),
                staged["artifactRefs"],
            )
            final_supporting_path = (
                final_root / relative.parent / supporting_path.name
            )
            self.assertIn(
                str(final_supporting_path.resolve()),
                staged["artifactRefs"],
            )
            self.assertTrue(
                (
                    publish_root / relative.parent / supporting_path.name
                ).is_file()
            )
            self.assertGreaterEqual(staged["durationMs"], 1000)
            self.assertNotEqual(
                "2026-10-01T08:00:01.000Z",
                staged["completedAt"],
            )
            digest_payload = dict(staged)
            digest = digest_payload.pop("resultDigest")
            self.assertEqual(
                runtime_manifest.canonical_digest(digest_payload),
                digest,
            )

            published = _publish_result_generation(
                workstream_id="W8",
                publish_root=publish_root,
                final_result_root=final_root,
                generation_id=COMMIT,
            )

            self.assertEqual((final_root / "W8" / COMMIT).resolve(), published)
            self.assertTrue(final_result_path.is_file())
            self.assertFalse((publish_root / "W8" / COMMIT).exists())

    def test_w7_continuation_results_publish_as_one_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_root = root / "raw"
            publish_root = root / "publish"
            final_root = root / "final"
            ui_evidence_paths: list[Path] = []
            for scenario_id in (
                "desktop-pre-restart",
                "desktop-continuity",
            ):
                path = root / scenario_id / "receiver-visible-evidence.json"
                path.parent.mkdir(parents=True)
                path.write_text("{}\n", encoding="utf-8")
                ui_evidence_paths.append(path)

            for run_id, result in (
                ("parent", "BLOCKED"),
                ("parent-c-child", "PASS"),
            ):
                relative = (
                    Path("W7")
                    / COMMIT
                    / "desktop"
                    / run_id
                    / "result.json"
                )
                raw_result_path = raw_root / relative
                raw_result_path.parent.mkdir(parents=True)
                raw_result_path.write_text("{}\n", encoding="utf-8")
                staged = {
                    "workstreamId": "W7",
                    "generationId": COMMIT,
                    "variantId": "desktop",
                    "runId": run_id,
                    "artifactRefs": [str(raw_result_path)],
                    "result": result,
                    "resultDigest": "0" * 64,
                    "startedAt": "2026-10-01T08:00:00.000Z",
                    "completedAt": "2026-10-01T08:00:01.000Z",
                    "durationMs": 1000,
                }
                _stage_child_result(
                    staged,
                    workstream_id="W7",
                    raw_result_root=raw_root,
                    publish_root=publish_root,
                    final_result_root=final_root,
                    ui_evidence_paths=tuple(ui_evidence_paths),
                )

            generation_root = final_root / "W7" / COMMIT
            self.assertFalse(generation_root.exists())

            published = _publish_result_generation(
                workstream_id="W7",
                publish_root=publish_root,
                final_result_root=final_root,
                generation_id=COMMIT,
            )

            self.assertEqual(generation_root.resolve(), published)
            self.assertEqual(
                2,
                len(tuple(generation_root.glob("desktop/*/result.json"))),
            )

    def test_w8_result_is_not_staged_without_receiver_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_root = root / "raw"
            publish_root = root / "publish"
            final_root = root / "final"
            relative = (
                Path("W8")
                / COMMIT
                / "subtype"
                / "w8-suite-test"
                / "result.json"
            )
            raw_result_path = raw_root / relative
            raw_result_path.parent.mkdir(parents=True)
            raw_result_path.write_text("{}\n", encoding="utf-8")
            result = {
                "workstreamId": "W8",
                "generationId": COMMIT,
                "variantId": "subtype",
                "runId": "w8-suite-test",
                "artifactRefs": [str(raw_result_path)],
                "result": "PASS",
                "resultDigest": "0" * 64,
            }

            with self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "receiver-visible evidence is unavailable",
            ):
                _stage_child_result(
                    result,
                    workstream_id="W8",
                    raw_result_root=raw_root,
                    publish_root=publish_root,
                    final_result_root=final_root,
                    ui_evidence_paths=(
                        root / "missing-ui-evidence.json",
                    ),
                )

            self.assertFalse((publish_root / relative).exists())
            self.assertFalse((final_root / relative).exists())

    def test_w8_suite_cli_is_the_only_w8_entry(self) -> None:
        self.assertEqual(
            "run-w8-suite",
            _parse_args(
                [
                    "run-w8-suite",
                    "--profiles",
                    "four,fiveArm",
                ]
            ).action,
        )
        self.assertEqual(
            "four,fiveArm",
            _parse_args(
                [
                    "run-w8-suite",
                    "--profiles",
                    "four,fiveArm",
                ]
            ).profiles,
        )
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                _parse_args(["run-private-comment"])
            with self.assertRaises(SystemExit):
                _parse_args(["run-social-expansion"])

    def test_social_desktop_acceptance_cli_dispatches_once(self) -> None:
        with patch.object(
            W7RuntimeOwner,
            "run_social_desktop_acceptance_suite",
            return_value={
                "status": "FUNCTIONAL_PASS",
                "proofState": "UNPROVEN",
            },
        ) as run_suite:
            status = main(
                [
                    "run-social-desktop-acceptance-suite",
                    "--profiles",
                    "four,fiveArm",
                    "--slot",
                    "12",
                ]
            )

        self.assertEqual(0, status)
        run_suite.assert_called_once_with(slot=12)

    def test_w8_suite_requires_complete_profile_closure(
        self,
    ) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            status = main(["run-w8-suite"])

        self.assertEqual(2, status)
        payload = json.loads(stderr.getvalue())
        self.assertEqual("CONTROLLER_BINDING_MISMATCH", payload["code"])
        self.assertEqual("runtime:secure-content-w8", payload["resource"])

    def test_w7_desktop_suite_requires_complete_profile_closure(
        self,
    ) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            status = main(["run-w7-desktop-suite"])

        self.assertEqual(2, status)
        payload = json.loads(stderr.getvalue())
        self.assertEqual("CONTROLLER_BINDING_MISMATCH", payload["code"])
        self.assertEqual("runtime:secure-content-w7", payload["resource"])

    def test_w8_suite_cli_dispatches_once(self) -> None:
        with patch.object(
            W7RuntimeOwner,
            "run_w8_suite",
            return_value={
                "status": "FUNCTIONAL_PASS",
                "proofState": "UNPROVEN",
            },
        ) as run_suite:
            status = main(
                [
                    "run-w8-suite",
                    "--profiles",
                    "four,fiveArm",
                ]
            )

        self.assertEqual(0, status)
        run_suite.assert_called_once_with()

    def test_w8_receiver_probe_binds_real_dom_action_and_assertion(
        self,
    ) -> None:
        class Element:
            def __init__(self, tag_name: str) -> None:
                self.tag_name = tag_name
                self.clicked = False

            def click(self) -> None:
                self.clicked = True

            def is_displayed(self) -> bool:
                return True

        class Driver:
            session_id = "webdriver-session"
            current_url = "tauri://localhost/moments"

            def __init__(self) -> None:
                self.nav = Element("button")
                self.action = Element("p")
                self.comments = Element("button")
                self.receiver = Element("p")
                self.css_selectors: list[str] = []
                self.xpath_selectors: list[str] = []

            def find_elements(self, using: str, selector: str) -> list[Element]:
                self.assert_locator(using)
                if using == "css selector":
                    self.css_selectors.append(selector)
                    if 'data-pt-primary-nav="moments"' in selector:
                        return [self.nav]
                    if "data-moments-comments-toggle" in selector:
                        return [self.comments]
                if using == "xpath":
                    self.xpath_selectors.append(selector)
                    if "'parent'" in selector:
                        return [self.action]
                    if "'comment'" in selector:
                        return [self.receiver]
                return []

            def execute_script(self, script: str, *arguments: object) -> object:
                self.assert_locator("script")
                if "scrollIntoView" not in script or len(arguments) != 1:
                    raise AssertionError(
                        "the probe must not return DOM elements from script"
                    )
                return None

            @staticmethod
            def assert_locator(using: str) -> None:
                if using not in {"css selector", "xpath", "script"}:
                    raise AssertionError(f"unexpected locator strategy: {using}")

        driver = Driver()
        client = SimpleNamespace(
            driver=driver,
            spec=SimpleNamespace(profile="w8-alice"),
        )

        evidence = _receiver_ui_probe(
            client,
            workstream_id="W8",
            scenario_id="private-comment",
            action_text="parent",
            visible_text="comment",
            open_comments=True,
        )

        self.assertRegex(
            evidence["actionResourceId"],
            r"^dom-action:[0-9a-f]{24}$",
        )
        self.assertRegex(
            evidence["receiverResourceId"],
            r"^dom-receiver:[0-9a-f]{24}$",
        )
        self.assertEqual("webdriver-session", evidence["automationSessionId"])
        self.assertTrue(driver.nav.clicked)
        self.assertTrue(driver.action.clicked)
        self.assertTrue(driver.comments.clicked)
        self.assertEqual(
            (
                '[data-pt-primary-nav="moments"] button, '
                '[data-pt-primary-nav="moments"] [role="button"]'
            ),
            driver.css_selectors[0],
        )
        action_selector = next(
            selector
            for selector in driver.xpath_selectors
            if "'parent'" in selector
        )
        self.assertIn(
            "[not(.//*[contains(string(.), 'parent')])]",
            action_selector,
        )
        self.assertNotIn("[not(*)]", action_selector)

        navigation_driver = Driver()
        navigation_client = SimpleNamespace(
            driver=navigation_driver,
            spec=SimpleNamespace(profile="w7-bob"),
        )
        navigation_evidence = _receiver_ui_probe(
            navigation_client,
            workstream_id="W7",
            scenario_id="desktop-continuity",
            action_text=None,
            visible_text="comment",
            open_comments=False,
        )

        self.assertTrue(navigation_driver.nav.clicked)
        self.assertFalse(navigation_driver.action.clicked)
        self.assertEqual(
            hashlib.sha256(b"moments-navigation").hexdigest(),
            navigation_evidence["actionTextSha256"],
        )

    def test_w9_suite_contract_is_single_entry(self) -> None:
        self.assertEqual(
            ("ios", "android", "cross-platform"),
            W9_RUNTIME_REUSE.scenario_ids,
        )
        self.assertEqual(1, W9_RUNTIME_REUSE.max_provisioning_runs)
        self.assertEqual(6, W9_RUNTIME_REUSE.max_client_launches)
        self.assertEqual("run-w9-suite", _parse_args(["run-w9-suite"]).action)

    def test_task_suite_entries_replace_public_leaf_commands(self) -> None:
        suite_arguments = {
            "run-w7-desktop-suite": ["--profiles", "four,fiveArm"],
            "run-social-desktop-acceptance-suite": [
                "--profiles",
                "four,fiveArm",
                "--slot",
                "12",
            ],
            "run-w9-suite": [],
            "run-w2-suite": ["--profiles", "four,fiveArm"],
            "run-w10-suite": ["--profiles", "four,fiveArm"],
            "run-w11-suite": ["--profiles", "four,fiveArm"],
            "run-final-suite": ["--profiles", "four,fiveArm"],
        }
        for action, arguments in suite_arguments.items():
            with self.subTest(action=action):
                self.assertEqual(
                    action,
                    _parse_args([action, *arguments]).action,
                )

        for action in load_platform_runtime_contract().commands:
            with self.subTest(leaf_action=action):
                with redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        _parse_args([action])
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                _parse_args(["run-w7-suite"])

    def test_task_suite_contracts_match_plan_tasks(self) -> None:
        plan_root = (
            Path(__file__).resolve().parents[3]
            / "docs"
            / "architecture"
            / "secure-content"
            / "execution-plans"
            / "20260913-secure-content-hard-cut"
            / "tasks"
        )
        contracts = runtime_owner_module.TASK_SUITE_CONTRACTS
        self.assertEqual({"W7"}, set(contracts))
        for task_id, contract in contracts.items():
            with self.subTest(task_id=task_id):
                text = (plan_root / f"{task_id}.md").read_text(
                    encoding="utf-8"
                )
                match = re.search(
                    r"^```json\s*$\s*(\{.*\})\s*^```$",
                    text,
                    re.MULTILINE,
                )
                self.assertIsNotNone(match)
                task = json.loads(match.group(1))
                self.assertEqual(
                    contract.to_dict(),
                    task["runtimeReuse"],
                )

    def test_platform_suites_share_physical_clients_within_budget(self) -> None:
        command_contract = load_platform_runtime_contract()
        expected = {
            "run-w9-suite": (0, 6, 6),
            "run-w2-suite": (4, 4, 8),
            "run-w10-suite": (4, 4, 8),
            "run-w11-suite": (7, 8, 15),
            "run-final-suite": (7, 8, 15),
        }
        for action, counts in expected.items():
            with self.subTest(action=action):
                suite = runtime_owner_module.TASK_SUITE_DEFINITIONS[action]
                desktop, mobile = (
                    runtime_owner_module._suite_physical_clients(
                        suite,
                        command_contract,
                    )
                )
                self.assertEqual(counts[0], len(desktop))
                self.assertEqual(counts[1], len(mobile))
                self.assertEqual(counts[2], len(desktop) + len(mobile))
                self.assertLessEqual(
                    len(desktop) + len(mobile),
                    suite.runtime_reuse.max_client_launches,
                )

        for action in ("run-w11-suite", "run-final-suite"):
            suite = runtime_owner_module.TASK_SUITE_DEFINITIONS[action]
            self.assertNotEqual(
                "four-alice",
                suite.desktop_client_aliases["four-alice"],
            )
            self.assertNotEqual(
                "four-bob",
                suite.desktop_client_aliases["four-bob"],
            )
            bindings = runtime_owner_module._suite_mobile_service_bindings(
                suite,
                command_contract,
            )
            self.assertEqual(
                {
                    runtime_owner_module.STATION_ID,
                    runtime_owner_module.SECONDARY_STATION_ID,
                },
                {
                    service_id
                    for client_id, service_id in bindings.items()
                    if runtime_owner_module._mobile_actor_role(client_id)
                    == "bob"
                },
            )

    def test_mobile_service_binding_supports_hyphenated_client_ids(self) -> None:
        self.assertEqual(
            "alice",
            runtime_owner_module._mobile_actor_role(
                "secure-content-hardcut-ios-alice"
            ),
        )
        self.assertEqual(
            runtime_owner_module.SECONDARY_STATION_ID,
            runtime_owner_module._mobile_service_for_client(
                "secure-content-ios-remote_bob",
                ("four", "fiveArm"),
            ),
        )
        self.assertEqual(
            runtime_owner_module.SECONDARY_STATION_ID,
            runtime_owner_module._mobile_service_for_client(
                "secure-content-hardcut-ios-bob",
                ("four", "fiveArm"),
            ),
        )
        self.assertEqual(
            runtime_owner_module.STATION_ID,
            runtime_owner_module._mobile_service_for_client(
                "secure-content-hardcut-ios-bob",
                ("four",),
            ),
        )

    def test_mobile_friendship_uses_explicit_local_and_remote_bob_bindings(
        self,
    ) -> None:
        alice = MagicMock()
        local_bob = MagicMock()
        remote_bob = MagicMock()
        accepted_requests = [
            {
                "requestId": "request-local",
                "senderPtid": "ptid-alice",
                "receiverPtid": "ptid-local-bob",
                "federationId": "federation-shared",
                "status": 2,
            },
            {
                "requestId": "request-remote",
                "senderPtid": "ptid-alice",
                "receiverPtid": "ptid-remote-bob",
                "federationId": "federation-shared",
                "status": 2,
            },
        ]
        alice.call_action.side_effect = lambda action, _payload: (
            [
                {
                    "ptid": "ptid-local-bob",
                    "federationId": "federation-shared",
                    "homeStationPeerId": "runtime-four",
                },
                {
                    "ptid": "ptid-remote-bob",
                    "federationId": "federation-shared",
                    "homeStationPeerId": "runtime-five-arm",
                },
            ]
            if action == "social.people.search"
            else {"friendRequests": accepted_requests}
            if action == "social.projection.read"
            else {}
        )

        def bob_action(
            receiver_ptid: str,
            request_id: str,
        ) -> Callable[[str, Mapping[str, object]], object]:
            return lambda action, _payload: (
                {
                    "friendRequests": [
                        {
                            "requestId": request_id,
                            "senderPtid": "ptid-alice",
                            "receiverPtid": receiver_ptid,
                            "federationId": "federation-shared",
                            "status": 2,
                        }
                    ]
                }
                if action == "social.projection.read"
                else {}
            )

        local_bob.call_action.side_effect = bob_action(
            "ptid-local-bob",
            "request-local",
        )
        remote_bob.call_action.side_effect = bob_action(
            "ptid-remote-bob",
            "request-remote",
        )
        sessions = {
            "secure-content-ios-alice": alice,
            "secure-content-ios-bob": local_bob,
            "secure-content-ios-remote_bob": remote_bob,
        }

        federation_id = runtime_owner_module._prepare_mobile_friendship(
            sessions,
            {
                "secure-content-ios-alice": "ptid-alice",
                "secure-content-ios-bob": "ptid-local-bob",
                "secure-content-ios-remote_bob": "ptid-remote-bob",
            },
            {"bob": "sc-bob-abcdefghij@testnet.local"},
            {
                runtime_owner_module.STATION_ID: {
                    "profile_id": "four",
                    "runtime_identity": "runtime-four",
                },
                runtime_owner_module.SECONDARY_STATION_ID: {
                    "profile_id": "fiveArm",
                    "runtime_identity": "runtime-five-arm",
                },
            },
            {
                "secure-content-ios-alice": runtime_owner_module.STATION_ID,
                "secure-content-ios-bob": runtime_owner_module.STATION_ID,
                "secure-content-ios-remote_bob": (
                    runtime_owner_module.SECONDARY_STATION_ID
                ),
            },
            frozenset(
                {
                    runtime_owner_module.STATION_ID,
                    runtime_owner_module.SECONDARY_STATION_ID,
                }
            ),
        )

        self.assertEqual("federation-shared", federation_id)
        send_payloads = [
            invocation.args[1]
            for invocation in alice.call_action.call_args_list
            if invocation.args[0] == "social.request.send"
        ]
        self.assertEqual(
            ["runtime-four", "runtime-five-arm"],
            [
                payload["receiverHomeStationPeerId"]
                for payload in send_payloads
            ],
        )
        local_bob.call_action.assert_any_call(
            "social.request.accept",
            {"requestId": "request-local"},
        )
        remote_bob.call_action.assert_any_call(
            "social.request.accept",
            {"requestId": "request-remote"},
        )

    def test_mobile_friendship_rejects_missing_required_bob_station(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeOwnerBlocked,
            "requires Bob clients for Station bindings",
        ):
            runtime_owner_module._prepare_mobile_friendship(
                {
                    "secure-content-ios-alice": MagicMock(),
                    "secure-content-ios-bob": MagicMock(),
                },
                {
                    "secure-content-ios-alice": "ptid-alice",
                    "secure-content-ios-bob": "ptid-local-bob",
                },
                {"bob": "sc-bob-abcdefghij@testnet.local"},
                {
                    runtime_owner_module.STATION_ID: {
                        "profile_id": "four",
                        "runtime_identity": "runtime-four",
                    },
                    runtime_owner_module.SECONDARY_STATION_ID: {
                        "profile_id": "fiveArm",
                        "runtime_identity": "runtime-five-arm",
                    },
                },
                {
                    "secure-content-ios-alice": (
                        runtime_owner_module.STATION_ID
                    ),
                    "secure-content-ios-bob": runtime_owner_module.STATION_ID,
                },
                frozenset(
                    {
                        runtime_owner_module.STATION_ID,
                        runtime_owner_module.SECONDARY_STATION_ID,
                    }
                ),
            )

    def test_mobile_friendship_rejects_unconfirmed_acceptance(self) -> None:
        alice = MagicMock()
        bob = MagicMock()
        alice.call_action.side_effect = lambda action, _payload: (
            [
                {
                    "ptid": "ptid-bob",
                    "federationId": "federation-shared",
                    "homeStationPeerId": "runtime-four",
                }
            ]
            if action == "social.people.search"
            else {
                "friendRequests": [
                    {
                        "requestId": "request-bob",
                        "senderPtid": "ptid-alice",
                        "receiverPtid": "ptid-bob",
                        "federationId": "federation-shared",
                        "status": 1,
                    }
                ]
            }
            if action == "social.projection.read"
            else {}
        )
        bob.call_action.side_effect = lambda action, _payload: (
            {
                "friendRequests": [
                    {
                        "requestId": "request-bob",
                        "senderPtid": "ptid-alice",
                        "receiverPtid": "ptid-bob",
                        "federationId": "federation-shared",
                        "status": 1,
                    }
                ]
            }
            if action == "social.projection.read"
            else {}
        )

        with (
            patch.object(
                runtime_owner_module.time,
                "monotonic",
                side_effect=(0, 0, 0, 0, 0, 61),
            ),
            patch.object(runtime_owner_module.time, "sleep"),
            self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "was not accepted",
            ),
        ):
            runtime_owner_module._prepare_mobile_friendship(
                {
                    "secure-content-ios-alice": alice,
                    "secure-content-ios-bob": bob,
                },
                {
                    "secure-content-ios-alice": "ptid-alice",
                    "secure-content-ios-bob": "ptid-bob",
                },
                {"bob": "sc-bob-abcdefghij@testnet.local"},
                {
                    runtime_owner_module.STATION_ID: {
                        "profile_id": "four",
                        "runtime_identity": "runtime-four",
                    }
                },
                {
                    "secure-content-ios-alice": (
                        runtime_owner_module.STATION_ID
                    ),
                    "secure-content-ios-bob": runtime_owner_module.STATION_ID,
                },
                frozenset({runtime_owner_module.STATION_ID}),
            )

    def test_final_suite_loads_only_complete_final_cut_bindings(self) -> None:
        generation = "a" * 40
        workspace_id = "0123456789abcdef"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for profile, workstream, service_id in (
                ("four", "W12F-FOUR", "station-four"),
                ("fiveArm", "W12F-FIVEARM", "station-five-arm"),
            ):
                reset_id = f"reset-{profile}"
                result_dir = (
                    root
                    / "W12"
                    / "final-cut"
                    / generation
                    / profile
                    / reset_id
                )
                result_dir.mkdir(parents=True)
                attestation = {
                    "source_commit": generation,
                    "workspace_id": workspace_id,
                    "profile_id": profile,
                    "station_service_id": service_id,
                    "station_runtime_identity": f"runtime-{profile}",
                    "reset_intent": "FINAL_CUT",
                }
                attestation["attestation_digest"] = (
                    runtime_manifest.canonical_digest(attestation)
                )
                attestation_path = (
                    result_dir
                    / runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
                )
                attestation_path.write_text(
                    json.dumps(attestation),
                    encoding="utf-8",
                )
                attestation_path.chmod(0o600)
                result = {
                    "kind": (
                        runtime_owner_module.schema_activation
                        .PROFILE_RESULT_KIND
                    ),
                    "workstream_id": workstream,
                    "task_id": "W12",
                    "generation_id": generation,
                    "source_commit": generation,
                    "workspace_id": workspace_id,
                    "profile_id": profile,
                    "reset_id": reset_id,
                    "reset_intent": "FINAL_CUT",
                    "schema_attestation_ref": {
                        "path": attestation_path.relative_to(root).as_posix(),
                        "sha256": hashlib.sha256(
                            attestation_path.read_bytes()
                        ).hexdigest(),
                    },
                    "schema_attestation_digest": attestation[
                        "attestation_digest"
                    ],
                    "journal_state": "COMPLETE",
                    "status": "PASS",
                    "claim": "FINAL_RESET_COMPLETE_ONLY",
                }
                result["result_digest"] = (
                    runtime_manifest.canonical_digest(result)
                )
                result_path = result_dir / "result.json"
                result_path.write_text(
                    json.dumps(result),
                    encoding="utf-8",
                )
                result_path.chmod(0o600)

            bindings = runtime_owner_module._load_final_cut_bindings(
                root,
                generation_id=generation,
                workspace_id=workspace_id,
            )

            self.assertEqual({"four", "fiveArm"}, set(bindings))
            self.assertEqual(
                "runtime-four",
                bindings["four"]["station_runtime_identity"],
            )

            result_path = (
                root
                / "W12"
                / "final-cut"
                / generation
                / "four"
                / "reset-four"
                / "result.json"
            )
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result["reset_intent"] = "SCHEMA_ACTIVATION"
            result.pop("result_digest")
            result["result_digest"] = runtime_manifest.canonical_digest(
                result
            )
            result_path.write_text(json.dumps(result), encoding="utf-8")
            result_path.chmod(0o600)

            with self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "FINAL_CUT result is invalid",
            ):
                runtime_owner_module._load_final_cut_bindings(
                    root,
                    generation_id=generation,
                    workspace_id=workspace_id,
                )

    def test_platform_suite_prepares_once_before_attach_only_loop(self) -> None:
        source = inspect.getsource(W7RuntimeOwner._run_platform_suite)
        scenario_loop = source.index("for scenario in suite.scenarios:")

        self.assertEqual(1, source.count("SuiteRuntimeLedger("))
        self.assertEqual(1, source.count("SuiteRuntimeAction.PROVISION"))
        self.assertLess(
            source.index("_prepare_desktop_suite_resources("),
            scenario_loop,
        )
        self.assertLess(
            source.index("_prepare_mobile_suite_resources("),
            scenario_loop,
        )
        self.assertNotIn(
            "_prepare_desktop_suite_resources(",
            source[scenario_loop:],
        )
        self.assertNotIn(
            "_prepare_mobile_suite_resources(",
            source[scenario_loop:],
        )
        self.assertNotIn("run_platform_action(", source)
        self.assertNotIn("_run_mobile_platform_action(", source)
        self.assertNotIn("_run_desktop_platform_action(", source)
        for action in (
            "SuiteRuntimeAction.UI_ACTION",
            "SuiteRuntimeAction.RECEIVER_ASSERTION",
            "SuiteRuntimeAction.SUPPORTING_OBSERVATION",
            "SuiteRuntimeAction.SCENARIO_END",
            "SuiteRuntimeAction.CLEANUP_COMPLETE",
        ):
            self.assertIn(action, source)
        self.assertIn("suite.primary_journey_id", source)
        self.assertIn("stack.callback(", source)

    def test_w9_suite_uses_shared_owner_instead_of_pending_fence(self) -> None:
        source = inspect.getsource(W7RuntimeOwner.run_w9_suite)

        self.assertNotIn("SUITE_RUNTIME_OWNER_PENDING", source)
        self.assertIn("_run_platform_suite", source)

    def test_task_suite_cli_dispatches_once(self) -> None:
        cases = {
            "run-w7-desktop-suite": (
                "run_w7_desktop_suite",
                ["--profiles", "four,fiveArm"],
            ),
            "run-w9-suite": ("run_w9_suite", []),
            "run-w2-suite": (
                "run_w2_suite",
                ["--profiles", "four,fiveArm"],
            ),
            "run-w10-suite": (
                "run_w10_suite",
                ["--profiles", "four,fiveArm"],
            ),
            "run-w11-suite": (
                "run_w11_suite",
                ["--profiles", "four,fiveArm"],
            ),
            "run-final-suite": (
                "run_final_suite",
                ["--profiles", "four,fiveArm"],
            ),
        }
        for action, (method_name, arguments) in cases.items():
            with self.subTest(action=action):
                with patch.object(
                    W7RuntimeOwner,
                    method_name,
                    return_value={
                        "status": "FUNCTIONAL_PASS",
                        "proofState": "UNPROVEN",
                    },
                ) as run_suite:
                    status = main([action, *arguments])

                self.assertEqual(0, status)
                run_suite.assert_called_once_with()

    def test_task_suite_invocations_do_not_share_mutable_runtime(self) -> None:
        owner = W7RuntimeOwner(
            repo_root=Path(__file__).resolve().parents[3],
            result_root=Path("/tmp/secure-content-suite-test"),
        )
        roots = iter((Path("/tmp/suite-one"), Path("/tmp/suite-two")))
        with patch.object(
            owner,
            "_run_platform_suite",
            side_effect=lambda _suite: {
                "status": "FUNCTIONAL_PASS",
                "runtimeRoot": str(next(roots)),
            },
        ):
            first = owner.run_w2_suite()
            second = owner.run_w2_suite()

        self.assertNotEqual(first["runtimeRoot"], second["runtimeRoot"])

    def test_suite_runtime_contracts_match_plan_tasks(self) -> None:
        plan_root = (
            Path(__file__).resolve().parents[3]
            / "docs"
            / "architecture"
            / "secure-content"
            / "execution-plans"
            / "20260913-secure-content-hard-cut"
            / "tasks"
        )
        for task_id, contract in (("W8", W8_RUNTIME_REUSE),):
            text = (plan_root / f"{task_id}.md").read_text(encoding="utf-8")
            match = re.search(
                r"^```json\s*$\s*(\{.*\})\s*^```$",
                text,
                re.MULTILINE,
            )
            self.assertIsNotNone(match)
            task = json.loads(match.group(1))
            self.assertEqual(contract.to_dict(), task["runtimeReuse"])

    def test_platform_owner_cli_dispatches_without_manifest_argument(
        self,
    ) -> None:
        command = load_platform_runtime_contract().command("run-w2-ios")
        owner = W7RuntimeOwner(
            repo_root=Path(__file__).resolve().parents[3],
            result_root=Path("/tmp/secure-content-leaf-test"),
        )
        with patch.object(
            W7RuntimeOwner,
            "_run_mobile_platform_action",
            return_value={
                "status": "FUNCTIONAL_PASS",
                "proofState": "UNPROVEN",
            },
        ) as run_mobile:
            result = owner.run_platform_action(command)

        self.assertEqual("FUNCTIONAL_PASS", result["status"])
        self.assertEqual(
            "run-w2-ios",
            run_mobile.call_args.args[0].action,
        )

    def test_platform_owner_cli_rejects_profile_selector_drift(self) -> None:
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                _parse_args(
                    [
                        "run-w2-ios",
                        "--profiles",
                        "four",
                    ]
                )

    def test_w8_remote_recipient_handle_is_opaque_and_action_bound(self) -> None:
        actor_ptid = "did:peers:five-arm-actor"
        owner = W8RemoteRecipientFixtureOwner(
            source_checkpoint=COMMIT,
            run_id="w8-remote-recipient",
            actor_ptid=actor_ptid,
            home_station_peer_id="five-arm-peer-id",
            federation_id="federation-1",
        )
        manifest = owner.manifest()
        encoded = json.dumps(manifest, sort_keys=True)
        handle = manifest["handles"][0]

        self.assertNotIn(actor_ptid, encoded)
        self.assertNotIn("federation-1", encoded)
        self.assertEqual(
            W8_REMOTE_RECIPIENT_CAPABILITY,
            handle["capability"],
        )
        self.assertEqual("actor-identity-provisioner", handle["owner"])

        context, client = owner.open_action_channel(
            workspace_id=IDENTITY["workspaceId"],
            gate_id="sc-dj-social-expansion",
            runtime_manifest_digests={"a" * 64},
        )
        try:
            acknowledgement = client.invoke(
                W8_REMOTE_RECIPIENT_CAPABILITY,
                W8_REMOTE_RECIPIENT_OPERATION,
                {
                    "handleId": handle["opaque_id"],
                    "expectedIdentityDigest": handle[
                        "expected_identity_digest"
                    ],
                    "runtimeManifestDigest": "a" * 64,
                    "actionPayload": {},
                },
                timeout_seconds=5,
            )
            outcome = acknowledgement["outcome"]
            self.assertEqual(actor_ptid, outcome["actorPtid"])
            self.assertEqual("fiveArm", outcome["profileId"])
            self.assertEqual("station-five-arm", outcome["serviceId"])
            self.assertEqual("federation-1", outcome["federationId"])
            self.assertEqual(
                hashlib.sha256(b"federation-1").hexdigest(),
                outcome["federationIdSha256"],
            )
            self.assertEqual(
                handle["expected_identity_digest"],
                outcome["fixtureIdentityDigest"],
            )
            identity_projection = dict(outcome)
            identity_projection.pop("fixtureIdentityDigest")
            self.assertEqual(
                handle["expected_identity_digest"],
                runtime_manifest.canonical_digest(identity_projection),
            )
        finally:
            _close_fixture_action_channel(context, client)

    def test_w8_remote_recipient_is_created_and_bound_by_identity_provisioner(
        self,
    ) -> None:
        registrations: list[tuple[str, str, str, str]] = []

        def register(
            station_url: str,
            *,
            role: str,
            suffix: str,
            password: str,
        ) -> str:
            registrations.append((station_url, role, suffix, password))
            return "remote@testnet.local"

        provisioner = RemotePrivateRecipientProvisioner(
            source_checkpoint=COMMIT,
            run_id="w8-provisioner",
            station_url="https://five-arm.invalid",
            password="fixture-password",
            account_registrar=register,
        )
        self.assertEqual("remote@testnet.local", provisioner.account)
        primary_client = object()
        remote_client = object()
        actions: list[tuple[object, str, Mapping[str, object]]] = []

        def federation_action(
            client: object,
            method: str,
            payload: Mapping[str, object],
        ) -> Mapping[str, object]:
            actions.append((client, method, payload))
            if method == "joinAcceptanceFederation":
                return {
                    "federationId": "federation-1",
                    "status": "active",
                }
            if method == "federationMemberStations":
                if len(actions) == 1:
                    return {"stationPeerIds": ["station-four-peer"]}
                return {
                    "stationPeerIds": [
                        "station-five-arm-peer",
                        "station-four-peer",
                    ]
                }
            if method == "resolveFederatedActorIdentity":
                return {
                    "actorPtid": "ptid:five-arm",
                    "federatedHandle": "@remote@five-arm.invalid",
                    "homeStationPeerId": "station-five-arm-peer",
                }
            raise AssertionError(f"unexpected action {method}")

        owner = provisioner.bind_identity(
            primary_client=primary_client,
            remote_client=remote_client,
            identity_reader=lambda _client, _method: {
                "actorPtid": "ptid:five-arm",
                "federatedHandle": "@remote@five-arm.invalid",
                "homeStationPeerId": "station-five-arm-peer",
            },
            authority_reader=lambda _client, _method: {
                "federationEndpoint": "https://four.invalid",
                "federationId": "federation-1",
                "homeStationPeerId": "station-four-peer",
            },
            federation_action=federation_action,
        )

        self.assertEqual(1, len(registrations))
        self.assertEqual(
            [
                (
                    primary_client,
                    "federationMemberStations",
                    {"federationId": "federation-1"},
                ),
                (
                    remote_client,
                    "joinAcceptanceFederation",
                    {
                        "federationEndpoint": "https://four.invalid",
                        "federationId": "federation-1",
                    },
                ),
                (
                    primary_client,
                    "federationMemberStations",
                    {"federationId": "federation-1"},
                ),
                (
                    remote_client,
                    "federationMemberStations",
                    {"federationId": "federation-1"},
                ),
                (
                    primary_client,
                    "resolveFederatedActorIdentity",
                    {"federatedHandle": "@remote@five-arm.invalid"},
                ),
            ],
            actions,
        )
        self.assertEqual(
            ("https://five-arm.invalid", "remote_recipient"),
            registrations[0][:2],
        )
        self.assertEqual("", provisioner.account)
        self.assertEqual(
            "actor-identity-provisioner",
            owner.manifest()["handles"][0]["owner"],
        )

    def test_w8_remote_recipient_can_reuse_an_existing_account(self) -> None:
        registrar = MagicMock()
        provisioner = RemotePrivateRecipientProvisioner(
            source_checkpoint=COMMIT,
            run_id="w8-existing-account",
            station_url="https://five-arm.invalid",
            password="fixture-password",
            account_registrar=registrar,
            existing_account="carol@p.t",
        )

        self.assertEqual("carol@p.t", provisioner.account)
        registrar.assert_not_called()

    def test_w8_remote_recipient_reuses_an_existing_shared_federation(
        self,
    ) -> None:
        provisioner = RemotePrivateRecipientProvisioner(
            source_checkpoint=COMMIT,
            run_id="w8-provisioner-existing-federation",
            station_url="https://five-arm.invalid",
            password="fixture-password",
            account_registrar=lambda *_args, **_kwargs: (
                "remote@testnet.local"
            ),
        )
        actions: list[str] = []

        def federation_action(
            _client: object,
            method: str,
            _payload: Mapping[str, object],
        ) -> Mapping[str, object]:
            actions.append(method)
            if method == "federationMemberStations":
                return {
                    "stationPeerIds": [
                        "station-four-peer",
                        "station-five-arm-peer",
                    ],
                }
            if method == "resolveFederatedActorIdentity":
                return {
                    "actorPtid": "ptid:five-arm",
                    "federatedHandle": "@remote@five-arm.invalid",
                    "homeStationPeerId": "station-five-arm-peer",
                }
            raise AssertionError(f"unexpected action {method}")

        provisioner.bind_identity(
            primary_client=object(),
            remote_client=object(),
            identity_reader=lambda _client, _method: {
                "actorPtid": "ptid:five-arm",
                "federatedHandle": "@remote@five-arm.invalid",
                "homeStationPeerId": "station-five-arm-peer",
            },
            authority_reader=lambda _client, _method: {
                "federationEndpoint": "https://four.invalid",
                "federationId": "federation-1",
                "homeStationPeerId": "station-four-peer",
            },
            federation_action=federation_action,
        )

        self.assertNotIn("joinAcceptanceFederation", actions)

    def test_w8_remote_recipient_rejects_mismatched_primary_resolution(
        self,
    ) -> None:
        provisioner = RemotePrivateRecipientProvisioner(
            source_checkpoint=COMMIT,
            run_id="w8-provisioner-mismatch",
            station_url="https://five-arm.invalid",
            password="fixture-password",
            account_registrar=lambda *_args, **_kwargs: (
                "remote@testnet.local"
            ),
        )

        with self.assertRaisesRegex(
            ValueError,
            "does not match the fiveArm Actor identity",
        ):
            provisioner.bind_identity(
                primary_client=object(),
                remote_client=object(),
                identity_reader=lambda _client, _method: {
                    "actorPtid": "ptid:five-arm",
                    "federatedHandle": "@remote@five-arm.invalid",
                    "homeStationPeerId": "station-five-arm-peer",
                },
                authority_reader=lambda _client, _method: {
                    "federationEndpoint": "https://four.invalid",
                    "federationId": "federation-1",
                    "homeStationPeerId": "station-four-peer",
                },
                federation_action=lambda _client, method, _payload: (
                    {
                        "actorPtid": "ptid:unexpected",
                        "federatedHandle": "@remote@five-arm.invalid",
                        "homeStationPeerId": "station-five-arm-peer",
                    }
                    if method == "resolveFederatedActorIdentity"
                    else {
                        "stationPeerIds": [
                            "station-four-peer",
                            "station-five-arm-peer",
                        ],
                    }
                ),
            )

    def test_w8_private_content_keys_require_published_prekeys(self) -> None:
        client = SimpleNamespace(spec=SimpleNamespace(profile="alice"))
        with patch(
            "tooling.development.secure_content.runtime_owner._fixture_harness",
            return_value={
                "actorPtid": "ptid:alice",
                "recoveryPreKeyAvailable": 1,
            },
        ) as harness:
            _prepare_private_content_keys(client)
        harness.assert_called_once_with(
            client,
            "prepareHistoricalRecoveryEpoch",
        )

        with (
            patch(
                "tooling.development.secure_content.runtime_owner._fixture_harness",
                return_value={
                    "actorPtid": "ptid:alice",
                    "recoveryPreKeyAvailable": 0,
                },
            ),
            self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "could not resolve private-content-prekey-availability",
            ),
        ):
            _prepare_private_content_keys(client)

    def test_remote_recipient_reuses_one_actor_identity_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = SimpleNamespace(
                actor_identity_root=root / "run" / "actor-identity",
                spec=SimpleNamespace(profile="remote-recipient"),
            )
            shared = root / "shared" / "actor-identity"

            _bind_reusable_actor_identity(client, shared)
            _bind_reusable_actor_identity(client, shared)

            self.assertTrue(client.actor_identity_root.is_symlink())
            self.assertEqual(shared.resolve(), client.actor_identity_root.resolve())
            self.assertEqual(0o700, shared.stat().st_mode & 0o777)

    def test_remote_recipient_rejects_non_reusable_identity_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            actor_identity_root = root / "run" / "actor-identity"
            actor_identity_root.mkdir(parents=True)
            client = SimpleNamespace(
                actor_identity_root=actor_identity_root,
                spec=SimpleNamespace(profile="remote-recipient"),
            )

            with self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "Actor Identity is not reusable",
            ):
                _bind_reusable_actor_identity(
                    client,
                    root / "shared" / "actor-identity",
                )

    def test_portable_recovery_maintains_prekeys_for_created_epoch(
        self,
    ) -> None:
        def native_result(payload: Mapping[str, object]) -> Mapping[str, object]:
            return {
                "ok": True,
                "value": {
                    "ok": True,
                    "data": {"status": json.dumps(payload)},
                },
            }

        client = MagicMock()
        client.spec = SimpleNamespace(profile="bob")
        words = [f"word-{index}" for index in range(24)]
        client.driver.execute_async_script.side_effect = (
            native_result({"words": words}),
            native_result(
                {
                    "backup": {"backupId": "backup-bob"},
                    "recoveryEpoch": 7,
                }
            ),
            native_result(
                {
                    "recoveryEpoch": 7,
                    "recoveryPreKeyAvailable": 100,
                }
            ),
        )

        phrase, prepared = _prepare_portable_recovery(client)

        self.assertEqual(" ".join(words), phrase)
        self.assertEqual(
            {
                "backupIdSha256": hashlib.sha256(
                    b"backup-bob"
                ).hexdigest(),
                "preparedEpoch": 7,
                "recoveryPreKeyAvailable": 100,
            },
            prepared,
        )
        maintenance = client.driver.execute_async_script.call_args_list[2]
        self.assertIn(
            "import('/src/store/privateMoments.ts')",
            maintenance.args[0],
        )
        self.assertEqual(
            "social_private_moments_acceptance_maintain_prekeys",
            maintenance.args[1],
        )

    def test_portable_recovery_rejects_mismatched_prekey_epoch(self) -> None:
        client = MagicMock()
        client.spec = SimpleNamespace(profile="bob")
        client.driver.execute_async_script.return_value = {
            "ok": True,
            "value": {
                "ok": True,
                "data": {
                    "status": json.dumps(
                        {
                            "recoveryEpoch": 8,
                            "recoveryPreKeyAvailable": 100,
                        }
                    )
                },
            },
        }

        with self.assertRaisesRegex(
            RuntimeOwnerBlocked,
            "PreKey pool is unavailable",
        ):
            _maintain_current_recovery_prekeys(
                client,
                expected_recovery_epoch=7,
            )

    def test_w8_remote_recipient_waits_for_mls_keypackage(self) -> None:
        client = MagicMock()
        client.spec = SimpleNamespace(profile="fiveArm")
        client.harness_namespace = "moments"
        states = iter(
            (
                {
                    "actorPtid": "ptid:remote",
                    "deviceId": "remote-device",
                    "active": False,
                    "availableKeyPackages": 0,
                },
                {
                    "actorPtid": "ptid:remote",
                    "deviceId": "remote-device",
                    "active": True,
                    "availableKeyPackages": 0,
                },
                {
                    "actorPtid": "ptid:remote",
                    "deviceId": "remote-device",
                    "active": True,
                    "availableKeyPackages": 1,
                },
            )
        )
        observed_namespaces: list[str] = []

        def harness(
            _method: str,
            _payload: Mapping[str, object],
            *,
            timeout: float,
        ) -> Mapping[str, object]:
            self.assertEqual(15, timeout)
            observed_namespaces.append(client.harness_namespace)
            return next(states)

        def immediate_wait(
            predicate: Callable[[], Mapping[str, object] | None],
            description: str,
            *,
            timeout: float,
            interval: float,
        ) -> Mapping[str, object]:
            self.assertIn("MLS KeyPackage inventory", description)
            self.assertEqual(120, timeout)
            self.assertEqual(1, interval)
            for _ in range(3):
                result = predicate()
                if result:
                    return result
            raise AssertionError("MLS readiness did not converge")

        client.harness.side_effect = harness
        with patch(
            "tooling.development.secure_content.runtime_owner.wait_until",
            side_effect=immediate_wait,
        ):
            result = _wait_for_mls_readiness(client)

        self.assertEqual(1, result["availableKeyPackages"])
        self.assertEqual(["chat", "chat", "chat"], observed_namespaces)
        self.assertEqual("moments", client.harness_namespace)
        self.assertEqual(
            [call("mlsReadiness", {}, timeout=15)] * 3,
            client.harness.call_args_list,
        )

    def test_w8_remote_recipient_mls_readiness_fails_closed(self) -> None:
        client = SimpleNamespace(spec=SimpleNamespace(profile="fiveArm"))

        def fail_wait(
            predicate: Callable[[], Mapping[str, object] | None],
            _description: str,
            *,
            timeout: float,
            interval: float,
        ) -> None:
            self.assertEqual(120, timeout)
            self.assertEqual(1, interval)
            self.assertIsNone(predicate())
            raise FoundationClientError("timed out")

        with (
            patch(
                "tooling.development.secure_content.runtime_owner._chat_harness",
                return_value={
                    "actorPtid": "ptid:remote",
                    "deviceId": "remote-device",
                    "active": True,
                    "availableKeyPackages": 0,
                },
            ),
            patch(
                "tooling.development.secure_content.runtime_owner.wait_until",
                side_effect=fail_wait,
            ),
            self.assertRaises(RuntimeOwnerBlocked) as raised,
        ):
            _wait_for_mls_readiness(client)

        self.assertEqual("FIXTURE_OWNER_UNAVAILABLE", raised.exception.code)
        self.assertEqual("fixture-mls:fiveArm", raised.exception.resource)

    def test_client_launch_uses_projected_runtime_source_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch(
                    "tooling.development.secure_content.runtime_owner._free_port",
                    side_effect=(4501, 4502, 4503),
                ),
                patch(
                    "tooling.development.secure_content.runtime_owner."
                    "FoundationRuntimeClient"
                ) as client_type,
            ):
                _make_client(
                    repo_root=Path(__file__).resolve().parents[3],
                    runtime_root=Path(directory),
                    station_url="https://station.invalid",
                    profile_env={},
                    source_commit=COMMIT,
                    client_id="desktop-alice",
                    runtime_kind="native-tauri",
                    port_bases=(4501, 4502, 4503),
                    reserved_ports=set(),
                )

        self.assertEqual(
            {
                "PT_BUILD_SOURCE_COMMIT": COMMIT,
                "PT_SECURE_CONTENT_RUNTIME_OWNER": "1",
            },
            client_type.call_args.kwargs["launch_env"],
        )
        self.assertEqual(
            COMMIT,
            client_type.call_args.kwargs["profile_env"][
                "PT_BUILD_SOURCE_COMMIT"
            ],
        )

    def test_running_client_authentication_uses_fixture_replacement_and_retries(
        self,
    ) -> None:
        client = MagicMock()
        client.driver = object()
        client.harness_namespace = "moments"
        client.spec = SimpleNamespace(profile="secure-content-desktop-alice")
        namespaces: list[str] = []

        def restore(*_args: object, **_kwargs: object) -> Mapping[str, object]:
            namespaces.append(client.harness_namespace)
            if len(namespaces) == 1:
                raise RuntimeError("acceptance bridge reloading")
            return {"authenticated": True}

        client.harness.side_effect = restore

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            _authenticate_running_client(
                client,
                account="alice@testnet.local",
                password="password",
            )

        self.assertEqual(2, client.harness.call_count)
        self.assertEqual(
            [
                call(
                    "restoreSessionWithPassword",
                    {
                        "account": "alice@testnet.local",
                        "password": "password",
                    },
                    timeout=120,
                ),
                call(
                    "restoreSessionWithPassword",
                    {
                        "account": "alice@testnet.local",
                        "password": "password",
                    },
                    timeout=120,
                ),
            ],
            client.harness.call_args_list,
        )
        self.assertEqual(
            ["secure-content-fixture", "secure-content-fixture"],
            namespaces,
        )
        self.assertEqual("moments", client.harness_namespace)

    def test_runtime_accounts_are_unique_and_provisioned_on_required_stations(
        self,
    ) -> None:
        response = MagicMock()
        response.status = 201
        response.read.return_value = b"{}"
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with patch(
            "tooling.development.secure_content.runtime_owner."
            "urllib.request.urlopen",
            return_value=response,
        ) as open_request:
            accounts, password = _provision_runtime_accounts(
                primary_station_url="http://127.0.0.1:4101",
                secondary_station_url="http://127.0.0.1:4102",
                run_id="w7-runtime-accounts",
                roles=("alice", "bob", "eve", "browser_actor"),
                secondary_roles=("bob",),
            )

        self.assertEqual(
            {"alice", "bob", "eve", "browser_actor"},
            set(accounts),
        )
        self.assertEqual(4, len(set(accounts.values())))
        self.assertTrue(password.startswith("W7Aa1!"))
        self.assertEqual(5, open_request.call_count)
        urls = [call.args[0].full_url for call in open_request.call_args_list]
        self.assertEqual(4, urls.count("http://127.0.0.1:4101/actor/sign-up"))
        self.assertEqual(1, urls.count("http://127.0.0.1:4102/actor/sign-up"))

    def test_runtime_account_name_is_unique_across_roles_and_runs(self) -> None:
        response = MagicMock()
        response.status = 201
        response.read.return_value = b"{}"
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with patch(
            "tooling.development.secure_content.runtime_owner."
            "urllib.request.urlopen",
            return_value=response,
        ) as open_request:
            for role, suffix in (
                ("browser_actor", "a" * 10),
                ("browser_anonymous_bootstrap", "a" * 10),
                ("browser_anonymous_bootstrap", "b" * 10),
            ):
                _register_runtime_account(
                    "http://127.0.0.1:4101",
                    role=role,
                    suffix=suffix,
                    password="password",
                )

        names = [
            json.loads(item.args[0].data)["name"]
            for item in open_request.call_args_list
        ]
        self.assertEqual(3, len(set(names)))
        self.assertTrue(all(name.startswith("sc-") for name in names))
        self.assertTrue(all(len(name) == 20 for name in names))

    def test_runtime_account_search_uses_registered_preferred_username(
        self,
    ) -> None:
        response = MagicMock()
        response.status = 201
        response.read.return_value = b"{}"
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with patch(
            "tooling.development.secure_content.runtime_owner."
            "urllib.request.urlopen",
            return_value=response,
        ) as open_request:
            account = _register_runtime_account(
                "http://127.0.0.1:4101",
                role="bob",
                suffix="a" * 10,
                password="password",
            )

        registered = json.loads(open_request.call_args.args[0].data)
        self.assertEqual(
            registered["name"],
            _runtime_account_search_query(account, role="bob"),
        )

    def test_accepted_friendship_uses_social_authority_flow(self) -> None:
        alice = MagicMock()
        alice.harness_namespace = "agent"
        alice.harness.side_effect = (
            {"actorPtid": "ptid:alice"},
            {
                "federationId": "federation-1",
                "homeStationPeerId": "station-four",
            },
            {"requestId": "friend-request-1"},
        )
        bob = MagicMock()
        bob.harness_namespace = "agent"
        bob.harness.side_effect = (
            {"actorPtid": "ptid:bob"},
            {
                "federationId": "federation-1",
                "homeStationPeerId": "station-four",
            },
            {"accepted": True, "requestId": "friend-request-1"},
        )

        _prepare_accepted_friendship(alice, bob)

        self.assertEqual(
            [
                call("acceptanceActorIdentity", {}, timeout=120),
                call("friendshipAuthority", {}, timeout=120),
                call(
                    "sendFriendRequest",
                    {
                        "actorPtid": "ptid:bob",
                        "federationId": "federation-1",
                        "homeStationPeerId": "station-four",
                    },
                    timeout=120,
                ),
            ],
            alice.harness.call_args_list,
        )
        self.assertEqual(
            [
                call("acceptanceActorIdentity", {}, timeout=120),
                call("friendshipAuthority", {}, timeout=120),
                call(
                    "acceptFriendRequest",
                    {"actorPtid": "ptid:alice"},
                    timeout=120,
                ),
            ],
            bob.harness.call_args_list,
        )
        self.assertEqual("agent", alice.harness_namespace)
        self.assertEqual("agent", bob.harness_namespace)

    def test_fixture_owner_prepares_recovery_prekeys_for_author_and_recipient(
        self,
    ) -> None:
        alice = MagicMock(name="alice")
        bob = MagicMock(name="bob")
        eve = MagicMock(name="eve")
        fixture_calls: list[tuple[object, str]] = []

        def fixture_harness(
            client: object,
            method: str,
            _payload: Mapping[str, object] | None = None,
            *,
            timeout: float = 120,
        ) -> Mapping[str, object]:
            del timeout
            fixture_calls.append((client, method))
            if method == "prepareAccountSwitch":
                return {
                    "primaryAccountId": "eve-account",
                    "secondaryAccountId": "alice-account",
                    "primaryActorPtid": "ptid:eve",
                    "secondaryActorPtid": "ptid:alice",
                    "primaryStorageIdentitySha256": "1" * 64,
                    "secondaryStorageIdentitySha256": "2" * 64,
                }
            if method == "prepareStationSwitch":
                return {
                    "primaryStationUrl": "http://127.0.0.1:4101",
                    "secondaryStationUrl": "http://127.0.0.1:4102",
                    "primaryStationPeerId": "station-four",
                    "secondaryStationPeerId": "station-five-arm",
                }
            if method == "preparePublisherDeviceRevocation":
                return {
                    "actorPtid": "ptid:alice",
                    "deviceId": "alice-device",
                    "observedProfileVersion": "1",
                }
            if method == "prepareHistoricalRecoveryEpoch":
                actor = "alice" if client is alice else "bob"
                return {
                    "actorPtid": f"ptid:{actor}",
                    "backupId": f"{actor}-backup",
                    "recoveryEpoch": 1,
                    "recoveryPreKeyAvailable": 100,
                }
            raise AssertionError(f"unexpected fixture method: {method}")

        with (
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_fixture_harness",
                side_effect=fixture_harness,
            ),
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_authenticate_running_client",
            ),
        ):
            owner = _build_fixture_owner(
                identity=IDENTITY,
                run_id="w7-recovery-precondition",
                secondary_station_url="http://127.0.0.1:4102",
                password="password",
                accounts={
                    "alice": "alice@testnet.local",
                    "bob": "bob@testnet.local",
                    "eve": "eve@testnet.local",
                },
                desktop={
                    "secure-content-desktop-alice": alice,
                    "secure-content-desktop-bob": bob,
                    "secure-content-desktop-eve": eve,
                },
            )

        recovery_clients = [
            client
            for client, method in fixture_calls
            if method == "prepareHistoricalRecoveryEpoch"
        ]
        self.assertEqual(2, len(recovery_clients))
        self.assertIs(alice, recovery_clients[0])
        self.assertIs(bob, recovery_clients[1])
        self.assertEqual(
            {"historical-recovery-epoch"},
            {
                handle["capability"]
                for handle in owner.manifest()["handles"]
                if handle["capability"] == "historical-recovery-epoch"
            },
        )

    def test_moments_readiness_retries_transient_native_identity_gap(
        self,
    ) -> None:
        snapshot = {
            "platform": "native",
            "nativeRuntimeIdentitySha256": "1" * 64,
        }
        client = MagicMock()
        client.harness_namespace = "agent"
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-alice"
        )
        client.harness.side_effect = (
            FoundationClientError(
                "native-tauri harness snapshot failed: "
                "moments.acceptance.nativeRuntimeIdentityMissing"
            ),
            snapshot,
        )

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            result = _wait_for_moments_snapshot(client)

        self.assertEqual(snapshot, result)
        self.assertEqual("moments", client.harness_namespace)
        self.assertEqual(
            [
                call("snapshot", timeout=10),
                call("snapshot", timeout=10),
            ],
            client.harness.call_args_list,
        )

    def test_moments_readiness_retries_transient_browser_identity_gap(
        self,
    ) -> None:
        snapshot = {
            "platform": "browser",
            "bootIdentitySha256": "2" * 64,
        }
        client = MagicMock()
        client.harness_namespace = "agent"
        client.spec = SimpleNamespace(
            profile="secure-content-browser-authenticated"
        )
        client.harness.side_effect = (
            FoundationClientError(
                "browser harness snapshot failed: "
                "moments.acceptance.browserRuntimeIdentityMissing"
            ),
            snapshot,
        )

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            result = _wait_for_moments_snapshot(client)

        self.assertEqual(snapshot, result)
        self.assertEqual(2, client.harness.call_count)

    def test_moments_readiness_retries_transient_script_timeout(self) -> None:
        snapshot = {
            "platform": "native",
            "nativeRuntimeIdentitySha256": "1" * 64,
        }
        client = MagicMock()
        client.harness_namespace = "agent"
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-eve",
            runtime="native-tauri",
        )
        client.harness.side_effect = (
            FoundationClientError(
                "native-tauri harness snapshot failed: "
                "Message: Script execution timed out"
            ),
            snapshot,
        )

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            result = _wait_for_moments_snapshot(client)

        self.assertEqual(snapshot, result)
        self.assertEqual(2, client.harness.call_count)

    def test_moments_readiness_retries_transient_browser_platform(
        self,
    ) -> None:
        snapshot = {
            "platform": "browser",
            "bootIdentitySha256": "2" * 64,
        }
        client = MagicMock()
        client.harness_namespace = "agent"
        client.spec = SimpleNamespace(
            profile="secure-content-browser-anonymous",
            runtime="browser",
        )
        client.harness.side_effect = (
            {
                "platform": "unknown",
                "bootIdentitySha256": "1" * 64,
            },
            snapshot,
        )

        with patch(
            "tooling.development.secure_content.runtime_owner.harness_ready",
            return_value=True,
        ):
            result = _wait_for_moments_snapshot(client)

        self.assertEqual(snapshot, result)
        self.assertEqual(2, client.harness.call_count)

    def test_moments_readiness_timeout_is_typed(self) -> None:
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-bob"
        )

        with (
            patch(
                "tooling.development.secure_content.runtime_owner.harness_ready",
                return_value=True,
            ),
            patch(
                "tooling.development.secure_content.runtime_owner.wait_until",
                side_effect=RuntimeError(
                    "moments.acceptance.nativeRuntimeIdentityMissing"
                ),
            ),
        ):
            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _wait_for_moments_snapshot(client)

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertEqual(
            "client:secure-content-desktop-bob",
            raised.exception.resource,
        )

    def test_start_client_uses_shared_moments_readiness(self) -> None:
        snapshot = {
            "platform": "native",
            "nativeRuntimeIdentitySha256": "1" * 64,
        }
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-alice",
            runtime="native-tauri",
        )
        client.harness_namespace = "agent"

        with (
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_authenticate_running_client",
            ) as authenticate,
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_wait_for_moments_snapshot",
                return_value=snapshot,
            ) as wait_for_snapshot,
        ):
            result = _start_client(
                client,
                account="alice@p.t",
                password="1",
            )

        client.start.assert_called_once_with()
        client.configure_station.assert_called_once_with()
        authenticate.assert_called_once_with(
            client,
            account="alice@p.t",
            password="1",
        )
        wait_for_snapshot.assert_called_once_with(client)
        self.assertEqual(snapshot, result)
        self.assertEqual("agent", client.harness_namespace)

    def test_start_client_converts_exhausted_driver_startup_to_typed_blocker(
        self,
    ) -> None:
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-desktop-alice",
            runtime="native-tauri",
        )
        client.start.side_effect = FoundationClientError(
            "timed out waiting for Native embedded WebDriver session"
        )

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _start_client(
                client,
                account="alice@p.t",
                password="1",
            )

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertEqual(
            "client:secure-content-desktop-alice",
            raised.exception.resource,
        )
        self.assertIn(
            "Native embedded WebDriver session",
            str(raised.exception),
        )
        client.configure_station.assert_not_called()

    def test_start_browser_client_completes_station_binding_after_authentication(
        self,
    ) -> None:
        snapshot = {
            "platform": "browser",
            "nativeRuntimeIdentitySha256": "",
        }
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-browser-authenticated",
            runtime="browser",
        )
        events: list[str] = []
        client.start.side_effect = lambda: events.append("start")
        client.configure_station.side_effect = lambda: events.append(
            "configure-station"
        )

        with (
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_authenticate_running_client",
                side_effect=lambda *_args, **_kwargs: events.append(
                    "authenticate"
                ),
            ),
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_ensure_browser_station_binding",
                side_effect=lambda *_args, **_kwargs: events.append(
                    "complete-binding"
                ),
            ) as ensure_station_binding,
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_wait_for_moments_snapshot",
                return_value=snapshot,
            ) as wait_for_snapshot,
        ):
            result = _start_client(
                client,
                account="alice@p.t",
                password="1",
            )

        client.start.assert_called_once_with()
        client.configure_station.assert_called_once_with()
        ensure_station_binding.assert_called_once_with(client)
        wait_for_snapshot.assert_called_once_with(client)
        self.assertEqual(
            ["start", "configure-station", "authenticate", "complete-binding"],
            events,
        )
        self.assertEqual(snapshot, result)

    def test_start_anonymous_browser_client_binds_then_clears_session(
        self,
    ) -> None:
        authenticated_snapshot = {
            "platform": "browser",
            "authenticationState": "AUTHENTICATED",
        }
        anonymous_snapshot = {
            "platform": "browser",
            "authenticationState": "ANONYMOUS",
            "nativeRuntimeIdentitySha256": "",
        }
        client = MagicMock()
        client.spec = SimpleNamespace(
            profile="secure-content-browser-anonymous",
            runtime="browser",
        )
        client.harness_namespace = "agent"
        events: list[str] = []
        client.start.side_effect = lambda: events.append("start")
        client.configure_station.side_effect = lambda: events.append(
            "configure-station"
        )
        client.harness.side_effect = lambda *_args, **_kwargs: events.append(
            "logout"
        )

        with (
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_authenticate_running_client",
                side_effect=lambda *_args, **_kwargs: events.append(
                    "authenticate"
                ),
            ) as authenticate,
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_ensure_browser_station_binding",
                side_effect=lambda *_args, **_kwargs: events.append(
                    "complete-binding"
                ),
            ) as ensure_station_binding,
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_wait_for_moments_snapshot",
                side_effect=(
                    authenticated_snapshot,
                    anonymous_snapshot,
                ),
            ) as wait_for_snapshot,
        ):
            result = _start_client(
                client,
                account=None,
                password="1",
                anonymous_binding_account="anonymous-bootstrap@p.t",
            )

        authenticate.assert_called_once_with(
            client,
            account="anonymous-bootstrap@p.t",
            password="1",
        )
        ensure_station_binding.assert_called_once_with(client)
        client.harness.assert_called_once_with("logout", timeout=120)
        self.assertEqual(2, wait_for_snapshot.call_count)
        self.assertEqual(
            [
                "start",
                "configure-station",
                "authenticate",
                "complete-binding",
                "logout",
            ],
            events,
        )
        self.assertEqual(anonymous_snapshot, result)

    def test_browser_manifest_attachment_recovers_lost_harness_once(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            storage_root = root / "storage"
            storage_root.mkdir()
            output_path = root / "runtime.json"
            old_driver = SimpleNamespace(
                session_id="webdriver-old",
                command_executor=SimpleNamespace(
                    _client_config=SimpleNamespace(
                        remote_server_addr="http://127.0.0.1:9515",
                    ),
                ),
            )
            new_driver = SimpleNamespace(
                session_id="webdriver-new",
                command_executor=SimpleNamespace(
                    _client_config=SimpleNamespace(
                        remote_server_addr="http://127.0.0.1:9516",
                    ),
                ),
            )
            client = MagicMock()
            client.spec = SimpleNamespace(
                profile="secure-content-browser-authenticated",
                runtime="browser",
                storage_root=storage_root,
            )
            client.harness_namespace = "agent"
            client.driver = old_driver
            client.restart.side_effect = lambda: setattr(
                client,
                "driver",
                new_driver,
            )
            previous = {
                "id": "secure-content-browser-authenticated",
                "actor_role": "browser_actor",
                "actor_role_digest": "a" * 64,
                "runtime_kind": "browser",
                "required_service_roles": [
                    "station",
                    "station-secondary",
                ],
                "service_bindings": {
                    "station": {
                        "service_id": "station-four",
                        "required_kind": "station",
                    },
                    "station-secondary": {
                        "service_id": "station-five-arm",
                        "required_kind": "station",
                    },
                },
                "storage_identity_digest": _storage_identity(storage_root),
                "boot_identity": "1" * 64,
                "session_generation": 1,
            }
            recovered_snapshot = {
                "platform": "browser",
                "actorPtidSha256": "a" * 64,
                "bootIdentitySha256": "2" * 64,
                "sessionGeneration": 2,
            }
            attachment_error = RunnerError(
                "runtime client 'secure-content-browser-authenticated' "
                "did not expose 'moments' acceptance harness"
            )

            with (
                patch(
                    "tooling.development.secure_content.runtime_owner."
                    "write_attached_runtime_manifest",
                    side_effect=(attachment_error, output_path),
                ) as write_manifest,
                patch(
                    "tooling.development.secure_content.runtime_owner."
                    "_wait_for_moments_snapshot",
                    return_value=recovered_snapshot,
                ) as wait_for_snapshot,
            ):
                result = _write_browser_runtime_manifest_with_recovery(
                    manifest_payload={"clients": [previous]},
                    output_path=output_path,
                    journey_id=BROWSER_JOURNEY,
                    sessions_by_client={previous["id"]: client},
                    repo_root=root,
                )

        self.assertEqual(output_path, result)
        client.restart.assert_called_once_with()
        wait_for_snapshot.assert_called_once_with(client)
        self.assertEqual("agent", client.harness_namespace)
        self.assertEqual(2, write_manifest.call_count)
        first_call, recovered_call = write_manifest.call_args_list
        self.assertEqual(
            "webdriver-old",
            first_call.kwargs["automation_refs_by_client"][
                previous["id"]
            ]["session_id"],
        )
        self.assertEqual(
            "webdriver-new",
            recovered_call.kwargs["automation_refs_by_client"][
                previous["id"]
            ]["session_id"],
        )
        recovered_client = recovered_call.kwargs["manifest_payload"][
            "clients"
        ][0]
        self.assertEqual(
            previous["storage_identity_digest"],
            recovered_client["storage_identity_digest"],
        )
        self.assertEqual("2" * 64, recovered_client["boot_identity"])
        self.assertEqual(2, recovered_client["session_generation"])

    def test_browser_manifest_attachment_recovery_is_bounded_per_client(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            storage_root = root / "storage"
            storage_root.mkdir()
            driver = SimpleNamespace(
                session_id="webdriver",
                command_executor=SimpleNamespace(
                    _client_config=SimpleNamespace(
                        remote_server_addr="http://127.0.0.1:9515",
                    ),
                ),
            )
            client = MagicMock()
            client.spec = SimpleNamespace(
                profile="secure-content-browser-authenticated",
                runtime="browser",
                storage_root=storage_root,
            )
            client.harness_namespace = "agent"
            client.driver = driver
            client.restart.side_effect = lambda: setattr(
                client,
                "driver",
                SimpleNamespace(
                    session_id="webdriver-recovered",
                    command_executor=driver.command_executor,
                ),
            )
            previous = {
                "id": "secure-content-browser-authenticated",
                "actor_role": "browser_actor",
                "actor_role_digest": "a" * 64,
                "service_bindings": {
                    "station": {
                        "service_id": "station-four",
                        "required_kind": "station",
                    },
                },
                "storage_identity_digest": _storage_identity(storage_root),
            }
            attachment_error = RunnerError(
                "runtime client 'secure-content-browser-authenticated' "
                "did not expose 'moments' acceptance harness"
            )

            with (
                patch(
                    "tooling.development.secure_content.runtime_owner."
                    "write_attached_runtime_manifest",
                    side_effect=(attachment_error, attachment_error),
                ) as write_manifest,
                patch(
                    "tooling.development.secure_content.runtime_owner."
                    "_wait_for_moments_snapshot",
                    return_value={
                        "actorPtidSha256": "a" * 64,
                        "bootIdentitySha256": "2" * 64,
                        "sessionGeneration": 2,
                    },
                ),
                self.assertRaises(RuntimeOwnerBlocked) as raised,
            ):
                _write_browser_runtime_manifest_with_recovery(
                    manifest_payload={"clients": [previous]},
                    output_path=root / "runtime.json",
                    journey_id=BROWSER_JOURNEY,
                    sessions_by_client={previous["id"]: client},
                    repo_root=root,
                )

        client.restart.assert_called_once_with()
        self.assertEqual(2, write_manifest.call_count)
        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertIn("one bounded", str(raised.exception))

    def test_station_tunnels_target_reviewed_profile_hosts_and_close(
        self,
    ) -> None:
        primary = MagicMock(local_port=4101)
        primary.is_alive.return_value = False
        secondary = MagicMock(local_port=4102)
        secondary.is_alive.return_value = False
        renewed_primary = MagicMock(local_port=4101)
        renewed_primary.is_alive.return_value = False
        renewed_secondary = MagicMock(local_port=4102)
        renewed_secondary.is_alive.return_value = False
        with patch(
            "tooling.development.secure_content.runtime_owner."
            "open_reviewed_remote_tunnel",
            side_effect=(
                primary,
                secondary,
                renewed_primary,
                renewed_secondary,
            ),
        ) as open_tunnel:
            stack, endpoints = _open_station_tunnels(
                (
                    (
                        "station-four",
                        {
                            "PT_STATION_MODE": "remote",
                            "PT_STATION_DEPLOY_ENV": "station-four",
                            "PT_STATION_PORT": "18080",
                            "PT_STATION_URL": "http://10.0.0.4:18080",
                        },
                    ),
                    (
                        "station-five-arm",
                        {
                            "PT_STATION_MODE": "remote",
                            "PT_STATION_DEPLOY_ENV": "station-five-arm",
                            "PT_STATION_PORT": "18080",
                            "PT_STATION_URL": "http://10.0.0.5:18080",
                        },
                    ),
                )
            )
            endpoints.refresh()
            stack.close()

        self.assertEqual(
            _StationEndpoint(
                transport_url="http://127.0.0.1:4101",
                canonical_origin="http://10.0.0.4:18080",
            ),
            endpoints["station-four"],
        )
        self.assertEqual(
            _StationEndpoint(
                transport_url="http://127.0.0.1:4102",
                canonical_origin="http://10.0.0.5:18080",
            ),
            endpoints["station-five-arm"],
        )
        self.assertEqual(
            [
                call(
                    "station-four",
                    remote_host="10.0.0.4",
                    remote_port=18080,
                ),
                call(
                    "station-five-arm",
                    remote_host="10.0.0.5",
                    remote_port=18080,
                ),
                call(
                    "station-four",
                    remote_host="10.0.0.4",
                    remote_port=18080,
                    local_port=4101,
                ),
                call(
                    "station-five-arm",
                    remote_host="10.0.0.5",
                    remote_port=18080,
                    local_port=4102,
                ),
            ],
            open_tunnel.call_args_list,
        )
        primary.stop.assert_called_once_with()
        secondary.stop.assert_called_once_with()
        renewed_primary.stop.assert_called_once_with()
        renewed_secondary.stop.assert_called_once_with()

    def test_https_station_endpoints_use_canonical_route_without_tunnel(
        self,
    ) -> None:
        with patch(
            "tooling.development.secure_content.runtime_owner."
            "open_reviewed_remote_tunnel",
        ) as open_tunnel:
            stack, endpoints = _open_station_tunnels(
                (
                    (
                        "station-four",
                        {
                            "PT_STATION_MODE": "remote",
                            "PT_STATION_DEPLOY_ENV": "station-four",
                            "PT_STATION_PORT": "443",
                            "PT_STATION_URL": "https://four.example:443",
                        },
                    ),
                )
            )
            stack.close()

        open_tunnel.assert_not_called()
        self.assertEqual(
            _StationEndpoint(
                transport_url="https://four.example:443",
                canonical_origin="https://four.example:443",
            ),
            endpoints["station-four"],
        )

    def test_station_tunnels_reject_non_remote_or_noncanonical_routes(
        self,
    ) -> None:
        invalid_profiles = (
            {
                "PT_STATION_MODE": "local",
                "PT_STATION_DEPLOY_ENV": "station-four",
                "PT_STATION_PORT": "18080",
                "PT_STATION_URL": "http://10.0.0.4:18080",
            },
            {
                "PT_STATION_MODE": "remote",
                "PT_STATION_DEPLOY_ENV": "station-four",
                "PT_STATION_PORT": "18080",
                "PT_STATION_URL": "http://127.0.0.1:18080",
            },
            {
                "PT_STATION_MODE": "remote",
                "PT_STATION_DEPLOY_ENV": "station-four",
                "PT_STATION_PORT": "18080",
                "PT_STATION_URL": "http://10.0.0.4:18081",
            },
        )
        for profile in invalid_profiles:
            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _open_station_tunnels((("station-four", profile),))
            self.assertEqual(
                "SERVICE_TRANSPORT_UNAVAILABLE",
                raised.exception.code,
            )
            self.assertEqual(
                "station-tunnel:station-four",
                raised.exception.resource,
            )

    def test_station_tunnel_refresh_failure_is_typed_and_cleanup_safe(
        self,
    ) -> None:
        primary = MagicMock(local_port=4101)
        primary.is_alive.return_value = False
        with patch(
            "tooling.development.secure_content.runtime_owner."
            "open_reviewed_remote_tunnel",
            side_effect=(
                primary,
                BlockedError(
                    "forward unavailable",
                    resource="deployment-tunnel:station-four",
                ),
            ),
        ):
            stack, endpoints = _open_station_tunnels(
                (
                    (
                        "station-four",
                        {
                            "PT_STATION_MODE": "remote",
                            "PT_STATION_DEPLOY_ENV": "station-four",
                            "PT_STATION_PORT": "18080",
                            "PT_STATION_URL": "http://10.0.0.4:18080",
                        },
                    ),
                )
            )
            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                endpoints.refresh()
            stack.close()

        self.assertEqual(
            "SERVICE_TRANSPORT_UNAVAILABLE",
            raised.exception.code,
        )
        self.assertIn("forward unavailable", str(raised.exception))
        self.assertEqual(
            "deployment-tunnel:station-four",
            raised.exception.resource,
        )
        self.assertEqual(2, primary.stop.call_count)

    def test_station_tunnel_open_failure_preserves_primary_error(self) -> None:
        primary = MagicMock(local_port=4101)
        primary.stop.side_effect = RuntimeError("tunnel cleanup failed")
        with patch(
            "tooling.development.secure_content.runtime_owner."
            "open_reviewed_remote_tunnel",
            side_effect=(
                primary,
                BlockedError(
                    "second tunnel failed",
                    resource="deployment-tunnel:station-five-arm",
                ),
            ),
        ):
            with self.assertRaisesRegex(
                RuntimeOwnerBlocked,
                "second tunnel failed",
            ) as raised:
                _open_station_tunnels(
                    (
                        (
                            "station-four",
                            {
                                "PT_STATION_MODE": "remote",
                                "PT_STATION_DEPLOY_ENV": "station-four",
                                "PT_STATION_PORT": "18080",
                                "PT_STATION_URL": "http://10.0.0.4:18080",
                            },
                        ),
                        (
                            "station-five-arm",
                            {
                                "PT_STATION_MODE": "remote",
                                "PT_STATION_DEPLOY_ENV": "station-five-arm",
                                "PT_STATION_PORT": "18080",
                                "PT_STATION_URL": "http://10.0.0.5:18080",
                            },
                        ),
                    )
                )

        self.assertEqual(1, len(raised.exception.secondary_cleanup_failures))
        self.assertIn(
            "RUNTIME_CLEANUP_FAILED",
            raised.exception.secondary_cleanup_failures[0],
        )
        self.assertIn(
            "tunnel cleanup failed",
            raised.exception.secondary_cleanup_failures[0],
        )

    def test_w7_refreshes_profile_owned_station_tunnels(
        self,
    ) -> None:
        source = inspect.getsource(
            W7RuntimeOwner.run_w7_desktop_suite
        )
        refreshes = [
            match.start()
            for match in re.finditer(
                re.escape("station_endpoints.refresh()"),
                source,
            )
        ]

        self.assertEqual(1, source.count("_open_station_tunnels("))
        self.assertEqual(2, len(refreshes))
        self.assertEqual(1, source.count("SuiteRuntimeLedger("))
        self.assertEqual(1, source.count("SuiteRuntimeAction.PROVISION"))
        self.assertLess(
            source.rindex("_start_client("),
            source.index(
                'scenario_id="desktop-pilot"',
            ),
        )
        self.assertLess(
            source.index("parent_path = write_attached_runtime_manifest("),
            source.index("blocked_result_path: Path | None = None"),
        )
        self.assertLess(
            source.index("blocked_result_path: Path | None = None"),
            refreshes[0],
        )
        self.assertLess(
            source.index("_stage_continuation_evidence("),
            refreshes[1],
        )
        self.assertLess(
            refreshes[1],
            source.index("desktop_result = execute_scenario("),
        )
        self.assertLess(
            source.index('scenario_id="desktop-pre-restart"'),
            source.index('scenario_id="desktop-continuity"'),
        )
        self.assertNotIn("desktop.clear()", source)
        self.assertIn("work_item_id=WORK_ITEM_ID", source)
        self.assertIn("task_id=TASK_ID", source)
        self.assertNotIn("BROWSER_JOURNEY", source)

    def test_mobile_station_binding_uses_canonical_origin_not_tunnel(self) -> None:
        session = MagicMock()
        calls: list[tuple[str, Mapping[str, object]]] = []

        def mobile_call(
            _session: object,
            action: str,
            payload: Mapping[str, object] | None = None,
            *,
            sensitive_values: tuple[str, ...] = (),
        ) -> Mapping[str, object]:
            self.assertTrue(
                not sensitive_values
                or sensitive_values == (RECOVERY_PHRASE,)
            )
            request = dict(payload or {})
            calls.append((action, request))
            if action == "station.add":
                return {"verifiedStationPeerId": "station-peer"}
            if action == "access.submit" and request["kind"] == "start":
                return {"decision": {"attemptId": "attempt-1"}}
            if action == "access.submit" and request["kind"] == "login":
                return {
                    "session": {
                        "actorPtid": "ptid:alice",
                        "stationPeerId": "station-peer",
                    }
                }
            if action == "lifecycle.restart":
                return {"requested": True, "scope": "webview"}
            if action == "lifecycle.scope.read":
                return {
                    "phase": "ACTIVE",
                    "activeStationPeerId": "station-peer",
                    "activeActorPtid": "ptid:alice",
                }
            if action == "moments.private.snapshot":
                return {
                    "active": True,
                    "stationPeerId": "station-peer",
                    "actorPtid": "ptid:alice",
                    "errorMessage": None,
                }
            if action == "moments.private.storeRecoveryPhrase":
                return {"stored": True, "recoveryEpoch": 1}
            if action == "moments.private.reconcile":
                return {
                    "active": True,
                    "report": {
                        "endpointPrekeysAvailable": 100,
                        "recoveryPrekeysAvailable": 100,
                    },
                }
            if action == "recovery.snapshot":
                return {
                    "writeAdmission": {
                        "open": True,
                        "reason": None,
                    },
                }
            if action == "build.identity":
                return {
                    "identity": {
                        "sourceCommit": COMMIT,
                        "workspaceState": "clean",
                    }
                }
            raise AssertionError(f"unexpected action {action}")

        endpoint = _StationEndpoint(
            transport_url="http://127.0.0.1:4101",
            canonical_origin="https://four.example",
        )
        with (
            patch(
                "tooling.development.secure_content.runtime_owner._mobile_call",
                side_effect=mobile_call,
            ),
            patch(
                "tooling.development.secure_content.runtime_owner."
                "_generate_mobile_recovery_phrase",
                return_value=RECOVERY_PHRASE,
            ),
        ):
            actor_ptid, _scope, _build = _start_mobile_client(
                session,
                client_id="ios-alice",
                account="alice@example.invalid",
                password="password",
                station_endpoint=endpoint,
                station_runtime_identity="station-peer",
                source_commit=COMMIT,
                required_actions=("station.add",),
            )

        self.assertEqual("ptid:alice", actor_ptid)
        self.assertEqual(
            ("station.add", {"url": "https://four.example"}),
            calls[0],
        )
        self.assertEqual(
            [
                "moments.private.snapshot",
                "moments.private.storeRecoveryPhrase",
                "moments.private.reconcile",
                "recovery.snapshot",
                "build.identity",
            ],
            [action for action, _payload in calls[-5:]],
        )
        self.assertEqual(
            {
                "recoveryPhrase": RECOVERY_PHRASE,
                "recoveryEpoch": 1,
            },
            calls[-4][1],
        )
        self.assertNotIn(
            RECOVERY_PHRASE,
            json.dumps((actor_ptid, _scope, _build)),
        )
        self.assertNotIn(endpoint.transport_url, json.dumps(calls))

    def test_mobile_recovery_phrase_matches_bip39_256_bit_vector(self) -> None:
        phrase = _generate_mobile_recovery_phrase(bytes(32))

        self.assertEqual(RECOVERY_PHRASE, phrase)
        self.assertEqual(24, len(phrase.split()))

    def test_mobile_private_content_keys_require_both_pools(self) -> None:
        session = MagicMock()
        session.call_action.side_effect = (
            {"stored": True, "recoveryEpoch": 1},
            {
                "active": True,
                "report": {
                    "endpointPrekeysAvailable": 100,
                    "recoveryPrekeysAvailable": 0,
                },
            },
        )

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _prepare_mobile_private_content_keys(
                session,
                client_id="ios-alice",
                recovery_phrase=RECOVERY_PHRASE,
            )

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertIn("recoveryPrekeysAvailable", str(raised.exception))
        self.assertEqual(
            [
                call(
                    "moments.private.storeRecoveryPhrase",
                    {
                        "recoveryPhrase": RECOVERY_PHRASE,
                        "recoveryEpoch": 1,
                    },
                ),
                call("moments.private.reconcile", {}),
            ],
            session.call_action.call_args_list,
        )

    def test_mobile_recovery_phrase_is_redacted_from_action_failure(
        self,
    ) -> None:
        session = MagicMock(client_id="ios-alice")
        session.call_action.side_effect = RuntimeError(
            f"rejected {RECOVERY_PHRASE}"
        )

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _prepare_mobile_private_content_keys(
                session,
                client_id="ios-alice",
                recovery_phrase=RECOVERY_PHRASE,
            )

        self.assertNotIn(RECOVERY_PHRASE, str(raised.exception))
        self.assertIn("[REDACTED]", str(raised.exception))

    def test_mobile_private_runtime_retries_transient_inactive_snapshot(
        self,
    ) -> None:
        session = MagicMock()
        session.call_action.side_effect = (
            {
                "active": False,
                "stationPeerId": None,
                "actorPtid": None,
                "errorPresent": False,
            },
            {
                "active": True,
                "stationPeerId": "station-peer",
                "actorPtid": "ptid:alice",
                "errorPresent": False,
            },
        )
        now = [0.0]
        sleeps: list[float] = []

        def sleep(duration: float) -> None:
            sleeps.append(duration)
            now[0] += duration

        snapshot = _require_mobile_private_runtime(
            session,
            client_id="ios-alice",
            station_runtime_identity="station-peer",
            actor_ptid="ptid:alice",
            timeout_seconds=1.0,
            poll_interval_seconds=0.25,
            monotonic=lambda: now[0],
            sleep=sleep,
        )

        self.assertTrue(snapshot["active"])
        self.assertEqual([0.25], sleeps)
        self.assertEqual(
            [
                call("moments.private.snapshot", {}),
                call("moments.private.snapshot", {}),
            ],
            session.call_action.call_args_list,
        )

    def test_mobile_private_runtime_fails_immediately_on_sanitized_error(
        self,
    ) -> None:
        session = MagicMock()
        session.call_action.return_value = {
            "active": False,
            "stationPeerId": None,
            "actorPtid": None,
            "errorPresent": True,
        }
        sleep = MagicMock()

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _require_mobile_private_runtime(
                session,
                client_id="ios-alice",
                station_runtime_identity="station-peer",
                actor_ptid="ptid:alice",
                timeout_seconds=60.0,
                monotonic=lambda: 0.0,
                sleep=sleep,
            )

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertIn("reported an activation failure", str(raised.exception))
        session.call_action.assert_called_once_with(
            "moments.private.snapshot",
            {},
        )
        sleep.assert_not_called()

    def test_mobile_private_runtime_rejects_active_stale_identity(self) -> None:
        session = MagicMock()
        session.call_action.return_value = {
            "active": True,
            "stationPeerId": "stale-station-peer",
            "actorPtid": "ptid:alice",
            "errorPresent": False,
        }
        sleep = MagicMock()

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _require_mobile_private_runtime(
                session,
                client_id="ios-alice",
                station_runtime_identity="station-peer",
                actor_ptid="ptid:alice",
                monotonic=lambda: 0.0,
                sleep=sleep,
            )

        self.assertEqual("STALE_CLIENT_IDENTITY", raised.exception.code)
        sleep.assert_not_called()

    def test_mobile_private_runtime_timeout_is_typed(self) -> None:
        session = MagicMock()
        session.call_action.return_value = {
            "active": False,
            "stationPeerId": None,
            "actorPtid": None,
            "errorPresent": False,
        }
        now = [0.0]
        sleeps: list[float] = []

        def sleep(duration: float) -> None:
            sleeps.append(duration)
            now[0] += duration

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _require_mobile_private_runtime(
                session,
                client_id="ios-alice",
                station_runtime_identity="station-peer",
                actor_ptid="ptid:alice",
                timeout_seconds=0.5,
                poll_interval_seconds=0.25,
                monotonic=lambda: now[0],
                sleep=sleep,
            )

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertEqual("client:ios-alice", raised.exception.resource)
        self.assertIn("did not become active", str(raised.exception))
        self.assertEqual([0.25, 0.25], sleeps)
        self.assertEqual(3, session.call_action.call_count)

    def test_mobile_write_admission_retries_until_open(self) -> None:
        session = MagicMock()
        session.call_action.side_effect = (
            {
                "writeAdmission": {
                    "open": False,
                    "reason": "session_refreshing",
                },
            },
            {
                "writeAdmission": {
                    "open": True,
                    "reason": None,
                },
            },
        )
        now = [0.0]
        sleeps: list[float] = []

        def sleep(duration: float) -> None:
            sleeps.append(duration)
            now[0] += duration

        snapshot = _require_mobile_write_admission(
            session,
            client_id="ios-alice",
            timeout_seconds=1.0,
            poll_interval_seconds=0.25,
            monotonic=lambda: now[0],
            sleep=sleep,
        )

        self.assertTrue(snapshot["writeAdmission"]["open"])
        self.assertEqual([0.25], sleeps)
        self.assertEqual(
            [
                call("recovery.snapshot", {}),
                call("recovery.snapshot", {}),
            ],
            session.call_action.call_args_list,
        )

    def test_mobile_write_admission_timeout_preserves_last_reason(self) -> None:
        session = MagicMock()
        session.call_action.return_value = {
            "writeAdmission": {
                "open": False,
                "reason": "session_refreshing",
            },
        }
        now = [0.0]
        sleeps: list[float] = []

        def sleep(duration: float) -> None:
            sleeps.append(duration)
            now[0] += duration

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _require_mobile_write_admission(
                session,
                client_id="ios-alice",
                timeout_seconds=0.5,
                poll_interval_seconds=0.25,
                monotonic=lambda: now[0],
                sleep=sleep,
            )

        self.assertEqual("CLIENT_RUNTIME_UNAVAILABLE", raised.exception.code)
        self.assertEqual("client:ios-alice", raised.exception.resource)
        self.assertIn("session_refreshing", str(raised.exception))
        self.assertEqual([0.25, 0.25], sleeps)
        self.assertEqual(3, session.call_action.call_count)

    def test_mobile_start_rejects_inactive_private_runtime_with_cause(
        self,
    ) -> None:
        session = MagicMock()
        calls: list[str] = []

        def mobile_call(
            _session: object,
            action: str,
            payload: Mapping[str, object] | None = None,
        ) -> Mapping[str, object]:
            request = dict(payload or {})
            calls.append(action)
            if action == "station.add":
                return {"verifiedStationPeerId": "station-peer"}
            if action == "access.submit" and request["kind"] == "start":
                return {"decision": {"attemptId": "attempt-1"}}
            if action == "access.submit" and request["kind"] == "login":
                return {
                    "session": {
                        "actorPtid": "ptid:alice",
                        "stationPeerId": "station-peer",
                    }
                }
            if action == "lifecycle.restart":
                return {"requested": True, "scope": "webview"}
            if action == "lifecycle.scope.read":
                return {
                    "phase": "ACTIVE",
                    "activeStationPeerId": "station-peer",
                    "activeActorPtid": "ptid:alice",
                }
            if action == "moments.private.snapshot":
                return {
                    "active": False,
                    "stationPeerId": None,
                    "actorPtid": None,
                    "errorPresent": True,
                }
            raise AssertionError(f"unexpected action {action}")

        endpoint = _StationEndpoint(
            transport_url="http://127.0.0.1:4101",
            canonical_origin="http://station.example:18080",
        )
        with (
            patch(
                "tooling.development.secure_content.runtime_owner._mobile_call",
                side_effect=mobile_call,
            ),
            self.assertRaises(RuntimeOwnerBlocked) as raised,
        ):
            _start_mobile_client(
                session,
                client_id="ios-alice",
                account="alice@example.invalid",
                password="password",
                station_endpoint=endpoint,
                station_runtime_identity="station-peer",
                source_commit=COMMIT,
                required_actions=("station.add",),
            )

        self.assertEqual(
            "CLIENT_RUNTIME_UNAVAILABLE",
            raised.exception.code,
        )
        self.assertIn("reported an activation failure", str(raised.exception))
        self.assertNotIn("build.identity", calls)

    def test_fixture_handler_rejects_an_unbound_runtime_manifest(self) -> None:
        handler = W7FixtureCapabilityHandler(
            W7FixtureBinding(
                capability="account-switch",
                opaque_id="fixture-account",
                expected_identity_digest="1" * 64,
                action=lambda *_: {
                    "completed": True,
                    "fixtureIdentityDigest": "1" * 64,
                },
            ),
            frozenset({"a" * 64}),
        )

        with self.assertRaisesRegex(Exception, "action binding is invalid"):
            handler.invoke(
                "round-trip",
                {
                    "actionPayload": {},
                    "expectedIdentityDigest": "1" * 64,
                    "handleId": "fixture-account",
                    "runtimeManifestDigest": "b" * 64,
                },
                deadline_monotonic=time.monotonic() + 1,
                cancellation=threading.Event(),
            )

    def test_scenario_journey_transition_uses_the_active_owner_session(self) -> None:
        session_id = "secure-content-w7-functional-20260918"
        declaration = {
            "state": "ACTIVE",
            "workItemId": "secure-content-w7",
            "planId": "SECURE-CONTENT-HARD-CUT-20260913",
            "taskId": "W7",
            "sessionId": session_id,
            "journeyId": "sc-dj-desktop-pilot",
        }
        responses = [
            {"declarations": [declaration]},
            {**declaration, "journeyId": BROWSER_JOURNEY},
            {**declaration, "journeyId": BROWSER_JOURNEY},
        ]
        commands: list[list[str]] = []

        def run(command: list[str], **_: object) -> SimpleNamespace:
            commands.append(command)
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps(responses[len(commands) - 1]),
                stderr="",
            )

        activated = _activate_scenario_journey(
            Path("/tmp/peers-touch"),
            BROWSER_JOURNEY,
            command_runner=run,
        )

        self.assertEqual(BROWSER_JOURNEY, activated["journeyId"])
        self.assertIn(session_id, commands[1])
        self.assertEqual("update", commands[1][2])
        self.assertEqual("check", commands[2][2])

    def test_scenario_journey_transition_rejects_another_plan_task(self) -> None:
        declaration = {
            "state": "ACTIVE",
            "workItemId": "secure-content-w7",
            "planId": "SECURE-CONTENT-HARD-CUT-20260913",
            "taskId": "W7-RUNTIME-OWNER",
            "sessionId": "wrong-task",
            "journeyId": "sc-dj-desktop-pilot",
        }

        def run(_command: list[str], **_: object) -> SimpleNamespace:
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps({"declarations": [declaration]}),
                stderr="",
            )

        with self.assertRaisesRegex(
            RuntimeOwnerBlocked,
            "not the active Plan task",
        ):
            _activate_scenario_journey(
                Path("/tmp/peers-touch"),
                BROWSER_JOURNEY,
                command_runner=run,
            )

    def test_fixture_requires_exact_source_and_all_capabilities(self) -> None:
        fixture = fixture_payload()
        _validate_fixture(fixture, source_commit=COMMIT)

        fixture["source_checkpoint"] = "8" * 40
        with self.assertRaisesRegex(
            RuntimeOwnerBlocked,
            "not source-bound",
        ):
            _validate_fixture(fixture, source_commit=COMMIT)

    def test_fixture_copy_is_private_and_exclusive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            source.write_text(json.dumps(fixture_payload()), encoding="utf-8")
            target = root / "owner" / "fixture.json"

            payload, reference = _copy_immutable(source, target)

            self.assertEqual(payload, fixture_payload())
            self.assertEqual("fixture.json", reference["path"])
            self.assertEqual(0o600, target.stat().st_mode & 0o777)
            with self.assertRaises(FileExistsError):
                _copy_immutable(source, target)

    def test_continuation_evidence_is_staged_in_child_result_directory(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent_dir = root / "desktop" / "parent-run"
            parent_dir.mkdir(parents=True)
            blocked_result_path = parent_dir / "result.json"
            resume_path = parent_dir / "desktop-pilot-resume.json"
            request_path = (
                parent_dir
                / "restart-request-secure-content-desktop-bob.json"
            )
            blocked_result_path.write_text('{"result":"BLOCKED"}\n')
            resume_path.write_text('{"kind":"resume"}\n')
            request_path.write_text('{"kind":"request"}\n')
            acknowledgement = {
                "schema_version": 1,
                "kind": runtime_manifest.CONTINUATION_ACKNOWLEDGEMENT_KIND,
            }

            child_dir = _stage_continuation_evidence(
                blocked_result_path=blocked_result_path,
                request_path=request_path,
                child_run_id="child-run",
                client_id="secure-content-desktop-bob",
                acknowledgement=acknowledgement,
            )

            self.assertEqual(root / "desktop" / "child-run", child_dir)
            for source in (blocked_result_path, resume_path, request_path):
                self.assertEqual(
                    source.read_bytes(),
                    (child_dir / source.name).read_bytes(),
                )
            self.assertEqual(
                acknowledgement,
                json.loads(
                    (
                        child_dir
                        / "restart-acknowledgement-secure-content-desktop-bob.json"
                    ).read_text(encoding="utf-8")
                ),
            )

    def test_fixture_owner_publishes_and_executes_bound_actions(self) -> None:
        calls: list[tuple[str, Mapping[str, object]]] = []

        def action(
            payload: Mapping[str, object],
            deadline_monotonic: float,
            cancellation: threading.Event,
        ) -> Mapping[str, object]:
            self.assertGreater(deadline_monotonic, time.monotonic())
            self.assertFalse(cancellation.is_set())
            calls.append(("called", payload))
            return {
                "completed": True,
                "fixtureIdentityDigest": "1" * 64,
            }

        owner = W7FixtureOwner(
            source_checkpoint=COMMIT,
            run_id="w7-fixture-owner-test",
            bindings=tuple(
                W7FixtureBinding(
                    capability=capability,
                    opaque_id=f"fixture-{index}",
                    expected_identity_digest=str(index + 1) * 64,
                    action=action,
                    secret_channel_ref=(
                        "w7-recovery-secret-channel"
                        if capability == "historical-recovery-epoch"
                        else None
                    ),
                )
                for index, capability in enumerate(
                    sorted(W7_FIXTURE_OPERATIONS)
                )
            ),
        )
        manifest = owner.manifest()
        _validate_fixture(manifest, source_commit=COMMIT)
        account_handle = next(
            handle
            for handle in manifest["handles"]
            if handle["capability"] == "account-switch"
        )

        context, client = owner.open_action_channel(
            workspace_id=IDENTITY["workspaceId"],
            gate_id="sc-dj-desktop-pilot",
            runtime_manifest_digests=("a" * 64,),
        )
        self.assertEqual({}, dict(owner.bindings))
        try:
            result = client.invoke(
                "account-switch",
                "round-trip",
                {
                    "actionPayload": {},
                    "expectedIdentityDigest": account_handle[
                        "expected_identity_digest"
                    ],
                    "handleId": account_handle["opaque_id"],
                    "runtimeManifestDigest": "a" * 64,
                },
                timeout_seconds=1,
            )
        finally:
            client.close()
            context.quiesce()
            cleanup = context.close()

        self.assertEqual([("called", {})], calls)
        self.assertTrue(result["outcome"]["completed"])
        self.assertTrue(cleanup.succeeded)

    def test_fixture_owner_rejects_action_identity_mismatch(self) -> None:
        def action(
            payload: Mapping[str, object],
            deadline_monotonic: float,
            cancellation: threading.Event,
        ) -> Mapping[str, object]:
            del payload, deadline_monotonic, cancellation
            return {
                "completed": True,
                "fixtureIdentityDigest": "f" * 64,
            }

        owner = W7FixtureOwner(
            source_checkpoint=COMMIT,
            run_id="w7-fixture-owner-mismatch",
            bindings=tuple(
                W7FixtureBinding(
                    capability=capability,
                    opaque_id=f"fixture-{index}",
                    expected_identity_digest=str(index + 1) * 64,
                    action=action,
                    secret_channel_ref=(
                        "w7-recovery-secret-channel"
                        if capability == "historical-recovery-epoch"
                        else None
                    ),
                )
                for index, capability in enumerate(
                    sorted(W7_FIXTURE_OPERATIONS)
                )
            ),
        )
        context, client = owner.open_action_channel(
            workspace_id=IDENTITY["workspaceId"],
            gate_id="sc-dj-desktop-pilot",
            runtime_manifest_digests=("a" * 64,),
        )
        try:
            with self.assertRaisesRegex(
                Exception,
                "fixture action identity does not match",
            ):
                client.invoke(
                    "account-switch",
                    "round-trip",
                    {
                        "actionPayload": {},
                        "expectedIdentityDigest": "1" * 64,
                        "handleId": "fixture-0",
                        "runtimeManifestDigest": "a" * 64,
                    },
                    timeout_seconds=1,
                )
        finally:
            client.close()
            context.quiesce()
            context.close()

    def test_client_cleanup_failure_is_typed_and_retained_for_retry(self) -> None:
        client = SimpleNamespace(
            spec=SimpleNamespace(profile="secure-content-desktop-alice"),
            stop=lambda: {
                "status": "failed",
                "failures": [
                    "renderer port remains open",
                    "logout: Authorization: Bearer secret-cleanup-token",
                ],
            },
        )
        active_client_ids = {id(client)}

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _stop_client_or_raise(
                client,
                purpose="Desktop",
                active_client_ids=active_client_ids,
            )

        self.assertEqual("RUNTIME_CLEANUP_FAILED", raised.exception.code)
        self.assertIn("Authorization: [REDACTED]", str(raised.exception))
        self.assertIn("renderer port remains open", str(raised.exception))
        self.assertNotIn("secret-cleanup-token", str(raised.exception))
        self.assertIn(id(client), active_client_ids)

    def test_runtime_cleanup_scope_preserves_primary_failure(self) -> None:
        stack = ExitStack()

        def fail_cleanup() -> None:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CLEANUP_FAILED",
                "secondary cleanup failed",
                resource="client:desktop",
            )

        stack.callback(fail_cleanup)
        with self.assertRaisesRegex(RunnerError, "primary product failure") as raised:
            with _runtime_cleanup_scope(stack):
                raise RunnerError("primary product failure")

        self.assertEqual(
            (
                "secondary runtime cleanup failure: RUNTIME_CLEANUP_FAILED: "
                "secondary cleanup failed",
            ),
            raised.exception.secondary_cleanup_failures,
        )
        self.assertEqual(
            (
                "primary product failure; secondary runtime cleanup failure: "
                "RUNTIME_CLEANUP_FAILED: secondary cleanup failed"
            ),
            _error_message_with_cleanup(raised.exception),
        )

    def test_runtime_cleanup_scope_reports_cleanup_failure_without_primary(self) -> None:
        stack = ExitStack()

        def fail_cleanup() -> None:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CLEANUP_FAILED",
                "cleanup failed",
                resource="client:desktop",
            )

        stack.callback(fail_cleanup)
        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            with _runtime_cleanup_scope(stack):
                pass

        self.assertEqual("RUNTIME_CLEANUP_FAILED", raised.exception.code)

    def test_runtime_owner_blocked_payload_retains_secondary_cleanup(self) -> None:
        stack = ExitStack()

        def fail_cleanup() -> None:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CLEANUP_FAILED",
                "cleanup failed",
                resource="client:desktop",
            )

        stack.callback(fail_cleanup)

        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            with _runtime_cleanup_scope(stack):
                raise RuntimeOwnerBlocked(
                    "PRIMARY_FAILURE",
                    "primary failure",
                    resource="runtime:secure-content-w7",
                )

        self.assertEqual(
            (
                "primary failure; secondary runtime cleanup failure: "
                "RUNTIME_CLEANUP_FAILED: cleanup failed"
            ),
            raised.exception.payload()["message"],
        )

    def test_manifest_payload_preserves_owner_bound_source(self) -> None:
        payload = _manifest_payload(
            identity=IDENTITY,
            journey_id=BROWSER_JOURNEY,
            run_id="w7-owner-run",
            services={"station-four": {"kind": "station"}},
            fixture_ref={"path": "fixture.json", "sha256": "1" * 64},
            fixture_digest="2" * 64,
            clients=[{"id": "browser"}],
        )

        self.assertNotIn("manifest_digest", payload)
        self.assertEqual(
            {
                "canonical_worktree": IDENTITY["root"],
                "workspace_id": IDENTITY["workspaceId"],
                "commit": COMMIT,
                "worktree_set_digest": IDENTITY["worktreeSetDigest"],
                "workspace_digest": "clean",
            },
            payload["source"],
        )
        self.assertEqual({"profile_id": "four", "slot": 5}, payload["controller_binding"])

    def test_continuation_manifest_has_fresh_run_identity_and_consumes_parent_artifact(
        self,
    ) -> None:
        parent_run_id = "w7-owner-run"
        child_run_id = _continuation_run_id(
            parent_run_id,
            "restart-request",
        )
        self.assertNotEqual(parent_run_id, child_run_id)
        self.assertEqual(
            child_run_id,
            _continuation_run_id(parent_run_id, "restart-request"),
        )

        with tempfile.TemporaryDirectory() as directory:
            artifact_dir = Path(directory)
            attestation = MagicMock()
            attestation.to_dict.return_value = {
                "artifactKind": runtime_manifest.SERVICE_ATTESTATION_KIND,
                "serviceId": "station-four",
            }
            child_services = _continuation_services(
                artifact_dir,
                run_id=child_run_id,
                journey_id="desktop-journey",
                services={
                    "station-four": {
                        "kind": "station",
                        "attestation_artifact_ref": {
                            "path": "attestations/station-four.json",
                            "sha256": "0" * 64,
                        },
                    },
                },
                attestations={"station-four": attestation},
            )
            child_attestation_ref = child_services["station-four"][
                "attestation_artifact_ref"
            ]
            child_attestation = json.loads(
                (artifact_dir / child_attestation_ref["path"]).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(child_run_id, child_attestation["runId"])
            self.assertEqual(
                "continuation-attestations/station-four.json",
                child_attestation_ref["path"],
            )

            parent = runtime_manifest.RuntimeManifestBinding(
                path=artifact_dir / "runtime-parent.json",
                sha256="a" * 64,
                run_id=parent_run_id,
                payload={"created_at": "2026-09-21T10:00:00.000Z"},
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset(),
                fixture_handles={},
                raw_bytes=b"parent",
            )
            context_args = {
                "repo_root": Path(__file__).resolve().parents[3],
                "source_commit": COMMIT,
                "session_id": "secure-content-w7",
                "declaration_id": "secure-content-w7-declaration",
                "runtime": "desktop",
                "profile": "four",
                "profiles": ("four",),
                "clients": (),
                "budget_seconds": 10,
                "started_monotonic": time.monotonic(),
                "artifact_dir": artifact_dir,
            }
            producer = ScenarioContext(
                scenario_id="desktop-parent",
                journey_id="desktop-journey",
                runtime_manifest=parent,
                **context_args,
            )
            artifact = producer.write_bound_artifact_json(
                "restart-request.json",
                "secure-content-runtime-restart-request",
                {"requestId": "restart-request"},
            )
            child = runtime_manifest.RuntimeManifestBinding(
                path=artifact_dir / "runtime-child.json",
                sha256="b" * 64,
                run_id=child_run_id,
                payload={
                    "created_at": "2099-09-21T10:00:00.000Z",
                    "continuation": {
                        "parent_manifest_digest": parent.sha256,
                    },
                },
                clients={},
                services={},
                service_profiles=frozenset({"four"}),
                fixture_capabilities=frozenset(),
                fixture_handles={},
                raw_bytes=b"child",
            )
            consumer = ScenarioContext(
                scenario_id="desktop-child",
                journey_id="desktop-journey",
                runtime_manifest=child,
                **context_args,
            )

            consumed = consumer.consume_bound_artifact_json(
                artifact,
                kind="secure-content-runtime-restart-request",
                producer_scenario_id="desktop-parent",
                producer_journey_id="desktop-journey",
                producer_runtime="desktop",
            )

        self.assertEqual("restart-request", consumed["requestId"])

    def test_service_payload_preserves_both_attestation_references(self) -> None:
        service_attestation_ref = {
            "path": "attestations/station-four.json",
            "sha256": "1" * 64,
        }
        schema_attestation_ref = {
            "path": "schema-attestations/station-four/schema-attestation.json",
            "sha256": "2" * 64,
        }
        payload = _service_payload(
            SimpleNamespace(
                service_kind="station",
                deployment_environment="station-four",
                endpoint="http://127.0.0.1:49152",
                live_commit=COMMIT,
                protocol_digest="3" * 64,
                runtime_identity="runtime-four",
            ),
            service_attestation_ref,
            schema_attestation_ref,
            profile_id="four",
            schema_attestation_endpoint="https://station-four.invalid",
        )

        self.assertEqual(runtime_manifest.SERVICE_FIELDS, set(payload))
        self.assertEqual(
            "http://127.0.0.1:49152",
            payload["endpoint"],
        )
        self.assertEqual(
            "https://station-four.invalid",
            payload["schema_attestation_endpoint"],
        )
        self.assertEqual(
            service_attestation_ref,
            payload["attestation_artifact_ref"],
        )
        self.assertEqual(
            schema_attestation_ref,
            payload["canonical_private_schema_attestation_ref"],
        )

    def test_missing_schema_attestation_fails_closed_before_launch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _resolve_canonical_private_schema_attestation(
                    Path(directory),
                    Path(__file__).resolve().parents[3],
                    IDENTITY,
                    SimpleNamespace(
                        service_kind="station",
                        deployment_environment="station-four",
                        endpoint="https://station-four.invalid",
                        live_commit=COMMIT,
                        protocol_digest="3" * 64,
                        runtime_identity="runtime-four",
                    ),
                    service_id="station-four",
                    profile_id="four",
                    attested_endpoint="https://station-four.invalid",
                )

        self.assertEqual(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            raised.exception.code,
        )

    def test_resolves_and_copies_exact_source_schema_attestation(self) -> None:
        from tooling.development.secure_content.test_runtime_manifest import (
            manifest_payload,
            write_manifest,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            activation = (
                root
                / "W12A"
                / "activation"
                / "600e3d468dfa46ec0522c10b4d7ec0ddf7ccb929"
                / "four"
                / "reset-four"
            )
            path = write_manifest(activation, manifest_payload())
            payload = json.loads(path.read_text(encoding="utf-8"))
            service = payload["services"]["station-four"]
            schema_source = (
                activation
                / service["canonical_private_schema_attestation_ref"]["path"]
            )
            for filename in (
                runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
                runtime_manifest.COMPLETED_RESET_JOURNAL_FILENAME,
                runtime_manifest.RESET_MANIFEST_FILENAME,
            ):
                source = schema_source.parent / filename
                target = activation / filename
                shutil.copyfile(source, target)
                target.chmod(0o600)

            binding = _resolve_canonical_private_schema_attestation(
                root,
                Path(__file__).resolve().parents[3],
                {
                    **IDENTITY,
                    "head": payload["source"]["commit"],
                },
                SimpleNamespace(
                    service_kind=service["kind"],
                    deployment_environment=service[
                        "deployment_environment"
                    ],
                    endpoint="http://127.0.0.1:49152",
                    live_commit=service["live_commit"],
                    protocol_digest=service["protocol_digest"],
                    runtime_identity=service["runtime_identity"],
                ),
                service_id="station-four",
                profile_id="four",
                attested_endpoint=service["schema_attestation_endpoint"],
                live_verifier=lambda _binding: None,
            )
            published_root = root / "published"
            reference = _publish_canonical_private_schema_attestation(
                published_root,
                "station-four",
                binding,
            )

            self.assertEqual(
                (
                    "schema-attestations/station-four/"
                    "canonical-private-schema-attestation.json"
                ),
                reference["path"],
            )
            self.assertEqual(
                {
                    "canonical-private-schema-attestation.json",
                    "completed-reset-journal.json",
                    "reset-manifest.json",
                },
                {
                    item.name
                    for item in (
                        published_root
                        / "schema-attestations"
                        / "station-four"
                    ).iterdir()
                },
            )

    def test_final_cut_admission_rejects_activation_attestation(self) -> None:
        from tooling.development.secure_content.test_runtime_manifest import (
            manifest_payload,
            write_manifest,
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            activation = (
                root
                / "W12A"
                / "activation"
                / "600e3d468dfa46ec0522c10b4d7ec0ddf7ccb929"
                / "four"
                / "reset-four"
            )
            path = write_manifest(activation, manifest_payload())
            payload = json.loads(path.read_text(encoding="utf-8"))
            service = payload["services"]["station-four"]
            schema_source = (
                activation
                / service["canonical_private_schema_attestation_ref"]["path"]
            )
            for filename in (
                runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
                runtime_manifest.COMPLETED_RESET_JOURNAL_FILENAME,
                runtime_manifest.RESET_MANIFEST_FILENAME,
            ):
                source = schema_source.parent / filename
                target = activation / filename
                shutil.copyfile(source, target)
                target.chmod(0o600)

            with self.assertRaises(RuntimeOwnerBlocked) as raised:
                _resolve_canonical_private_schema_attestation(
                    root,
                    Path(__file__).resolve().parents[3],
                    {
                        **IDENTITY,
                        "head": payload["source"]["commit"],
                    },
                    SimpleNamespace(
                        service_kind=service["kind"],
                        deployment_environment=service[
                            "deployment_environment"
                        ],
                        endpoint=service["endpoint"],
                        live_commit=service["live_commit"],
                        protocol_digest=service["protocol_digest"],
                        runtime_identity=service["runtime_identity"],
                    ),
                    service_id="station-four",
                    profile_id="four",
                    attested_endpoint=service[
                        "schema_attestation_endpoint"
                    ],
                    accepted_intents=("FINAL_CUT",),
                    live_verifier=lambda _binding: None,
                )

        self.assertEqual(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            raised.exception.code,
        )

    def test_live_schema_verifier_requires_exact_ssh_readback(self) -> None:
        payload = {
            "schema_version": 1,
            "deployment_environment": "station-four",
            "attestation_digest": "1" * 64,
        }
        binding = runtime_manifest.CanonicalPrivateSchemaAttestationBinding(
            path=Path("/tmp/canonical-private-schema-attestation.json"),
            payload=payload,
            raw_bytes=json.dumps(payload).encode("utf-8"),
        )
        command_runner = MagicMock(
            return_value=SimpleNamespace(
                returncode=0,
                stdout=json.dumps(payload) + "\n",
                stderr="",
            )
        )
        transport = MagicMock()
        transport.schema_verify_command.return_value = [
            "ssh",
            "station-four",
            "secure-content-maintenance",
            "--operation",
            "schema_verify",
        ]
        _verify_live_canonical_private_schema_attestation(
            binding,
            repo_root=Path(__file__).resolve().parents[3],
            transport=transport,
            command_runner=command_runner,
        )
        transport.schema_verify_command.assert_called_once_with(
            payload,
            budget_seconds=120,
        )
        self.assertEqual(
            payload,
            json.loads(command_runner.call_args.kwargs["input"]),
        )

        command_runner.return_value = SimpleNamespace(
            returncode=0,
            stdout=json.dumps({**payload, "attestation_digest": "2" * 64})
            + "\n",
            stderr="",
        )
        with self.assertRaises(RuntimeOwnerBlocked) as raised:
            _verify_live_canonical_private_schema_attestation(
                binding,
                repo_root=Path(__file__).resolve().parents[3],
                transport=transport,
                command_runner=command_runner,
            )
        self.assertEqual(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            raised.exception.code,
        )

    def test_client_payload_uses_live_snapshot_and_storage_inode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "storage"
            storage.mkdir()
            client = SimpleNamespace(
                spec=SimpleNamespace(
                    runtime="native-tauri",
                    storage_root=storage,
                )
            )
            snapshot = {
                "actorPtidSha256": "3" * 64,
                "bootIdentitySha256": "4" * 64,
                "sessionGeneration": 2,
            }

            payload = _client_payload("desktop-alice", "alice", client, snapshot)

            self.assertEqual(_storage_identity(storage), payload["storage_identity_digest"])
            self.assertEqual(snapshot["bootIdentitySha256"], payload["boot_identity"])
            self.assertEqual(2, payload["session_generation"])

    def test_restart_lease_is_held_exclusively(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with _restart_lease(
                root,
                request_id="restart-request",
                client_id="desktop-bob",
            ) as first:
                self.assertIn("restart-request", first[0])
                with self.assertRaisesRegex(
                    RuntimeOwnerBlocked,
                    "lease is unavailable",
                ):
                    with _restart_lease(
                        root,
                        request_id="competing-request",
                        client_id="desktop-bob",
                    ):
                        pass


if __name__ == "__main__":
    unittest.main()
