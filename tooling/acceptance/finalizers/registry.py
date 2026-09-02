"""Immutable resolver for protected post-cleanup evidence finalizers."""

from __future__ import annotations

import ast
import hashlib
import importlib.machinery
import json
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from tooling.acceptance.core.finalization_contracts import (
    FINALIZER_INPUT_BYTE_LIMIT_MAX,
    FINALIZER_TIMEOUT_SECONDS_MAX,
    FinalizerExecutionConfig,
    FinalizerProtectedBaseline,
    FinalizerRegistryEntry,
    FinalizerRequirement,
    RequiredFinalizerMapping,
    domain_separated_sha256,
    validate_finalizer_id,
    validate_repo_relative_path,
    validate_sha256,
)


_REGISTRY_KEYS = frozenset({"entries"})
_ENTRY_KEYS = frozenset(
    {
        "finalizerId",
        "entrypoint",
        "sourcePaths",
        "sourceDigest",
        "contractRoleProjectionDigest",
        "evidenceRoleNames",
    }
)
_REGISTRY_DECLARATION_KEYS = frozenset(
    {
        "path",
        "protectedBaseline",
        "protectedBaselineDigest",
        "protectedBaselineFileSha256",
    }
)
_EXECUTION_CONFIG_KEYS = frozenset(
    {"id", "timeoutSeconds", "inputByteLimit"}
)
_BASELINE_KEYS = frozenset(
    {
        "gateId",
        "finalizerId",
        "requirementMappingDigest",
        "registryFilePath",
        "registryFileDigest",
        "contractSchemaPath",
        "contractSchemaDigest",
        "entrypointSourcePath",
        "entrypointSourceDigest",
        "generatorSourcePath",
        "generatorSourceDigest",
    }
)
_ENTRYPOINT_PATTERN = re.compile(
    r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*"
)
_DUNDER_NAME_PATTERN = re.compile(r"__[A-Za-z0-9_]+__")
_I_JSON_INTEGER_MIN = -9007199254740991
_I_JSON_INTEGER_MAX = 9007199254740991
_DYNAMIC_LOADING_MODULE_ROOTS = frozenset(
    {
        "builtins",
        "importlib",
        "operator",
        "pkgutil",
        "runpy",
        "sys",
        "zipimport",
    }
)
_DYNAMIC_LOADING_SYMBOLS = frozenset(
    {
        "SourceFileLoader",
        "__builtins__",
        "__dict__",
        "__getattribute__",
        "__globals__",
        "__import__",
        "attrgetter",
        "compile",
        "eval",
        "exec",
        "exec_module",
        "getattr",
        "globals",
        "import_module",
        "itemgetter",
        "load_module",
        "locals",
        "modules",
        "module_from_spec",
        "spec_from_file_location",
        "vars",
    }
)
_ALLOWED_FINALIZER_STDLIB_ROOTS = frozenset(
    {
        "base64",
        "binascii",
        "collections",
        "dataclasses",
        "datetime",
        "decimal",
        "enum",
        "functools",
        "hashlib",
        "hmac",
        "io",
        "itertools",
        "json",
        "math",
        "re",
        "secrets",
        "string",
        "time",
        "typing",
        "uuid",
    }
)


@dataclass(frozen=True)
class FinalizerRegistry:
    path: str
    entries: Mapping[str, FinalizerRegistryEntry]
    file_sha256: str

    def require(self, finalizer_id: str) -> FinalizerRegistryEntry:
        try:
            return self.entries[finalizer_id]
        except KeyError as error:
            raise ValueError(
                f"unknown finalizer registration: {finalizer_id}"
            ) from error


@dataclass(frozen=True)
class FinalizerBinding:
    mapping: RequiredFinalizerMapping
    requirement: FinalizerRequirement
    config: FinalizerExecutionConfig
    registry_entry: FinalizerRegistryEntry
    protected_baseline: FinalizerProtectedBaseline

    def plan_config(self) -> dict[str, Any]:
        return {
            "id": self.config.finalizer_id,
            "timeoutSeconds": self.config.timeout_seconds,
            "inputByteLimit": self.config.input_byte_limit,
        }


