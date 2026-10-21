#!/usr/bin/env python3
"""Issue the fail-closed 0.0.1 Mobile iOS and Desktop release verdict."""

from __future__ import annotations

import html
import json
import os
import sys
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    EvidenceStore,
    FormalExecutionPlan,
    GateError,
    REPO_ROOT,
    load_formal_plan,
    source_identity,
)
from tooling.acceptance.gates.release.evidence import (
    GateInspection,
    OPERATION_ANALYSIS_GATE_ID,
    OPERATION_REPORT_ROLE,
    artifact_by_role,
    inspect_gate,
    parse_current_results,
    parse_source_environment,
    validate_operation_analysis_report,
)


GATE_ID = "release-0.0.1-mobile-ios-desktop-aggregate"
PLAN_ID = "release-0.0.1-mobile-ios-desktop-acceptance-20261017"
PLAN_PATH = (
    REPO_ROOT
    / "docs/architecture/engineering/acceptance/execution-plans"
    / "20261017-release-0.0.1-mobile-ios-desktop/plan.md"
)
AGGREGATE_SOURCE_ENV = "PT_ACCEPTANCE_AGGREGATE_SOURCE"
CURRENT_RESULTS_ENV = "PT_ACCEPTANCE_CURRENT_RESULTS"
REPORT_ROLE = "release-mobile-ios-desktop-final-report"
MARKDOWN_ROLE = "release-mobile-ios-desktop-final-markdown"
HTML_ROLE = "release-mobile-ios-desktop-final-html"
NON_CLAIMS = (
    "AI、Agent、Bot、provider、MCP 与 Skill",
    "Android、Windows、Linux 与实体 iOS 设备",
    "签名、公证、安装包分发、商店发布与线上发布",
    "未被核心 Journey 依赖的 Applet 产品就绪度",
)


def _gate_catalog() -> dict[str, dict[str, Any]]:
    value = json.loads(
        (REPO_ROOT / "tooling/acceptance/gates.yaml").read_text(
            encoding="utf-8"
        )
    )
    gates = value.get("gates")
    if not isinstance(gates, dict):
        raise GateError("Acceptance Gate catalog is malformed")
    return gates


def _required_gate_ids(plan: FormalExecutionPlan) -> tuple[str, ...]:
    if plan.plan_id != PLAN_ID:
        raise GateError("release aggregate loaded the wrong formal Plan")
    completion = tuple(plan.gate_ids("completion"))
    if not completion or completion[-1] != GATE_ID:
        raise GateError("release aggregate must be the final completion Gate")
    if GATE_ID in completion[:-1]:
        raise GateError("release aggregate is duplicated in completion")
    return completion[:-1]


def _operation_report(
    store: EvidenceStore,
    inspections: list[GateInspection],
) -> dict[str, Any] | None:
    inspection = next(
        (
            item
            for item in inspections
            if item.gate_id == OPERATION_ANALYSIS_GATE_ID
        ),
        None,
    )
    if (
        inspection is None
        or inspection.status != "PASS"
        or inspection.manifest is None
    ):
        return None
    try:
        _, report = artifact_by_role(
            store,
            inspection.manifest,
            OPERATION_REPORT_ROLE,
        )
        validate_operation_analysis_report(
            report, store=store, expected_source=inspection.manifest["source"],
        )
    except GateError:
        return None
    return report


