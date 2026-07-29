#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any


ARTIFACT_KIND = "desktop-telemetry-db-schema-gate"
PHASE = "P0a-5/P0c-5"
BOM = ["BOM-CON-03", "BOM-CON-04"]
SPEC = ["SPEC-DB-01", "SPEC-DB-02"]
GATE = (
    "Station telemetry DB schema evidence must prove raw event persistence, rollup persistence, "
    "query capability, and runtime migration application before P0a-5 local schema evidence can close"
)
DEFAULT_OUTPUT = Path("tooling/acceptance/reports/desktop-telemetry-db-schema-gate.json")
STORE_PATH = Path("apps/station/app/subserver/frontend_telemetry/store.go")
HANDLER_TEST_PATH = Path("apps/station/app/subserver/frontend_telemetry/handler_test.go")
SUBSERVER_PATH = Path("apps/station/app/subserver/frontend_telemetry/subserver.go")
MIGRATIONS_DIR = Path("apps/station/app/subserver/frontend_telemetry/migrations")

RAW_SCHEMA_TOKENS = [
    "func (rawEventModel) TableName() string { return \"frontend_telemetry_events\" }",
    "ActorID",
    "EventID",
    "SchemaVersion",
    "TS",
    "Kind",
    "Source",
    "Module",
    "Runtime",
    "InteractionID",
    "DurationMS",
    "TagsJSON",
    "DataJSON",
]
ROLLUP_SCHEMA_TOKENS = [
    "func (rollupModel) TableName() string { return \"frontend_telemetry_rollups\" }",
    "WindowStart",
    "WindowMinutes",
    "Count",
    "DurationCount",
    "P50DurationMS",
    "P95DurationMS",
    "MaxDurationMS",
]
STORE_CAPABILITY_TOKENS = [
    "func (s *rawEventStore) AutoMigrate() error",
    "func (s *rawEventStore) PersistBatch(",
    "func (s *rawEventStore) Query(",
    "func (s *rawEventStore) QueryRollups(",
    "func (s *rawEventStore) rebuildRollups(",
]
QUERY_TEST_TOKENS = [
    "TestHandleIngestPersistsValidEventsAndRejectsInvalidOnes",
    "TestHandleQueryFiltersByInteractionID",
    "TestHandleRollupQueryReturnsPersistedPercentiles",
]
RUNTIME_MIGRATION_TOKENS = [
    "func (s *subServer) Init(",
    "store.GetRDS(ctx)",
    "newRawEventStore(rds)",
    "rawStore.AutoMigrate()",
    "s.store = rawStore",
]
VERSIONED_MIGRATION_TOKENS = [
    "CREATE TABLE IF NOT EXISTS frontend_telemetry_events",
    "actor_id TEXT NOT NULL",
    "event_id TEXT NOT NULL",
    "schema_version INTEGER NOT NULL",
    "ts REAL NOT NULL",
    "kind TEXT NOT NULL",
    "interaction_id TEXT",
    "duration_ms REAL",
    "tags_json TEXT",
    "data_json TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_actor_event",
    "ON frontend_telemetry_events(actor_id, event_id)",
    "CREATE TABLE IF NOT EXISTS frontend_telemetry_rollups",
    "window_start DATETIME NOT NULL",
    "window_minutes INTEGER NOT NULL",
    "count INTEGER NOT NULL DEFAULT 0",
    "duration_count INTEGER NOT NULL DEFAULT 0",
    "p50_duration_ms REAL",
    "p95_duration_ms REAL",
    "max_duration_ms REAL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_rollup",
    "ON frontend_telemetry_rollups(",
]
REQUIRED_MIGRATION_TABLES = ["frontend_telemetry_events", "frontend_telemetry_rollups"]
REQUIRED_MIGRATION_INDEXES = ["idx_frontend_telemetry_actor_event", "idx_frontend_telemetry_rollup"]


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def token_evidence(name: str, path: Path, text: str, tokens: list[str]) -> dict[str, Any]:
    present = [token for token in tokens if token in text]
    missing = [token for token in tokens if token not in present]
    return {
        "name": name,
        "path": str(path),
        "status": "pass" if not missing else "diagnostic incomplete",
        "proofStatus": "PROVEN" if not missing else "UNPROVEN",
        "requiredTokenCount": len(tokens),
        "presentTokenCount": len(present),
        "missingTokens": missing,
    }


def migration_up_sql(text: str) -> str:
    up = text.split("-- +migrate Down", 1)[0]
    return "\n".join(line for line in up.splitlines() if not line.strip().startswith("-- +migrate"))