def _closed_mapping(
    value: object,
    expected_keys: frozenset[str],
    label: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    actual_keys = frozenset(value)
    if actual_keys != expected_keys:
        missing = sorted(expected_keys - actual_keys)
        unknown = sorted(actual_keys - expected_keys)
        raise ValueError(
            f"{label} has invalid fields; missing={missing}, unknown={unknown}"
        )
    return value


def _parse_strict_json_value(
    raw: bytes,
    *,
    label: str,
    source: str,
) -> object:
    def reject_duplicate_keys(
        pairs: list[tuple[str, object]],
    ) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError(f"{label} contains duplicate key: {key}")
            result[key] = item
        return result

    def parse_lossless_float(token: str) -> float:
        value = float(token)
        if not math.isfinite(value):
            raise ValueError(f"{label} contains invalid number: {token}")
        round_trip = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
        )
        if Decimal(round_trip) != Decimal(token):
            raise ValueError(f"{label} contains lossy number: {token}")
        return value

    def parse_safe_integer(token: str) -> int:
        value = int(token)
        if not _I_JSON_INTEGER_MIN <= value <= _I_JSON_INTEGER_MAX:
            raise ValueError(
                f"{label} contains integer outside the I-JSON safe range: "
                f"{token}"
            )
        return value

    def validate_unicode_scalars(item: object) -> None:
        if isinstance(item, str):
            try:
                item.encode("utf-8")
            except UnicodeEncodeError as error:
                raise ValueError(
                    f"{label} contains a non-scalar Unicode string"
                ) from error
            return
        if isinstance(item, list):
            for child in item:
                validate_unicode_scalars(child)
            return
        if isinstance(item, dict):
            for key, child in item.items():
                validate_unicode_scalars(key)
                validate_unicode_scalars(child)

    try:
        value = json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=reject_duplicate_keys,
            parse_int=parse_safe_integer,
            parse_float=parse_lossless_float,
            parse_constant=lambda token: (_ for _ in ()).throw(
                ValueError(f"{label} contains invalid number: {token}")
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid UTF-8 JSON: {source}") from error
    validate_unicode_scalars(value)
    return value


def loads_strict_json_value(content: str, label: str) -> object:
    """Decode an authority-bearing JSON value without lossy coercion."""
    try:
        raw = content.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ValueError(f"{label} is not valid UTF-8 JSON") from error
    return _parse_strict_json_value(raw, label=label, source=label)


def _load_json_object(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ValueError(f"{label} cannot be read: {path}") from error

    value = _parse_strict_json_value(
        raw,
        label=label,
        source=str(path),
    )
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain an object: {path}")
    return value, raw


def load_strict_json_object(path: Path, label: str) -> dict[str, Any]:
    """Load an authority-bearing JSON object without lossy parser behavior."""
    value, _ = _load_json_object(path, label)
    return value


def _raw_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _repo_file(repo_root: Path, relative_path: str) -> Path:
    canonical_path = validate_repo_relative_path(relative_path)
    resolved_root = repo_root.resolve()
    unresolved = resolved_root / canonical_path
    relative_parts = Path(canonical_path).parts
    current = resolved_root
    for part in relative_parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(
                f"repository-relative path contains a symlink: {canonical_path}"
            )
    candidate = unresolved.resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(
            f"repository-relative path escapes repository: {canonical_path}"
        ) from error
    return candidate


def _validate_sorted_unique_strings(
    value: object,
    label: str,
    *,
    allow_empty: bool = False,
    paths: bool = False,
) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or any(not isinstance(item, str) or not item for item in value)
    ):
        qualifier = "possibly empty " if allow_empty else "non-empty "
        raise ValueError(f"{label} must be a {qualifier}list of strings")
    items = tuple(value)
    if len(set(items)) != len(items):
        raise ValueError(f"{label} contains duplicates")
    if items != tuple(sorted(items)):
        raise ValueError(f"{label} must be UTF-8 lexically sorted")
    if paths:
        items = tuple(validate_repo_relative_path(item) for item in items)
    return items


def _source_digest(repo_root: Path, source_paths: tuple[str, ...]) -> str:
    inventory: list[list[str]] = []
    for source_path in source_paths:
        path = _repo_file(repo_root, source_path)
        try:
            file_sha256 = _raw_sha256(path.read_bytes())
        except OSError as error:
            raise ValueError(
                f"finalizer source path cannot be read: {source_path}"
            ) from error
        inventory.append([source_path, file_sha256])
    return domain_separated_sha256(
        "pt.acceptance.finalization.source.v1",
        inventory,
    )


def _existing_local_module_paths(
    repo_root: Path,
    module_parts: tuple[str, ...],
) -> set[str]:
    paths: set[str] = set()
    for depth in range(1, len(module_parts) + 1):
        prefix = "/".join(module_parts[:depth])
        for suffix in importlib.machinery.SOURCE_SUFFIXES:
            module_path = f"{prefix}{suffix}"
            package_path = f"{prefix}/__init__{suffix}"
            if _repo_file(repo_root, module_path).is_file():
                paths.add(module_path)
            if _repo_file(repo_root, package_path).is_file():
                paths.add(package_path)
        forbidden_paths = [
            candidate
            for suffix in (
                *importlib.machinery.BYTECODE_SUFFIXES,
                *importlib.machinery.EXTENSION_SUFFIXES,
            )
            for candidate in (
                f"{prefix}{suffix}",
                f"{prefix}/__init__{suffix}",
            )
            if _repo_file(repo_root, candidate).is_file()
        ]
        cache_dir = _repo_file(
            repo_root,
            f"{'/'.join(module_parts[: depth - 1]) + '/' if depth > 1 else ''}"
            "__pycache__",
        )
        module_name = module_parts[depth - 1]
        if cache_dir.is_dir():
            forbidden_paths.extend(
                str(path.relative_to(repo_root))
                for path in cache_dir.glob(f"{module_name}.*.pyc")
            )
        if forbidden_paths:
            raise ValueError(
                "repository import resolves to forbidden native or bytecode "
                f"source: {sorted(forbidden_paths)}"
            )
    return paths


def _validate_source_import_closure(
    repo_root: Path,
    source_paths: tuple[str, ...],
    *,
    finalizer_id: str,
) -> None:
    declared_paths = set(source_paths)
    required_paths: set[str] = set()
    for source_path in source_paths:
        if not source_path.endswith(".py"):
            continue
        path = _repo_file(repo_root, source_path)
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=source_path)
        except (OSError, UnicodeError, SyntaxError) as error:
            raise ValueError(
                f"{finalizer_id}: finalizer source cannot be parsed: "
                f"{source_path}"
            ) from error

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if (
                        alias.name.split(".", 1)[0]
                        in _DYNAMIC_LOADING_MODULE_ROOTS
                    ):
                        raise ValueError(
                            f"{finalizer_id}: dynamic source loading is "
                            f"forbidden: {source_path}"
                        )
            elif (
                isinstance(node, ast.ImportFrom)
                and node.module
                and node.module.split(".", 1)[0]
                in _DYNAMIC_LOADING_MODULE_ROOTS
            ):
                raise ValueError(
                    f"{finalizer_id}: dynamic source loading is forbidden: "
                    f"{source_path}"
                )
            elif (
                isinstance(node, ast.Name)
                and (
                    node.id in _DYNAMIC_LOADING_SYMBOLS
                    or _DUNDER_NAME_PATTERN.fullmatch(node.id)
                )
            ) or (
                isinstance(node, ast.Attribute)
                and (
                    node.attr in _DYNAMIC_LOADING_SYMBOLS
                    or _DUNDER_NAME_PATTERN.fullmatch(node.attr)
                )
            ) or (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and (
                    node.value in _DYNAMIC_LOADING_SYMBOLS
                    or _DUNDER_NAME_PATTERN.fullmatch(node.value)
                )
            ):
                raise ValueError(
                    f"{finalizer_id}: dynamic source loading is forbidden: "
                    f"{source_path}"
                )
            elif (
                isinstance(node, ast.Call)
                and not isinstance(node.func, (ast.Name, ast.Attribute))
            ):
                raise ValueError(
                    f"{finalizer_id}: unresolved call target is forbidden: "
                    f"{source_path}"
                )

        source_parts = Path(source_path).with_suffix("").parts
        package_parts = source_parts[:-1]
        for node in ast.walk(tree):
            module_candidates: list[tuple[str, ...]] = []
            if isinstance(node, ast.Import):
                module_candidates.extend(
                    tuple(alias.name.split(".")) for alias in node.names
                )
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    parent_depth = node.level - 1
                    if parent_depth > len(package_parts):
                        raise ValueError(
                            f"{finalizer_id}: relative import escapes source "
                            f"package: {source_path}"
                        )
                    base_parts = package_parts[: len(package_parts) - parent_depth]
                else:
                    base_parts = ()
                if node.module:
                    base_parts = (*base_parts, *node.module.split("."))
                    module_candidates.append(base_parts)
                for alias in node.names:
                    if alias.name != "*":
                        module_candidates.append(
                            (*base_parts, *alias.name.split("."))
                        )

            for module_parts in module_candidates:
                local_paths = _existing_local_module_paths(
                    repo_root,
                    module_parts,
                )
                if (
                    not local_paths
                    and module_parts
                    and module_parts[0] not in _ALLOWED_FINALIZER_STDLIB_ROOTS
                ):
                    raise ValueError(
                        f"{finalizer_id}: unsupported import is forbidden: "
                        f"{'.'.join(module_parts)}"
                    )
                required_paths.update(local_paths)

    missing_paths = sorted(required_paths - declared_paths)
    if missing_paths:
        raise ValueError(
            f"{finalizer_id}: imported repository source is absent from "
            f"sourcePaths: {missing_paths}"
        )


