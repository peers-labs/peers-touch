#!/usr/bin/env python3
"""Verify an OAuth2 Client deployment without emitting credentials."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import re
import secrets
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import (
    HTTPBasicAuthHandler,
    HTTPPasswordMgrWithDefaultRealm,
    HTTPRedirectHandler,
    Request,
    build_opener,
)

from preflight import (
    DEFAULT_CATALOG,
    PreflightError,
    default_env_file,
    default_repo_root,
    discover_source,
    load_catalog,
    normalize_base_url,
    parse_env_file,
    select_enabled_providers,
)


RunCommand = Callable[..., subprocess.CompletedProcess[str]]
FORBIDDEN_ADMIN_KEYS = frozenset(
    {
        "access_token",
        "refresh_token",
        "client_secret",
        "private_key",
        "private_key_b64",
        "bridge_secret",
        "password",
        "password_hash",
    }
)
RECORD_CLASSES = (
    "transactions",
    "identities",
    "credentials",
    "refresh-operations",
    "audits",
)
REQUIRED_CALLBACK_RECORD_CLASSES = (
    "transactions",
    "identities",
    "credentials",
    "audits",
)
ENVELOPE_FIELDS = frozenset(
    {"version", "key_id", "algorithm", "nonce", "ciphertext", "updated_at"}
)
BRIDGE_TIMESTAMP_WINDOW = timedelta(minutes=5)
BRIDGE_CALLBACK_FIELDS = frozenset(
    {
        "assertion_id",
        "avatar_url",
        "bridge_version",
        "display_name",
        "email",
        "email_verified",
        "provider",
        "provider_user_id",
        "purpose",
        "receiver_challenge",
        "receiver_id",
        "session_id",
        "site_id",
        "sig",
        "ts",
        "union_id",
        "username",
    }
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _request(
    url: str,
    method: str = "GET",
    timeout: float = 10,
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> tuple[int, dict[str, str], bytes]:
    handlers: list[Any] = [NoRedirect()]
    if username is not None and password is not None:
        password_manager = HTTPPasswordMgrWithDefaultRealm()
        password_manager.add_password(None, url, username, password)
        handlers.append(HTTPBasicAuthHandler(password_manager))
    request = Request(url, method=method)
    opener = build_opener(*handlers)
    try:
        response = opener.open(request, timeout=timeout)
        return response.status, dict(response.headers.items()), response.read()
    except HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()
    except URLError as error:
        raise PreflightError(
            "DEPLOYMENT_UNREACHABLE",
            {"reason": error.reason.__class__.__name__},
        ) from error


def _header(headers: dict[str, str], name: str) -> str:
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return ""


def _expect_method_rejection(base_url: str, path: str, timeout: float) -> None:
    status, headers, _ = _request(base_url + path, method="POST", timeout=timeout)
    if status != 405 or _header(headers, "Allow").upper() != "GET":
        raise PreflightError(
            "HTTP_METHOD_CONTRACT_FAILED",
            {"path": path, "status": status},
        )


def verify_http_contract(
    base_url: str,
    providers: list[str],
    catalog: dict[str, Any],
    site_id: str,
    timeout: float,
    allow_http: bool = False,
) -> dict[str, Any]:
    if allow_http:
        parsed_base = urlparse(base_url)
        if parsed_base.scheme not in {"http", "https"} or not parsed_base.netloc:
            raise PreflightError("DEPLOYMENT_URL_INVALID")
        base_url = base_url.rstrip("/")
    else:
        base_url = normalize_base_url(base_url)

    status, headers, body = _request(
        base_url + "/api/healthz",
        timeout=timeout,
    )
    if status in {401, 403} or (
        status in {302, 307, 308}
        and "vercel" in _header(headers, "Location").lower()
    ):
        raise PreflightError(
            "PREVIEW_PROTECTION_BLOCKED",
            {"path": "/api/healthz", "status": status},
        )
    try:
        health = json.loads(body)
    except json.JSONDecodeError as error:
        raise PreflightError(
            "HEALTH_CONTRACT_FAILED",
            {"status": status, "reason": error.__class__.__name__},
        ) from error
    if status != 200 or health != {"status": "ok"}:
        raise PreflightError("HEALTH_CONTRACT_FAILED", {"status": status})

    method_paths = ["/api/healthz", "/api/admin", "/api/admin/data"]
    method_paths.extend(
        path
        for provider in providers
        for path in (
            f"/api/oauth/{provider}/start",
            f"/api/oauth/{provider}/callback",
        )
    )
    for path in method_paths:
        _expect_method_rejection(base_url, path, timeout)

    ambiguous = (
        base_url
        + "/api/oauth/"
        + providers[0]
        + "/callback?"
        + urlencode({"state": "state", "code": "code", "error": "access_denied"})
    )
    status, _, body = _request(ambiguous, timeout=timeout)
    try:
        callback_error = json.loads(body).get("error")
    except json.JSONDecodeError:
        callback_error = None
    if status != 400 or callback_error != "invalid_callback_result":
        raise PreflightError(
            "CALLBACK_CONTRACT_FAILED",
            {"provider": providers[0], "status": status},
        )

    provider_results: dict[str, dict[str, Any]] = {}
    for provider in providers:
        context = catalog["providers"][provider]
        start_url = (
            base_url
            + f"/api/oauth/{provider}/start?"
            + urlencode({"site_id": site_id})
        )
        status, headers, _ = _request(start_url, timeout=timeout)
        location_value = _header(headers, "Location")
        location = urlparse(location_value)
        query = parse_qs(location.query)
        callback = base_url + context["callbackPath"]
        if (
            status not in {302, 303, 307, 308}
            or location.scheme != "https"
            or location.hostname != context["authorizationHost"]
            or query.get("redirect_uri") != [callback]
            or not query.get("state", [""])[0]
        ):
            raise PreflightError(
                "PROVIDER_START_CONTRACT_FAILED",
                {"provider": provider, "status": status},
            )
        if context["capabilities"].get("pkce") == "S256" and (
            query.get("code_challenge_method") != ["S256"]
            or not query.get("code_challenge", [""])[0]
        ):
            raise PreflightError(
                "PROVIDER_PKCE_CONTRACT_FAILED",
                {"provider": provider},
            )
        provider_results[provider] = {
            "authorizationHost": location.hostname,
            "callback": callback,
            "pkce": context["capabilities"].get("pkce"),
            "status": "PASS",
        }
    return {
        "status": "PASS",
        "health": "PASS",
        "methodContract": "GET-only",
        "ambiguousCallbackRejected": True,
        "providers": provider_results,
    }


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in FORBIDDEN_ADMIN_KEYS:
                return True
            if _contains_forbidden_key(child):
                return True
    elif isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


def _load_admin_snapshot(
    base_url: str,
    env: dict[str, str],
    timeout: float,
) -> dict[str, Any]:
    missing = [
        key
        for key in ("OAUTH_ADMIN_USERNAME", "OAUTH_ADMIN_PASSWORD")
        if not env.get(key, "").strip()
    ]
    if missing:
        raise PreflightError(
            "LIVE_ADMIN_CREDENTIALS_REQUIRED",
            {"missingKeys": missing},
        )
    status, _, body = _request(
        base_url + "/api/admin/data",
        timeout=timeout,
        username=env["OAUTH_ADMIN_USERNAME"],
        password=env["OAUTH_ADMIN_PASSWORD"],
    )
    if status != 200:
        raise PreflightError("LIVE_ADMIN_READBACK_FAILED", {"status": status})
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise PreflightError(
            "LIVE_ADMIN_READBACK_INVALID",
            {"reason": error.__class__.__name__},
        ) from error
    if not isinstance(payload, dict) or not isinstance(
        payload.get("identities"), list
    ):
        raise PreflightError(
            "LIVE_ADMIN_READBACK_INVALID",
            {"field": "identities"},
        )
    if _contains_forbidden_key(payload):
        raise PreflightError("LIVE_ADMIN_EXPOSED_SECRET_FIELD")
    return payload


def _identity_totals(
    payload: dict[str, Any],
    providers: list[str],
) -> dict[str, dict[str, int]]:
    totals = {
        provider: {"identityCount": 0, "loginCount": 0}
        for provider in providers
    }
    for index, item in enumerate(payload["identities"]):
        if not isinstance(item, dict):
            raise PreflightError(
                "LIVE_ADMIN_READBACK_INVALID",
                {"field": f"identities[{index}]"},
            )
        provider = item.get("provider")
        login_count = item.get("login_count")
        if (
            not isinstance(provider, str)
            or not provider.strip()
            or not isinstance(login_count, int)
            or isinstance(login_count, bool)
            or login_count < 0
        ):
            raise PreflightError(
                "LIVE_ADMIN_READBACK_INVALID",
                {"field": f"identities[{index}]"},
            )
        if provider in totals:
            totals[provider]["identityCount"] += 1
            totals[provider]["loginCount"] += login_count
    return totals


def capture_live_baseline(
    base_url: str,
    env: dict[str, str],
    providers: list[str],
    timeout: float,
) -> dict[str, Any]:
    payload = _load_admin_snapshot(base_url, env, timeout)
    return {
        "kind": "oauth2-client-live-baseline",
        "baseUrl": base_url,
        "providers": _identity_totals(payload, providers),
    }


def _validate_live_baseline(
    baseline: dict[str, Any],
    providers: list[str],
    base_url: str,
) -> dict[str, dict[str, int]]:
    if (
        set(baseline) != {"kind", "baseUrl", "providers"}
        or baseline.get("kind") != "oauth2-client-live-baseline"
        or baseline.get("baseUrl") != base_url
        or not isinstance(baseline.get("providers"), dict)
    ):
        raise PreflightError("LIVE_PROVIDER_BASELINE_INVALID")
    result: dict[str, dict[str, int]] = {}
    for provider in providers:
        item = baseline["providers"].get(provider)
        if (
            not isinstance(item, dict)
            or set(item) != {"identityCount", "loginCount"}
            or any(
                not isinstance(item[key], int)
                or isinstance(item[key], bool)
                or item[key] < 0
                for key in ("identityCount", "loginCount")
            )
        ):
            raise PreflightError(
                "LIVE_PROVIDER_BASELINE_INVALID",
                {"provider": provider},
            )
        result[provider] = item
    return result


def verify_live_admin(
    base_url: str,
    env: dict[str, str],
    providers: list[str],
    timeout: float,
    baseline: dict[str, Any],
) -> dict[str, Any]:
    payload = _load_admin_snapshot(base_url, env, timeout)
    identities = payload["identities"]
    totals = _identity_totals(payload, providers)
    missing_providers = sorted(
        provider
        for provider, total in totals.items()
        if total["loginCount"] < 1
    )
    if missing_providers:
        raise PreflightError(
            "LIVE_PROVIDER_CALLBACK_UNPROVEN",
            {"providers": missing_providers},
        )
    previous = _validate_live_baseline(baseline, providers, base_url)
    advanced_providers = sorted(
        provider
        for provider in providers
        if totals[provider]["loginCount"] > previous[provider]["loginCount"]
    )
    stale_providers = sorted(set(providers) - set(advanced_providers))
    if stale_providers:
        raise PreflightError(
            "LIVE_PROVIDER_CALLBACK_UNPROVEN",
            {"providers": stale_providers, "reason": "login_count_not_advanced"},
        )
    return {
        "status": "PASS",
        "providers": sorted(providers),
        "identityCount": len(identities),
        "advancedSinceBaseline": advanced_providers,
        "secretFieldsExposed": False,
    }


def _verify_bridge_callback(
    callback_url: str,
    provider: str,
    site_id: str,
    receiver_id: str,
    receiver_challenge: str,
    bridge_secret: str,
    now: datetime,
) -> dict[str, Any]:
    parsed = urlparse(callback_url)
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.path != "/callback"
        or parsed.fragment
    ):
        raise PreflightError("LIVE_CALLBACK_RECEIVER_INVALID")
    raw_query = parse_qs(parsed.query, keep_blank_values=True)
    if any(len(values) != 1 for values in raw_query.values()):
        raise PreflightError("LIVE_CALLBACK_PAYLOAD_INVALID")
    if not set(raw_query).issubset(BRIDGE_CALLBACK_FIELDS):
        raise PreflightError("LIVE_CALLBACK_PAYLOAD_INVALID")
    values = {key: items[0] for key, items in raw_query.items()}
    signature = values.pop("sig", "")
    session_id = values.pop("session_id", "")
    expected = {
        "bridge_version": "v1",
        "provider": provider,
        "site_id": site_id,
        "purpose": "account_login",
        "receiver_id": receiver_id,
        "receiver_challenge": receiver_challenge,
    }
    if session_id != receiver_id or any(
        values.get(key) != value for key, value in expected.items()
    ):
        raise PreflightError("LIVE_CALLBACK_RECEIVER_MISMATCH")
    assertion_id = values.get("assertion_id", "")
    if not re.fullmatch(r"[0-9a-f]{64}", assertion_id):
        raise PreflightError("LIVE_CALLBACK_ASSERTION_INVALID")
    if not values.get("provider_user_id", "").strip():
        raise PreflightError("LIVE_CALLBACK_IDENTITY_INVALID")
    email_verified = values.get("email_verified")
    if email_verified not in {"true", "false"} or (
        email_verified == "true"
    ) != bool(values.get("email", "").strip()):
        raise PreflightError("LIVE_CALLBACK_IDENTITY_INVALID")
    try:
        occurred_at = datetime.fromisoformat(
            values.get("ts", "").replace("Z", "+00:00")
        )
    except ValueError as error:
        raise PreflightError("LIVE_CALLBACK_TIMESTAMP_INVALID") from error
    if occurred_at.tzinfo is None:
        raise PreflightError("LIVE_CALLBACK_TIMESTAMP_INVALID")
    occurred_at = occurred_at.astimezone(timezone.utc)
    if (
        occurred_at < now - BRIDGE_TIMESTAMP_WINDOW
        or occurred_at > now + BRIDGE_TIMESTAMP_WINDOW
    ):
        raise PreflightError("LIVE_CALLBACK_TIMESTAMP_INVALID")
    canonical = urlencode(
        sorted((key, value) for key, value in values.items() if value)
    )
    expected_signature = hmac.new(
        bridge_secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not signature or not hmac.compare_digest(signature, expected_signature):
        raise PreflightError("LIVE_CALLBACK_SIGNATURE_INVALID")
    return {
        "status": "PASS",
        "provider": provider,
        "receiverBinding": "PASS",
        "assertionSignature": "PASS",
        "timestampFresh": True,
    }


def _loopback_template_allowed(env: dict[str, str]) -> bool:
    for raw in env.get("OAUTH_ALLOWED_RETURN_TO", "").split(","):
        parsed = urlparse(raw.strip())
        if (
            parsed.scheme == "http"
            and parsed.hostname == "127.0.0.1"
            and parsed.port is None
            and parsed.path == "/callback"
            and not parsed.query
            and not parsed.fragment
        ):
            return True
    return False


def run_live_provider(
    base_url: str,
    env: dict[str, str],
    provider: str,
    site_id: str,
    timeout: float,
) -> dict[str, Any]:
    bridge_secret = env.get("PEERS_OAUTH_BRIDGE_SECRET", "").strip()
    if not bridge_secret:
        raise PreflightError(
            "LIVE_CALLBACK_BRIDGE_SECRET_REQUIRED",
            {"missingKeys": ["PEERS_OAUTH_BRIDGE_SECRET"]},
        )
    if not _loopback_template_allowed(env):
        raise PreflightError(
            "LIVE_CALLBACK_LOOPBACK_NOT_ALLOWED",
            {"requiredReturnTo": "http://127.0.0.1/callback"},
        )

    stable_base_url = normalize_base_url(base_url)
    baseline = capture_live_baseline(
        stable_base_url,
        env,
        [provider],
        timeout,
    )
    receiver_id = "vercel-verify-" + secrets.token_urlsafe(12)
    receiver_challenge = secrets.token_urlsafe(32)
    completed = threading.Event()
    callback_result: dict[str, Any] = {}
    callback_error: list[PreflightError] = []
    callback_context: dict[str, str] = {}

    class LiveCallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if urlparse(self.path).path != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            try:
                callback_result.update(
                    _verify_bridge_callback(
                        callback_context["origin"] + self.path,
                        provider,
                        site_id,
                        receiver_id,
                        receiver_challenge,
                        bridge_secret,
                        datetime.now(timezone.utc),
                    )
                )
                status = 200
            except PreflightError as error:
                callback_error.append(error)
                status = 400
            except Exception as error:
                callback_error.append(
                    PreflightError(
                        "LIVE_CALLBACK_VERIFICATION_FAILED",
                        {"reason": error.__class__.__name__},
                    )
                )
                status = 500
            body = json.dumps(
                {"status": "ok" if status == 200 else "invalid"}
            ).encode("utf-8")
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            finally:
                completed.set()

        def log_message(self, format: str, *args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), LiveCallbackHandler)
    callback_context["origin"] = f"http://127.0.0.1:{server.server_port}"
    return_to = callback_context["origin"] + "/callback?" + urlencode(
        {
            "session_id": receiver_id,
            "receiver_challenge": receiver_challenge,
            "purpose": "account_login",
        }
    )
    start_url = stable_base_url + f"/api/oauth/{provider}/start?" + urlencode(
        {"site_id": site_id, "return_to": return_to}
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(
        json.dumps(
            {
                "action": "OPEN_PROVIDER_AUTHORIZATION",
                "provider": provider,
                "url": start_url,
            },
            sort_keys=True,
        ),
        file=sys.stderr,
        flush=True,
    )
    try:
        if not completed.wait(timeout):
            raise PreflightError(
                "LIVE_PROVIDER_CALLBACK_TIMEOUT",
                {"provider": provider, "timeoutSeconds": timeout},
            )
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
    if callback_error:
        raise callback_error[0]

    admin = verify_live_admin(
        stable_base_url,
        env,
        [provider],
        timeout,
        baseline,
    )
    return {
        "status": "PASS",
        "provider": provider,
        "callback": callback_result,
        "admin": admin,
    }


def _run_gh(
    command: list[str],
    runner: RunCommand,
    timeout: float,
) -> str:
    try:
        result = runner(
            command,
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise PreflightError(
            "GITHUB_PERSISTENCE_READ_TIMEOUT",
            {"timeoutSeconds": timeout},
        ) from error
    if result.returncode != 0:
        raise PreflightError(
            "GITHUB_PERSISTENCE_READ_FAILED",
            {"operation": command[2] if len(command) > 2 else "api"},
        )
    return result.stdout


def _verify_record_authenticity(
    repo_root: Path,
    env: dict[str, str],
    records: list[dict[str, str]],
    runner: RunCommand,
    go_bin: str,
    timeout: float,
) -> dict[str, Any]:
    verification_timeout = max(timeout, 120)
    resolved = shutil.which(go_bin)
    if resolved is None and runner is subprocess.run:
        raise PreflightError("GO_TOOLCHAIN_UNAVAILABLE", {"binary": go_bin})
    keys = {
        key.removeprefix("OAUTH_CREDENTIAL_KEY_").lower(): value
        for key, value in env.items()
        if key.startswith("OAUTH_CREDENTIAL_KEY_") and value.strip()
    }
    request = {
        "active_key_id": env["OAUTH_CREDENTIAL_ACTIVE_KEY_ID"],
        "keys": keys,
        "records": records,
    }
    try:
        result = runner(
            [
                resolved or go_bin,
                "run",
                "./cmd/verify-record-envelopes",
            ],
            input=json.dumps(request),
            text=True,
            cwd=repo_root / "apps" / "oauth2-client",
            capture_output=True,
            check=False,
            timeout=verification_timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise PreflightError(
            "GITHUB_ENVELOPE_AUTHENTICATION_TIMEOUT",
            {"timeoutSeconds": verification_timeout},
        ) from error
    if result.returncode != 0:
        raise PreflightError(
            "GITHUB_ENVELOPE_AUTHENTICATION_FAILED",
            {"exitCode": result.returncode},
        )
    try:
        verified = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise PreflightError(
            "GITHUB_ENVELOPE_AUTHENTICATION_FAILED",
            {"reason": error.__class__.__name__},
        ) from error
    if (
        not isinstance(verified, dict)
        or verified.get("status") != "PASS"
        or verified.get("record_count") != len(records)
        or not isinstance(verified.get("active_key_envelope_count"), int)
        or not isinstance(verified.get("retained_key_envelope_count"), int)
        or verified["active_key_envelope_count"]
        + verified["retained_key_envelope_count"]
        != len(records)
    ):
        raise PreflightError("GITHUB_ENVELOPE_AUTHENTICATION_FAILED")
    return verified


def verify_github_repository_private(
    env: dict[str, str],
    runner: RunCommand = subprocess.run,
    gh_bin: str = "gh",
    timeout: float = 30,
) -> dict[str, Any]:
    required = ("OAUTH_GITHUB_STORAGE_OWNER", "OAUTH_GITHUB_STORAGE_REPO")
    missing = [key for key in required if not env.get(key, "").strip()]
    if missing:
        raise PreflightError(
            "GITHUB_PERSISTENCE_ENV_REQUIRED",
            {"missingKeys": missing},
        )
    resolved = shutil.which(gh_bin)
    if resolved is None and runner is subprocess.run:
        raise PreflightError("GITHUB_CLI_UNAVAILABLE", {"binary": gh_bin})
    executable = resolved or gh_bin
    owner = quote(env["OAUTH_GITHUB_STORAGE_OWNER"], safe="")
    repository = quote(env["OAUTH_GITHUB_STORAGE_REPO"], safe="")
    private = _run_gh(
        [
            executable,
            "api",
            f"repos/{owner}/{repository}",
            "--jq",
            ".private",
        ],
        runner,
        timeout,
    ).strip()
    if private != "true":
        raise PreflightError("GITHUB_STORAGE_REPOSITORY_NOT_PRIVATE")
    return {"status": "PASS", "private": True}


def verify_github_envelopes(
    env: dict[str, str],
    runner: RunCommand = subprocess.run,
    gh_bin: str = "gh",
    go_bin: str = "go",
    repo_root: Optional[Path] = None,
    timeout: float = 30,
) -> dict[str, Any]:
    required = (
        "OAUTH_GITHUB_STORAGE_OWNER",
        "OAUTH_GITHUB_STORAGE_REPO",
        "OAUTH_GITHUB_STORAGE_BRANCH",
        "OAUTH_CREDENTIAL_ACTIVE_KEY_ID",
    )
    missing = [key for key in required if not env.get(key, "").strip()]
    if missing:
        raise PreflightError(
            "GITHUB_PERSISTENCE_ENV_REQUIRED",
            {"missingKeys": missing},
        )
    repository_privacy = verify_github_repository_private(
        env,
        runner=runner,
        gh_bin=gh_bin,
        timeout=timeout,
    )
    resolved = shutil.which(gh_bin)
    if resolved is None and runner is subprocess.run:
        raise PreflightError("GITHUB_CLI_UNAVAILABLE", {"binary": gh_bin})
    executable = resolved or gh_bin
    owner = quote(env["OAUTH_GITHUB_STORAGE_OWNER"], safe="")
    repository = quote(env["OAUTH_GITHUB_STORAGE_REPO"], safe="")
    branch = quote(env["OAUTH_GITHUB_STORAGE_BRANCH"], safe="")
    commit = _run_gh(
        [
            executable,
            "api",
            f"repos/{owner}/{repository}/commits/{branch}",
            "--jq",
            ".sha",
        ],
        runner,
        timeout,
    ).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise PreflightError("GITHUB_PERSISTENCE_COMMIT_INVALID")
    tree_payload = _run_gh(
        [
            executable,
            "api",
            f"repos/{owner}/{repository}/git/trees/{commit}?recursive=1",
        ],
        runner,
        timeout,
    )
    try:
        tree = json.loads(tree_payload)
    except json.JSONDecodeError as error:
        raise PreflightError(
            "GITHUB_PERSISTENCE_TREE_INVALID",
            {"reason": error.__class__.__name__},
        ) from error
    if not isinstance(tree, dict) or not isinstance(tree.get("tree"), list):
        raise PreflightError("GITHUB_PERSISTENCE_TREE_INVALID")
    if tree.get("truncated") is not False:
        raise PreflightError("GITHUB_PERSISTENCE_TREE_TRUNCATED")
    paths = sorted(
        {
            item["path"]
            for item in tree["tree"]
            if isinstance(item, dict)
            and item.get("type") == "blob"
            and isinstance(item.get("path"), str)
            and item["path"].startswith("oauth-data/")
            and item["path"].endswith(".json")
        }
    )
    if len(paths) > 2000:
        raise PreflightError(
            "GITHUB_PERSISTENCE_SCAN_LIMIT_EXCEEDED",
            {"recordCount": len(paths), "limit": 2000},
        )
    missing_classes = [
        record_class
        for record_class in REQUIRED_CALLBACK_RECORD_CLASSES
        if not any(
            path.startswith(f"oauth-data/{record_class}/") for path in paths
        )
    ]
    if missing_classes:
        raise PreflightError(
            "GITHUB_PERSISTENCE_CLASS_MISSING",
            {"recordClasses": missing_classes},
        )
    observed_classes = sorted(
        record_class
        for record_class in RECORD_CLASSES
        if any(
            path.startswith(f"oauth-data/{record_class}/") for path in paths
        )
    )

    secret_values = [
        value.encode("utf-8")
        for key, value in env.items()
        if value
        and len(value) >= 8
        and (
            key.endswith("_SECRET")
            or "_PRIVATE_KEY" in key
            or key.startswith("OAUTH_CREDENTIAL_KEY_")
            or key.endswith("_HMAC_KEY")
            or key in {"OAUTH_ADMIN_PASSWORD", "OAUTH_ADMIN_PASSWORD_HASH"}
        )
    ]
    active_key = env["OAUTH_CREDENTIAL_ACTIVE_KEY_ID"].strip().lower()
    configured_key_ids = {
        key.removeprefix("OAUTH_CREDENTIAL_KEY_").lower()
        for key, value in env.items()
        if key.startswith("OAUTH_CREDENTIAL_KEY_") and value.strip()
    }
    records: list[dict[str, str]] = []
    active_envelopes = 0
    for record_path in paths:
        encoded = _run_gh(
            [
                executable,
                "api",
                (
                    f"repos/{owner}/{repository}/contents/"
                    f"{quote(record_path, safe='/')}?ref={commit}"
                ),
                "--jq",
                ".content",
            ],
            runner,
            timeout,
        )
        try:
            payload = base64.b64decode("".join(encoded.split()), validate=True)
            envelope = json.loads(payload)
        except (ValueError, json.JSONDecodeError) as error:
            raise PreflightError(
                "GITHUB_ENVELOPE_INVALID",
                {"path": record_path, "reason": error.__class__.__name__},
            ) from error
        if (
            not isinstance(envelope, dict)
            or set(envelope) != ENVELOPE_FIELDS
            or envelope.get("version") != 1
            or envelope.get("key_id") not in configured_key_ids
            or envelope.get("algorithm") != "AES-256-GCM"
            or not isinstance(envelope.get("nonce"), str)
            or not isinstance(envelope.get("ciphertext"), str)
        ):
            raise PreflightError(
                "GITHUB_ENVELOPE_INVALID",
                {"path": record_path},
            )
        if any(secret in payload for secret in secret_values):
            raise PreflightError(
                "GITHUB_ENVELOPE_PLAINTEXT_SECRET",
                {"path": record_path},
            )
        records.append(
            {
                "path": record_path,
                "payload": base64.b64encode(payload).decode("ascii"),
            }
        )
        if envelope["key_id"] == active_key:
            active_envelopes += 1
    if active_envelopes == 0:
        raise PreflightError(
            "GITHUB_ACTIVE_KEY_ENVELOPE_MISSING",
            {"activeKeyId": active_key},
        )
    authenticated = _verify_record_authenticity(
        (repo_root or default_repo_root()).resolve(),
        env,
        records,
        runner,
        go_bin,
        timeout,
    )
    return {
        "status": "PASS",
        "recordClasses": observed_classes,
        "requiredRecordClasses": list(REQUIRED_CALLBACK_RECORD_CLASSES),
        "repositoryCommit": commit,
        "repositoryPrivate": repository_privacy["private"],
        "envelopeCount": authenticated["record_count"],
        "activeKeyEnvelopeCount": authenticated["active_key_envelope_count"],
        "retainedKeyEnvelopeCount": authenticated[
            "retained_key_envelope_count"
        ],
        "authenticated": True,
        "allKeyIdsConfigured": True,
        "plaintextSecrets": False,
    }


class _SelfTestHandler(BaseHTTPRequestHandler):
    catalog: dict[str, Any]
    base_url: str

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/healthz":
            self._json(200, {"status": "ok"})
            return
        if parsed.path.endswith("/callback"):
            self._json(400, {"error": "invalid_callback_result"})
            return
        if parsed.path.endswith("/start"):
            provider = parsed.path.split("/")[3]
            context = self.catalog["providers"][provider]
            query = {
                "redirect_uri": self.base_url + context["callbackPath"],
                "state": "opaque-state",
            }
            if context["capabilities"].get("pkce") == "S256":
                query["code_challenge_method"] = "S256"
                query["code_challenge"] = "fixture-challenge"
            self.send_response(302)
            self.send_header(
                "Location",
                f"https://{context['authorizationHost']}/authorize?"
                + urlencode(query),
            )
            self.end_headers()
            return
        self.send_response(401)
        self.end_headers()

    def do_POST(self) -> None:
        self.send_response(405)
        self.send_header("Allow", "GET")
        self.end_headers()

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        return


def self_test(catalog: dict[str, Any]) -> dict[str, Any]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SelfTestHandler)
    base_url = f"http://127.0.0.1:{server.server_port}"
    _SelfTestHandler.catalog = catalog
    _SelfTestHandler.base_url = base_url
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        result = verify_http_contract(
            base_url,
            ["github", "google", "weixin"],
            catalog,
            "default",
            2,
            allow_http=True,
        )
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
    return {"status": "PASS", "mode": "self-test", "http": result}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--repo-root", type=Path, default=default_repo_root())
    result.add_argument("--env-file", type=Path)
    result.add_argument("--base-url")
    result.add_argument("--provider", action="append", default=[])
    result.add_argument("--site-id", default="default")
    result.add_argument("--run-live-provider")
    result.add_argument("--verify-github-storage", action="store_true")
    result.add_argument("--gh-bin", default="gh")
    result.add_argument("--go-bin", default="go")
    result.add_argument("--timeout", type=float, default=10)
    result.add_argument("--self-test", action="store_true")
    return result


def main(argv: Optional[list[str]] = None) -> int:
    args = parser().parse_args(argv)
    try:
        catalog = load_catalog(DEFAULT_CATALOG)
        if args.self_test:
            report = self_test(catalog)
        else:
            if not args.base_url:
                raise PreflightError("DEPLOYMENT_URL_REQUIRED")
            repo_root = args.repo_root.resolve()
            source = discover_source(repo_root, catalog)
            if not source["catalogMatches"]:
                raise PreflightError(
                    "PROVIDER_CATALOG_DRIFT",
                    source["catalogDelta"],
                )
            providers = select_enabled_providers(
                source,
                catalog,
                list(args.provider),
            )
            if args.run_live_provider:
                context = catalog["providers"].get(args.run_live_provider, {})
                if context.get("status") != "active":
                    raise PreflightError(
                        "PROVIDER_NOT_ONBOARDED",
                        {"providers": [args.run_live_provider]},
                    )
                evidence = source["evidence"].get(args.run_live_provider, {})
                if not evidence.get("enabledInConfig"):
                    raise PreflightError(
                        "PROVIDER_NOT_ENABLED",
                        {
                            "providers": [args.run_live_provider],
                            "config": "apps/oauth2-client/config/sites.json",
                        },
                    )
            report = {
                "status": "PASS",
                "http": verify_http_contract(
                    args.base_url,
                    providers,
                    catalog,
                    args.site_id,
                    args.timeout,
                ),
            }
            if args.run_live_provider or args.verify_github_storage:
                env_file = args.env_file or default_env_file(repo_root)
                env = parse_env_file(env_file)
                if args.run_live_provider:
                    report["githubRepository"] = (
                        verify_github_repository_private(
                            env,
                            gh_bin=args.gh_bin,
                            timeout=args.timeout,
                        )
                    )
                    report["liveCallback"] = run_live_provider(
                        normalize_base_url(args.base_url),
                        env,
                        args.run_live_provider,
                        args.site_id,
                        args.timeout,
                    )
                if args.verify_github_storage:
                    report["githubPersistence"] = verify_github_envelopes(
                        env,
                        gh_bin=args.gh_bin,
                        go_bin=args.go_bin,
                        repo_root=repo_root,
                        timeout=args.timeout,
                    )
    except PreflightError as error:
        report = {
            "status": "BLOCKED",
            "code": error.code,
            "detail": error.detail,
        }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
