from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from tooling.development.secure_content import work_item


REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST = (
    REPO_ROOT
    / "docs/architecture/secure-content/execution-plans/"
    "20260913-secure-content-work-items.yaml"
)


class WorkItemProjectionTest(unittest.TestCase):
    def test_loads_exact_w4_projection(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W4",
            journey="sc-dj-optional-auth",
            repo_root=REPO_ROOT,
        )

        self.assertEqual("secure-content-w4", projection.work_item_id)
        self.assertEqual("W4", projection.workstream_id)
        self.assertEqual("sc-dj-optional-auth", projection.journey_id)
        self.assertEqual(
            ("exclusive-write:apps/station/frame/core/auth",),
            tuple(
                claim
                for claim in projection.source_claim_arguments
                if claim.endswith("apps/station/frame/core/auth")
            ),
        )
        self.assertEqual((), projection.runtime_claim_arguments)

    def test_loads_w2_source_and_runtime_subphases(self) -> None:
        source = work_item.load_projection(
            MANIFEST,
            workstream="W2A",
            journey=None,
            repo_root=REPO_ROOT,
        )
        desktop = work_item.load_projection(
            MANIFEST,
            workstream="W2B-DESKTOP",
            journey="sc-dj-chat-attachment-atomic",
            repo_root=REPO_ROOT,
        )
        mobile = work_item.load_projection(
            MANIFEST,
            workstream="W2B-MOBILE",
            journey="sc-dj-chat-attachment-mobile",
            repo_root=REPO_ROOT,
        )

        self.assertEqual("secure-content-w2a", source.work_item_id)
        self.assertEqual((), source.runtime_claim_arguments)
        self.assertIn(
            "exclusive-write:packages/secure-content-core",
            source.source_claim_arguments,
        )
        self.assertEqual("secure-content-w2b-desktop", desktop.work_item_id)
        self.assertIn(
            "exclusive:fixture:secure-content-chat-desktop",
            desktop.runtime_claim_arguments,
        )
        self.assertEqual("secure-content-w2b-mobile", mobile.work_item_id)
        self.assertIn(
            "exclusive:fixture:mobile-ios-simulator-native",
            mobile.runtime_claim_arguments,
        )

    def test_rejects_unknown_fields_path_escape_and_runtime_kind(self) -> None:
        base = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
        cases = (
            ("unknown", lambda item: item.__setitem__("unexpected", True)),
            (
                "path escape",
                lambda item: item["resources"]["sourceClaims"][0].__setitem__(
                    "pathPrefix", "../outside"
                ),
            ),
            (
                "runtime kind",
                lambda item: item["resources"]["runtimeClaims"].append(
                    {"kind": "unknown", "resourceId": "x", "mode": "exclusive"}
                ),
            ),
        )

        for name, mutate in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                manifest = json.loads(json.dumps(base))
                mutate(manifest["items"][5])
                path = Path(temp) / "manifest.yaml"
                path.write_text(yaml.safe_dump(manifest), encoding="utf-8")

                with self.assertRaises(work_item.ManifestError):
                    work_item.load_projection(
                        path,
                        workstream="W4",
                        journey="sc-dj-optional-auth",
                        repo_root=REPO_ROOT,
                    )

    def test_rejects_undeclared_journey_and_unauthorized_reset(self) -> None:
        with self.assertRaises(work_item.ManifestError):
            work_item.load_projection(
                MANIFEST,
                workstream="W4",
                journey="sc-dj-content-prekey",
                repo_root=REPO_ROOT,
            )

        with self.assertRaisesRegex(
            work_item.ManifestError,
            "destructiveResetScopes",
        ):
            work_item.load_projection(
                MANIFEST,
                workstream="W12",
                journey="sc-dj-authorized-reset",
                repo_root=REPO_ROOT,
            )

    def test_start_invokes_make_and_validates_ledger_readback(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W4",
            journey="sc-dj-optional-auth",
            repo_root=REPO_ROOT,
        )
        calls: list[list[str]] = []
        declaration = {
            "declarationId": f"{projection.work_item_id}-9eb2cb904c9ae460",
            "workItemId": projection.work_item_id,
            "sessionId": projection.work_item_id,
            "workspaceId": "9eb2cb904c9ae460",
            "branch": "feat/federation",
            "sourceHead": "2d54851f95994d717928105aca6470c30adf3657",
            "journeyId": projection.journey_id,
            "purpose": projection.purpose,
            "state": "DECLARED",
            "sourceClaims": list(
                reversed(
                    [
                        {
                            "mode": claim.split(":", 1)[0],
                            "pathPrefix": claim.split(":", 1)[1],
                        }
                        for claim in projection.source_claim_arguments
                    ]
                )
            ),
            "runtimeClaims": [],
            "declarationDigest": "a" * 64,
        }

        def fake_runner(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
            self.assertEqual(REPO_ROOT, cwd)
            calls.append(command)
            if command == ["git", "config", "user.email"]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="acceptance@test.invalid\n",
                    stderr="",
                )
            if command[2] == "status":
                stdout = json.dumps(
                    {
                        "workspaceId": declaration["workspaceId"],
                        "declarations": [declaration],
                    }
                )
            else:
                stdout = json.dumps(declaration)
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        result = work_item.execute_projection(
            "start",
            projection,
            repo_root=REPO_ROOT,
            session="secure-content-w4",
            command_runner=fake_runner,
        )

        self.assertEqual("a" * 64, result["declarationDigest"])
        self.assertEqual(
            ["node", "tooling/scripts/local-dev/dev-work.mjs", "start"],
            calls[1][:3],
        )
        self.assertIn(
            ";".join(projection.source_claim_arguments),
            calls[1],
        )
        self.assertIn("acceptance@test.invalid", calls[1])
        self.assertEqual(
            [
                "node",
                "tooling/scripts/local-dev/dev-work.mjs",
                "status",
                "--work-item",
                "secure-content-w4",
            ],
            calls[2],
        )

    def test_readback_mismatch_fails_closed(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W4",
            journey="sc-dj-optional-auth",
            repo_root=REPO_ROOT,
        )

        def fake_runner(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
            del cwd
            declaration = {
                "declarationId": f"{projection.work_item_id}-9eb2cb904c9ae460",
                "workItemId": projection.work_item_id,
                "sessionId": projection.work_item_id,
                "workspaceId": "9eb2cb904c9ae460",
                "branch": "feat/federation",
                "sourceHead": "2d54851f95994d717928105aca6470c30adf3657",
                "journeyId": projection.journey_id,
                "purpose": projection.purpose,
                "state": "DECLARED",
                "sourceClaims": [],
                "runtimeClaims": [],
                "declarationDigest": "b" * 64,
            }
            stdout = (
                json.dumps(
                    {
                        "workspaceId": declaration["workspaceId"],
                        "declarations": [declaration],
                    }
                )
                if command[2] == "status"
                else json.dumps(declaration)
            )
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        with self.assertRaises(work_item.LedgerReadbackError):
            work_item.execute_projection(
                "update",
                projection,
                repo_root=REPO_ROOT,
                session="secure-content-w4",
                command_runner=fake_runner,
            )

    def test_start_fails_closed_when_git_owner_is_unavailable(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W4",
            journey="sc-dj-optional-auth",
            repo_root=REPO_ROOT,
        )

        def missing_owner(
            command: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            self.assertEqual(REPO_ROOT, cwd)
            self.assertEqual(["git", "config", "user.email"], command)
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="")

        with self.assertRaisesRegex(
            work_item.CommandError,
            "cannot resolve the Development work owner",
        ):
            work_item.execute_projection(
                "start",
                projection,
                repo_root=REPO_ROOT,
                session="secure-content-w4",
                command_runner=missing_owner,
            )

    def test_rejects_shell_metacharacters_in_claim_paths(self) -> None:
        raw = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
        raw["items"][5]["resources"]["sourceClaims"][0]["pathPrefix"] = (
            "apps/$(touch-pwned)"
        )
        raw["items"][5]["scope"]["include"][0] = "apps/$(touch-pwned)"

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "manifest.yaml"
            path.write_text(yaml.safe_dump(raw), encoding="utf-8")

            with self.assertRaises(work_item.ManifestError):
                work_item.load_projection(
                    path,
                    workstream="W4",
                    journey="sc-dj-optional-auth",
                    repo_root=REPO_ROOT,
                )


if __name__ == "__main__":
    unittest.main()
