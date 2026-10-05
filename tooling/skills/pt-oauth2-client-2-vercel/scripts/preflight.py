#!/usr/bin/env python3
"""Discover and validate the OAuth2 Client Vercel deployment context."""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_CATALOG = SKILL_DIR / "references" / "provider-catalog.json"

GLOBAL_ENV_FIELDS = (
    ("OAUTH_GITHUB_STORAGE_OWNER", "config"),
    ("OAUTH_GITHUB_STORAGE_REPO", "config"),
    ("OAUTH_GITHUB_STORAGE_BRANCH", "config"),
    ("OAUTH_GITHUB_APP_ID", "config"),
    ("OAUTH_GITHUB_APP_INSTALLATION_ID", "config"),
    ("OAUTH_GITHUB_APP_PRIVATE_KEY_B64", "secret"),
    ("OAUTH_CREDENTIAL_ACTIVE_KEY_ID", "config"),
    ("OAUTH_STORAGE_INDEX_HMAC_KEY", "secret"),
    ("OAUTH_AUDIT_HMAC_KEY", "secret"),
    ("OAUTH_ADMIN_USERNAME", "config"),
    ("OAUTH_ADMIN_PASSWORD_HASH", "secret"),
    ("PEERS_OAUTH_BRIDGE_SECRET", "secret"),
)

OPTIONAL_GLOBAL_ENV_FIELDS = (
    ("OAUTH_SITE_ID", "config"),
    ("OAUTH_GITHUB_API_BASE_URL", "config"),
)

FORBIDDEN_SYNC_KEYS = frozenset({"ADDR", "OAUTH_ADMIN_PASSWORD", "VERCEL"})


class PreflightError(RuntimeError):
    """A redacted, machine-readable preflight failure."""

    def __init__(self, code: str, detail: Optional[dict[str, Any]] = None):
        super().__init__(code)
        self.code = code
        self.detail = detail or {}


def default_repo_root() -> Path:
    return SCRIPT_DIR.parents[3]


def default_env_file(repo_root: Path) -> Path:
    return repo_root.parent / "env" / "peers-touch-infra" / "oauth2-client-test" / "runtime.env"


def parse_env_file(path: Path) -> dict[str, str]:
    try:
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            raise PreflightError(
                "ENV_FILE_PERMISSIONS_TOO_OPEN",
                {"mode": oct(mode), "required": "0o600"},
            )
        lines = path.read_text(encoding="utf-8").splitlines()
    except PreflightError:
        raise
    except OSError as error:
        raise PreflightError(
            "ENV_FILE_UNAVAILABLE",
            {"path": str(path), "reason": error.__class__.__name__},
        ) from error

    values: dict[str, str] = {}
    invalid_lines: list[int] = []
    duplicate_keys: list[str] = []
    pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
    for line_number, original in enumerate(lines, start=1):
        line = original.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        match = pattern.match(line)
        if match is None:
            invalid_lines.append(line_number)
            continue
        key, value = match.groups()
        if key in values:
            duplicate_keys.append(key)
        value = value.strip()
        quote = None
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            quote = value[0]
            value = value[1:-1]
        if quote != "'":
            value = value.replace(r"\$", "$")
        values[key] = value
    if invalid_lines:
        raise PreflightError(
            "ENV_FILE_INVALID",
            {"path": str(path), "lineNumbers": invalid_lines},
        )
    if duplicate_keys:
        raise PreflightError(
            "ENV_FILE_DUPLICATE_KEYS",
            {"keys": sorted(set(duplicate_keys))},
        )
    return values


def valid_admin_password_hash(value: str) -> bool:
    parts = value.strip().split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2-sha256":
        return False
    try:
        iterations = int(parts[1])
        salt = base64.b64decode(parts[2], validate=True)
        digest = base64.b64decode(parts[3], validate=True)
    except (ValueError, base64.binascii.Error):
        return False
    return 100_000 <= iterations <= 10_000_000 and len(salt) >= 16 and len(digest) == 32


