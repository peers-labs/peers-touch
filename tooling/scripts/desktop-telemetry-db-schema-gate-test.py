#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-telemetry-db-schema-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_db_schema_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_store(root: Path) -> None:
    path = root / "apps/station/app/subserver/frontend_telemetry/store.go"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        """
package frontend_telemetry

type rawEventModel struct {
  ActorID string
  EventID string
  SchemaVersion uint32
  TS float64
  Kind string
  Source string
  Module string
  Runtime string
  InteractionID string
  DurationMS *float64
  TagsJSON string
  DataJSON string
}
func (rawEventModel) TableName() string { return "frontend_telemetry_events" }
type rollupModel struct {
  WindowStart string
  WindowMinutes int
  Count int
  DurationCount int
  P50DurationMS *float64
  P95DurationMS *float64
  MaxDurationMS *float64
}
func (rollupModel) TableName() string { return "frontend_telemetry_rollups" }
func (s *rawEventStore) AutoMigrate() error { return nil }
func (s *rawEventStore) PersistBatch() {}
func (s *rawEventStore) Query() {}
func (s *rawEventStore) QueryRollups() {}
func (s *rawEventStore) rebuildRollups() {}
""",
        encoding="utf-8",
    )


def write_handler_test(root: Path) -> None:
    path = root / "apps/station/app/subserver/frontend_telemetry/handler_test.go"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        """
package frontend_telemetry

func TestHandleIngestPersistsValidEventsAndRejectsInvalidOnes() {}
func TestHandleQueryFiltersByInteractionID() {}
func TestHandleRollupQueryReturnsPersistedPercentiles() {}
""",
        encoding="utf-8",
    )


def write_subserver(root: Path, include_runtime_migration: bool = True) -> None:
    path = root / "apps/station/app/subserver/frontend_telemetry/subserver.go"
    path.parent.mkdir(parents=True, exist_ok=True)
    if include_runtime_migration:
        body = """
package frontend_telemetry

func (s *subServer) Init(ctx context.Context) error {
  rds, err := store.GetRDS(ctx)
  if err != nil { return err }
  rawStore := newRawEventStore(rds)
  if err := rawStore.AutoMigrate(); err != nil { return err }
  s.store = rawStore
  return nil
}
"""
    else:
        body = """
package frontend_telemetry

func (s *subServer) Init(ctx context.Context) error {
  return nil
}
"""
    path.write_text(body, encoding="utf-8")


def write_versioned_migration(root: Path, body: str | None = None) -> None:
    migration = root / "apps/station/app/subserver/frontend_telemetry/migrations/001_frontend_telemetry.sql"
    migration.parent.mkdir(parents=True, exist_ok=True)
    migration.write_text(
        body
        or """
CREATE TABLE IF NOT EXISTS frontend_telemetry_events (
  actor_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  ts REAL NOT NULL,
  kind TEXT NOT NULL,
  interaction_id TEXT,
  duration_ms REAL,
  tags_json TEXT,
  data_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_actor_event
  ON frontend_telemetry_events(actor_id, event_id);
CREATE TABLE IF NOT EXISTS frontend_telemetry_rollups (
  actor_id TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  window_minutes INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  module TEXT,
  runtime TEXT,
  phase TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  p50_duration_ms REAL,
  p95_duration_ms REAL,
  max_duration_ms REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_rollup
  ON frontend_telemetry_rollups(
    actor_id,
    window_start,
    window_minutes,
    kind,
    source,
    module,
    runtime,
    phase
  );
""",
        encoding="utf-8",
    )


