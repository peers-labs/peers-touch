from __future__ import annotations

import base64
import contextlib
import copy
import hashlib
import hmac
import io
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from unittest import mock


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import preflight  # noqa: E402
import sync_vercel_env  # noqa: E402
import verify_deployment  # noqa: E402


REPO_ROOT = Path(__file__).resolve().parents[4]
SKILL_ROOT = Path(__file__).resolve().parents[1]
GITHUB_COMMIT = "a" * 40


def github_tree(paths: list[str], truncated: bool = False) -> str:
    return json.dumps(
        {
            "sha": GITHUB_COMMIT,
            "truncated": truncated,
            "tree": [
                {"path": path, "type": "blob"}
                for path in paths
            ],
        }
    )


def fixture_env() -> dict[str, str]:
    return {
        "OAUTH_STORAGE_DRIVER": "memory",
        "OAUTH_GITHUB_STORAGE_OWNER": "owner",
        "OAUTH_GITHUB_STORAGE_REPO": "repo",
        "OAUTH_GITHUB_STORAGE_BRANCH": "main",
        "OAUTH_GITHUB_APP_ID": "123",
        "OAUTH_GITHUB_APP_INSTALLATION_ID": "456",
        "OAUTH_GITHUB_APP_PRIVATE_KEY_B64": "private-key-secret",
        "OAUTH_CREDENTIAL_ACTIVE_KEY_ID": "v1",
        "OAUTH_CREDENTIAL_KEY_V1": "credential-key-secret",
        "OAUTH_STORAGE_INDEX_HMAC_KEY": "index-hmac-secret",
        "OAUTH_AUDIT_HMAC_KEY": "audit-hmac-secret",
        "OAUTH_ADMIN_USERNAME": "operator",
        "OAUTH_ADMIN_PASSWORD_HASH": (
            "pbkdf2-sha256$100000$MDEyMzQ1Njc4OWFiY2RlZg==$"
            "pnq3X8b0RCPy3QPbc4tMRNkzzR3dLJBRf6HfSFzQh1Y="
        ),
        "OAUTH_ADMIN_PASSWORD": "admin-password-secret",
        "PEERS_OAUTH_BRIDGE_SECRET": "bridge-signing-secret",
        "OAUTH_GITHUB_CLIENT_ID": "github-client",
        "OAUTH_GITHUB_CLIENT_SECRET": "github-client-secret",
        "OAUTH_GOOGLE_CLIENT_ID": "google-client",
        "OAUTH_GOOGLE_CLIENT_SECRET": "google-client-secret",
    }