def load_catalog(path: Path) -> dict[str, Any]:
    try:
        catalog = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PreflightError(
            "PROVIDER_CATALOG_INVALID",
            {"path": str(path), "reason": error.__class__.__name__},
        ) from error
    if (
        not isinstance(catalog, dict)
        or catalog.get("schemaVersion") != 1
        or not isinstance(catalog.get("providers"), dict)
    ):
        raise PreflightError("PROVIDER_CATALOG_INVALID", {"path": str(path)})
    for name, context in catalog["providers"].items():
        if not isinstance(context, dict):
            raise PreflightError(
                "PROVIDER_CATALOG_INVALID",
                {"path": str(path), "provider": name},
            )
        fields = context.get("credentialFields")
        if (
            not re.fullmatch(r"[a-z0-9_-]+", name)
            or context.get("status") not in {"active", "future-onboarding"}
            or not re.fullmatch(r"OAUTH_[A-Z0-9_]+", context.get("envPrefix", ""))
            or context.get("callbackPath") != f"/api/oauth/{name}/callback"
            or not context.get("authorizationHost")
            or context.get("credentialModel")
            not in {"client_secret", "app_secret", "private_key_jwt"}
            or not isinstance(fields, list)
            or not fields
            or not isinstance(context.get("optionalFields"), list)
            or not isinstance(context.get("capabilities"), dict)
            or not isinstance(context.get("verificationRules"), list)
            or not context["verificationRules"]
            or not isinstance(context.get("officialDocs"), list)
            or not context["officialDocs"]
            or any(
                not isinstance(url, str) or not url.startswith("https://")
                for url in context["officialDocs"]
            )
        ):
            raise PreflightError(
                "PROVIDER_CATALOG_INVALID",
                {"path": str(path), "provider": name},
            )
        for field in fields + context["optionalFields"]:
            if (
                not isinstance(field, dict)
                or not re.fullmatch(r"[A-Z0-9_]+", field.get("suffix", ""))
                or field.get("visibility") not in {"config", "secret"}
            ):
                raise PreflightError(
                    "PROVIDER_CATALOG_INVALID",
                    {"path": str(path), "provider": name},
                )
    return catalog


def _provider_constants(provider_source: str) -> tuple[set[str], dict[str, str]]:
    constants = {
        name: value
        for name, value in re.findall(
            r'\b(Provider[A-Za-z0-9]+)\s+Provider\s*=\s*"([a-z0-9_-]+)"',
            provider_source,
        )
    }
    return set(constants.values()), constants


def _config_providers(config_dir: Path) -> tuple[set[str], dict[str, bool]]:
    providers: set[str] = set()
    enabled: dict[str, bool] = {}
    for path in sorted(config_dir.glob("sites*.json")):
        is_runtime_config = path.name == "sites.json"
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise PreflightError(
                "OAUTH_CONFIG_INVALID",
                {"path": str(path), "reason": error.__class__.__name__},
            ) from error
        sites = payload.get("sites", []) if isinstance(payload, dict) else payload
        if not isinstance(sites, list):
            raise PreflightError("OAUTH_CONFIG_INVALID", {"path": str(path)})
        for site in sites:
            configured = site.get("providers", {}) if isinstance(site, dict) else {}
            if not isinstance(configured, dict):
                raise PreflightError("OAUTH_CONFIG_INVALID", {"path": str(path)})
            for name, options in configured.items():
                normalized = str(name).strip().lower()
                providers.add(normalized)
                if is_runtime_config:
                    is_enabled = not (
                        isinstance(options, dict)
                        and options.get("enabled") is False
                    )
                    enabled[normalized] = (
                        enabled.get(normalized, False) or is_enabled
                    )
    return providers, enabled


