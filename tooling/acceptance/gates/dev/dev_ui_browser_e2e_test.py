from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import workspace_id
from tooling.acceptance.core.provisioning import ProvisioningState
from tooling.acceptance.gates.dev.dev_ui_browser_e2e import (
    GATE_ID,
    count_refresh_requests,
    validate_snapshot,
)
from tooling.acceptance.gates.dev.peers_dev_ui_browser_e2e import (
    validate_driver_summary,
    validate_runtime_manifest,
)
from tooling.acceptance.provisioners import (
    DevUiLocalBrowserProvisioner,
    PeersDevFixtureBrowserProvisioner,
    get_provisioner,
)
from tooling.acceptance.core._paths import REPO_ROOT


def snapshot(commit: str) -> dict[str, object]:
    workspace = workspace_id(REPO_ROOT)
    return {
        "server": {
            "source": {
                "workspaceId": workspace,
                "branch": "feature/dev-ui",
                "head": commit,
                "dirty": False,
            }
        },
        "serverFreshness": {"state": "current"},
        "discovery": {
            "checkedAt": "2026-09-23T01:00:10.000Z",
            "count": 2,
            "error": None,
        },
        "worktrees": [
            {
                "workspaceId": workspace,
                "git": {"head": commit},
                "freshness": {
                    "lastReportedAt": "2026-09-23T01:00:05.000Z",
                    "stateUpdatedAt": "2026-09-23T01:00:06.000Z",
                    "checkedAt": "2026-09-23T01:00:10.000Z",
                    "updatedAt": "2026-09-23T01:00:10.000Z",
                },
            },
            {
                "workspaceId": "fedcba9876543210",
                "git": {"head": "b" * 40},
                "freshness": {
                    "lastReportedAt": None,
                    "stateUpdatedAt": None,
                    "checkedAt": "2026-09-23T01:00:10.000Z",
                    "updatedAt": "2026-09-23T01:00:10.000Z",
                },
            },
        ],
    }


class DevUiBrowserAcceptanceTests(unittest.TestCase):
    def test_environment_resolves_registered_provisioner(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "dev-ui-local-browser.yaml"
        )
        provisioner = get_provisioner(contract)
        self.assertIsInstance(provisioner, DevUiLocalBrowserProvisioner)

    def test_provisioner_emits_browser_runtime_identity(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "dev-ui-local-browser.yaml"
        )
        provisioner = DevUiLocalBrowserProvisioner(
            contract,
            probe=lambda: {
                "kind": "peers-touch-dev-server",
                "endpoint": "http://127.0.0.1:4177",
                "source": {
                    "workspaceId": workspace_id(REPO_ROOT),
                    "branch": "feature/dev-ui",
                    "head": "a" * 40,
                    "dirty": False,
                },
            },
        )
        provisioner._git_commit = lambda: "a" * 40
        provisioner._git_workspace_digest = lambda: "clean"

        manifest = provisioner.provision(GATE_ID)

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "dev-ui-local")
        self.assertEqual(manifest.clients[0].runtime, "browser")
        self.assertEqual(manifest.clients[0].required_service_roles, ())

    def test_snapshot_requires_exact_source_and_four_clocks(self) -> None:
        commit = "a" * 40
        counts = validate_snapshot(
            snapshot(commit),
            source_commit=commit,
            workspace_id=workspace_id(REPO_ROOT),
        )
        self.assertEqual(
            counts,
            {"discoveredWorktrees": 2, "renderedWorktreeRows": 2},
        )

        invalid = snapshot(commit)
        invalid["worktrees"][0]["freshness"].pop("updatedAt")
        with self.assertRaisesRegex(Exception, "freshness fields"):
            validate_snapshot(
                invalid,
                source_commit=commit,
                workspace_id=workspace_id(REPO_ROOT),
            )

    def test_har_counts_successful_sse_and_polling_requests(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "browser.har"
            path.write_text(
                json.dumps(
                    {
                        "log": {
                            "entries": [
                                {
                                    "request": {
                                        "url": "http://127.0.0.1:4177/api/status"
                                    },
                                    "response": {"status": 200},
                                },
                                {
                                    "request": {
                                        "url": "http://127.0.0.1:4177/api/status"
                                    },
                                    "response": {"status": 500},
                                },
                                {
                                    "request": {
                                        "url": "http://127.0.0.1:4177/api/events"
                                    },
                                    "response": {"status": 200},
                                },
                                {
                                    "request": {
                                        "url": "http://127.0.0.1:4177/app.js"
                                    },
                                    "response": {"status": 200},
                                },
                            ]
                        }
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(count_refresh_requests(path), 2)

    def test_progress_gate_accepts_canonical_browser_runtime_and_artifacts(
        self,
    ) -> None:
        validate_runtime_manifest(
            {
                "environmentId": "peers-dev-fixture-browser",
                "profile": {"resolvedName": "dev-ui-local"},
                "clients": [
                    {
                        "id": "peers-dev-fixture-browser",
                        "runtime": "browser",
                        "renderer_port": 4177,
                    }
                ],
            }
        )
        with tempfile.TemporaryDirectory() as temp:
            output_directory = Path(temp)
            for filename in ("desktop.png", "narrow.png"):
                (output_directory / filename).write_bytes(b"x" * 10_001)
            screenshots = validate_driver_summary(
                {
                    "ok": True,
                    "viewports": ["1440x1000", "390x844"],
                    "screenshots": ["desktop.png", "narrow.png"],
                    "disconnectFallback": "PASS",
                    "sseRecovery": "PASS",
                    "singletonReuse": "PASS",
                    "unregisteredVisible": "PASS",
                },
                output_directory,
            )
            self.assertEqual(set(screenshots), {"desktop", "narrow"})

    def test_progress_gate_rejects_incomplete_driver_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(Exception, "summary is invalid"):
                validate_driver_summary({"ok": True}, Path(temp))

    def test_progress_environment_resolves_owned_fixture_provisioner(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "peers-dev-fixture-browser.yaml"
        )
        provisioner = get_provisioner(contract)
        self.assertIsInstance(provisioner, PeersDevFixtureBrowserProvisioner)


if __name__ == "__main__":
    unittest.main()
