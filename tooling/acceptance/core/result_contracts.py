"""Pure canonical result contracts and deterministic platform-matrix folding."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Iterable, Mapping


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_MATRIX_RESULT_DOMAIN = "pt.acceptance.finalization.platform-matrix-result.v1"


class ResultContractError(ValueError):
    """A canonical result contract is incomplete or internally inconsistent."""


class CanonicalResultTuple(Enum):
    """The six result identities admitted by the Acceptance architecture."""

    PassedDoneProven = ("passed", "DONE", "PROVEN")
    PassedDoneUnproven = ("passed", "DONE", "UNPROVEN")
    PassedPartialUnproven = ("passed", "PARTIAL", "UNPROVEN")
    FailedPartialUnproven = ("failed", "PARTIAL", "UNPROVEN")
    FailedDoneUnproven = ("failed", "DONE", "UNPROVEN")
    BlockedBlockedUnproven = ("blocked", "BLOCKED", "UNPROVEN")

    @property
    def status(self) -> str:
        return self.value[0]

    @property
    def completion_status(self) -> str:
        return self.value[1]

    @property
    def proof_status(self) -> str:
        return self.value[2]

    def to_dict(self) -> dict[str, str]:
        return {
            "status": self.status,
            "completionStatus": self.completion_status,
            "proofStatus": self.proof_status,
        }

    @classmethod
    def from_dict(cls, value: object) -> "CanonicalResultTuple":
        if not isinstance(value, dict) or set(value) != {
            "status",
            "completionStatus",
            "proofStatus",
        }:
            raise ResultContractError(
                "resultTuple must contain exactly status, completionStatus, "
                "and proofStatus"
            )
        identity = (
            value["status"],
            value["completionStatus"],
            value["proofStatus"],
        )
        for result_tuple in cls:
            if result_tuple.value == identity:
                return result_tuple
        raise ResultContractError("resultTuple is not a canonical identity")


def fold_result_tuples(
    result_tuples: Iterable[CanonicalResultTuple],
) -> CanonicalResultTuple:
    """Fold a non-empty required-cell result set using the canonical precedence."""

    values = tuple(result_tuples)
    if not values:
        raise ResultContractError("result tuple fold requires a non-empty set")
    if any(type(value) is not CanonicalResultTuple for value in values):
        raise ResultContractError(
            "result tuple fold accepts only CanonicalResultTuple values"
        )

    if CanonicalResultTuple.BlockedBlockedUnproven in values:
        return CanonicalResultTuple.BlockedBlockedUnproven

    if any(value.status == "failed" for value in values):
        if all(value.completion_status == "DONE" for value in values):
            return CanonicalResultTuple.FailedDoneUnproven
        return CanonicalResultTuple.FailedPartialUnproven

    if all(value.completion_status == "DONE" for value in values):
        if all(value.proof_status == "PROVEN" for value in values):
            return CanonicalResultTuple.PassedDoneProven
        return CanonicalResultTuple.PassedDoneUnproven

    return CanonicalResultTuple.PassedPartialUnproven


@dataclass(frozen=True)
class PlatformCellResult:
    """One exact Runtime Cell result in a platform matrix."""

    cell_id: str
    source_commit: str
    result_tuple: CanonicalResultTuple

    def __post_init__(self) -> None:
        _require_identifier(self.cell_id, field_name="cellId")
        _require_non_empty(self.source_commit, field_name="sourceCommit")
        if type(self.result_tuple) is not CanonicalResultTuple:
            raise ResultContractError(
                "resultTuple must be a CanonicalResultTuple"
            )

    def to_dict(self) -> dict[str, object]:
        return {
            "cellId": self.cell_id,
            "sourceCommit": self.source_commit,
            "resultTuple": self.result_tuple.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: object) -> "PlatformCellResult":
        if not isinstance(value, dict) or set(value) != {
            "cellId",
            "sourceCommit",
            "resultTuple",
        }:
            raise ResultContractError(
                "PlatformCellResult fields are incomplete or unknown"
            )
        return cls(
            cell_id=value["cellId"],
            source_commit=value["sourceCommit"],
            result_tuple=CanonicalResultTuple.from_dict(value["resultTuple"]),
        )


@dataclass(frozen=True)
class PlatformMatrixResult:
    """A closed, canonical cross-platform result and its integrity digest."""

    gate_id: str
    source_commit: str
    required_runtime_cells: tuple[str, ...]
    cells: Mapping[str, PlatformCellResult]
    result_tuple: CanonicalResultTuple
    matrix_result_digest: str = field(init=False)

    def __post_init__(self) -> None:
        _require_identifier(self.gate_id, field_name="gateId")
        _require_non_empty(self.source_commit, field_name="sourceCommit")

        required = tuple(self.required_runtime_cells)
        if not required:
            raise ResultContractError(
                "requiredRuntimeCells must be non-empty"
            )
        if len(set(required)) != len(required):
            raise ResultContractError(
                "requiredRuntimeCells must contain unique cell IDs"
            )
        if required != tuple(sorted(required)):
            raise ResultContractError(
                "requiredRuntimeCells must be UTF-8 lexical sorted"
            )
        for cell_id in required:
            _require_identifier(cell_id, field_name="requiredRuntimeCells")

        cells = dict(self.cells)
        if set(cells) != set(required):
            raise ResultContractError(
                "cells keys must equal requiredRuntimeCells exactly"
            )
        for cell_id in required:
            cell = cells[cell_id]
            if type(cell) is not PlatformCellResult:
                raise ResultContractError(
                    f"cell {cell_id}: value must be a PlatformCellResult"
                )
            if cell.cell_id != cell_id:
                raise ResultContractError(
                    f"cell {cell_id}: nested cellId does not match map key"
                )
            if cell.source_commit != self.source_commit:
                raise ResultContractError(
                    f"cell {cell_id}: sourceCommit does not match matrix"
                )

        expected_tuple = fold_result_tuples(
            cells[cell_id].result_tuple for cell_id in required
        )
        if self.result_tuple is not expected_tuple:
            raise ResultContractError(
                "resultTuple does not match the deterministic cell fold"
            )

        object.__setattr__(self, "required_runtime_cells", required)
        object.__setattr__(self, "cells", MappingProxyType(cells))
        object.__setattr__(
            self,
            "matrix_result_digest",
            _matrix_result_digest(self._digest_payload()),
        )

    @classmethod
    def create(
        cls,
        gate_id: str,
        source_commit: str,
        required_runtime_cells: Iterable[str],
        cells: Mapping[str, PlatformCellResult],
    ) -> "PlatformMatrixResult":
        required = tuple(required_runtime_cells)
        if not required:
            raise ResultContractError(
                "requiredRuntimeCells must be non-empty"
            )
        if len(set(required)) != len(required):
            raise ResultContractError(
                "requiredRuntimeCells must contain unique cell IDs"
            )
        for cell_id in required:
            _require_identifier(cell_id, field_name="requiredRuntimeCells")

        canonical_required = tuple(sorted(required))
        canonical_cells = dict(cells)
        if set(canonical_cells) != set(canonical_required):
            raise ResultContractError(
                "cells keys must equal requiredRuntimeCells exactly"
            )
        if any(
            type(cell) is not PlatformCellResult
            for cell in canonical_cells.values()
        ):
            raise ResultContractError(
                "cells values must be PlatformCellResult instances"
            )

        result_tuple = fold_result_tuples(
            canonical_cells[cell_id].result_tuple
            for cell_id in canonical_required
        )
        return cls(
            gate_id=gate_id,
            source_commit=source_commit,
            required_runtime_cells=canonical_required,
            cells=canonical_cells,
            result_tuple=result_tuple,
        )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "gateId": self.gate_id,
            "sourceCommit": self.source_commit,
            "requiredRuntimeCells": list(self.required_runtime_cells),
            "cells": {
                cell_id: self.cells[cell_id].to_dict()
                for cell_id in self.required_runtime_cells
            },
            "resultTuple": self.result_tuple.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "matrixResultDigest": self.matrix_result_digest,
        }

    @classmethod
    def from_dict(cls, value: object) -> "PlatformMatrixResult":
        if not isinstance(value, dict) or set(value) != {
            "gateId",
            "sourceCommit",
            "requiredRuntimeCells",
            "cells",
            "resultTuple",
            "matrixResultDigest",
        }:
            raise ResultContractError(
                "PlatformMatrixResult fields are incomplete or unknown"
            )
        required = value["requiredRuntimeCells"]
        cells = value["cells"]
        if not isinstance(required, list) or not isinstance(cells, dict):
            raise ResultContractError(
                "PlatformMatrixResult cells and requiredRuntimeCells are invalid"
            )
        decoded = cls(
            gate_id=value["gateId"],
            source_commit=value["sourceCommit"],
            required_runtime_cells=tuple(required),
            cells={
                cell_id: PlatformCellResult.from_dict(cell)
                for cell_id, cell in cells.items()
            },
            result_tuple=CanonicalResultTuple.from_dict(value["resultTuple"]),
        )
        if value["matrixResultDigest"] != decoded.matrix_result_digest:
            raise ResultContractError("matrixResultDigest does not match matrix")
        return decoded


def _require_identifier(value: object, *, field_name: str) -> None:
    if type(value) is not str or _IDENTIFIER_PATTERN.fullmatch(value) is None:
        raise ResultContractError(f"{field_name} must be a non-empty identifier")


def _require_non_empty(value: object, *, field_name: str) -> None:
    if type(value) is not str or not value:
        raise ResultContractError(f"{field_name} must be a non-empty string")


def _matrix_result_digest(payload: Mapping[str, object]) -> str:
    envelope = {
        "domain": _MATRIX_RESULT_DOMAIN,
        "payload": payload,
    }
    encoded = json.dumps(
        envelope,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