def build_report(
    *,
    source: Mapping[str, str],
    plan: FormalExecutionPlan,
    inspections: list[GateInspection],
    operation_report: Mapping[str, Any] | None,
) -> dict[str, Any]:
    by_gate = {item.gate_id: item for item in inspections}
    closure_matrix = []
    for closure_id, gate_ids in plan.acceptance["closures"].items():
        closure_inspections = [
            by_gate[gate_id]
            for gate_id in gate_ids
            if gate_id != GATE_ID and gate_id in by_gate
        ]
        expected_count = len(
            [gate_id for gate_id in gate_ids if gate_id != GATE_ID]
        )
        closure_matrix.append(
            {
                "closureId": closure_id,
                "status": (
                    "PASS"
                    if len(closure_inspections) == expected_count
                    and all(item.status == "PASS" for item in closure_inspections)
                    else "UNPROVEN"
                ),
                "passedCount": sum(
                    item.status == "PASS" for item in closure_inspections
                ),
                "requiredCount": expected_count,
            }
        )
    blockers = [
        {
            "gateId": item.gate_id,
            "status": item.status,
            "detail": item.detail,
        }
        for item in inspections
        if item.status != "PASS"
    ]
    if operation_report is None:
        blockers.append(
            {
                "gateId": "release-0.0.1-operation-analysis",
                "status": "UNPROVEN",
                "detail": "operation-analysis report is missing or invalid",
            }
        )
    passed = not blockers and all(
        item["status"] == "PASS" for item in closure_matrix
    )
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "schemaVersion": 1,
        "gateId": GATE_ID,
        "gate": GATE_ID,
        "planId": PLAN_ID,
        "status": "PASS" if passed else "FAIL",
        "completionStatus": "DONE" if passed else "PARTIAL",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "phase": "R001-08",
        "bom": ["R001-J07"],
        "spec": [
            str(PLAN_PATH.relative_to(REPO_ROOT)),
            "docs/architecture/engineering/acceptance/execution-plans/"
            "20261017-release-0.0.1-mobile-ios-desktop/tasks/"
            "R001-08-RELEASE.md",
        ],
        "sampleEmissionAllowed": passed,
        "source": dict(source),
        "releaseVerdict": "可发布" if passed else "不可发布",
        "closureMatrix": closure_matrix,
        "gateCount": len(inspections),
        "passedCount": sum(item.status == "PASS" for item in inspections),
        "blockers": blockers,
        "fixedDefects": (
            list(operation_report.get("fixedDefects", []))
            if operation_report
            else []
        ),
        "openUxBlockers": (
            list(operation_report.get("openBlockers", []))
            if operation_report
            else []
        ),
        "preservedDesigns": (
            list(operation_report.get("preservedDesigns", []))
            if operation_report
            else []
        ),
        "uxRoadmap": (
            dict(operation_report.get("roadmap", {}))
            if operation_report
            else {"must": [], "should": [], "could": []}
        ),
        "journeys": (
            list(operation_report.get("journeys", []))
            if operation_report
            else []
        ),
        "nonClaims": list(NON_CLAIMS),
        "gates": [item.summary() for item in inspections],
        "assertions": [
            {
                "name": f"exact-source-{item.gate_id}",
                "passed": item.status == "PASS",
                "detail": item.detail,
            }
            for item in inspections
        ]
        + [
            {
                "name": "operation-analysis-report",
                "passed": operation_report is not None,
                "detail": (
                    "current exact-source report"
                    if operation_report is not None
                    else "missing or invalid"
                ),
            }
        ],
    }


def _summary_lines(items: list[Mapping[str, Any]]) -> list[str]:
    if not items:
        return ["- 无"]
    return [
        f"- **{item.get('summary', item.get('gateId', '未命名'))}**："
        f"{item.get('rationale', item.get('detail', ''))}"
        for item in items
    ]


def render_markdown(report: Mapping[str, Any]) -> str:
    lines = [
        "# Peers Touch 0.0.1 Mobile iOS + Desktop 发布验收报告",
        "",
        f"> 发布结论：**{report['releaseVerdict']}**",
        "",
        "## 能力与 Journey 矩阵",
        "",
    ]
    lines.extend(
        (
            f"- `{item['closureId']}`：{item['status']}，"
            f"{item['passedCount']}/{item['requiredCount']}"
        )
        for item in report["closureMatrix"]
    )
    lines.extend(
        [
            "",
            "## 关键 Journey 结果",
            "",
            *(
                [
                    (
                        f"- `{item['journeyId']}` · `{item['platform']}`："
                        f"{'完成' if item['completed'] else '未完成'}，"
                        f"{item['durationSeconds']} 秒"
                    )
                    for item in report["journeys"]
                ]
                or ["- 无"]
            ),
            "",
            "## 已修复发布缺陷",
            "",
            *_summary_lines(report["fixedDefects"]),
            "",
            "## 未解决发布阻塞",
            "",
            *_summary_lines(report["blockers"]),
            "",
            "## 保留的好设计",
            "",
            *_summary_lines(report["preservedDesigns"]),
            "",
            "## 下阶段 UX 优化",
            "",
            "### 下一阶段必须做",
            *_summary_lines(report["uxRoadmap"].get("must", [])),
            "",
            "### 应该做",
            *_summary_lines(report["uxRoadmap"].get("should", [])),
            "",
            "### 可以做",
            *_summary_lines(report["uxRoadmap"].get("could", [])),
            "",
            "## 明确不声明",
            "",
            *[f"- {item}" for item in report["nonClaims"]],
            "",
            "## 技术证据附录",
            "",
        ]
    )
    lines.extend(
        f"- `{item['gate_id']}`：{item['status']}，run `{item['run_id']}`"
        for item in report["gates"]
    )
    return "\n".join(lines) + "\n"


def render_html(report: Mapping[str, Any]) -> str:
    rendered_lines: list[str] = []
    for line in render_markdown(report).splitlines():
        if line.startswith("### "):
            rendered_lines.append(f"<h3>{html.escape(line[4:])}</h3>")
        elif line.startswith("## "):
            rendered_lines.append(f"<h2>{html.escape(line[3:])}</h2>")
        elif line.startswith("# "):
            rendered_lines.append(f"<h1>{html.escape(line[2:])}</h1>")
        elif line.startswith("> "):
            rendered_lines.append(
                f"<blockquote>{html.escape(line[2:])}</blockquote>"
            )
        elif line.startswith("- "):
            rendered_lines.append(f"<p>• {html.escape(line[2:])}</p>")
        elif line:
            rendered_lines.append(f"<p>{html.escape(line)}</p>")
        else:
            rendered_lines.append("<br>")
    body = "\n".join(rendered_lines)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Peers Touch 0.0.1 发布验收报告</title>