def executable_migration_evidence(paths: list[Path]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": "versioned-migration-executable-schema",
        "status": "diagnostic incomplete",
        "proofStatus": "UNPROVEN",
        "executedFileCount": 0,
        "requiredTables": REQUIRED_MIGRATION_TABLES,
        "requiredIndexes": REQUIRED_MIGRATION_INDEXES,
        "presentTables": [],
        "presentIndexes": [],
        "missingTables": REQUIRED_MIGRATION_TABLES,
        "missingIndexes": REQUIRED_MIGRATION_INDEXES,
    }
    if not paths:
        result["reason"] = "no relevant versioned migration files to execute"
        return result
    try:
        with sqlite3.connect(":memory:") as conn:
            for path in paths:
                conn.executescript(migration_up_sql(read_text(path)))
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'frontend_telemetry_%'"
                )
            }
            indexes = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_frontend_telemetry_%'"
                )
            }
    except sqlite3.Error as exc:
        result["reason"] = f"versioned frontend telemetry DB migration Up SQL failed to execute: {exc}"
        return result
    present_tables = [name for name in REQUIRED_MIGRATION_TABLES if name in tables]
    present_indexes = [name for name in REQUIRED_MIGRATION_INDEXES if name in indexes]
    missing_tables = [name for name in REQUIRED_MIGRATION_TABLES if name not in tables]
    missing_indexes = [name for name in REQUIRED_MIGRATION_INDEXES if name not in indexes]
    proven = not missing_tables and not missing_indexes
    result.update(
        {
            "status": "pass" if proven else "diagnostic incomplete",
            "proofStatus": "PROVEN" if proven else "UNPROVEN",
            "executedFileCount": len(paths),
            "presentTables": present_tables,
            "presentIndexes": present_indexes,
            "missingTables": missing_tables,
            "missingIndexes": missing_indexes,
            "reason": "versioned frontend telemetry DB migration Up SQL executes and creates required tables/indexes"
            if proven
            else "versioned frontend telemetry DB migration Up SQL executed but required tables/indexes are missing",
        }
    )
    return result


def migration_evidence(root: Path) -> dict[str, Any]:
    migrations_dir = root / MIGRATIONS_DIR
    migration_files = sorted(migrations_dir.glob("*.sql")) if migrations_dir.exists() else []
    relevant_files: list[str] = []
    relevant_paths: list[Path] = []
    present_tokens: set[str] = set()
    relevant_tokens = ("frontend_telemetry_events", "frontend_telemetry_rollups")
    for path in migration_files:
        text = read_text(path)
        if any(token in text for token in relevant_tokens):
            relevant_files.append(str(path.relative_to(root)))
            relevant_paths.append(path)
            for token in VERSIONED_MIGRATION_TOKENS:
                if token in text:
                    present_tokens.add(token)
    missing_tokens = [token for token in VERSIONED_MIGRATION_TOKENS if token not in present_tokens]
    executable = executable_migration_evidence(relevant_paths)
    proven = bool(relevant_files) and not missing_tokens and executable.get("proofStatus") == "PROVEN"
    return {
        "name": "versioned-migration-evidence",
        "path": str(MIGRATIONS_DIR),
        "status": "pass" if proven else "diagnostic incomplete",
        "proofStatus": "PROVEN" if proven else "UNPROVEN",
        "requiredTokenCount": len(VERSIONED_MIGRATION_TOKENS),
        "presentTokenCount": len(present_tokens),
        "missingTokens": missing_tokens,
        "executableSchemaEvidence": executable,
        "migrationFileCount": len(migration_files),
        "relevantMigrationFiles": relevant_files,
        "reason": "versioned frontend telemetry DB migration files prove required raw and rollup schema tokens and executable schema"
        if proven
        else (
            "versioned frontend telemetry DB migration files are missing required schema tokens or executable schema proof"
            if relevant_files
            else "no versioned frontend telemetry DB migration files found; current schema evidence is AutoMigrate-only"
        ),
    }


def issue_breakdown(output: Path, runtime_migration: dict[str, Any], versioned_migration: dict[str, Any]) -> list[dict[str, Any]]:
    if runtime_migration.get("status") == "pass":
        return []
    return [
        {
            "category": "station-telemetry-db-runtime-migration-unproven",
            "summary": "P0a-5 DB schema migration application path is not proven in the frontend telemetry subserver runtime.",
            "proofImpact": "P0a-5 and downstream P0a/P0c remain PARTIAL/UNPROVEN until runtime migration application evidence is proven.",
            "sourceArtifact": str(output),
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
            "evidenceDetails": [runtime_migration, versioned_migration],
            "recommendedReviewCommands": recommended_review_commands(),
        }
    ]