def _provider_capabilities(
    provider_source: str, provider_test_source: str
) -> dict[str, Any]:
    pkce = (
        "S256"
        if "PKCEChallenge(" in provider_source
        and 'q.Set("code_challenge_method", "S256")' in provider_source
        and "code_challenge" in provider_test_source
        else "provider-native-no-pkce"
    )
    capabilities: dict[str, Any] = {
        "authorizationCode": (
            "ExchangeCode(" in provider_source
            and "Exchange" in provider_test_source
        ),
        "pkce": pkce,
        "refreshToken": (
            "RefreshToken(" in provider_source
            and "TestRefresh" in provider_test_source
        ),
    }
    if "verifiedEmail(" in provider_source:
        capabilities["verifiedEmailLookup"] = (
            "Verified" in provider_test_source
        )
    if "openidconnect.googleapis.com" in provider_source:
        capabilities["oidcUserInfo"] = "email_verified" in provider_test_source
    if "UnionID" in provider_source:
        capabilities["unionId"] = "unionid" in provider_test_source
    return capabilities


def discover_source(repo_root: Path, catalog: dict[str, Any]) -> dict[str, Any]:
    app_root = repo_root / "apps" / "oauth2-client"
    required_paths = {
        "providerSource": app_root / "internal/domain/oauth/valueobject/provider.go",
        "bootstrap": app_root / "internal/bootstrap/config.go",
        "providerAdapters": app_root / "internal/infrastructure/provider",
        "routes": app_root / "api/oauth",
        "config": app_root / "config",
        "vercelConfig": app_root / "vercel.json",
    }
    missing_paths = [
        name for name, path in required_paths.items() if not path.exists()
    ]
    if missing_paths:
        raise PreflightError("SOURCE_CONTEXT_INCOMPLETE", {"missing": missing_paths})

    provider_source = required_paths["providerSource"].read_text(encoding="utf-8")
    bootstrap_source = required_paths["bootstrap"].read_text(encoding="utf-8")
    constants, constant_names = _provider_constants(provider_source)
    adapters = {
        path.name
        for path in required_paths["providerAdapters"].iterdir()
        if path.is_dir() and path.name != "common" and (path / "provider.go").is_file()
    }
    routes: dict[str, list[str]] = {}
    for provider_dir in required_paths["routes"].iterdir():
        if not provider_dir.is_dir():
            continue
        routes[provider_dir.name] = sorted(
            child.name
            for child in provider_dir.iterdir()
            if child.is_dir() and (child / "index.go").is_file()
        )
    config_providers, enabled = _config_providers(required_paths["config"])
    env_prefixes: dict[str, str] = {}
    for constant_name, prefix in re.findall(
        r'loadProviderFromEnv\(valueobject\.(Provider[A-Za-z0-9]+),\s*"([A-Z0-9_]+)"\)',
        bootstrap_source,
    ):
        provider = constant_names.get(constant_name)
        if provider:
            env_prefixes[provider] = prefix
    tested = {
        provider
        for provider in adapters
        if (
            required_paths["providerAdapters"] / provider / "provider_test.go"
        ).is_file()
    }
    capabilities: dict[str, dict[str, Any]] = {}
    for provider in sorted(adapters):
        provider_path = required_paths["providerAdapters"] / provider
        implementation = (provider_path / "provider.go").read_text(encoding="utf-8")
        test_path = provider_path / "provider_test.go"
        test_source = (
            test_path.read_text(encoding="utf-8") if test_path.is_file() else ""
        )
        capabilities[provider] = _provider_capabilities(
            implementation,
            test_source,
        )

    discovered = constants | adapters | set(routes) | config_providers | set(env_prefixes)
    catalog_providers = catalog["providers"]
    active_catalog = {
        name
        for name, context in catalog_providers.items()
        if context.get("status") == "active"
    }
    incomplete: dict[str, list[str]] = {}
    for provider in sorted(discovered | active_catalog):
        missing: list[str] = []
        if provider not in constants:
            missing.append("provider.go")
        if provider not in adapters:
            missing.append("provider adapter")
        if set(routes.get(provider, [])) != {"callback", "start"}:
            missing.append("start/callback routes")
        if provider not in config_providers:
            missing.append("config/sites*.json")
        if provider not in env_prefixes:
            missing.append("bootstrap env prefix")
        if provider not in tested:
            missing.append("provider tests")
        if missing:
            incomplete[provider] = missing

    prefix_mismatches = {
        provider: {
            "source": env_prefixes.get(provider),
            "catalog": catalog_providers.get(provider, {}).get("envPrefix"),
        }
        for provider in sorted(active_catalog & set(env_prefixes))
        if env_prefixes[provider]
        != catalog_providers.get(provider, {}).get("envPrefix")
    }
    capability_mismatches = {
        provider: {
            "source": capabilities.get(provider, {}),
            "catalog": catalog_providers.get(provider, {}).get("capabilities", {}),
        }
        for provider in sorted(active_catalog)
        if capabilities.get(provider)
        != catalog_providers.get(provider, {}).get("capabilities", {})
    }
    delta = {
        "unknownProviders": sorted(discovered - active_catalog),
        "catalogProvidersMissingFromSource": sorted(active_catalog - discovered),
        "incompleteProviders": incomplete,
        "envPrefixMismatches": prefix_mismatches,
        "capabilityMismatches": capability_mismatches,
    }
    return {
        "providers": sorted(discovered),
        "enabledProviders": sorted(
            provider
            for provider in active_catalog
            if enabled.get(provider, False)
        ),
        "evidence": {
            provider: {
                "providerConstant": provider in constants,
                "adapter": provider in adapters,
                "routes": routes.get(provider, []),
                "config": provider in config_providers,
                "enabledInConfig": enabled.get(provider, False),
                "envPrefix": env_prefixes.get(provider),
                "tests": provider in tested,
                "capabilities": capabilities.get(provider, {}),
            }
            for provider in sorted(discovered)
        },
        "catalogDelta": delta,
        "catalogMatches": not any(
            (
                delta["unknownProviders"],
                delta["catalogProvidersMissingFromSource"],
                delta["incompleteProviders"],
                delta["envPrefixMismatches"],
                delta["capabilityMismatches"],
            )
        ),
    }


