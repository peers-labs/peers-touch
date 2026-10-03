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
W12D_TASK = (
    REPO_ROOT
    / "docs/architecture/secure-content/execution-plans/"
    "20260913-secure-content-hard-cut/tasks/W12D.md"
)


def _load_task_slice(path: Path) -> dict[str, object]:
    document = path.read_text(encoding="utf-8")
    start = document.index("```json\n") + len("```json\n")
    end = document.index("\n```", start)
    return json.loads(document[start:end])


class WorkItemProjectionTest(unittest.TestCase):
    def test_accepts_repository_dotfile_claim(self) -> None:
        self.assertEqual(
            ".gitignore",
            work_item._canonical_repo_path(".gitignore", "path"),
        )

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

    def test_w12a_projections_bind_explicit_parent_task(self) -> None:
        cases = (
            ("W12A", "sc-dj-mobile-matrix", "W12A"),
            ("W12C", "sc-dj-runtime-manifest-v3", "W12C"),
            ("W12D", "sc-dj-canonical-schema-activation", "W12D"),
            ("W12A-FOUR", "sc-dj-canonical-schema-activation", "W12D"),
            ("W12A-FIVEARM", "sc-dj-canonical-schema-activation", "W12D"),
        )
        for workstream, journey, task_id in cases:
            with self.subTest(workstream=workstream):
                projection = work_item.load_projection(
                    MANIFEST,
                    workstream=workstream,
                    journey=journey,
                    repo_root=REPO_ROOT,
                )

                self.assertEqual(task_id, projection.task_id)
                self.assertEqual(
                    "docs/architecture/secure-content/execution-plans/"
                    "20260913-secure-content-hard-cut/plan.md",
                    projection.plan_ref,
                )

    def test_w12_source_projections_cover_task_read_roots(self) -> None:
        cases = (
            (
                "W12A",
                "sc-dj-mobile-matrix",
                (
                    "shared-read:apps/desktop/src-tauri/src/social",
                    "shared-read:docs/architecture/secure-content",
                    "shared-read:packages/secure-content-core",
                ),
            ),
            (
                "W12C",
                "sc-dj-runtime-manifest-v3",
                (
                    "shared-read:apps/desktop",
                    "shared-read:apps/station",
                ),
            ),
            (
                "W12D",
                "sc-dj-canonical-schema-activation",
                (
                    "shared-read:apps/desktop",
                    "shared-read:apps/dev",
                    "shared-read:apps/station",
                    "shared-read:docs/architecture",
                    "shared-read:tooling",
                ),
            ),
        )
        for workstream, journey, claims in cases:
            with self.subTest(workstream=workstream):
                projection = work_item.load_projection(
                    MANIFEST,
                    workstream=workstream,
                    journey=journey,
                    repo_root=REPO_ROOT,
                )
                for claim in claims:
                    self.assertIn(claim, projection.source_claim_arguments)

    def test_desktop_usability_workstreams_exclude_other_product_runtimes(
        self,
    ) -> None:
        forbidden_journeys = {
            "sc-dj-browser-private-boundary",
            "sc-dj-mobile-matrix",
            "sc-dj-chat-attachment-atomic",
            "sc-dj-chat-attachment-mobile",
            "sc-dj-chat-revalidation",
            "sc-dj-hardcut-regression",
            "sc-dj-authorized-reset",
            "sc-dj-acceptance-promotion",
        }
        forbidden_runtime_markers = (
            "browser",
            "ios",
            "android",
            "chat",
            "final-cut",
        )
        for workstream, journey in (
            ("W12C", "sc-dj-runtime-manifest-v3"),
            ("W12D", "sc-dj-canonical-schema-activation"),
            ("W7", "sc-dj-desktop-pilot"),
            ("W8", "sc-dj-social-expansion"),
        ):
            with self.subTest(workstream=workstream):
                projection = work_item.load_projection(
                    MANIFEST,
                    workstream=workstream,
                    journey=journey,
                    repo_root=REPO_ROOT,
                )
                self.assertFalse(
                    any(
                        claim.startswith("shared-read:apps/mobile")
                        or claim.startswith("exclusive-write:apps/mobile")
                        or "messaging-platform" in claim
                        or "gates/mobile" in claim
                        for claim in projection.source_claim_arguments
                    )
                )
                self.assertNotIn(projection.journey_id, forbidden_journeys)
                self.assertFalse(
                    any(
                        marker in claim
                        for marker in forbidden_runtime_markers
                        for claim in projection.runtime_claim_arguments
                    )
                )

    def test_w12d_projection_owns_the_source_freeze_contract(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W12D",
            journey="sc-dj-canonical-schema-activation",
            repo_root=REPO_ROOT,
        )

        for path in (
            "docs/architecture/secure-content/execution-plans/"
            "20260913-secure-content-work-items.yaml",
            "tooling/development/secure_content/schema_activation.py",
            "tooling/development/secure_content/test_schema_activation.py",
            "apps/station/app/subserver/social/infrastructure/"
            "secure_content_reset_types.go",
        ):
            self.assertIn(
                f"exclusive-write:{path}",
                projection.source_claim_arguments,
            )
        self.assertEqual(
            "allowed",
            projection.authorization["checkpoint"]["amend"],
        )

    def test_w12d_activation_children_cover_parent_task_source_scope(self) -> None:
        task = _load_task_slice(W12D_TASK)
        for workstream in ("W12A-FOUR", "W12A-FIVEARM"):
            with self.subTest(workstream=workstream):
                projection = work_item.load_projection(
                    MANIFEST,
                    workstream=workstream,
                    journey="sc-dj-canonical-schema-activation",
                    repo_root=REPO_ROOT,
                )
                claims = tuple(
                    (mode, path)
                    for mode, path in (
                        claim.split(":", 1)
                        for claim in projection.source_claim_arguments
                    )
                )
                for path in task["writeSet"]:
                    self.assertTrue(
                        any(
                            mode == "exclusive-write"
                            and (path == prefix or path.startswith(f"{prefix}/"))
                            for mode, prefix in claims
                        ),
                        f"{workstream} does not cover W12D write path {path}",
                    )
                for path in task["readSet"]:
                    self.assertTrue(
                        any(
                            path == prefix or path.startswith(f"{prefix}/")
                            for _, prefix in claims
                        ),
                        f"{workstream} does not cover W12D read path {path}",
                    )

    def test_w7_projection_covers_its_task_level_read_roots(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W7",
            journey="sc-dj-desktop-pilot",
            repo_root=REPO_ROOT,
        )

        for claim in (
            "shared-read:apps/station",
            "shared-read:docs/architecture/secure-content",
            "shared-read:docs/architecture/social",
        ):
            with self.subTest(claim=claim):
                self.assertIn(claim, projection.source_claim_arguments)

    def test_w8_projection_covers_its_task_level_read_roots(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W8",
            journey="sc-dj-social-expansion",
            repo_root=REPO_ROOT,
        )

        for path in (
            "apps/station/app/subserver/social",
            "apps/desktop",
            "packages/locales",
            "tooling/development/secure_content/scenarios/private_comment.py",
            "tooling/development/secure_content/scenarios/social_expansion.py",
            "tooling/development/secure_content/scenarios/social_subtype.py",
            "tooling/development/secure_content/scenarios/social_object.py",
            "tooling/development/secure_content/scenarios/social_delete_block.py",
            "tooling/development/secure_content/scenarios/social_bounds.py",
            "docs/architecture/secure-content",
            "docs/architecture/social",
            "tooling/acceptance",
        ):
            with self.subTest(path=path):
                self.assertTrue(
                    any(
                        claim == f"shared-read:{path}"
                        or claim.startswith(f"exclusive-write:{path}")
                        for claim in projection.source_claim_arguments
                    )
                )

    def test_product_suites_attach_without_station_deploy_ownership(self) -> None:
        cases = (
            ("W7", "sc-dj-desktop-pilot"),
            ("W8", "sc-dj-social-expansion"),
        )
        for workstream, journey in cases:
            with self.subTest(workstream=workstream):
                projection = work_item.load_projection(
                    MANIFEST,
                    workstream=workstream,
                    journey=journey,
                    repo_root=REPO_ROOT,
                )
                self.assertFalse(
                    any(
                        ":station.deploy:" in claim
                        for claim in projection.runtime_claim_arguments
                    )
                )

    def test_rejects_unknown_fields_path_escape_and_runtime_kind(self) -> None:
        base = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
        cases = (
            ("unknown", lambda item: item.__setitem__("unexpected", True)),
            ("missing task", lambda item: item.pop("taskId")),
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

        runtime_manifest = work_item.load_projection(
            MANIFEST,
            workstream="W7R",
            journey="sc-dj-runtime-manifest-v3",
            repo_root=REPO_ROOT,
        )
        self.assertEqual("secure-content-w7r", runtime_manifest.work_item_id)
        self.assertEqual((), runtime_manifest.runtime_claim_arguments)
        self.assertIn(
            "exclusive-write:tooling/development/secure_content/runtime_manifest.py",
            runtime_manifest.source_claim_arguments,
        )

        for retired_workstream in (
            "W2A",
            "W2",
            "W2D",
            "W8S",
            "W9S",
            "W9",
            "W10",
            "W11",
            "W12",
            "W12B",
            "W12F-FOUR",
            "W12F-FIVEARM",
            "W13",
        ):
            with self.subTest(workstream=retired_workstream):
                with self.assertRaisesRegex(
                    work_item.ManifestError,
                    "unknown workstream",
                ):
                    work_item.load_projection(
                        MANIFEST,
                        workstream=retired_workstream,
                        journey=None,
                        repo_root=REPO_ROOT,
                    )

        for workstream, scope in (
            ("W12A-FOUR", "station-four-social-private"),
            ("W12A-FIVEARM", "station-five-arm-social-private"),
        ):
            with self.subTest(workstream=workstream):
                authorized = work_item.load_projection(
                    MANIFEST,
                    workstream=workstream,
                    journey="sc-dj-canonical-schema-activation",
                    repo_root=REPO_ROOT,
                )
                self.assertEqual(
                    authorized.authorization["runtime"][
                        "destructiveResetScopes"
                    ],
                    [scope],
                )
                self.assertEqual(
                    [
                        claim
                        for claim in authorized.runtime_claim_arguments
                        if ":station.reset:" in claim
                    ],
                    [f"exclusive:station.reset:{scope}"],
                )

        with tempfile.TemporaryDirectory() as temp:
            manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
            w12a_four = next(
                item
                for item in manifest["items"]
                if item["workstreamId"] == "W12A-FOUR"
            )
            w12a_four["authorization"]["runtime"][
                "destructiveResetScopes"
            ] = []
            path = Path(temp) / "manifest.yaml"
            path.write_text(yaml.safe_dump(manifest), encoding="utf-8")

            with self.assertRaisesRegex(
                work_item.ManifestError,
                "destructiveResetScopes",
            ):
                work_item.load_projection(
                    path,
                    workstream="W12A-FOUR",
                    journey="sc-dj-canonical-schema-activation",
                    repo_root=REPO_ROOT,
                )

    def test_start_passes_w12a_parent_locator_and_validates_readback(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W12A-FOUR",
            journey="sc-dj-canonical-schema-activation",
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
            "planPath": projection.plan_ref,
            "taskId": projection.task_id,
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
            "runtimeClaims": [
                {
                    "mode": claim.split(":", 2)[0],
                    "kind": claim.split(":", 2)[1],
                    "resourceId": claim.split(":", 2)[2],
                }
                for claim in projection.runtime_claim_arguments
            ],
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
            session=projection.work_item_id,
            command_runner=fake_runner,
        )

        self.assertEqual("a" * 64, result["declarationDigest"])
        self.assertEqual(projection.plan_ref, result["planPath"])
        self.assertEqual(projection.task_id, result["taskId"])
        self.assertEqual(
            ["node", "tooling/scripts/local-dev/dev-work.mjs", "start"],
            calls[1][:3],
        )
        plan_index = calls[1].index("--plan")
        self.assertEqual(
            [
                "--plan",
                projection.plan_ref,
                "--task",
                projection.task_id,
            ],
            calls[1][plan_index : plan_index + 4],
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
                "secure-content-w12a-four",
            ],
            calls[2],
        )

    def test_ensure_active_projection_restarts_terminal_declaration(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W12A-FOUR",
            journey="sc-dj-canonical-schema-activation",
            repo_root=REPO_ROOT,
        )
        calls: list[list[str]] = []
        declaration = {
            "declarationId": f"{projection.work_item_id}-9eb2cb904c9ae460",
            "workItemId": projection.work_item_id,
            "sessionId": "released-session",
            "workspaceId": "9eb2cb904c9ae460",
            "branch": "feat/federation",
            "sourceHead": "1" * 40,
            "journeyId": projection.journey_id,
            "planPath": projection.plan_ref,
            "taskId": projection.task_id,
            "purpose": "stale terminal declaration",
            "state": "RELEASED",
            "sourceClaims": [],
            "runtimeClaims": [],
            "declarationDigest": "1" * 64,
        }

        def fresh_declaration(state: str, digest: str) -> dict[str, object]:
            return {
                "declarationId": (
                    f"{projection.work_item_id}-9eb2cb904c9ae460"
                ),
                "workItemId": projection.work_item_id,
                "sessionId": projection.work_item_id,
                "workspaceId": "9eb2cb904c9ae460",
                "branch": "feat/federation",
                "sourceHead": "2" * 40,
                "journeyId": projection.journey_id,
                "planPath": projection.plan_ref,
                "taskId": projection.task_id,
                "purpose": projection.purpose,
                "state": state,
                "sourceClaims": [
                    {
                        "mode": claim.split(":", 1)[0],
                        "pathPrefix": claim.split(":", 1)[1],
                    }
                    for claim in projection.source_claim_arguments
                ],
                "runtimeClaims": [
                    {
                        "mode": claim.split(":", 2)[0],
                        "kind": claim.split(":", 2)[1],
                        "resourceId": claim.split(":", 2)[2],
                    }
                    for claim in projection.runtime_claim_arguments
                ],
                "declarationDigest": digest,
            }

        def fake_runner(
            command: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            nonlocal declaration
            self.assertEqual(REPO_ROOT, cwd)
            calls.append(command)
            if command == ["git", "config", "user.email"]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="acceptance@test.invalid\n",
                    stderr="",
                )
            action = command[2]
            if action == "start":
                declaration = fresh_declaration("DECLARED", "2" * 64)
            elif action == "check":
                declaration = fresh_declaration("ACTIVE", "3" * 64)
            stdout = (
                json.dumps(
                    {
                        "workspaceId": declaration["workspaceId"],
                        "declarations": [declaration],
                    }
                )
                if action == "status"
                else json.dumps(declaration)
            )
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=stdout,
                stderr="",
            )

        result = work_item.ensure_active_projection(
            projection,
            repo_root=REPO_ROOT,
            session=projection.work_item_id,
            command_runner=fake_runner,
        )

        self.assertEqual("ACTIVE", result["state"])
        self.assertEqual("3" * 64, result["declarationDigest"])
        self.assertEqual(
            ["status", "start", "status", "check", "status"],
            [
                command[2]
                for command in calls
                if command[0] == "node"
            ],
        )

    def test_ensure_active_projection_preserves_resource_conflict(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W12A-FOUR",
            journey="sc-dj-canonical-schema-activation",
            repo_root=REPO_ROOT,
        )
        released = {
            "state": "RELEASED",
            "workspaceId": "9eb2cb904c9ae460",
        }

        def conflict_runner(
            command: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            self.assertEqual(REPO_ROOT, cwd)
            if command == ["git", "config", "user.email"]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="acceptance@test.invalid\n",
                    stderr="",
                )
            if command[2] == "status":
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps(
                        {
                            "workspaceId": released["workspaceId"],
                            "declarations": [released],
                        }
                    ),
                    stderr="",
                )
            return subprocess.CompletedProcess(
                command,
                2,
                stdout="",
                stderr=json.dumps(
                    {
                        "code": "RESOURCE_DECLARATION_CONFLICT",
                        "status": "BLOCKED",
                    }
                ),
            )

        with self.assertRaisesRegex(
            work_item.CommandError,
            "RESOURCE_DECLARATION_CONFLICT",
        ):
            work_item.ensure_active_projection(
                projection,
                repo_root=REPO_ROOT,
                session=projection.work_item_id,
                command_runner=conflict_runner,
            )

    def test_plan_locator_readback_mismatch_fails_closed(self) -> None:
        projection = work_item.load_projection(
            MANIFEST,
            workstream="W4",
            journey="sc-dj-optional-auth",
            repo_root=REPO_ROOT,
        )

        for field, value in (
            ("planPath", "docs/architecture/secure-content/other-plan.md"),
            ("taskId", "W3"),
        ):
            with self.subTest(field=field):
                declaration = {
                    "declarationId": (
                        f"{projection.work_item_id}-9eb2cb904c9ae460"
                    ),
                    "workItemId": projection.work_item_id,
                    "sessionId": projection.work_item_id,
                    "workspaceId": "9eb2cb904c9ae460",
                    "branch": "feat/federation",
                    "sourceHead": (
                        "2d54851f95994d717928105aca6470c30adf3657"
                    ),
                    "journeyId": projection.journey_id,
                    "planPath": projection.plan_ref,
                    "taskId": projection.task_id,
                    "purpose": projection.purpose,
                    "state": "DECLARED",
                    "sourceClaims": [
                        {
                            "mode": claim.split(":", 1)[0],
                            "pathPrefix": claim.split(":", 1)[1],
                        }
                        for claim in projection.source_claim_arguments
                    ],
                    "runtimeClaims": [],
                    "declarationDigest": "b" * 64,
                }
                declaration[field] = value

                def fake_runner(
                    command: list[str],
                    cwd: Path,
                ) -> subprocess.CompletedProcess[str]:
                    self.assertEqual(REPO_ROOT, cwd)
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
                    return subprocess.CompletedProcess(
                        command,
                        0,
                        stdout=stdout,
                        stderr="",
                    )

                with self.assertRaisesRegex(
                    work_item.LedgerReadbackError,
                    field,
                ):
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