def recommended_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Run Station frontend telemetry store and handler tests that prove local raw/query/rollup behavior.",
            "command": "cd apps/station && go test ./app/subserver/frontend_telemetry",
        },
        {
            "purpose": "Inspect current AutoMigrate-backed telemetry schema definitions.",
            "command": "rg -n 'frontend_telemetry_events|frontend_telemetry_rollups|AutoMigrate|PersistBatch|QueryRollups' apps/station/app/subserver/frontend_telemetry",
        },
        {
            "purpose": "Check whether the frontend telemetry subserver applies schema migration during runtime initialization.",
            "command": "rg -n 'GetRDS|newRawEventStore|AutoMigrate|s.store = rawStore' apps/station/app/subserver/frontend_telemetry/subserver.go",
        },
        {
            "purpose": "Check whether optional versioned frontend telemetry DB migrations exist.",
            "command": "find apps/station/app/subserver/frontend_telemetry -path '*migrations*' -type f -maxdepth 4 -print",
        },
    ]


def build_report(root: Path, output: Path) -> dict[str, Any]:
    store_path = root / STORE_PATH
    test_path = root / HANDLER_TEST_PATH
    subserver_path = root / SUBSERVER_PATH
    store_text = read_text(store_path)
    test_text = read_text(test_path)
    subserver_text = read_text(subserver_path)
    raw_schema = token_evidence("raw-event-schema", STORE_PATH, store_text, RAW_SCHEMA_TOKENS)
    rollup_schema = token_evidence("rollup-schema", STORE_PATH, store_text, ROLLUP_SCHEMA_TOKENS)
    store_capability = token_evidence("store-capability", STORE_PATH, store_text, STORE_CAPABILITY_TOKENS)
    query_tests = token_evidence("query-and-rollup-tests", HANDLER_TEST_PATH, test_text, QUERY_TEST_TOKENS)
    runtime_migration = token_evidence("runtime-automigrate-application", SUBSERVER_PATH, subserver_text, RUNTIME_MIGRATION_TOKENS)
    versioned_migration = migration_evidence(root)
    checks = [raw_schema, rollup_schema, store_capability, query_tests, runtime_migration]
    proven_without_versioned_migration = all(check.get("proofStatus") == "PROVEN" for check in checks)
    status = "pass" if all(check.get("status") == "pass" for check in checks) else "diagnostic incomplete"
    issues = issue_breakdown(output, runtime_migration, versioned_migration)
    return {
        "artifactKind": ARTIFACT_KIND,
        "schemaVersion": 1,
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "sourceArtifact": str(output),
        "sourceArtifactKind": ARTIFACT_KIND,
        "sourcePhase": PHASE,
        "sourceBom": BOM,
        "sourceSpec": SPEC,
        "sourceGate": GATE,
        "sampleEmissionAllowed": False,
        "checks": checks,
        "versionedMigrationEvidence": versioned_migration,
        "summary": {
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "rawSchemaProofStatus": raw_schema["proofStatus"],
            "rollupSchemaProofStatus": rollup_schema["proofStatus"],
            "storeCapabilityProofStatus": store_capability["proofStatus"],
            "queryTestProofStatus": query_tests["proofStatus"],
            "runtimeMigrationProofStatus": runtime_migration["proofStatus"],
            "versionedMigrationProofStatus": versioned_migration["proofStatus"],
            "versionedMigrationStatus": "present" if versioned_migration["proofStatus"] == "PROVEN" else "absent",
            "migrationPolicy": "runtime-gorm-automigrate",
            "provenWithoutVersionedMigration": proven_without_versioned_migration,
            "sampleEmissionAllowed": False,
        },
        "issue_breakdown": issues,
        "issueBreakdown": issues,
        "recommended_review_commands": recommended_review_commands(),
        "recommendedReviewCommands": recommended_review_commands(),
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Telemetry DB Schema Gate",
        "",
        f"- status: `{report['status']}`",
        f"- completionStatus: `{report['completionStatus']}`",
        f"- proofStatus: `{report['proofStatus']}`",
        f"- phase: `{report['phase']}`",
        f"- bom: `{','.join(report['bom'])}`",
        f"- spec: `{','.join(report['spec'])}`",
        f"- gate: `{report['gate']}`",
        "",
        "## Checks",
    ]
    for check in report["checks"]:
        lines.append(
            "- `{name}` status=`{status}` proof=`{proof}` missing=`{missing}`".format(
                name=check["name"],
                status=check["status"],
                proof=check["proofStatus"],
                missing=",".join(check.get("missingTokens", [])) or check.get("reason", "n/a"),
            )
        )
    versioned = report.get("versionedMigrationEvidence")
    if isinstance(versioned, dict):
        lines.append(
            "- `{name}` status=`{status}` proof=`{proof}` reason=`{reason}`".format(
                name=versioned["name"],
                status=versioned["status"],
                proof=versioned["proofStatus"],
                reason=versioned.get("reason", "n/a"),
            )
        )
    if report["issueBreakdown"]:
        lines.extend(["", "## Issues"])
        for issue in report["issueBreakdown"]:
            lines.append(f"- `{issue['category']}`: {issue['summary']} impact={issue['proofImpact']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    output = Path(args.output)
    report = build_report(root, output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")
    print(f"[desktop-telemetry-db-schema-gate] wrote {output}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