def normalize_base_url(raw: str) -> str:
    parsed = urlparse(raw.strip())
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise PreflightError("STABLE_HTTPS_BASE_URL_REQUIRED")
    return urlunparse(("https", parsed.netloc, "", "", "", "")).rstrip("/")


def select_enabled_providers(
    source: dict[str, Any],
    catalog: dict[str, Any],
    requested_providers: list[str],
) -> list[str]:
    active = {
        name
        for name, context in catalog["providers"].items()
        if context.get("status") == "active"
    }
    providers = sorted(set(requested_providers or source["enabledProviders"]))
    unsupported = sorted(set(providers) - active)
    if unsupported:
        raise PreflightError(
            "PROVIDER_NOT_ONBOARDED",
            {"providers": unsupported},
        )
    if not providers:
        raise PreflightError("NO_DEPLOYMENT_PROVIDER_SELECTED")
    disabled = sorted(
        provider
        for provider in providers
        if not source["evidence"][provider]["enabledInConfig"]
    )
    if disabled:
        raise PreflightError(
            "PROVIDER_NOT_ENABLED",
            {"providers": disabled, "config": "apps/oauth2-client/config/sites.json"},
        )
    omitted = sorted(set(source["enabledProviders"]) - set(providers))
    if omitted:
        raise PreflightError(
            "PROVIDER_SELECTION_INCOMPLETE",
            {
                "providers": omitted,
                "config": "apps/oauth2-client/config/sites.json",
            },
        )
    return providers


