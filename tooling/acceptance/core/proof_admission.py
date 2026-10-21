"""Source-bound proof admission primitives.

The coordinator persistence contracts live in finalization_contracts; this
module owns source inventory, forbidden-process scanning and restricted claim
evaluation.
"""

from __future__ import annotations

import ast
import builtins
import hashlib
import os
from pathlib import Path
from typing import Iterable

from . import finalization_contracts as contracts


class ProofAdmissionRejected(ValueError):
    pass


def _file_identity(repo_root: Path, relative: str) -> tuple[str, bytes]:
    normalized = contracts.validate_repo_relative_path(relative)
    root = Path(repo_root).resolve(strict=True)
    path = (root / normalized).resolve(strict=True)
    if path.is_symlink() or root not in path.parents:
        raise ProofAdmissionRejected("proof source escaped the repository")
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), data


def _python_import_targets(
    source_path: str,
    source: bytes,
    known_paths: frozenset[str],
) -> tuple[contracts.ProofAdmissionSourceEdge, ...]:
    try:
        tree = ast.parse(source, filename=source_path, feature_version=(3, 12))
    except (SyntaxError, ValueError) as error:
        raise ProofAdmissionRejected(
            f"Python proof source is not valid PYTHON_AST_V1: {source_path}"
        ) from error
    targets: set[str] = set()
    for node in ast.walk(tree):
        modules: tuple[str, ...] = ()
        if isinstance(node, ast.Import):
            modules = tuple(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            modules = (node.module,)
        for module in modules:
            candidate = module.replace(".", "/") + ".py"
            package = module.replace(".", "/") + "/__init__.py"
            if candidate in known_paths:
                targets.add(candidate)
            elif package in known_paths:
                targets.add(package)
    return tuple(
        contracts.ProofAdmissionSourceEdge.create(
            edge_kind=contracts.ProofAdmissionEdgeKind.IMPORT,
            target_path=target,
            assigned_grammar_id=contracts.ProofAdmissionGrammarId.PYTHON_AST_V1,
            assigned_interpreter=contracts.ProofAdmissionInterpreter.PYTHON3,
        )
        for target in sorted(targets, key=lambda item: item.encode("utf-8"))
    )


def build_source_inventory(
    repo_root: Path,
    paths: Iterable[str],
) -> tuple[contracts.ProofAdmissionSourceNode, ...]:
    normalized = tuple(
        sorted(
            {contracts.validate_repo_relative_path(path) for path in paths},
            key=lambda item: item.encode("utf-8"),
        )
    )
    if not normalized:
        raise ProofAdmissionRejected("proof source inventory is empty")
    known = frozenset(normalized)
    identities = {
        path: _file_identity(repo_root, path) for path in normalized
    }
    nodes = []
    for path in normalized:
        digest, data = identities[path]
        classification, grammar, interpreter = (
            contracts.classify_proof_admission_source(
                path,
                executable=os.access(Path(repo_root) / path, os.X_OK),
            )
        )
        edges = (
            _python_import_targets(path, data, known)
            if grammar is contracts.ProofAdmissionGrammarId.PYTHON_AST_V1
            else ()
        )
        nodes.append(
            contracts.ProofAdmissionSourceNode.create(
                repo_relative_path=path,
                raw_file_sha256=digest,
                byte_length=len(data),
                classification=classification,
                grammar_id=grammar,
                interpreter_assignment=interpreter,
                forward_edges=edges,
            )
        )
    result = tuple(nodes)
    contracts.proof_admission_source_digest(result)
    return result


def _attribute_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _attribute_name(node.value)
        return None if parent is None else f"{parent}.{node.attr}"
    return None


def _forbidden_symbols(tree: ast.AST) -> tuple[str, ...]:
    aliases: dict[str, str] = {}
    findings: set[str] = set()
    registry = contracts.canonical_forbidden_process_api_registry()
    forbidden = {
        symbol
        for rule in registry
        for symbol in rule.canonical_symbols
        if not symbol.startswith("any ")
    }
    forbidden_roots = {
        symbol for symbol in forbidden if "." not in symbol and " " not in symbol
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                bound = alias.asname or alias.name.split(".", 1)[0]
                aliases[bound] = alias.name
                if alias.name in forbidden_roots:
                    findings.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module in forbidden_roots:
                findings.add(module)
            for alias in node.names:
                bound = alias.asname or alias.name
                aliases[bound] = f"{module}.{alias.name}".strip(".")
        elif isinstance(node, ast.Call):
            name = _attribute_name(node.func)
            if name is None:
                continue
            root, separator, suffix = name.partition(".")
            resolved = aliases.get(root, root)
            canonical = (
                f"{resolved}.{suffix}" if separator and suffix else resolved
            )
            if canonical in forbidden:
                findings.add(canonical)
            if canonical in {"subprocess.Popen", "subprocess.run", "subprocess.call"}:
                findings.add("subprocess")
            if canonical.startswith("subprocess."):
                for keyword in node.keywords:
                    if (
                        keyword.arg == "shell"
                        and isinstance(keyword.value, ast.Constant)
                        and keyword.value.value is True
                    ):
                        findings.add("subprocess shell=True")
    return tuple(sorted(findings, key=lambda item: item.encode("utf-8")))


def scan_forbidden_process_apis(
    *,
    repo_root: Path,
    nodes: tuple[contracts.ProofAdmissionSourceNode, ...],
    scanner_interpreter: contracts.PythonScannerInterpreterIdentity,
) -> contracts.ForbiddenProcessApiScan:
    source_digest = contracts.proof_admission_source_digest(nodes)
    inspected = []
    violations = []
    for node in nodes:
        if node.grammar_id is not contracts.ProofAdmissionGrammarId.PYTHON_AST_V1:
            continue
        digest, source = _file_identity(repo_root, node.repo_relative_path)
        if digest != node.raw_file_sha256:
            raise ProofAdmissionRejected("proof source changed during scan")
        try:
            tree = ast.parse(
                source,
                filename=node.repo_relative_path,
                feature_version=(3, 12),
            )
        except (SyntaxError, ValueError) as error:
            raise ProofAdmissionRejected("proof source cannot be parsed") from error
        inspected.append((node.repo_relative_path, node.source_node_digest))
        violations.extend(
            f"{node.repo_relative_path}:{symbol}"
            for symbol in _forbidden_symbols(tree)
        )
    if violations:
        raise ProofAdmissionRejected(
            "forbidden process API: " + ", ".join(violations)
        )
    scanner_paths = (
        "tooling/acceptance/core/finalization_contracts.py",
        "tooling/acceptance/core/proof_admission.py",
    )
    scanner_sources = tuple(
        (
            path,
            _file_identity(repo_root, path)[0],
            len(_file_identity(repo_root, path)[1]),
        )
        for path in scanner_paths
    )
    return contracts.ForbiddenProcessApiScan.create(
        scanner_source_files=scanner_sources,
        scanner_interpreter=scanner_interpreter,
        proof_admission_source_digest=source_digest,
        inspected_nodes=tuple(
            sorted(inspected, key=lambda item: item[0].encode("utf-8"))
        ),
        rule_registry=contracts.canonical_forbidden_process_api_registry(),
    )


def run_restricted_claim(
    source: bytes,
    *,
    resolution: contracts.AuthoritativeLatestResolution,
) -> contracts.ClaimEmitterOutput:
    """Evaluate a tiny expression-only claim program with no import capability."""
    try:
        tree = ast.parse(source, filename="<claim>", mode="exec")
    except SyntaxError as error:
        raise ProofAdmissionRejected("claim source is invalid") from error
    allowed = set(contracts.CLAIM_EMITTER_AST_ALLOWLIST_V1)
    for node in ast.walk(tree):
        if type(node).__name__ not in allowed:
            raise ProofAdmissionRejected(
                f"claim AST node is forbidden: {type(node).__name__}"
            )
    if _forbidden_symbols(tree):
        raise ProofAdmissionRejected("claim source uses a forbidden process API")
    namespace = {
        "authoritative_input": contracts.ClaimEmitterInput.create(
            resolution=resolution
        ),
        "__builtins__": {
            name: getattr(builtins, name)
            for name in contracts.CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1
            if hasattr(builtins, name)
        },
    }
    exec(compile(tree, "<claim>", "exec"), namespace, namespace)
    result = namespace.get("authoritative_result")
    if type(result) is not contracts.AuthoritativeLatestResolution:
        raise ProofAdmissionRejected(
            "claim must assign authoritative_result to the input resolution"
        )
    if result != resolution:
        raise ProofAdmissionRejected("claim changed the authoritative resolution")
    return contracts.ClaimEmitterOutput.create(resolution=result)


run_claim_with_lease = run_restricted_claim