def sign_bridge_callback(values: dict[str, str]) -> dict[str, str]:
    signed = dict(values)
    canonical = urlencode(
        sorted(
            (key, value)
            for key, value in signed.items()
            if key != "session_id" and value
        )
    )
    signed["sig"] = hmac.new(
        fixture_env()["PEERS_OAUTH_BRIDGE_SECRET"].encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return signed


def write_env(path: Path, values: dict[str, str]) -> None:
    path.write_text(
        "\n".join(f"{key}={value}" for key, value in sorted(values.items())) + "\n",
        encoding="utf-8",
    )
    path.chmod(0o600)


class PreflightTests(unittest.TestCase):
    def test_env_file_requires_owner_only_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            write_env(env_file, fixture_env())
            env_file.chmod(0o644)
            with self.assertRaises(preflight.PreflightError) as raised:
                preflight.parse_env_file(env_file)
        self.assertEqual(
            raised.exception.code,
            "ENV_FILE_PERMISSIONS_TOO_OPEN",
        )

    def test_env_file_rejects_duplicate_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            env_file.write_text(
                "OAUTH_SITE_ID=one\nOAUTH_SITE_ID=two\n",
                encoding="utf-8",
            )
            env_file.chmod(0o600)
            with self.assertRaises(preflight.PreflightError) as raised:
                preflight.parse_env_file(env_file)
        self.assertEqual(
            raised.exception.code,
            "ENV_FILE_DUPLICATE_KEYS",
        )

    def test_env_file_decodes_shell_escaped_dollar_signs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            env_file.write_text(
                r"OAUTH_ADMIN_PASSWORD_HASH=pbkdf2-sha256\$100000\$salt\$digest"
                + "\n",
                encoding="utf-8",
            )
            env_file.chmod(0o600)

            values = preflight.parse_env_file(env_file)

        self.assertEqual(
            values["OAUTH_ADMIN_PASSWORD_HASH"],
            "pbkdf2-sha256$100000$salt$digest",
        )

    def test_default_root_and_provider_discovery_match_current_source(self) -> None:
        self.assertEqual(preflight.default_repo_root(), REPO_ROOT)
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        discovery = preflight.discover_source(REPO_ROOT, catalog)
        self.assertTrue(discovery["catalogMatches"])
        self.assertEqual(discovery["providers"], ["github", "google", "weixin"])
        self.assertEqual(discovery["enabledProviders"], ["github", "google"])
        self.assertEqual(
            discovery["evidence"]["github"]["capabilities"]["pkce"],
            "S256",
        )
        self.assertTrue(
            discovery["evidence"]["weixin"]["capabilities"]["unionId"]
        )

    def test_vercel_config_targets_only_function_entrypoints(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        app_root = REPO_ROOT / "apps/oauth2-client"
        self.assertEqual(
            preflight.validate_vercel_config(
                app_root,
                ["github", "google"],
                catalog,
            ),
            [],
        )

        with tempfile.TemporaryDirectory() as temporary:
            stale_root = Path(temporary)
            stale_config = json.loads(
                (app_root / "vercel.json").read_text(encoding="utf-8")
            )
            stale_config["functions"] = {
                "api/**/*.go": {
                    "includeFiles": "config/sites.json",
                    "maxDuration": 60,
                }
            }
            (stale_root / "vercel.json").write_text(
                json.dumps(stale_config),
                encoding="utf-8",
            )
            errors = preflight.validate_vercel_config(
                stale_root,
                ["github", "google"],
                catalog,
            )

        self.assertIn(
            "Go Functions must use Vercel auto-discovery instead of functions globs",
            errors,
        )

    def test_catalog_drift_is_detected(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        stale = copy.deepcopy(catalog)
        stale["providers"]["github"]["status"] = "future-onboarding"
        discovery = preflight.discover_source(REPO_ROOT, stale)
        self.assertFalse(discovery["catalogMatches"])
        self.assertIn("github", discovery["catalogDelta"]["unknownProviders"])

    def test_apple_context_requires_private_key_jwt_fields(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        apple = catalog["providers"]["apple"]
        suffixes = {
            field["suffix"] for field in apple["credentialFields"]
        }
        self.assertEqual(apple["credentialModel"], "private_key_jwt")
        self.assertTrue(
            {"CLIENT_ID", "ISSUER", "TEAM_ID", "KEY_ID", "PRIVATE_KEY_B64"}
            <= suffixes
        )

    def test_capability_drift_is_detected(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        stale = copy.deepcopy(catalog)
        stale["providers"]["google"]["capabilities"]["refreshToken"] = False
        discovery = preflight.discover_source(REPO_ROOT, stale)
        self.assertFalse(discovery["catalogMatches"])
        self.assertIn(
            "google",
            discovery["catalogDelta"]["capabilityMismatches"],
        )

    def test_example_config_cannot_enable_runtime_provider(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            config_dir = Path(temporary)
            (config_dir / "sites.json").write_text(
                json.dumps(
                    {
                        "sites": [
                            {
                                "providers": {
                                    "github": {"enabled": True},
                                    "google": {"enabled": False},
                                    "weixin": {"enabled": False},
                                }
                            },
                            {"providers": {"google": {"enabled": True}}},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (config_dir / "sites.example.json").write_text(
                json.dumps(
                    {
                        "sites": [
                            {
                                "providers": {
                                    "weixin": {"enabled": True},
                                    "apple": {"enabled": True},
                                }
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            providers, enabled = preflight._config_providers(config_dir)

        self.assertEqual(providers, {"apple", "github", "google", "weixin"})
        self.assertEqual(
            enabled,
            {"github": True, "google": True, "weixin": False},
        )

    def test_preflight_redacts_values_and_forces_production_overrides(self) -> None:
        values = fixture_env()
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            write_env(env_file, values)
            report, sync_values = preflight.build_preflight(
                REPO_ROOT,
                env_file,
                preflight.DEFAULT_CATALOG,
                "https://oauth.example.test/",
                ["peers-touch://oauth/callback?request=ignored"],
                [],
            )
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(
                report["deployment"]["callbacks"]["github"],
                "https://oauth.example.test/api/oauth/github/callback",
            )
            self.assertEqual(sync_values["OAUTH_STORAGE_DRIVER"], ("github", "config"))
            self.assertNotIn("OAUTH_ADMIN_PASSWORD", sync_values)

            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exit_code = preflight.main(
                    [
                        "--repo-root",
                        str(REPO_ROOT),
                        "--env-file",
                        str(env_file),
                        "--base-url",
                        "https://oauth.example.test",
                        "--return-to",
                        "peers-touch://oauth/callback",
                    ]
                )
            self.assertEqual(exit_code, 0)
            rendered = output.getvalue()
            for secret in values.values():
                if "secret" in secret:
                    self.assertNotIn(secret, rendered)

    def test_missing_environment_emits_key_only_delta(self) -> None:
        values = fixture_env()
        del values["OAUTH_GOOGLE_CLIENT_SECRET"]
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            write_env(env_file, values)
            report, _ = preflight.build_preflight(
                REPO_ROOT,
                env_file,
                preflight.DEFAULT_CATALOG,
                "https://oauth.example.test",
                ["https://app.example.test/oauth/callback"],
                [],
            )
        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(
            report["environment"]["missingKeys"],
            ["OAUTH_GOOGLE_CLIENT_SECRET"],
        )
        self.assertNotIn("google-client-secret", json.dumps(report))

    def test_invalid_admin_password_hash_blocks_sync_without_exposing_value(self) -> None:
        values = fixture_env()
        values["OAUTH_ADMIN_PASSWORD_HASH"] = "not-a-valid-password-hash"
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            write_env(env_file, values)
            report, _ = preflight.build_preflight(
                REPO_ROOT,
                env_file,
                preflight.DEFAULT_CATALOG,
                "https://oauth.example.test",
                ["https://app.example.test/oauth/callback"],
                [],
            )

        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(
            report["environment"]["invalidKeys"],
            ["OAUTH_ADMIN_PASSWORD_HASH"],
        )
        self.assertNotIn("not-a-valid-password-hash", json.dumps(report))

    def test_explicit_provider_must_be_enabled_in_runtime_config(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            write_env(env_file, fixture_env())
            with self.assertRaises(preflight.PreflightError) as raised:
                preflight.build_preflight(
                    REPO_ROOT,
                    env_file,
                    preflight.DEFAULT_CATALOG,
                    "https://oauth.example.test",
                    ["https://app.example.test/oauth/callback"],
                    ["weixin"],
                )
        self.assertEqual(raised.exception.code, "PROVIDER_NOT_ENABLED")

    def test_explicit_provider_subset_cannot_skip_an_enabled_provider(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "runtime.env"
            write_env(env_file, fixture_env())
            with self.assertRaises(preflight.PreflightError) as raised:
                preflight.build_preflight(
                    REPO_ROOT,
                    env_file,
                    preflight.DEFAULT_CATALOG,
                    "https://oauth.example.test",
                    ["https://app.example.test/oauth/callback"],
                    ["github"],
                )
        self.assertEqual(
            raised.exception.code,
            "PROVIDER_SELECTION_INCOMPLETE",
        )
        self.assertEqual(raised.exception.detail["providers"], ["google"])


class SkillGovernanceTests(unittest.TestCase):
    def test_frontmatter_path_and_agents_registration(self) -> None:
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertEqual(SKILL_ROOT.name, "pt-oauth2-client-2-vercel")
        self.assertTrue(skill.startswith("---\nname: pt-oauth2-client-2-vercel\n"))
        description = next(
            line.removeprefix("description: ")
            for line in skill.splitlines()
            if line.startswith("description: ")
        )
        for trigger in (
            "oauth2-client-2-vercel",
            "deploy/publish oauth2-client to Vercel",
            "发布 OAuth2 client server",
        ):
            self.assertIn(trigger, description)
        self.assertIn("vercel deploy --target=preview --yes", skill)
        self.assertIn("creates a new Production deployment", skill)
        agents = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("| `pt-oauth2-client-2-vercel` |", agents)
        projection = REPO_ROOT / ".trae/skills/pt-oauth2-client-2-vercel"
        if projection.exists():
            self.assertEqual(projection.resolve(), SKILL_ROOT.resolve())
        tracked = subprocess.run(
            [
                "git",
                "ls-files",
                "--error-unmatch",
                ".trae/skills/pt-oauth2-client-2-vercel/SKILL.md",
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(tracked.returncode, 0)

    def test_provider_source_change_selects_publication_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "plan.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "tooling/scripts/acceptance-plan.py"),
                    "--changed-file",
                    "apps/oauth2-client/internal/infrastructure/provider/google/provider.go",
                    "--output",
                    str(output),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            plan = json.loads(output.read_text(encoding="utf-8"))
        self.assertIn(
            "oauth2-client-vercel-publication",
            [gate["id"] for gate in plan["selected_gates"]],
        )

    def test_vercel_link_metadata_is_ignored(self) -> None:
        completed = subprocess.run(
            ["git", "check-ignore", "--quiet", ".vercel/project.json"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0)


class SyncTests(unittest.TestCase):
    def test_sync_passes_values_only_on_stdin(self) -> None:
        calls: list[tuple[list[str], dict[str, object]]] = []

        def runner(command, **kwargs):
            calls.append((command, kwargs))
            if command[-1] == "--version":
                return subprocess.CompletedProcess(
                    command,
                    0,
                    sync_vercel_env.SUPPORTED_VERCEL_CLI_VERSION + "\n",
                    "",
                )
            return subprocess.CompletedProcess(command, 0, "", "")

        values = {
            "OAUTH_GITHUB_CLIENT_SECRET": ("never-in-argv", "secret"),
            "OAUTH_BASE_URL": ("https://oauth.example.test", "config"),
        }
        result = sync_vercel_env.sync_environment(
            REPO_ROOT,
            values,
            ["preview"],
            "/usr/bin/true",
            False,
            runner,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["operationCount"], 2)
        self.assertEqual(
            result["cliVersion"],
            sync_vercel_env.SUPPORTED_VERCEL_CLI_VERSION,
        )
        env_calls = [
            (command, kwargs)
            for command, kwargs in calls
            if "env" in command
        ]
        self.assertTrue(
            all(
                "never-in-argv" not in argument
                for command, _ in env_calls
                for argument in command
            )
        )
        secret_call = next(
            item
            for item in env_calls
            if "OAUTH_GITHUB_CLIENT_SECRET" in item[0]
        )
        config_call = next(
            item
            for item in env_calls
            if "OAUTH_BASE_URL" in item[0]
        )
        self.assertEqual(secret_call[1]["input"], "never-in-argv\n")
        self.assertEqual(secret_call[1]["cwd"], REPO_ROOT)
        self.assertEqual(secret_call[0][-2:], ["--type", "secret"])
        self.assertEqual(config_call[0][-2:], ["--type", "config"])
        self.assertNotIn("--visibility", secret_call[0])
        self.assertNotIn("--visibility", config_call[0])

    def test_dry_run_does_not_require_vercel_cli(self) -> None:
        result = sync_vercel_env.sync_environment(
            REPO_ROOT,
            {"OAUTH_BASE_URL": ("https://oauth.example.test", "config")},
            ["preview", "production"],
            "missing-vercel-cli",
            True,
        )
        self.assertEqual(result["mode"], "dry-run")
        self.assertEqual(result["operationCount"], 2)

    def test_default_cli_falls_back_to_npx(self) -> None:
        with mock.patch.object(
            sync_vercel_env.shutil,
            "which",
            side_effect=lambda binary: (
                "/usr/local/bin/npx" if binary == "npx" else None
            ),
        ):
            self.assertEqual(
                sync_vercel_env.resolve_vercel_command("vercel"),
                [
                    "/usr/local/bin/npx",
                    "--yes",
                    f"vercel@{sync_vercel_env.SUPPORTED_VERCEL_CLI_VERSION}",
                ],
            )

    def test_old_cli_is_rejected_before_environment_mutation(self) -> None:
        def runner(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, "21.4.0\n", "")

        with self.assertRaises(preflight.PreflightError) as raised:
            sync_vercel_env.sync_environment(
                REPO_ROOT,
                {"OAUTH_BASE_URL": ("https://oauth.example.test", "config")},
                ["preview"],
                "/usr/bin/true",
                False,
                runner,
            )
        self.assertEqual(
            raised.exception.code,
            "VERCEL_CLI_VERSION_UNSUPPORTED",
        )


class VerificationTests(unittest.TestCase):
    def test_http_contract_self_test(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        result = verify_deployment.self_test(catalog)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["http"]["methodContract"], "GET-only")

    def test_live_provider_does_not_narrow_enabled_provider_checks(self) -> None:
        observed: dict[str, object] = {}

        def verify_http(base_url, providers, catalog, site_id, timeout):
            observed["httpProviders"] = providers
            return {"status": "PASS"}

        def run_live(base_url, env, provider, site_id, timeout):
            observed["liveProvider"] = provider
            return {"status": "PASS", "provider": provider}

        with (
            mock.patch.object(
                verify_deployment,
                "verify_http_contract",
                side_effect=verify_http,
            ),
            mock.patch.object(
                verify_deployment,
                "parse_env_file",
                return_value=fixture_env(),
            ),
            mock.patch.object(
                verify_deployment,
                "verify_github_repository_private",
                return_value={"status": "PASS", "private": True},
            ),
            mock.patch.object(
                verify_deployment,
                "run_live_provider",
                side_effect=run_live,
            ),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            result = verify_deployment.main(
                [
                    "--repo-root",
                    str(REPO_ROOT),
                    "--base-url",
                    "https://oauth.example.test",
                    "--run-live-provider",
                    "github",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(observed["httpProviders"], ["github", "google"])
        self.assertEqual(observed["liveProvider"], "github")

    def test_live_admin_requires_each_provider_and_rejects_secret_fields(self) -> None:
        payload = {
            "identities": [
                {"provider": "github", "login_count": 1, "has_access_token": True},
                {"provider": "google", "login_count": 1, "has_refresh_token": True},
            ],
            "events": [],
        }
        with mock.patch.object(
            verify_deployment,
            "_request",
            return_value=(200, {}, json.dumps(payload).encode("utf-8")),
        ):
            result = verify_deployment.verify_live_admin(
                "https://oauth.example.test",
                fixture_env(),
                ["github", "google"],
                2,
                {
                    "kind": "oauth2-client-live-baseline",
                    "baseUrl": "https://oauth.example.test",
                    "providers": {
                        "github": {"identityCount": 0, "loginCount": 0},
                        "google": {"identityCount": 0, "loginCount": 0},
                    },
                },
            )
        self.assertEqual(result["providers"], ["github", "google"])
        self.assertFalse(result["secretFieldsExposed"])

    def test_live_admin_requires_login_count_to_advance_from_baseline(self) -> None:
        payload = {
            "identities": [
                {"provider": "github", "login_count": 3},
                {"provider": "google", "login_count": 2},
            ],
        }
        baseline = {
            "kind": "oauth2-client-live-baseline",
            "baseUrl": "https://oauth.example.test",
            "providers": {
                "github": {"identityCount": 1, "loginCount": 2},
                "google": {"identityCount": 1, "loginCount": 1},
            },
        }
        with mock.patch.object(
            verify_deployment,
            "_request",
            return_value=(200, {}, json.dumps(payload).encode("utf-8")),
        ):
            result = verify_deployment.verify_live_admin(
                "https://oauth.example.test",
                fixture_env(),
                ["github", "google"],
                2,
                baseline,
            )
        self.assertEqual(
            result["advancedSinceBaseline"],
            ["github", "google"],
        )

    def test_live_admin_rejects_stale_identity_readback(self) -> None:
        payload = {
            "identities": [
                {"provider": "github", "login_count": 2},
            ],
        }
        baseline = {
            "kind": "oauth2-client-live-baseline",
            "baseUrl": "https://oauth.example.test",
            "providers": {
                "github": {"identityCount": 1, "loginCount": 2},
            },
        }
        with mock.patch.object(
            verify_deployment,
            "_request",
            return_value=(200, {}, json.dumps(payload).encode("utf-8")),
        ):
            with self.assertRaises(preflight.PreflightError) as raised:
                verify_deployment.verify_live_admin(
                    "https://oauth.example.test",
                    fixture_env(),
                    ["github"],
                    2,
                    baseline,
                )
        self.assertEqual(
            raised.exception.code,
            "LIVE_PROVIDER_CALLBACK_UNPROVEN",
        )
        self.assertEqual(
            raised.exception.detail["reason"],
            "login_count_not_advanced",
        )

    def test_live_admin_rejects_baseline_from_another_domain(self) -> None:
        baseline = {
            "kind": "oauth2-client-live-baseline",
            "baseUrl": "https://other.example.test",
            "providers": {
                "github": {"identityCount": 1, "loginCount": 0},
            },
        }
        with mock.patch.object(
            verify_deployment,
            "_request",
            return_value=(
                200,
                {},
                json.dumps(
                    {
                        "identities": [
                            {"provider": "github", "login_count": 1},
                        ]
                    }
                ).encode("utf-8"),
            ),
        ):
            with self.assertRaises(preflight.PreflightError) as raised:
                verify_deployment.verify_live_admin(
                    "https://oauth.example.test",
                    fixture_env(),
                    ["github"],
                    2,
                    baseline,
                )
        self.assertEqual(
            raised.exception.code,
            "LIVE_PROVIDER_BASELINE_INVALID",
        )

    def test_signed_callback_is_bound_to_the_live_receiver(self) -> None:
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        values = sign_bridge_callback({
            "bridge_version": "v1",
            "provider": "github",
            "site_id": "default",
            "purpose": "account_login",
            "session_id": "vercel-verify-fixture",
            "receiver_id": "vercel-verify-fixture",
            "receiver_challenge": "fixture-challenge",
            "assertion_id": "a" * 64,
            "provider_user_id": "42",
            "email_verified": "false",
            "ts": "2026-10-02T12:00:00Z",
        })
        result = verify_deployment._verify_bridge_callback(
            "http://127.0.0.1:43123/callback?" + urlencode(values),
            "github",
            "default",
            "vercel-verify-fixture",
            "fixture-challenge",
            fixture_env()["PEERS_OAUTH_BRIDGE_SECRET"],
            now,
        )
        self.assertEqual(result["receiverBinding"], "PASS")
        self.assertEqual(result["assertionSignature"], "PASS")

    def test_signed_callback_rejects_a_different_receiver_challenge(self) -> None:
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        values = sign_bridge_callback({
            "bridge_version": "v1",
            "provider": "github",
            "site_id": "default",
            "purpose": "account_login",
            "session_id": "vercel-verify-fixture",
            "receiver_id": "vercel-verify-fixture",
            "receiver_challenge": "other-challenge",
            "assertion_id": "a" * 64,
            "provider_user_id": "42",
            "email_verified": "false",
            "ts": "2026-10-02T12:00:00Z",
        })
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment._verify_bridge_callback(
                "http://127.0.0.1:43123/callback?" + urlencode(values),
                "github",
                "default",
                "vercel-verify-fixture",
                "fixture-challenge",
                fixture_env()["PEERS_OAUTH_BRIDGE_SECRET"],
                now,
            )
        self.assertEqual(
            raised.exception.code,
            "LIVE_CALLBACK_RECEIVER_MISMATCH",
        )

    def test_signed_callback_rejects_mismatched_session_id(self) -> None:
        values = sign_bridge_callback({
            "bridge_version": "v1",
            "provider": "github",
            "site_id": "default",
            "purpose": "account_login",
            "session_id": "other-session",
            "receiver_id": "vercel-verify-fixture",
            "receiver_challenge": "fixture-challenge",
            "assertion_id": "a" * 64,
            "provider_user_id": "42",
            "email_verified": "false",
            "ts": "2026-10-02T12:00:00Z",
        })
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment._verify_bridge_callback(
                "http://127.0.0.1:43123/callback?" + urlencode(values),
                "github",
                "default",
                "vercel-verify-fixture",
                "fixture-challenge",
                fixture_env()["PEERS_OAUTH_BRIDGE_SECRET"],
                datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc),
            )
        self.assertEqual(
            raised.exception.code,
            "LIVE_CALLBACK_RECEIVER_MISMATCH",
        )

    def test_signed_callback_rejects_consumer_invalid_identity(self) -> None:
        now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        values = sign_bridge_callback({
            "bridge_version": "v1",
            "provider": "github",
            "site_id": "default",
            "purpose": "account_login",
            "session_id": "vercel-verify-fixture",
            "receiver_id": "vercel-verify-fixture",
            "receiver_challenge": "fixture-challenge",
            "assertion_id": "a" * 64,
            "provider_user_id": "",
            "email_verified": "true",
            "ts": "2026-10-02T12:00:00Z",
        })
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment._verify_bridge_callback(
                "http://127.0.0.1:43123/callback?" + urlencode(values),
                "github",
                "default",
                "vercel-verify-fixture",
                "fixture-challenge",
                fixture_env()["PEERS_OAUTH_BRIDGE_SECRET"],
                now,
            )
        self.assertEqual(
            raised.exception.code,
            "LIVE_CALLBACK_IDENTITY_INVALID",
        )

    def test_signed_callback_uses_station_timestamp_window(self) -> None:
        now = datetime(2026, 10, 2, 12, 6, tzinfo=timezone.utc)
        values = sign_bridge_callback({
            "bridge_version": "v1",
            "provider": "github",
            "site_id": "default",
            "purpose": "account_login",
            "session_id": "vercel-verify-fixture",
            "receiver_id": "vercel-verify-fixture",
            "receiver_challenge": "fixture-challenge",
            "assertion_id": "a" * 64,
            "provider_user_id": "42",
            "email_verified": "false",
            "ts": "2026-10-02T12:00:00Z",
        })
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment._verify_bridge_callback(
                "http://127.0.0.1:43123/callback?" + urlencode(values),
                "github",
                "default",
                "vercel-verify-fixture",
                "fixture-challenge",
                fixture_env()["PEERS_OAUTH_BRIDGE_SECRET"],
                now,
            )
        self.assertEqual(
            raised.exception.code,
            "LIVE_CALLBACK_TIMESTAMP_INVALID",
        )

    def test_live_admin_rejects_malformed_login_count_with_typed_error(self) -> None:
        payload = {
            "identities": [
                {"provider": "github", "login_count": "not-a-number"},
            ],
        }
        with mock.patch.object(
            verify_deployment,
            "_request",
            return_value=(200, {}, json.dumps(payload).encode("utf-8")),
        ):
            with self.assertRaises(preflight.PreflightError) as raised:
                verify_deployment.verify_live_admin(
                    "https://oauth.example.test",
                    fixture_env(),
                    ["github"],
                    2,
                    {
                        "kind": "oauth2-client-live-baseline",
                        "baseUrl": "https://oauth.example.test",
                        "providers": {
                            "github": {"identityCount": 0, "loginCount": 0},
                        },
                    },
                )
        self.assertEqual(raised.exception.code, "LIVE_ADMIN_READBACK_INVALID")
        self.assertEqual(
            raised.exception.detail,
            {"field": "identities[0]"},
        )

    def test_github_persistence_checks_all_envelope_classes(self) -> None:
        paths = [
            f"oauth-data/{record_class}/fixture.json"
            for record_class in verify_deployment.RECORD_CLASSES
        ]
        def encoded_envelope(key_id: str) -> str:
            return base64.b64encode(
                json.dumps(
                    {
                        "version": 1,
                        "key_id": key_id,
                        "algorithm": "AES-256-GCM",
                        "nonce": "fixture-nonce",
                        "ciphertext": "fixture-ciphertext",
                        "updated_at": "2026-10-02T00:00:00Z",
                    }
                ).encode("utf-8")
            ).decode("ascii")

        def runner(command, **kwargs):
            if command[2] == "repos/owner/repo":
                output = "true\n"
            elif "/commits/" in command[2]:
                output = GITHUB_COMMIT
            elif "/git/trees/" in command[2]:
                output = github_tree(paths)
            elif "/audits/" in command[2]:
                self.assertIn(f"ref={GITHUB_COMMIT}", command[2])
                output = encoded_envelope("v2")
            elif command[1:3] == ["run", "./cmd/verify-record-envelopes"]:
                request = json.loads(kwargs["input"])
                self.assertNotIn(
                    "current-credential-key-secret",
                    " ".join(command),
                )
                self.assertIn(
                    "current-credential-key-secret",
                    request["keys"].values(),
                )
                output = json.dumps(
                    {
                        "status": "PASS",
                        "record_count": len(paths),
                        "active_key_envelope_count": 1,
                        "retained_key_envelope_count": len(paths) - 1,
                    }
                )
            else:
                output = encoded_envelope("v1")
            return subprocess.CompletedProcess(command, 0, output, "")

        values = fixture_env()
        values["OAUTH_CREDENTIAL_ACTIVE_KEY_ID"] = "V2"
        values["OAUTH_CREDENTIAL_KEY_V2"] = "current-credential-key-secret"
        result = verify_deployment.verify_github_envelopes(
            values,
            runner=runner,
            gh_bin="fixture-gh",
        )
        self.assertEqual(result["envelopeCount"], len(paths))
        self.assertEqual(result["activeKeyEnvelopeCount"], 1)
        self.assertEqual(
            result["retainedKeyEnvelopeCount"],
            len(paths) - 1,
        )
        self.assertTrue(result["allKeyIdsConfigured"])
        self.assertTrue(result["repositoryPrivate"])
        self.assertFalse(result["plaintextSecrets"])

    def test_github_persistence_does_not_require_refresh_before_first_login(
        self,
    ) -> None:
        paths = [
            f"oauth-data/{record_class}/fixture.json"
            for record_class in verify_deployment.REQUIRED_CALLBACK_RECORD_CLASSES
        ]
        envelope = base64.b64encode(
            json.dumps(
                {
                    "version": 1,
                    "key_id": "v1",
                    "algorithm": "AES-256-GCM",
                    "nonce": "fixture-nonce",
                    "ciphertext": "fixture-ciphertext",
                    "updated_at": "2026-10-02T00:00:00Z",
                }
            ).encode("utf-8")
        ).decode("ascii")

        def runner(command, **kwargs):
            if command[2] == "repos/owner/repo":
                output = "true\n"
            elif "/commits/" in command[2]:
                output = GITHUB_COMMIT
            elif "/git/trees/" in command[2]:
                output = github_tree(paths)
            elif command[1:3] == ["run", "./cmd/verify-record-envelopes"]:
                output = json.dumps(
                    {
                        "status": "PASS",
                        "record_count": len(paths),
                        "active_key_envelope_count": len(paths),
                        "retained_key_envelope_count": 0,
                    }
                )
            else:
                output = envelope
            return subprocess.CompletedProcess(command, 0, output, "")

        result = verify_deployment.verify_github_envelopes(
            fixture_env(),
            runner=runner,
            gh_bin="fixture-gh",
        )
        self.assertNotIn("refresh-operations", result["recordClasses"])
        self.assertEqual(
            result["requiredRecordClasses"],
            list(verify_deployment.REQUIRED_CALLBACK_RECORD_CLASSES),
        )
        self.assertEqual(result["repositoryCommit"], GITHUB_COMMIT)

    def test_github_persistence_rejects_truncated_tree(self) -> None:
        def runner(command, **kwargs):
            if command[2] == "repos/owner/repo":
                output = "true\n"
            elif "/commits/" in command[2]:
                output = GITHUB_COMMIT
            else:
                output = github_tree([], truncated=True)
            return subprocess.CompletedProcess(command, 0, output, "")

        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.verify_github_envelopes(
                fixture_env(),
                runner=runner,
                gh_bin="fixture-gh",
            )
        self.assertEqual(
            raised.exception.code,
            "GITHUB_PERSISTENCE_TREE_TRUNCATED",
        )

    def test_github_persistence_requires_an_active_key_envelope(self) -> None:
        paths = [
            f"oauth-data/{record_class}/fixture.json"
            for record_class in verify_deployment.RECORD_CLASSES
        ]
        old_envelope = base64.b64encode(
            json.dumps(
                {
                    "version": 1,
                    "key_id": "v1",
                    "algorithm": "AES-256-GCM",
                    "nonce": "fixture-nonce",
                    "ciphertext": "fixture-ciphertext",
                    "updated_at": "2026-10-02T00:00:00Z",
                }
            ).encode("utf-8")
        ).decode("ascii")

        def runner(command, **kwargs):
            if command[2] == "repos/owner/repo":
                output = "true\n"
            elif "/commits/" in command[2]:
                output = GITHUB_COMMIT
            elif "/git/trees/" in command[2]:
                output = github_tree(paths)
            else:
                output = old_envelope
            return subprocess.CompletedProcess(command, 0, output, "")

        values = fixture_env()
        values["OAUTH_CREDENTIAL_ACTIVE_KEY_ID"] = "v2"
        values["OAUTH_CREDENTIAL_KEY_V2"] = "current-credential-key-secret"
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.verify_github_envelopes(
                values,
                runner=runner,
                gh_bin="fixture-gh",
            )
        self.assertEqual(
            raised.exception.code,
            "GITHUB_ACTIVE_KEY_ENVELOPE_MISSING",
        )

    def test_github_persistence_rejects_non_object_envelope(self) -> None:
        paths = [
            f"oauth-data/{record_class}/fixture.json"
            for record_class in verify_deployment.RECORD_CLASSES
        ]
        malformed = base64.b64encode(b"[]").decode("ascii")

        def runner(command, **kwargs):
            if command[2] == "repos/owner/repo":
                output = "true\n"
            elif "/commits/" in command[2]:
                output = GITHUB_COMMIT
            elif "/git/trees/" in command[2]:
                output = github_tree(paths)
            else:
                output = malformed
            return subprocess.CompletedProcess(command, 0, output, "")

        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.verify_github_envelopes(
                fixture_env(),
                runner=runner,
                gh_bin="fixture-gh",
            )
        self.assertEqual(raised.exception.code, "GITHUB_ENVELOPE_INVALID")

    def test_github_persistence_rejects_public_repository(self) -> None:
        def runner(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, "false\n", "")

        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.verify_github_envelopes(
                fixture_env(),
                runner=runner,
                gh_bin="fixture-gh",
            )
        self.assertEqual(
            raised.exception.code,
            "GITHUB_STORAGE_REPOSITORY_NOT_PRIVATE",
        )

    def test_github_persistence_rejects_extra_plaintext_envelope_fields(
        self,
    ) -> None:
        paths = [
            f"oauth-data/{record_class}/fixture.json"
            for record_class in verify_deployment.REQUIRED_CALLBACK_RECORD_CLASSES
        ]
        envelope = base64.b64encode(
            json.dumps(
                {
                    "version": 1,
                    "key_id": "v1",
                    "algorithm": "AES-256-GCM",
                    "nonce": "fixture-nonce",
                    "ciphertext": "fixture-ciphertext",
                    "updated_at": "2026-10-02T00:00:00Z",
                    "access_token": "plaintext-runtime-token",
                }
            ).encode("utf-8")
        ).decode("ascii")

        def runner(command, **kwargs):
            if command[2] == "repos/owner/repo":
                output = "true\n"
            elif "/commits/" in command[2]:
                output = GITHUB_COMMIT
            elif "/git/trees/" in command[2]:
                output = github_tree(paths)
            else:
                output = envelope
            return subprocess.CompletedProcess(command, 0, output, "")

        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.verify_github_envelopes(
                fixture_env(),
                runner=runner,
                gh_bin="fixture-gh",
            )
        self.assertEqual(raised.exception.code, "GITHUB_ENVELOPE_INVALID")


if __name__ == "__main__":
    unittest.main()