def _parse_registry_entry(
    repo_root: Path,
    value: object,
    index: int,
) -> FinalizerRegistryEntry:
    entry = _closed_mapping(value, _ENTRY_KEYS, f"entries[{index}]")
    finalizer_id = validate_finalizer_id(entry["finalizerId"])
    entrypoint = entry["entrypoint"]
    if not isinstance(entrypoint, str) or not _ENTRYPOINT_PATTERN.fullmatch(
        entrypoint
    ):
        raise ValueError(
            f"entries[{index}].entrypoint must be a fixed Python module"
        )
    source_paths = _validate_sorted_unique_strings(
        entry["sourcePaths"],
        f"entries[{index}].sourcePaths",
        paths=True,
    )
    evidence_role_names = _validate_sorted_unique_strings(
        entry["evidenceRoleNames"],
        f"entries[{index}].evidenceRoleNames",
        allow_empty=True,
    )
    _validate_source_import_closure(
        repo_root,
        source_paths,
        finalizer_id=finalizer_id,
    )
    source_digest = validate_sha256(entry["sourceDigest"])
    actual_source_digest = _source_digest(repo_root, source_paths)
    if source_digest != actual_source_digest:
        raise ValueError(
            f"{finalizer_id}: sourceDigest does not match current source bytes"
        )
    projection_digest = validate_sha256(
        entry["contractRoleProjectionDigest"]
    )
    actual_projection_digest = domain_separated_sha256(
        "pt.acceptance.finalization.role-projection.v1",
        {
            "finalizerId": finalizer_id,
            "evidenceRoleNames": list(evidence_role_names),
        },
    )
    if projection_digest != actual_projection_digest:
        raise ValueError(
            f"{finalizer_id}: contractRoleProjectionDigest mismatch"
        )
    return FinalizerRegistryEntry(
        finalizer_id=finalizer_id,
        entrypoint=entrypoint,
        source_paths=source_paths,
        source_digest=source_digest,
        contract_role_projection_digest=projection_digest,
        evidence_role_names=evidence_role_names,
    )


