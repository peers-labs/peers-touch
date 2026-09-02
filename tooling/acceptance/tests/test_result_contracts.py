#!/usr/bin/env python3
"""Tests for the canonical Acceptance result algebra."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    CanonicalResultTuple,
    PlatformCellResult,
    PlatformMatrixResult,
    ResultContractError,
    fold_result_tuples,
)


class CanonicalResultTupleTests(unittest.TestCase):
    def test_union_contains_exactly_six_architecture_identities(self) -> None:
        self.assertEqual(
            {result.name: result.to_dict() for result in CanonicalResultTuple},
            {
                "PassedDoneProven": {
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                },
                "PassedDoneUnproven": {
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "UNPROVEN",
                },
                "PassedPartialUnproven": {
                    "status": "passed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                },
                "FailedPartialUnproven": {
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                },
                "FailedDoneUnproven": {
                    "status": "failed",
                    "completionStatus": "DONE",
                    "proofStatus": "UNPROVEN",
                },
                "BlockedBlockedUnproven": {
                    "status": "blocked",
                    "completionStatus": "BLOCKED",
                    "proofStatus": "UNPROVEN",
                },
            },
        )

    def test_fold_implements_complete_precedence_table(self) -> None:
        cases = (
            (
                (CanonicalResultTuple.PassedDoneProven,),
                CanonicalResultTuple.PassedDoneProven,
            ),
            (
                (
                    CanonicalResultTuple.PassedDoneProven,
                    CanonicalResultTuple.PassedDoneUnproven,
                ),
                CanonicalResultTuple.PassedDoneUnproven,
            ),
            (
                (
                    CanonicalResultTuple.PassedDoneProven,
                    CanonicalResultTuple.PassedPartialUnproven,
                ),
                CanonicalResultTuple.PassedPartialUnproven,
            ),
            (
                (
                    CanonicalResultTuple.FailedDoneUnproven,
                    CanonicalResultTuple.PassedDoneProven,
                ),
                CanonicalResultTuple.FailedDoneUnproven,
            ),
            (
                (
                    CanonicalResultTuple.FailedDoneUnproven,
                    CanonicalResultTuple.PassedPartialUnproven,
                ),
                CanonicalResultTuple.FailedPartialUnproven,
            ),
            (
                (
                    CanonicalResultTuple.BlockedBlockedUnproven,
                    CanonicalResultTuple.FailedDoneUnproven,
                ),
                CanonicalResultTuple.BlockedBlockedUnproven,
            ),
        )
        for values, expected in cases:
            with self.subTest(values=values):
                self.assertIs(fold_result_tuples(values), expected)
                self.assertIs(fold_result_tuples(reversed(values)), expected)

    def test_fold_rejects_empty_or_noncanonical_input(self) -> None:
        with self.assertRaises(ResultContractError):
            fold_result_tuples(())
        with self.assertRaises(ResultContractError):
            fold_result_tuples((CanonicalResultTuple.PassedDoneProven, "PROVEN"))

    def test_decoder_rejects_noncanonical_or_open_tuple(self) -> None:
        canonical = CanonicalResultTuple.PassedDoneProven
        self.assertIs(
            CanonicalResultTuple.from_dict(canonical.to_dict()),
            canonical,
        )
        with self.assertRaises(ResultContractError):
            CanonicalResultTuple.from_dict(
                {**canonical.to_dict(), "reason": "unexpected"}
            )
        with self.assertRaises(ResultContractError):
            CanonicalResultTuple.from_dict(
                {
                    "status": "passed",
                    "completionStatus": "BLOCKED",
                    "proofStatus": "PROVEN",
                }
            )


class PlatformResultTests(unittest.TestCase):
    COMMIT = "cf22b1f2da965150c8193f967c102bd17129dfe3"

    @classmethod
    def _cell(
        cls,
        cell_id: str,
        result_tuple: CanonicalResultTuple,
        *,
        source_commit: str | None = None,
    ) -> PlatformCellResult:
        return PlatformCellResult(
            cell_id=cell_id,
            source_commit=source_commit or cls.COMMIT,
            result_tuple=result_tuple,
        )

    def test_matrix_has_canonical_identity_and_digest(self) -> None:
        cells = {
            "desktop-macos-native": self._cell(
                "desktop-macos-native",
                CanonicalResultTuple.PassedDoneProven,
            ),
            "desktop-linux-native": self._cell(
                "desktop-linux-native",
                CanonicalResultTuple.PassedDoneUnproven,
            ),
        }

        matrix = PlatformMatrixResult.create(
            "synthetic-native-gate",
            self.COMMIT,
            ("desktop-macos-native", "desktop-linux-native"),
            cells,
        )

        self.assertEqual(
            matrix.required_runtime_cells,
            ("desktop-linux-native", "desktop-macos-native"),
        )
        self.assertIs(
            matrix.result_tuple,
            CanonicalResultTuple.PassedDoneUnproven,
        )
        self.assertEqual(
            matrix.matrix_result_digest,
            "206bcedb7ef28e466d627eb61fed0927b8a2b59f9224663b1f8988589f35af9e",
        )
        self.assertEqual(
            matrix.to_dict(),
            {
                "gateId": "synthetic-native-gate",
                "sourceCommit": self.COMMIT,
                "requiredRuntimeCells": [
                    "desktop-linux-native",
                    "desktop-macos-native",
                ],
                "cells": {
                    "desktop-linux-native": {
                        "cellId": "desktop-linux-native",
                        "sourceCommit": self.COMMIT,
                        "resultTuple": {
                            "status": "passed",
                            "completionStatus": "DONE",
                            "proofStatus": "UNPROVEN",
                        },
                    },
                    "desktop-macos-native": {
                        "cellId": "desktop-macos-native",
                        "sourceCommit": self.COMMIT,
                        "resultTuple": {
                            "status": "passed",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                        },
                    },
                },
                "resultTuple": {
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "UNPROVEN",
                },
                "matrixResultDigest": (
                    "206bcedb7ef28e466d627eb61fed0927b8a2b59f9224663b1f8988589f35af9e"
                ),
            },
        )
        self.assertEqual(
            PlatformMatrixResult.from_dict(matrix.to_dict()),
            matrix,
        )

        changed_digest = matrix.to_dict()
        changed_digest["matrixResultDigest"] = "0" * 64
        with self.assertRaises(ResultContractError):
            PlatformMatrixResult.from_dict(changed_digest)

    def test_matrix_rejects_open_or_inconsistent_identity(self) -> None:
        linux = self._cell(
            "desktop-linux-native",
            CanonicalResultTuple.PassedDoneProven,
        )
        macos = self._cell(
            "desktop-macos-native",
            CanonicalResultTuple.PassedDoneProven,
        )
        cases = (
            (
                ("desktop-macos-native", "desktop-linux-native"),
                {
                    "desktop-linux-native": linux,
                    "desktop-macos-native": macos,
                },
                CanonicalResultTuple.PassedDoneProven,
            ),
            (
                ("desktop-linux-native",),
                {
                    "desktop-linux-native": linux,
                    "desktop-macos-native": macos,
                },
                CanonicalResultTuple.PassedDoneProven,
            ),
            (
                ("desktop-linux-native",),
                {"desktop-linux-native": macos},
                CanonicalResultTuple.PassedDoneProven,
            ),
            (
                ("desktop-linux-native",),
                {
                    "desktop-linux-native": self._cell(
                        "desktop-linux-native",
                        CanonicalResultTuple.PassedDoneProven,
                        source_commit="stale",
                    )
                },
                CanonicalResultTuple.PassedDoneProven,
            ),
            (
                ("desktop-linux-native",),
                {"desktop-linux-native": linux},
                CanonicalResultTuple.PassedDoneUnproven,
            ),
        )
        for required, cells, result_tuple in cases:
            with self.subTest(required=required, cells=cells):
                with self.assertRaises(ResultContractError):
                    PlatformMatrixResult(
                        gate_id="synthetic-native-gate",
                        source_commit=self.COMMIT,
                        required_runtime_cells=required,
                        cells=cells,
                        result_tuple=result_tuple,
                    )

    def test_matrix_factory_rejects_missing_duplicate_and_empty_cells(self) -> None:
        linux = self._cell(
            "desktop-linux-native",
            CanonicalResultTuple.PassedDoneProven,
        )
        for required, cells in (
            ((), {}),
            (
                ("desktop-linux-native", "desktop-linux-native"),
                {"desktop-linux-native": linux},
            ),
            (("desktop-linux-native", "desktop-macos-native"), {
                "desktop-linux-native": linux,
            }),
        ):
            with self.subTest(required=required):
                with self.assertRaises(ResultContractError):
                    PlatformMatrixResult.create(
                        "synthetic-native-gate",
                        self.COMMIT,
                        required,
                        cells,
                    )

    def test_matrix_rejects_cell_subclasses(self) -> None:
        class DivergentCell(PlatformCellResult):
            def to_dict(self) -> dict[str, object]:
                return {
                    **super().to_dict(),
                    "sourceCommit": "foreign-source",
                }

        cell = DivergentCell(
            cell_id="desktop-linux-native",
            source_commit=self.COMMIT,
            result_tuple=CanonicalResultTuple.PassedDoneProven,
        )

        with self.assertRaisesRegex(
            ResultContractError,
            "cells values must be PlatformCellResult instances",
        ):
            PlatformMatrixResult.create(
                "synthetic-native-gate",
                self.COMMIT,
                ("desktop-linux-native",),
                {"desktop-linux-native": cell},
            )


if __name__ == "__main__":
    unittest.main()
