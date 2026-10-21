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
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from unittest import mock


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import preflight  # noqa: E402
import prepare_artifact  # noqa: E402
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
        self.assertNotIn("operator", discovery["providers"])
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

    def test_upload_artifact_includes_neutral_git_module(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "artifact"
            result = prepare_artifact.prepare_artifact(REPO_ROOT, output)
            go_mod = (
                output / "apps/oauth2-client/go.mod"
            ).read_text(encoding="utf-8")

            self.assertEqual(result["status"], "PASS")
            self.assertGreater(result["sharedModuleFiles"], 0)
            self.assertIn(prepare_artifact.NEW_REPLACE, go_mod)
            self.assertNotIn(prepare_artifact.OLD_REPLACE, go_mod)
            self.assertTrue(
                (
                    output
                    / "apps/oauth2-client/packages/github-repository/go.mod"
                ).is_file()
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
        self.assertIn("scripts/prepare_artifact.py", skill)
        self.assertIn("--target=preview", skill)
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


class _OperatorBrokerHandler(BaseHTTPRequestHandler):
    catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
    base_url = "http://127.0.0.1"
    bare_rejects = True

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        self.send_response(405)
        self.send_header("Allow", "GET")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/healthz":
            self._json(200, {"status": "ok", "version": "0.1.0"})
            return
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) == 4 and parts[:2] == ["api", "oauth"]:
            provider, action = parts[2], parts[3]
            query = parse_qs(parsed.query)
            if action == "callback":
                if "code" in query and "error" in query:
                    self._json(400, {"error": "invalid_callback_result"})
                    return
                self._json(404, {"error": "not_found"})
                return
            if action == "start":
                if self.bare_rejects and "return_to" not in query:
                    self._json(
                        400, {"error": "operator_handoff_binding_mismatch"}
                    )
                    return
                context = self.catalog["providers"][provider]
                params = {
                    "redirect_uri": self.base_url + context["callbackPath"],
                    "state": "opaque-state",
                }
                if context["capabilities"].get("pkce") == "S256":
                    params["code_challenge_method"] = "S256"
                    params["code_challenge"] = "fixture-challenge"
                location = (
                    "https://" + context["authorizationHost"] + "/?"
                    + urlencode(params)
                )
                self.send_response(302)
                self.send_header("Location", location)
                self.end_headers()
                return
        self._json(404, {"error": "not_found"})

    def log_message(self, format: str, *args: object) -> None:
        return


class _FixedHealthHandler(BaseHTTPRequestHandler):
    health_body: bytes = b"{}"

    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(self.health_body)))
        self.end_headers()
        self.wfile.write(self.health_body)

    def log_message(self, format: str, *args: object) -> None:
        return