def load_finalizer_registry(
    repo_root: Path,
    registry_path: str,
) -> FinalizerRegistry:
    canonical_path = validate_repo_relative_path(registry_path)
    document, raw = _load_json_object(
        _repo_file(repo_root, canonical_path),
        "finalizer registry",
    )
    registry = _closed_mapping(
        document,
        _REGISTRY_KEYS,
        "finalizer registry",
    )
    entries_value = registry["entries"]
    if not isinstance(entries_value, list) or not entries_value:
        raise ValueError("finalizer registry entries must be a non-empty list")
    entries: dict[str, FinalizerRegistryEntry] = {}
    for index, value in enumerate(entries_value):
        entry = _parse_registry_entry(repo_root, value, index)
        if entry.finalizer_id in entries:
            raise ValueError(
                f"duplicate finalizer registration: {entry.finalizer_id}"
            )
        entries[entry.finalizer_id] = entry
    return FinalizerRegistry(
        path=canonical_path,
        entries=MappingProxyType(entries),
        file_sha256=_raw_sha256(raw),
    )


def _repo_root(acceptance_root: Path) -> Path:
    resolved = acceptance_root.resolve()
    if resolved.name == "acceptance" and resolved.parent.name == "tooling":
        return resolved.parents[1]
    return resolved