<style>
body {{ font: 15px/1.65 -apple-system, BlinkMacSystemFont, sans-serif; color: #17202a; margin: 0 auto; max-width: 960px; padding: 40px 24px; }}
h1, h2 {{ line-height: 1.25; }}
blockquote {{ border-left: 4px solid #157347; margin: 0; padding: 12px 16px; background: #f3f8f5; }}
p {{ margin: 6px 0; overflow-wrap: anywhere; }}
</style>
</head>
<body>{body}</body>
</html>
"""


class ReleaseAggregateGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "R001-08"
    bom = ("R001-J07",)
    spec = (
        str(PLAN_PATH.relative_to(REPO_ROOT)),
        "docs/architecture/engineering/acceptance/execution-plans/"
        "20261017-release-0.0.1-mobile-ios-desktop/tasks/"
        "R001-08-RELEASE.md",
    )

    def __init__(
        self,
        *,
        store: EvidenceStore | None = None,
        expected_source: Mapping[str, str] | None = None,
        plan: FormalExecutionPlan | None = None,
        current_results: str | None = None,
        catalog: Mapping[str, Mapping[str, Any]] | None = None,
    ) -> None:
        super().__init__()
        self.store = store or EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        fallback = expected_source or source_identity(REPO_ROOT)
        self.expected_source = parse_source_environment(
            os.environ.get(AGGREGATE_SOURCE_ENV, ""),
            fallback=fallback,
        )
        self.plan = plan or load_formal_plan(PLAN_PATH)
        self.current_results = (
            current_results
            if current_results is not None
            else os.environ.get(CURRENT_RESULTS_ENV, "")
        )
        self.catalog = dict(catalog or _gate_catalog())

    def run(self) -> dict[str, Any]:
        raise GateError(
            "ReleaseAggregateGate uses its evidence-aware execute entrypoint"
        )

    def evaluate(self) -> dict[str, Any]:
        required_gate_ids = _required_gate_ids(self.plan)
        try:
            current = parse_current_results(
                self.current_results,
                expected_source=self.expected_source,
            )
        except GateError:
            current = {}
        unexpected = sorted(set(current) - set(required_gate_ids))
        if unexpected:
            raise GateError(
                f"current aggregate contains undeclared Gates: {unexpected}"
            )
        inspections: list[GateInspection] = []
        for gate_id in required_gate_ids:
            definition = self.catalog.get(gate_id)
            if not isinstance(definition, Mapping):
                inspections.append(
                    GateInspection(
                        gate_id,
                        None,
                        "ERROR",
                        "Gate is missing from the catalog",
                    )
                )
                continue
            required_cells = definition.get("requiredRuntimeCells", ())
            inspections.append(
                inspect_gate(
                    self.store,
                    gate_id,
                    expected_source=self.expected_source,
                    current_result=current.get(gate_id),
                    require_current_result=True,
                    require_canonical_report=(
                        definition.get("tier") == "env-evidence"
                    ),
                    required_runtime_cells=(
                        tuple(required_cells)
                        if isinstance(required_cells, list)
                        else ()
                    ),
                )
            )
        operation_report = _operation_report(self.store, inspections)
        return build_report(
            source=self.expected_source,
            plan=self.plan,
            inspections=inspections,
            operation_report=operation_report,
        )

    def execute(self) -> int:
        try:
            report = self.evaluate()
        except GateError as error:
            report = build_report(
                source=self.expected_source,
                plan=self.plan,
                inspections=[
                    GateInspection(GATE_ID, None, "ERROR", str(error))
                ],
                operation_report=None,
            )
        with ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
            source=self.expected_source,
        ) as artifacts:
            artifacts.write_json(
                "release-0.0.1/mobile-ios-desktop-acceptance.json",
                report,
                role=REPORT_ROLE,
            )
            artifacts.write_bytes(
                "release-0.0.1/mobile-ios-desktop-acceptance.md",
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role=MARKDOWN_ROLE,
            )
            artifacts.write_bytes(
                "release-0.0.1/mobile-ios-desktop-acceptance.html",
                render_html(report).encode("utf-8"),
                media_type="text/html",
                role=HTML_ROLE,
            )
            passed = report["status"] == "PASS"
            artifacts.complete(
                status="PASS" if passed else "FAIL",
                completion_status="DONE" if passed else "PARTIAL",
                proof_status="PROVEN" if passed else "UNPROVEN",
                runtime={
                    "planId": PLAN_ID,
                    "source": self.expected_source,
                    "releaseVerdict": report["releaseVerdict"],
                    "gateCount": report["gateCount"],
                    "passedCount": report["passedCount"],
                },
            )
        stream = sys.stdout if report["status"] == "PASS" else sys.stderr
        stream.write(
            f"{report['status']}: {self.gate_id}: "
            f"{report['releaseVerdict']}\n"
        )
        return 0 if report["status"] == "PASS" else 1


def main() -> int:
    return ReleaseAggregateGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