class VerificationTests(unittest.TestCase):
    def test_http_contract_self_test(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        result = verify_deployment.self_test(catalog)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["http"]["methodContract"], "GET-only")

    def test_healthz_requires_exact_status_and_semver_version(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        invalid_bodies = [
            b'{"status":"ok"}',
            b'{"status":"ok","version":"v0.1.0"}',
            b'{"status":"ok","version":"0.1"}',
            b'{"status":"degraded","version":"0.1.0"}',
            b'{"status":"ok","version":"0.1.0","extra":true}',
        ]
        for health_body in invalid_bodies:
            _FixedHealthHandler.health_body = health_body
            server = ThreadingHTTPServer(("127.0.0.1", 0), _FixedHealthHandler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_port}"
                with self.assertRaises(preflight.PreflightError) as raised:
                    verify_deployment.verify_http_contract(
                        base_url,
                        ["github", "google"],
                        catalog,
                        "default",
                        5,
                        allow_http=True,
                    )
                self.assertEqual(
                    raised.exception.code,
                    "HEALTH_CONTRACT_FAILED",
                    health_body,
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_operator_return_to_matches_broker_binding_contract(self) -> None:
        callback_url = (
            "https://admin.example.test/api/admin/auth/callback?existing=1"
        )
        for _ in range(5):
            bound = urlparse(
                verify_deployment.build_operator_return_to(callback_url)
            )
            self.assertEqual(bound.scheme, "https")
            self.assertEqual(bound.hostname, "admin.example.test")
            self.assertEqual(bound.path, "/api/admin/auth/callback")
            self.assertEqual(bound.fragment, "")
            query = parse_qs(bound.query)
            self.assertEqual(set(query), {"receiver_challenge", "login_attempt_id"})
            challenge = base64.urlsafe_b64decode(
                query["receiver_challenge"][0] + "=="
            )
            self.assertEqual(len(challenge), 32)
            self.assertRegex(
                query["login_attempt_id"][0],
                r"^[A-Za-z0-9_-]{16,128}$",
            )

    def test_resolve_operator_callback_url(self) -> None:
        complete_env = {
            "OAUTH_OPERATOR_LOGIN_SITE_ID": "default",
            "OAUTH_OPERATOR_LOGIN_CALLBACK_URL": (
                "https://admin.example.test/api/admin/auth/callback"
            ),
            "OAUTH_OPERATOR_LOGIN_AUDIENCE": "x-config-admin",
            "OAUTH_OPERATOR_LOGIN_SIGNING_KEY_ID": "operator-login-2026-10",
            "OAUTH_OPERATOR_LOGIN_SIGNING_PRIVATE_KEY_B64": "x",
            "OAUTH_OPERATOR_LOGIN_REDEEM_SECRET_B64": "y",
        }
        self.assertIsNone(
            verify_deployment.resolve_operator_callback_url({}, "default")
        )
        mismatched = dict(complete_env)
        mismatched["OAUTH_OPERATOR_LOGIN_SITE_ID"] = "other"
        self.assertIsNone(
            verify_deployment.resolve_operator_callback_url(mismatched, "default")
        )
        incomplete = dict(complete_env)
        del incomplete["OAUTH_OPERATOR_LOGIN_AUDIENCE"]
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.resolve_operator_callback_url(incomplete, "default")
        self.assertEqual(raised.exception.code, "OPERATOR_LOGIN_CONFIG_INCOMPLETE")
        invalid_url = dict(complete_env)
        invalid_url["OAUTH_OPERATOR_LOGIN_CALLBACK_URL"] = "http://admin.example.test/cb"
        with self.assertRaises(preflight.PreflightError) as raised:
            verify_deployment.resolve_operator_callback_url(invalid_url, "default")
        self.assertEqual(
            raised.exception.code, "OPERATOR_LOGIN_CALLBACK_URL_INVALID"
        )
        self.assertEqual(
            verify_deployment.resolve_operator_callback_url(
                complete_env, "default"
            ),
            "https://admin.example.test/api/admin/auth/callback",
        )

    def test_operator_http_contract_rejects_unbound_start(self) -> None:
        class WeakOperatorHandler(_OperatorBrokerHandler):
            bare_rejects = False

        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        server = ThreadingHTTPServer(("127.0.0.1", 0), WeakOperatorHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            _OperatorBrokerHandler.base_url = (
                f"http://127.0.0.1:{server.server_port}"
            )
            with self.assertRaises(preflight.PreflightError) as raised:
                verify_deployment.verify_http_contract(
                    _OperatorBrokerHandler.base_url,
                    ["github", "google"],
                    catalog,
                    "default",
                    5,
                    allow_http=True,
                    operator_callback_url=(
                        "https://admin.example.test/api/admin/auth/callback"
                    ),
                )
            self.assertEqual(raised.exception.code, "OPERATOR_START_BINDING_FAILED")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_operator_http_contract_passes_with_bound_start(self) -> None:
        catalog = preflight.load_catalog(preflight.DEFAULT_CATALOG)
        server = ThreadingHTTPServer(("127.0.0.1", 0), _OperatorBrokerHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            _OperatorBrokerHandler.base_url = (
                f"http://127.0.0.1:{server.server_port}"
            )
            result = verify_deployment.verify_http_contract(
                _OperatorBrokerHandler.base_url,
                ["github", "google"],
                catalog,
                "default",
                5,
                allow_http=True,
                operator_callback_url=(
                    "https://admin.example.test/api/admin/auth/callback"
                ),
            )
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["startEntry"], "operator-handoff")
            self.assertEqual(
                result["registeredCallbackBase"],
                _OperatorBrokerHandler.base_url,
            )
            self.assertEqual(
                {name: item["entry"] for name, item in result["providers"].items()},
                {"github": "operator-handoff", "google": "operator-handoff"},
            )
            self.assertEqual(
                {name: item["callback"] for name, item in result["providers"].items()},
                {
                    "github": _OperatorBrokerHandler.base_url
                    + "/api/oauth/github/callback",
                    "google": _OperatorBrokerHandler.base_url
                    + "/api/oauth/google/callback",
                },
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_live_provider_does_not_narrow_enabled_provider_checks(self) -> None:
        observed: dict[str, object] = {}

        def verify_http(
            base_url, providers, catalog, site_id, timeout, **kwargs
        ):
            observed["httpProviders"] = providers
            observed["operatorCallback"] = kwargs.get(
                "operator_callback_url"
            )
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
        self.assertIn("operator-handoffs", result["recordClasses"])

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