def _load_capability_declaration(
    acceptance_root: Path,
) -> tuple[dict[str, Any] | None, dict[str, str]]:
    registry_declaration: dict[str, Any] | None = None
    requirements: dict[str, str] = {}
    capability_dir = acceptance_root / "capabilities"
    if not capability_dir.exists():
        return None, requirements
    for path in sorted(capability_dir.glob("*.yaml")):
        document, _ = _load_json_object(path, "capability root")
        if "finalizerRegistry" in document:
            if registry_declaration is not None:
                raise ValueError(
                    "finalizerRegistry must have exactly one capability owner"
                )
            registry_declaration = _closed_mapping(
                document["finalizerRegistry"],
                _REGISTRY_DECLARATION_KEYS,
                f"{path}: finalizerRegistry",
            )
        mapping = document.get("requiredEvidenceFinalizers", {})
        if not isinstance(mapping, dict):
            raise ValueError(
                f"{path}: requiredEvidenceFinalizers must be an object"
            )
        for gate_id, finalizer_id_value in mapping.items():
            if (
                not isinstance(gate_id, str)
                or not gate_id
                or gate_id in requirements
            ):
                raise ValueError(
                    f"{path}: duplicate or invalid required finalizer Gate ID"
                )
            requirements[gate_id] = validate_finalizer_id(
                finalizer_id_value
            )
    if bool(registry_declaration) != bool(requirements):
        raise ValueError(
            "finalizerRegistry and requiredEvidenceFinalizers must be "
            "declared together"
        )
    return registry_declaration, requirements


def _parse_execution_config(
    gate_id: str,
    value: object,
) -> FinalizerExecutionConfig:
    config = _closed_mapping(
        value,
        _EXECUTION_CONFIG_KEYS,
        f"{gate_id}: evidenceFinalizer",
    )
    finalizer_id = validate_finalizer_id(config["id"])
    timeout_seconds = config["timeoutSeconds"]
    input_byte_limit = config["inputByteLimit"]
    if (
        isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, int)
        or not 1 <= timeout_seconds <= FINALIZER_TIMEOUT_SECONDS_MAX
    ):
        raise ValueError(
            f"{gate_id}: timeoutSeconds must be an integer from 1 to "
            f"{FINALIZER_TIMEOUT_SECONDS_MAX}"
        )
    if (
        isinstance(input_byte_limit, bool)
        or not isinstance(input_byte_limit, int)
        or not 1 <= input_byte_limit <= FINALIZER_INPUT_BYTE_LIMIT_MAX
    ):
        raise ValueError(
            f"{gate_id}: inputByteLimit must be an integer from 1 to "
            f"{FINALIZER_INPUT_BYTE_LIMIT_MAX}"
        )
    return FinalizerExecutionConfig(
        gate_id=gate_id,
        finalizer_id=finalizer_id,
        timeout_seconds=timeout_seconds,
        input_byte_limit=input_byte_limit,
    )


