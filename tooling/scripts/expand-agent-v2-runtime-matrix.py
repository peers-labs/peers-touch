#!/usr/bin/env python3
"""Expand and validate the reviewed Modern Chat Agent V2 runtime matrix."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from itertools import product
from pathlib import Path
from typing import Any, Mapping, Sequence

import yaml


KEY_FIELDS = (
    "gate",
    "row",
    "platform",
    "runtime",
    "cell",
    "locale",
    "ordering",
    "sample_id",
)
DIMENSION_FIELDS = ("locales", "orderings", "sample_set")
ROLE_POLICY_FIELDS = ("always", "required", "not_applicable")
ALWAYS_REQUIRED_ROLES = {
    "cell-results",
    "runtime-attestation-set",
    "cleanup",
}
RUNTIME_ATTESTATION_PROFILES = {
    "direct_runtime",
    "contract_only",
    "orchestration_guard",
    "non_advertised",
}


class MatrixError(ValueError):
    """The matrix is ambiguous, malformed, or violates a reviewed invariant."""


def _mapping(value: Any, context: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MatrixError(f"{context} must be a mapping")
    return value


def _sequence(value: Any, context: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise MatrixError(f"{context} must be a list")
    return value


def _string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise MatrixError(f"{context} must be a non-empty string")
    return value


def _string_list(value: Any, context: str, *, allow_empty: bool = False) -> list[str]:
    values = [_string(item, f"{context} item") for item in _sequence(value, context)]
    if not values and not allow_empty:
        raise MatrixError(f"{context} must not be empty")
    return values


def load_matrix(path: Path) -> Mapping[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as error:
        raise MatrixError(f"cannot load matrix {path}: {error}") from error
    return _mapping(value, "matrix")


def _resolve_path(matrix: Mapping[str, Any], path: str, row_id: str) -> bool:
    current: Any = matrix
    for component in path.split("."):
        if not component or not isinstance(current, Mapping) or component not in current:
            raise MatrixError(
                f"row {row_id} required_if path {path!r} is unresolved"
            )
        current = current[component]
    if type(current) is not bool:
        raise MatrixError(
            f"row {row_id} required_if path {path!r} resolved to non-boolean"
        )
    return current


def _row_is_required(matrix: Mapping[str, Any], row: Mapping[str, Any], row_id: str) -> bool:
    if "required_if" not in row:
        return True
    path = _string(row["required_if"], f"row {row_id} required_if")
    return _resolve_path(matrix, path, row_id)


def _validated_cell_sets(matrix: Mapping[str, Any]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for name, value in _mapping(matrix.get("cell_sets"), "cell_sets").items():
        set_name = _string(name, "cell set name")
        cells = _string_list(value, f"cell set {set_name}")
        duplicate = next((cell for cell, count in Counter(cells).items() if count > 1), None)
        if duplicate is not None:
            raise MatrixError(f"cell set {set_name} contains duplicate cell {duplicate}")
        result[set_name] = cells
    return result


def _row_cells(
    row: Mapping[str, Any],
    row_id: str,
    cell_sets: Mapping[str, list[str]],
) -> list[str]:
    cells: list[str] = []
    seen: set[str] = set()

    def add(cell: str) -> None:
        if cell in seen:
            raise MatrixError(f"row {row_id} contains duplicate cell {cell}")
        seen.add(cell)
        cells.append(cell)

    for set_name in _string_list(
        row.get("cell_sets", []),
        f"row {row_id} cell_sets",
        allow_empty=True,
    ):
        if set_name not in cell_sets:
            raise MatrixError(f"row {row_id} references unknown cell set {set_name}")
        for cell in cell_sets[set_name]:
            add(cell)
    for cell in _string_list(
        row.get("cells", []),
        f"row {row_id} cells",
        allow_empty=True,
    ):
        add(cell)
    if not cells:
        raise MatrixError(f"row {row_id} has no cells")
    return cells


def _validated_role_policy(
    row: Mapping[str, Any],
    row_id: str,
) -> dict[str, tuple[str, ...]] | None:
    if "role_policy" not in row:
        return None
    policy = _mapping(row["role_policy"], f"row {row_id} role_policy")
    unexpected = sorted(set(policy) - set(ROLE_POLICY_FIELDS))
    if unexpected:
        raise MatrixError(
            f"row {row_id} role_policy has unknown fields: {unexpected}"
        )
    result = {
        field: tuple(
            _string_list(
                policy.get(field, []),
                f"row {row_id} role_policy.{field}",
                allow_empty=field == "not_applicable",
            )
        )
        for field in ROLE_POLICY_FIELDS
    }
    role_sets = {field: set(values) for field, values in result.items()}
    for field, values in role_sets.items():
        if len(values) != len(result[field]):
            raise MatrixError(
                f"row {row_id} role_policy.{field} contains duplicate roles"
            )
    if not ALWAYS_REQUIRED_ROLES.issubset(role_sets["always"]):
        raise MatrixError(
            f"row {row_id} role_policy.always must include "
            f"{sorted(ALWAYS_REQUIRED_ROLES)}"
        )
    for left_index, left in enumerate(ROLE_POLICY_FIELDS):
        for right in ROLE_POLICY_FIELDS[left_index + 1 :]:
            overlap = sorted(role_sets[left] & role_sets[right])
            if overlap:
                raise MatrixError(
                    f"row {row_id} role_policy overlaps {left}/{right}: "
                    f"{overlap}"
                )
    return result


def role_policy_by_row(
    matrix: Mapping[str, Any],
    gate_id: str,
) -> dict[str, dict[str, tuple[str, ...]]]:
    policies: dict[str, dict[str, tuple[str, ...]]] = {}
    for index, value in enumerate(_sequence(matrix.get("rows"), "rows")):
        row = _mapping(value, f"rows[{index}]")
        row_id = _string(row.get("id"), f"rows[{index}].id")
        gate = _string(row.get("gate"), f"row {row_id} gate")
        policy = _validated_role_policy(row, row_id)
        if gate == gate_id and policy is not None:
            policies[row_id] = policy
    return policies


def runtime_attestation_profile_by_row(
    matrix: Mapping[str, Any],
    gate_id: str,
) -> dict[str, str]:
    profiles: dict[str, str] = {}
    for index, value in enumerate(_sequence(matrix.get("rows"), "rows")):
        row = _mapping(value, f"rows[{index}]")
        row_id = _string(row.get("id"), f"rows[{index}].id")
        gate = _string(row.get("gate"), f"row {row_id} gate")
        raw_profile = row.get("runtime_attestation_profile")
        if raw_profile is None:
            continue
        profile = _string(
            raw_profile,
            f"row {row_id} runtime_attestation_profile",
        )
        if profile not in RUNTIME_ATTESTATION_PROFILES:
            raise MatrixError(
                f"row {row_id} has unknown runtime attestation profile "
                f"{profile!r}"
            )
        if gate == gate_id:
            profiles[row_id] = profile
    return profiles


def _validated_rules(expansion: Mapping[str, Any]) -> list[tuple[set[str], Mapping[str, Any]]]:
    result: list[tuple[set[str], Mapping[str, Any]]] = []
    for index, value in enumerate(_sequence(expansion.get("rules", []), "tuple_expansion.rules")):
        rule = _mapping(value, f"tuple_expansion.rules[{index}]")
        cells = _string_list(rule.get("cells"), f"tuple_expansion.rules[{index}].cells")
        duplicate = next((cell for cell, count in Counter(cells).items() if count > 1), None)
        if duplicate is not None:
            raise MatrixError(f"tuple_expansion.rules[{index}] contains duplicate cell {duplicate}")
        result.append((set(cells), rule))
    return result


def _validate_expansion_contract(expansion: Mapping[str, Any]) -> None:
    expected_literals = {
        "mode": "cartesian",
        "rule_precedence": "cell_rule_then_row_then_default",
        "cell_rules_merge": "all_matching_in_order_last_field_wins",
    }
    for field, expected in expected_literals.items():
        if expansion.get(field) != expected:
            raise MatrixError(
                f"tuple_expansion.{field} must be {expected!r}"
            )
    key_fields = tuple(
        _string_list(expansion.get("key"), "tuple_expansion.key")
    )
    if key_fields != KEY_FIELDS:
        raise MatrixError(
            f"tuple_expansion.key must be {list(KEY_FIELDS)!r}"
        )


def _dimension_values(
    row: Mapping[str, Any],
    row_id: str,
    cell: str,
    defaults: Mapping[str, Any],
    rules: Sequence[tuple[set[str], Mapping[str, Any]]],
    sample_sets: Mapping[str, Any],
) -> tuple[list[str], list[str], list[str]]:
    resolved = {field: defaults.get(field) for field in DIMENSION_FIELDS}
    for field in DIMENSION_FIELDS:
        if field in row:
            resolved[field] = row[field]
    for matching_cells, rule in rules:
        if cell not in matching_cells:
            continue
        for field in DIMENSION_FIELDS:
            if field in rule:
                resolved[field] = rule[field]

    locales = _string_list(resolved["locales"], f"row {row_id} cell {cell} locales")
    orderings = _string_list(resolved["orderings"], f"row {row_id} cell {cell} orderings")
    sample_set = _string(resolved["sample_set"], f"row {row_id} cell {cell} sample_set")
    if sample_set not in sample_sets:
        raise MatrixError(
            f"row {row_id} cell {cell} references unknown sample set {sample_set}"
        )
    sample_ids = _string_list(
        sample_sets[sample_set],
        f"sample set {sample_set}",
    )
    return locales, orderings, sample_ids


def _expected_count(value: Any, context: str) -> int:
    if type(value) is not int or value < 0:
        raise MatrixError(f"{context} must be a non-negative integer")
    return value


def _validate_counts(
    keys: Sequence[tuple[str, ...]],
    invariants: Mapping[str, Any],
) -> dict[str, int]:
    actual_total = len(keys)
    expected_total = _expected_count(
        invariants.get("expected_expanded_tuples"),
        "global_invariants.expected_expanded_tuples",
    )
    if actual_total < expected_total:
        raise MatrixError(
            f"missing tuple count: expected {expected_total}, got {actual_total}"
        )
    if actual_total > expected_total:
        raise MatrixError(
            f"unexpected tuple count: expected {expected_total}, got {actual_total}"
        )

    expected_by_gate = {
        _string(gate, "expected gate"): _expected_count(
            count,
            f"global_invariants.expected_tuples_by_gate.{gate}",
        )
        for gate, count in _mapping(
            invariants.get("expected_tuples_by_gate"),
            "global_invariants.expected_tuples_by_gate",
        ).items()
    }
    actual_by_gate = Counter(key[0] for key in keys)
    for gate in sorted(set(expected_by_gate) | set(actual_by_gate)):
        expected = expected_by_gate.get(gate, 0)
        actual = actual_by_gate.get(gate, 0)
        if actual < expected:
            raise MatrixError(
                f"missing tuple count for gate {gate}: expected {expected}, got {actual}"
            )
        if actual > expected:
            raise MatrixError(
                f"unexpected tuple count for gate {gate}: expected {expected}, got {actual}"
            )
    return dict(sorted(actual_by_gate.items()))


def expand_matrix(matrix: Mapping[str, Any]) -> tuple[list[tuple[str, ...]], dict[str, int]]:
    expansion = _mapping(matrix.get("tuple_expansion"), "tuple_expansion")
    _validate_expansion_contract(expansion)
    defaults = _mapping(expansion.get("defaults"), "tuple_expansion.defaults")
    sample_sets = _mapping(expansion.get("sample_sets"), "tuple_expansion.sample_sets")
    rules = _validated_rules(expansion)
    cell_sets = _validated_cell_sets(matrix)

    keys: list[tuple[str, ...]] = []
    seen: set[tuple[str, ...]] = set()
    for index, value in enumerate(_sequence(matrix.get("rows"), "rows")):
        row = _mapping(value, f"rows[{index}]")
        row_id = _string(row.get("id"), f"rows[{index}].id")
        if not _row_is_required(matrix, row, row_id):
            continue
        gate = _string(row.get("gate"), f"row {row_id} gate")
        platform = _string(row.get("platform"), f"row {row_id} platform")
        runtime = _string(row.get("runtime"), f"row {row_id} runtime")
        _validated_role_policy(row, row_id)
        if "role_policy" in row and "runtime_attestation_profile" not in row:
            raise MatrixError(
                f"row {row_id} with role_policy requires "
                "runtime_attestation_profile"
            )
        runtime_attestation_profile_by_row(matrix, gate)
        for cell in _row_cells(row, row_id, cell_sets):
            locales, orderings, sample_ids = _dimension_values(
                row,
                row_id,
                cell,
                defaults,
                rules,
                sample_sets,
            )
            for locale, ordering, sample_id in product(locales, orderings, sample_ids):
                key = (
                    gate,
                    row_id,
                    platform,
                    runtime,
                    cell,
                    locale,
                    ordering,
                    sample_id,
                )
                if key in seen:
                    raise MatrixError(f"duplicate tuple: {'|'.join(key)}")
                seen.add(key)
                keys.append(key)

    keys.sort()
    counts = _validate_counts(
        keys,
        _mapping(matrix.get("global_invariants"), "global_invariants"),
    )
    return keys, counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without emitting tuple keys")
    parser.add_argument("matrix", type=Path)
    args = parser.parse_args()

    try:
        matrix = load_matrix(args.matrix)
        keys, counts = expand_matrix(matrix)
    except MatrixError as error:
        print(f"runtime matrix rejected: {error}", file=sys.stderr)
        return 1

    if args.check:
        rendered_counts = ", ".join(f"{gate}={count}" for gate, count in counts.items())
        print(f"runtime matrix valid: tuples={len(keys)}; {rendered_counts}")
        return 0

    json.dump(
        [dict(zip(KEY_FIELDS, key)) for key in keys],
        sys.stdout,
        indent=2,
        ensure_ascii=True,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