def normalize_return_to(values: list[str], env: dict[str, str]) -> list[str]:
    candidates = values
    if not candidates:
        candidates = env.get("OAUTH_ALLOWED_RETURN_TO", "").split(",")
    normalized: list[str] = []
    for raw in candidates:
        parsed = urlparse(raw.strip())
        if (
            not parsed.scheme
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise PreflightError("RETURN_TO_INVALID")
        value = urlunparse(
            (parsed.scheme, parsed.netloc, parsed.path, parsed.params, "", "")
        )
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        raise PreflightError("RETURN_TO_REQUIRED")
    return normalized


def validate_vercel_config(
    app_root: Path, providers: list[str], catalog: dict[str, Any]
) -> list[str]:
    path = app_root / "vercel.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ["vercel.json is unavailable or invalid JSON"]
    errors: list[str] = []
    if config.get("$schema") != "https://openapi.vercel.sh/vercel.json":
        errors.append("vercel.json schema is missing")
    functions = config.get("functions")
    if functions not in (None, {}):
        errors.append(
            "Go Functions must use Vercel auto-discovery instead of functions globs"
        )
    entrypoints = sorted(app_root.glob("api/**/index.go"))
    if not entrypoints:
        errors.append("no api/**/index.go Go Function entrypoints found")
    for entrypoint in entrypoints:
        content = entrypoint.read_text(encoding="utf-8")
        relative = entrypoint.relative_to(app_root).as_posix()
        if "package handler" not in content or "func Handler(" not in content:
            errors.append(f"{relative} is not a Vercel Go Function entrypoint")
    embedded_config = app_root / "config/sites.go"
    try:
        embedded_source = embedded_config.read_text(encoding="utf-8")
    except OSError:
        embedded_source = ""
    if "//go:embed sites.json" not in embedded_source:
        errors.append("config/sites.json is not embedded in Go Functions")
    configured_routes = {
        item.get("src")
        for item in config.get("routes", [])
        if isinstance(item, dict) and item.get("src") == item.get("dest")
    }
    required_routes = {"/api/healthz", "/api/admin", "/api/admin/data"}
    for provider in providers:
        callback = catalog["providers"][provider]["callbackPath"]
        required_routes.add(callback)
        required_routes.add(callback.removesuffix("/callback") + "/start")
    missing_routes = sorted(required_routes - configured_routes)
    if missing_routes:
        errors.append("vercel.json routes missing: " + ", ".join(missing_routes))
    return errors


def _required_environment(
    providers: list[str], catalog: dict[str, Any], env: dict[str, str]
) -> list[tuple[str, str]]:
    required = list(GLOBAL_ENV_FIELDS)
    active_key = env.get("OAUTH_CREDENTIAL_ACTIVE_KEY_ID", "").strip()
    if active_key:
        normalized_key = re.sub(r"[^A-Za-z0-9]", "_", active_key).upper()
        required.append((f"OAUTH_CREDENTIAL_KEY_{normalized_key}", "secret"))
    for provider in providers:
        context = catalog["providers"][provider]
        prefix = context["envPrefix"]
        for field in context["credentialFields"]:
            if field.get("required") is True:
                required.append(
                    (f"{prefix}_{field['suffix']}", field["visibility"])
                )
    return required


def build_preflight(
    repo_root: Path,
    env_file: Path,
    catalog_path: Path,
    base_url: str,
    return_to: list[str],
    requested_providers: list[str],
) -> tuple[dict[str, Any], dict[str, tuple[str, str]]]:
    repo_root = repo_root.resolve()
    env_file = env_file.expanduser().resolve()
    try:
        env_file.relative_to(repo_root)
    except ValueError:
        pass
    else:
        raise PreflightError("ENV_FILE_MUST_BE_OUTSIDE_SOURCE_REPOSITORY")

    catalog = load_catalog(catalog_path)
    source = discover_source(repo_root, catalog)
    if not source["catalogMatches"]:
        raise PreflightError("PROVIDER_CATALOG_DRIFT", source["catalogDelta"])

    providers = select_enabled_providers(
        source,
        catalog,
        requested_providers,
    )

    env = parse_env_file(env_file)
    stable_base_url = normalize_base_url(base_url)
    allowed_return_to = normalize_return_to(return_to, env)
    config_errors = validate_vercel_config(
        repo_root / "apps" / "oauth2-client", providers, catalog
    )

    required = _required_environment(providers, catalog, env)
    missing = sorted(name for name, _ in required if not env.get(name, "").strip())
    invalid = []
    admin_password_hash = env.get("OAUTH_ADMIN_PASSWORD_HASH", "")
    if admin_password_hash and not valid_admin_password_hash(admin_password_hash):
        invalid.append("OAUTH_ADMIN_PASSWORD_HASH")
    env_delta = [
        {
            "name": name,
            "visibility": visibility,
            "reason": "required for selected production deployment",
        }
        for name, visibility in required
        if name in missing
    ]
    env_delta.extend(
        {
            "name": name,
            "visibility": "secret",
            "reason": "value does not satisfy the runtime format contract",
        }
        for name in invalid
    )
    overrides = {
        "OAUTH_STORAGE_DRIVER": "github",
        "OAUTH_BASE_URL": stable_base_url,
        "OAUTH_ALLOWED_RETURN_TO": ",".join(allowed_return_to),
    }
    for provider in providers:
        context = catalog["providers"][provider]
        overrides[f"{context['envPrefix']}_REDIRECT_URI"] = (
            stable_base_url + context["callbackPath"]
        )

    sync_values: dict[str, tuple[str, str]] = {}
    for name, visibility in required:
        if env.get(name, "").strip():
            sync_values[name] = (env[name], visibility)
    for name, visibility in OPTIONAL_GLOBAL_ENV_FIELDS:
        if env.get(name, "").strip():
            sync_values[name] = (env[name], visibility)
    for name, value in env.items():
        if name.startswith("OAUTH_CREDENTIAL_KEY_") and value.strip():
            sync_values[name] = (value, "secret")
    for provider in providers:
        context = catalog["providers"][provider]
        prefix = context["envPrefix"]
        for field in context.get("optionalFields", []):
            name = f"{prefix}_{field['suffix']}"
            if env.get(name, "").strip():
                sync_values[name] = (env[name], field["visibility"])
    for name, value in overrides.items():
        sync_values[name] = (value, "config")
    for key in FORBIDDEN_SYNC_KEYS:
        sync_values.pop(key, None)

    status = "PASS" if not missing and not invalid and not config_errors else "BLOCKED"
    report = {
        "status": status,
        "code": None if status == "PASS" else "PREFLIGHT_FAILED",
        "source": source,
        "deployment": {
            "rootDirectory": "apps/oauth2-client",
            "stableBaseUrl": stable_base_url,
            "providers": providers,
            "callbacks": {
                provider: overrides[
                    f"{catalog['providers'][provider]['envPrefix']}_REDIRECT_URI"
                ]
                for provider in providers
            },
            "returnTo": allowed_return_to,
            "storageDriver": "github",
            "memoryStoreAllowed": False,
        },
        "environment": {
            "source": f"<external-env>/{env_file.name}",
            "presentKeys": sorted(sync_values),
            "missingKeys": missing,
            "invalidKeys": invalid,
            "delta": env_delta,
            "forbiddenSyncKeys": sorted(FORBIDDEN_SYNC_KEYS),
        },
        "vercelConfig": {
            "status": "PASS" if not config_errors else "BLOCKED",
            "errors": config_errors,
        },
    }
    return report, sync_values


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--repo-root", type=Path, default=default_repo_root())
    result.add_argument("--env-file", type=Path)
    result.add_argument("--base-url", required=True)
    result.add_argument("--return-to", action="append", default=[])
    result.add_argument("--provider", action="append", default=[])
    return result


def main(argv: Optional[list[str]] = None) -> int:
    args = parser().parse_args(argv)
    env_file = args.env_file or default_env_file(args.repo_root.resolve())
    try:
        report, _ = build_preflight(
            args.repo_root,
            env_file,
            DEFAULT_CATALOG,
            args.base_url,
            args.return_to,
            args.provider,
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