def _load_protected_baseline(
    repo_root: Path,
    declaration: dict[str, Any],
    gate_id: str,
    finalizer_id: str,
    registry: FinalizerRegistry,
) -> FinalizerProtectedBaseline:
    registry_path = validate_repo_relative_path(declaration["path"])
    baseline_path = validate_repo_relative_path(
        declaration["protectedBaseline"]
    )
    declared_digest = validate_sha256(
        declaration["protectedBaselineDigest"]
    )
    declared_file_sha256 = validate_sha256(
        declaration["protectedBaselineFileSha256"]
    )
    baseline_document, baseline_raw = _load_json_object(
        _repo_file(repo_root, baseline_path),
        "protected finalizer baseline",
    )
    baseline = _closed_mapping(
        baseline_document,
        _BASELINE_KEYS,
        "protected finalizer baseline",
    )
    if _raw_sha256(baseline_raw) != declared_file_sha256:
        raise ValueError("protectedBaselineFileSha256 mismatch")
    protected_baseline = FinalizerProtectedBaseline.from_dict(baseline)
    if protected_baseline.digest() != declared_digest:
        raise ValueError("protectedBaselineDigest mismatch")

    if (
        protected_baseline.gate_id != gate_id
        or protected_baseline.finalizer_id != finalizer_id
    ):
        raise ValueError(f"{gate_id}: protected baseline identity mismatch")
    if protected_baseline.registry_file_path != registry_path:
        raise ValueError(f"{gate_id}: protected registry path mismatch")
    if protected_baseline.registry_file_digest != registry.file_sha256:
        raise ValueError(f"{gate_id}: protected registry digest mismatch")
    expected_mapping_digest = domain_separated_sha256(
        "pt.acceptance.finalization.requirement-mapping.v1",
        {
            "gateId": gate_id,
            "finalizerId": finalizer_id,
            "finalizerRegistryPath": registry_path,
            "protectedBaselinePath": baseline_path,
        },
    )
    if (
        protected_baseline.requirement_mapping_digest
        != expected_mapping_digest
    ):
        raise ValueError(f"{gate_id}: requirement mapping digest mismatch")
    protected_components = (
        (
            protected_baseline.contract_schema_path,
            protected_baseline.contract_schema_digest,
        ),
        (
            protected_baseline.entrypoint_source_path,
            protected_baseline.entrypoint_source_digest,
        ),
        (
            protected_baseline.generator_source_path,
            protected_baseline.generator_source_digest,
        ),
    )
    entry = registry.require(finalizer_id)
    unsupported_source_paths = sorted(
        path
        for path in entry.source_paths
        if not path.endswith(".py")
        and path != protected_baseline.contract_schema_path
    )
    if unsupported_source_paths:
        raise ValueError(
            f"{gate_id}: sourcePaths contain unsupported non-Python files: "
            f"{unsupported_source_paths}"
        )
    expected_entrypoint_path = f"{entry.entrypoint.replace('.', '/')}.py"
    if protected_baseline.entrypoint_source_path != expected_entrypoint_path:
        raise ValueError(
            f"{gate_id}: finalizer entrypoint/source path mismatch"
        )
    package_entrypoint_path = (
        f"{entry.entrypoint.replace('.', '/')}/__init__.py"
    )
    if _repo_file(repo_root, package_entrypoint_path).exists():
        raise ValueError(
            f"{gate_id}: finalizer entrypoint is shadowed by a package"
        )
    entrypoint_parts = entry.entrypoint.split(".")
    for depth in range(1, len(entrypoint_parts)):
        package_initializer_path = (
            "/".join(entrypoint_parts[:depth]) + "/__init__.py"
        )
        if (
            _repo_file(repo_root, package_initializer_path).exists()
            and package_initializer_path not in entry.source_paths
        ):
            raise ValueError(
                f"{gate_id}: finalizer package initializer is absent from "
                f"sourcePaths: {package_initializer_path}"
            )
    for component_path, component_digest in protected_components:
        if component_path not in entry.source_paths:
            raise ValueError(
                f"{gate_id}: protected component is absent from sourcePaths: "
                f"{component_path}"
            )
        path = _repo_file(repo_root, component_path)
        try:
            actual_digest = _raw_sha256(path.read_bytes())
        except OSError as error:
            raise ValueError(
                f"{gate_id}: protected component cannot be read: "
                f"{component_path}"
            ) from error
        if actual_digest != component_digest:
            raise ValueError(
                f"{gate_id}: protected component digest mismatch: "
                f"{component_path}"
            )
    return protected_baseline