class DesktopTelemetryDbSchemaGateTest(unittest.TestCase):
    def test_gate_passes_with_runtime_automigrate_policy_when_versioned_sql_is_absent(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_store(root)
            write_handler_test(root)
            write_subserver(root)
            report = module.build_report(root, Path("out.json"))

        self.assertEqual(report["artifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["rawSchemaProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["rollupSchemaProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["storeCapabilityProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["queryTestProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["runtimeMigrationProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["versionedMigrationProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["versionedMigrationStatus"], "absent")
        self.assertEqual(report["summary"]["migrationPolicy"], "runtime-gorm-automigrate")
        self.assertTrue(report["summary"]["provenWithoutVersionedMigration"])
        self.assertEqual(report["issueBreakdown"], [])

    def test_gate_is_partial_when_runtime_migration_application_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_store(root)
            write_handler_test(root)
            write_subserver(root, include_runtime_migration=False)
            report = module.build_report(root, Path("out.json"))

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["runtimeMigrationProofStatus"], "UNPROVEN")
        issue = report["issueBreakdown"][0]
        self.assertEqual(issue["category"], "station-telemetry-db-runtime-migration-unproven")
        self.assertEqual(issue["sourcePhase"], module.PHASE)
        self.assertEqual(issue["sourceBom"], module.BOM)
        self.assertEqual(issue["sourceSpec"], module.SPEC)
        self.assertIn("PARTIAL/UNPROVEN", issue["proofImpact"])

    def test_gate_passes_when_versioned_migration_evidence_exists(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_store(root)
            write_handler_test(root)
            write_subserver(root)
            write_versioned_migration(root)
            report = module.build_report(root, Path("out.json"))

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["issueBreakdown"], [])
        self.assertEqual(report["summary"]["versionedMigrationProofStatus"], "PROVEN")
        self.assertEqual(
            report["versionedMigrationEvidence"]["presentTokenCount"],
            report["versionedMigrationEvidence"]["requiredTokenCount"],
        )
        self.assertEqual(report["versionedMigrationEvidence"]["missingTokens"], [])
        executable = report["versionedMigrationEvidence"]["executableSchemaEvidence"]
        self.assertEqual(executable["status"], "pass")
        self.assertEqual(executable["proofStatus"], "PROVEN")
        self.assertEqual(executable["missingTables"], [])
        self.assertEqual(executable["missingIndexes"], [])
        self.assertEqual(
            executable["presentTables"],
            ["frontend_telemetry_events", "frontend_telemetry_rollups"],
        )

    def test_versioned_migration_evidence_requires_schema_and_index_tokens(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_versioned_migration(
                root,
                """
CREATE TABLE IF NOT EXISTS frontend_telemetry_events (event_id TEXT);
CREATE TABLE IF NOT EXISTS frontend_telemetry_rollups (count INTEGER);
""",
            )
            evidence = module.migration_evidence(root)

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertGreater(evidence["requiredTokenCount"], evidence["presentTokenCount"])
        self.assertIn("actor_id TEXT NOT NULL", evidence["missingTokens"])
        self.assertIn("CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_actor_event", evidence["missingTokens"])

    def test_versioned_migration_evidence_requires_executable_up_sql(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_versioned_migration(
                root,
                """
CREATE TABLE IF NOT EXISTS frontend_telemetry_events (
  actor_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  ts REAL NOT NULL,
  kind TEXT NOT NULL,
  interaction_id TEXT,
  duration_ms REAL,
  tags_json TEXT,
  data_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_actor_event
  ON frontend_telemetry_events(actor_id, event_id);
CREATE TABLE IF NOT EXISTS frontend_telemetry_rollups (
  actor_id TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  window_minutes INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  module TEXT,
  runtime TEXT,
  phase TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  p50_duration_ms REAL,
  p95_duration_ms REAL,
  max_duration_ms REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_rollup
  ON frontend_telemetry_rollups(
    actor_id,
    window_start,
    window_minutes,
    kind,
    source,
    module,
    runtime,
    phase
  );
THIS IS NOT SQL;
""",
            )
            evidence = module.migration_evidence(root)

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        executable = evidence["executableSchemaEvidence"]
        self.assertEqual(executable["status"], "diagnostic incomplete")
        self.assertEqual(executable["proofStatus"], "UNPROVEN")
        self.assertIn("failed to execute", executable["reason"])


if __name__ == "__main__":
    unittest.main()
