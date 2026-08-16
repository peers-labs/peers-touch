from __future__ import annotations

import json
import shutil
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ._paths import REPO_ROOT, REPORTS_DIR, EVIDENCE_DIR
from .errors import EvidenceError
from .redaction import redact_text, redact_value


TEXT_EVIDENCE_SUFFIXES = {".html", ".json", ".log", ".md", ".txt", ".xml"}


@dataclass
class ActorRuntime:
    name: str
    runtime: Optional[str] = None
    port: Optional[int] = None
    gateway_port: Optional[int] = None
    profile: Optional[str] = None
    storage_root: Optional[str] = None
    pid: Optional[int] = None


@dataclass
class AssertionResult:
    name: str
    passed: bool
    detail: Optional[str] = None


@dataclass
class EvidenceReport:
    gate_id: str
    status: str
    started_at: str
    duration_ms: int
    runtime: dict[str, Any] = field(default_factory=dict)
    actors: dict[str, ActorRuntime] = field(default_factory=dict)
    assertions: list[AssertionResult] = field(default_factory=list)
    evidence: dict[str, str] = field(default_factory=dict)
    station_url: Optional[str] = None
    error: Optional[str] = None
    error_type: Optional[str] = None
    manifest: Optional[dict[str, Any]] = None

    def add_evidence_file(self, key: str, path: Path) -> str:
        if not path.exists():
            return ""
        if path.is_dir():
            raise EvidenceError(f"evidence path must be a file: {path}")

        dest = EVIDENCE_DIR / f"{self.gate_id}-{key}{path.suffix}"
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        if path.suffix.lower() in TEXT_EVIDENCE_SUFFIXES:
            text = path.read_text(encoding="utf-8", errors="replace")
            dest.write_text(redact_text(text), encoding="utf-8")
        else:
            shutil.copyfile(path, dest)

        try:
            stored_path = str(dest.relative_to(REPO_ROOT))
        except ValueError:
            stored_path = str(dest)
        self.evidence[key] = stored_path
        return stored_path

    def add_actor(self, actor: ActorRuntime) -> None:
        self.actors[actor.name] = actor

    def add_assertion(self, name: str, passed: bool, detail: str | None = None) -> None:
        self.assertions.append(AssertionResult(name=name, passed=passed, detail=detail))

    def to_dict(self) -> dict[str, Any]:
        actors: dict[str, dict[str, Any]] = {}
        for key, actor in self.actors.items():
            if is_dataclass(actor):
                actors[key] = asdict(actor)
            elif isinstance(actor, Mapping):
                actors[key] = dict(actor)
            else:
                raise EvidenceError(
                    f"actor {key!r} must be ActorRuntime or a mapping, got {type(actor).__name__}"
                )

        report = {
            "gate": self.gate_id,
            "status": self.status,
            "started_at": self.started_at,
            "duration_ms": self.duration_ms,
            "station_url": self.station_url,
            "runtime": self.runtime,
            "actors": actors,
            "assertions": [asdict(a) for a in self.assertions],
            "evidence": self.evidence,
            "error": self.error,
            "error_type": self.error_type,
            "manifest": self.manifest,
        }
        return redact_value(report)

    def write(self, report_path: Optional[Path] = None) -> Path:
        if report_path is None:
            report_path = REPORTS_DIR / f"{self.gate_id}.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(self.to_dict(), indent=2, sort_keys=True, default=str) + "\n",
            encoding="utf-8",
        )
        return report_path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_report(gate_id: str) -> EvidenceReport:
    return EvidenceReport(
        gate_id=gate_id,
        status="RUNNING",
        started_at=now_iso(),
        duration_ms=0,
    )