def load_finalizer_bindings(
    acceptance_root: Path,
    gate_defs: Mapping[str, Any],
) -> Mapping[str, FinalizerBinding]:
    declaration, requirements = _load_capability_declaration(acceptance_root)
    configured_gate_ids = {
        gate_id
        for gate_id, gate in gate_defs.items()
        if isinstance(gate, dict) and "evidenceFinalizer" in gate
    }
    if not requirements:
        if configured_gate_ids:
            raise ValueError(
                "Gate Catalog evidenceFinalizer config has no protected "
                "requiredEvidenceFinalizers mapping"
            )
        return MappingProxyType({})
    assert declaration is not None

    repo_root = _repo_root(acceptance_root)
    registry_path = validate_repo_relative_path(declaration["path"])
    registry = load_finalizer_registry(repo_root, registry_path)
    if configured_gate_ids != set(requirements):
        missing = sorted(set(requirements) - configured_gate_ids)
        unexpected = sorted(configured_gate_ids - set(requirements))
        raise ValueError(
            "required finalizer mapping and Gate Catalog config differ; "
            f"missing={missing}, unexpected={unexpected}"
        )

    bindings: dict[str, FinalizerBinding] = {}
    for gate_id, finalizer_id in sorted(requirements.items()):
        gate = gate_defs.get(gate_id)
        if not isinstance(gate, dict):
            raise ValueError(
                f"required finalizer Gate is missing from Catalog: {gate_id}"
            )
        config = _parse_execution_config(
            gate_id,
            gate["evidenceFinalizer"],
        )
        if config.finalizer_id != finalizer_id:
            raise ValueError(f"{gate_id}: finalizer mapping/config mismatch")
        entry = registry.require(finalizer_id)
        baseline = _load_protected_baseline(
            repo_root,
            declaration,
            gate_id,
            finalizer_id,
            registry,
        )
        mapping = RequiredFinalizerMapping(
            gate_id=gate_id,
            finalizer_id=finalizer_id,
        )
        requirement = FinalizerRequirement(
            gate_id=gate_id,
            finalizer_id=finalizer_id,
            finalizer_registry_path=registry_path,
            protected_baseline_path=validate_repo_relative_path(
                declaration["protectedBaseline"]
            ),
            protected_baseline_digest=validate_sha256(
                declaration["protectedBaselineDigest"]
            ),
            protected_baseline_file_sha256=validate_sha256(
                declaration["protectedBaselineFileSha256"]
            ),
        )
        if (
            requirement.requirement_mapping_digest()
            != baseline.requirement_mapping_digest
        ):
            raise ValueError(
                f"{gate_id}: requirement mapping digest mismatch"
            )
        bindings[gate_id] = FinalizerBinding(
            mapping=mapping,
            requirement=requirement,
            config=config,
            registry_entry=entry,
            protected_baseline=baseline,
        )
    return MappingProxyType(bindings)
