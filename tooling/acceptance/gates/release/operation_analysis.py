#!/usr/bin/env python3
"""Build the 0.0.1 Desktop and iOS operation-analysis report."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    source_identity,
)
from tooling.acceptance.gates.release.evidence import (
    GateInspection,
    OPERATION_ANALYSIS_GATE_ID,
    OPERATION_REPORT_ROLE,
    inspect_gate,
    parse_source_environment,
    validate_operation_analysis_report,
    validate_review_artifact,
)
from tooling.acceptance.gates.release.operation_contract import (
    JOURNEY_IDS, PLATFORMS, REQUIRED_JOURNEYS, validate_trace_binding,
)


GATE_ID = OPERATION_ANALYSIS_GATE_ID
PLAN_ID = "release-0.0.1-mobile-ios-desktop-acceptance-20261017"
REVIEW_INPUT_ENV = "PT_RELEASE_OPERATION_REVIEW_INPUT"
AGGREGATE_SOURCE_ENV = "PT_ACCEPTANCE_AGGREGATE_SOURCE"
REPORT_ROLE = OPERATION_REPORT_ROLE
MARKDOWN_ROLE = "release-operation-analysis-markdown"
HTML_ROLE = "release-operation-analysis-html"
INPUT_ROLE = "release-operation-review-input"

REQUIRED_EVIDENCE_GATES = (
    "mobile-simulator-whole-product-usability-e2e",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-platform-e2e",
    "station-access-desktop-oauth-native-e2e",
    "desktop-shell-tray-e2e",
    "station-access-federation-boundary-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-interactions-group-e2e",
    "social-private-desktop-e2e",
    "social-cross-station-mobile-desktop-e2e",
)
DIMENSIONS = (
    "simplicity",
    "usability",
    "smoothness",
    "understandability",
    "mainstream-standard",
)
CLASSIFICATIONS = (
    "release-defect",
    "next-stage-ux",
    "preserve-good-design",
)
FORBIDDEN_TEXT = (
    re.compile(r"https?://", re.IGNORECASE),
    re.compile(r"\bptid[:=][^\s]+", re.IGNORECASE),
    re.compile(
        r"\b(?:password|secret|token|authorization)\s*[:=]",
        re.IGNORECASE,
    ),
)


def _required_text(value: Mapping[str, Any], field: str, label: str) -> str:
    item = value.get(field)
    if not isinstance(item, str) or not item.strip():
        raise GateError(f"{label} {field} must be non-empty text")
    return item.strip()


def _text_list(value: object, label: str, *, allow_empty: bool = False) -> list[str]:
    if (
        not isinstance(value, list)
        or (not value and not allow_empty)
        or any(not isinstance(item, str) or not item.strip() for item in value)
    ):
        raise GateError(f"{label} must be a list of non-empty text values")
    return [item.strip() for item in value]


def _reject_sensitive_text(value: object, label: str) -> None:
    if isinstance(value, str):
        if any(pattern.search(value) for pattern in FORBIDDEN_TEXT):
            raise GateError(f"{label} contains sensitive or raw internal text")
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            _reject_sensitive_text(item, f"{label}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _reject_sensitive_text(item, f"{label}[{index}]")


def load_review_input(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateError(f"operation review input is unreadable: {path}") from error
    if not isinstance(value, dict):
        raise GateError("operation review input must be a JSON object")
    return value


def validate_review_input(
    value: Mapping[str, Any],
    *,
    store: EvidenceStore,
    expected_source: Mapping[str, str],
) -> dict[str, Any]:
    if (
        value.get("artifactKind") != "release-operation-review-input"
        or value.get("schemaVersion") != 1
        or value.get("planId") != PLAN_ID
        or value.get("source") != dict(expected_source)
    ):
        raise GateError(
            "operation review input identity does not match the release candidate"
        )
    reviewer = _required_text(value, "reviewer", "operation review input")
    journeys = value.get("journeys")
    if not isinstance(journeys, list):
        raise GateError("operation review input journeys must be a list")

    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, raw in enumerate(journeys):
        label = f"journey[{index}]"
        if not isinstance(raw, Mapping):
            raise GateError(f"{label} must be an object")
        journey_id = _required_text(raw, "journeyId", label)
        platform = _required_text(raw, "platform", label)
        key = (journey_id, platform)
        if key not in REQUIRED_JOURNEYS:
            raise GateError(f"{label} has an unsupported journey/platform pair")
        if key in seen:
            raise GateError(f"operation review repeats journey {key!r}")
        seen.add(key)
        if raw.get("completed") is not True:
            raise GateError(f"{label} is not completed")
        duration = raw.get("durationSeconds")
        if (
            isinstance(duration, bool)
            or not isinstance(duration, (int, float))
            or duration < 0
        ):
            raise GateError(f"{label} durationSeconds must be non-negative")
        wait_points = raw.get("waitPoints")
        if not isinstance(wait_points, list):
            raise GateError(f"{label} waitPoints must be a list")
        normalized_waits: list[dict[str, Any]] = []
        for wait_index, wait in enumerate(wait_points):
            wait_label = f"{label}.waitPoints[{wait_index}]"
            if not isinstance(wait, Mapping):
                raise GateError(f"{wait_label} must be an object")
            wait_duration = wait.get("durationSeconds")
            if (
                isinstance(wait_duration, bool)
                or not isinstance(wait_duration, (int, float))
                or wait_duration < 0
            ):
                raise GateError(
                    f"{wait_label} durationSeconds must be non-negative"
                )
            normalized_waits.append(
                {
                    "label": _required_text(wait, "label", wait_label),
                    "durationSeconds": wait_duration,
                    "feedback": _required_text(wait, "feedback", wait_label),
                }
            )

        judgments = raw.get("judgments")
        if not isinstance(judgments, list) or not judgments:
            raise GateError(f"{label} judgments must be a non-empty list")
        normalized_judgments: list[dict[str, Any]] = []
        for judgment_index, judgment in enumerate(judgments):
            judgment_label = f"{label}.judgments[{judgment_index}]"
            if not isinstance(judgment, Mapping):
                raise GateError(f"{judgment_label} must be an object")
            classification = _required_text(
                judgment,
                "classification",
                judgment_label,
            )
            if classification not in CLASSIFICATIONS:
                raise GateError(
                    f"{judgment_label} classification is unsupported"
                )
            priority = _required_text(judgment, "priority", judgment_label)
            allowed_priorities = {
                "release-defect": {"must"},
                "next-stage-ux": {"must", "should", "could"},
                "preserve-good-design": {"preserve"},
            }[classification]
            if priority not in allowed_priorities:
                raise GateError(
                    f"{judgment_label} priority does not match classification"
                )
            dimensions = judgment.get("dimensions")
            if (
                not isinstance(dimensions, Mapping)
                or set(dimensions) != set(DIMENSIONS)
                or any(
                    not isinstance(dimensions[name], str)
                    or not dimensions[name].strip()
                    for name in DIMENSIONS
                )
            ):
                raise GateError(
                    f"{judgment_label} must explain all five UX dimensions"
                )
            resolution_status = judgment.get(
                "resolutionStatus",
                "not-applicable",
            )
            regression_evidence = judgment.get("regressionEvidence")
            if classification == "release-defect":
                if resolution_status not in {"resolved", "open"}:
                    raise GateError(
                        f"{judgment_label} release defect resolution is invalid"
                    )
                if resolution_status == "resolved":
                    validate_review_artifact(
                        store,
                        regression_evidence,
                        expected_source=expected_source,
                    )
            elif resolution_status != "not-applicable":
                raise GateError(
                    f"{judgment_label} non-defect resolution must be not-applicable"
                )
            normalized_judgments.append(
                {
                    "summary": _required_text(
                        judgment,
                        "summary",
                        judgment_label,
                    ),
                    "classification": classification,
                    "priority": priority,
                    "rationale": _required_text(
                        judgment,
                        "rationale",
                        judgment_label,
                    ),
                    "affectedUsers": _required_text(
                        judgment,
                        "affectedUsers",
                        judgment_label,
                    ),
                    "dimensions": {
                        name: str(dimensions[name]).strip()
                        for name in DIMENSIONS
                    },
                    "resolutionStatus": resolution_status,
                    "regressionEvidence": regression_evidence,
                }
            )

        screenshot = validate_review_artifact(
            store,
            raw.get("screenshot"),
            expected_source=expected_source,
        )
        interaction_trace = validate_review_artifact(
            store,
            raw.get("interactionTrace"),
            expected_source=expected_source,
        )
        normalized.append(
            {
                "journeyId": journey_id,
                "platform": platform,
                "goal": _required_text(raw, "goal", label),
                "steps": _text_list(raw.get("steps"), f"{label}.steps"),
                "completed": True,
                "durationSeconds": duration,
                "waitPoints": normalized_waits,
                "discoverability": _required_text(
                    raw,
                    "discoverability",
                    label,
                ),
                "feedback": _required_text(raw, "feedback", label),
                "recovery": _required_text(raw, "recovery", label),
                "facts": _text_list(raw.get("facts"), f"{label}.facts"),
                "observations": _text_list(
                    raw.get("observations"),
                    f"{label}.observations",
                ),
                "judgments": normalized_judgments,
                "screenshot": screenshot,
                "interactionTrace": interaction_trace,
                "traceSegmentId": _required_text(raw, "traceSegmentId", label),
            }
        )
        validate_trace_binding(store, normalized[-1], expected_source=expected_source)

    missing = sorted(set(REQUIRED_JOURNEYS) - seen)
    if missing:
        raise GateError(f"operation review is missing journeys: {missing}")
    _reject_sensitive_text(normalized, "operation review")
    return {
        "reviewer": reviewer,
        "journeys": sorted(
            normalized,
            key=lambda item: (
                JOURNEY_IDS.index(item["journeyId"]),
                PLATFORMS.index(item["platform"]),
            ),
        ),
    }


def _evidence_uri(reference: Mapping[str, Any]) -> str:
    artifact = reference.get("artifact", reference)
    return (
        "peers-touch-evidence://"
        f"{artifact['workspaceId']}/{artifact['gateId']}/"
        f"{artifact['runId']}/{artifact['path']}"
    )


def build_report(
    *,
    source: Mapping[str, str],
    evidence: list[GateInspection],
    review: Mapping[str, Any] | None,
    error: str = "",
) -> dict[str, Any]:
    evidence_ready = all(item.status == "PASS" for item in evidence)
    journeys = list(review.get("journeys", [])) if review else []
    judgments = [
        judgment
        for journey in journeys
        for judgment in journey["judgments"]
    ]
    fixed_defects = [
        item
        for item in judgments
        if item["classification"] == "release-defect"
        and item["resolutionStatus"] == "resolved"
    ]
    open_blockers = [
        item
        for item in judgments
        if item["classification"] == "release-defect"
        and item["resolutionStatus"] == "open"
    ]
    preserved = [
        item
        for item in judgments
        if item["classification"] == "preserve-good-design"
    ]
    roadmap = {
        priority: [
            item
            for item in judgments
            if item["classification"] == "next-stage-ux"
            and item["priority"] == priority
        ]
        for priority in ("must", "should", "could")
    }
    passed = (
        evidence_ready
        and review is not None
        and len(journeys) == len(REQUIRED_JOURNEYS)
        and not open_blockers
        and not error
    )
    blockers = [
        {
            "summary": f"{item.gate_id}: {item.status}",
            "detail": item.detail,
        }
        for item in evidence
        if item.status != "PASS"
    ]
    blockers.extend(
        {
            "summary": item["summary"],
            "detail": item["rationale"],
        }
        for item in open_blockers
    )
    if error:
        blockers.append(
            {
                "summary": "实操审计输入无效",
                "detail": error,
            }
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
        "phase": "R001-07",
        "bom": ["R001-J06"],
        "spec": [
            "docs/architecture/engineering/acceptance/execution-plans/"
            "20261017-release-0.0.1-mobile-ios-desktop/tasks/R001-07-UX.md",
            "docs/client/common/ux-design-methodology.md",
        ],
        "sampleEmissionAllowed": passed,
        "source": dict(source),
        "uxVerdict": "通过" if passed else "不可判定",
        "reviewer": review.get("reviewer") if review else None,
        "journeyCount": len(journeys),
        "journeys": journeys,
        "fixedDefects": fixed_defects,
        "openBlockers": blockers,
        "preservedDesigns": preserved,
        "roadmap": roadmap,
        "evidenceGates": [item.summary() for item in evidence],
        "assertions": [
            {
                "name": f"current-source-{item.gate_id}",
                "passed": item.status == "PASS",
                "detail": item.detail,
            }
            for item in evidence
        ]
        + [
            {
                "name": "complete-desktop-ios-operation-matrix",
                "passed": len(journeys) == len(REQUIRED_JOURNEYS),
                "detail": (
                    f"{len(journeys)}/{len(REQUIRED_JOURNEYS)} journey cells"
                ),
            },
            {
                "name": "no-open-release-defect",
                "passed": not open_blockers,
                "detail": f"{len(open_blockers)} open release defects",
            },
        ],
    }


def _judgment_lines(items: list[Mapping[str, Any]]) -> list[str]:
    if not items:
        return ["- 无"]
    return [
        (
            f"- **{item.get('summary', '未命名')}**："
            f"{item.get('rationale', item.get('detail', ''))}"
            + (
                f"（影响：{item['affectedUsers']}）"
                if item.get("affectedUsers")
                else ""
            )
        )
        for item in items
    ]


def render_markdown(report: Mapping[str, Any]) -> str:
    lines = [
        "# Peers Touch 0.0.1 Desktop + iOS 实操与 UX 分析",
        "",
        f"> UX 审计结论：**{report['uxVerdict']}**",
        "",
        "## 关键 Journey",
        "",
    ]
    for journey in report["journeys"]:
        lines.extend(
            [
                f"### {journey['journeyId']} · {journey['platform']}",
                "",
                f"- 任务：{journey['goal']}",
                f"- 结果：{'完成' if journey['completed'] else '未完成'}",
                f"- 用时：{journey['durationSeconds']} 秒",
                f"- 可发现性：{journey['discoverability']}",
                f"- 反馈：{journey['feedback']}",
                f"- 恢复：{journey['recovery']}",
                (
                    f"- [截图]({_evidence_uri(journey['screenshot'])}) · "
                    f"[操作轨迹]({_evidence_uri(journey['interactionTrace'])})"
                ),
                "",
                "**测量事实**",
                *[f"- {item}" for item in journey["facts"]],
                "",
                "**直接观察**",
                *[f"- {item}" for item in journey["observations"]],
                "",
                "**评审判断**",
                *_judgment_lines(journey["judgments"]),
                "",
            ]
        )
    lines.extend(
        [
            "## 已修复发布缺陷",
            "",
            *_judgment_lines(report["fixedDefects"]),
            "",
            "## 未解决发布阻塞",
            "",
            *_judgment_lines(report["openBlockers"]),
            "",
            "## 保留的好设计",
            "",
            *_judgment_lines(report["preservedDesigns"]),
            "",
            "## 下阶段 UX 路线图",
            "",
            "### 下一阶段必须做",
            *_judgment_lines(report["roadmap"]["must"]),
            "",
            "### 应该做",
            *_judgment_lines(report["roadmap"]["should"]),
            "",
            "### 可以做",
            *_judgment_lines(report["roadmap"]["could"]),
            "",
            "## 技术证据附录",
            "",
        ]
    )
    lines.extend(
        f"- `{item['gate_id']}`：{item['status']}，run `{item['run_id']}`"
        for item in report["evidenceGates"]
    )
    return "\n".join(lines) + "\n"


def render_html(report: Mapping[str, Any]) -> str:
    markdown = render_markdown(report)
    link_pattern = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

    def linkify(line: str) -> str:
        parts: list[str] = []
        offset = 0
        for match in link_pattern.finditer(line):
            parts.append(html.escape(line[offset : match.start()]))
            parts.append(
                '<a href="'
                + html.escape(match.group(2), quote=True)
                + '">'
                + html.escape(match.group(1))
                + "</a>"
            )
            offset = match.end()
        parts.append(html.escape(line[offset:]))
        return "".join(parts)

    rendered_lines: list[str] = []
    for line in markdown.splitlines():
        if line.startswith("### "):
            rendered_lines.append(f"<h3>{linkify(line[4:])}</h3>")
        elif line.startswith("## "):
            rendered_lines.append(f"<h2>{linkify(line[3:])}</h2>")
        elif line.startswith("# "):
            rendered_lines.append(f"<h1>{linkify(line[2:])}</h1>")
        elif line.startswith("> "):
            rendered_lines.append(
                f"<blockquote>{linkify(line[2:])}</blockquote>"
            )
        elif line.startswith("- "):
            rendered_lines.append(f"<p>• {linkify(line[2:])}</p>")
        elif line:
            rendered_lines.append(f"<p>{linkify(line)}</p>")
        else:
            rendered_lines.append("<br>")
    body = "\n".join(rendered_lines)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Peers Touch 0.0.1 Desktop + iOS 实操与 UX 分析</title>
<style>
body {{ font: 15px/1.65 -apple-system, BlinkMacSystemFont, sans-serif; color: #17202a; margin: 0 auto; max-width: 960px; padding: 40px 24px; }}
p {{ margin: 0 0 8px; overflow-wrap: anywhere; }}
</style>
</head>
<body>{body}</body>
</html>
"""


validate_analysis_report = validate_operation_analysis_report


class OperationAnalysisGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "R001-07"
    bom = ("R001-J06",)
    spec = (
        "docs/architecture/engineering/acceptance/execution-plans/"
        "20261017-release-0.0.1-mobile-ios-desktop/tasks/R001-07-UX.md",
        "docs/client/common/ux-design-methodology.md",
    )

    def __init__(
        self,
        *,
        store: EvidenceStore | None = None,
        expected_source: Mapping[str, str] | None = None,
        review_input: Path | None = None,
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
        input_value = os.environ.get(REVIEW_INPUT_ENV, "").strip()
        self.review_input = review_input or (
            Path(input_value) if input_value else None
        )

    def run(self) -> dict[str, Any]:
        raise GateError(
            "OperationAnalysisGate uses its evidence-aware execute entrypoint"
        )

    def evaluate(self) -> tuple[dict[str, Any], dict[str, Any] | None]:
        inspections = [
            inspect_gate(
                self.store,
                gate_id,
                expected_source=self.expected_source,
                require_canonical_report=True,
            )
            for gate_id in REQUIRED_EVIDENCE_GATES
        ]
        review: dict[str, Any] | None = None
        error = ""
        try:
            if self.review_input is None:
                raise GateError(f"{REVIEW_INPUT_ENV} is required")
            review = validate_review_input(
                load_review_input(self.review_input),
                store=self.store,
                expected_source=self.expected_source,
            )
        except GateError as caught:
            error = str(caught)
        return (
            build_report(
                source=self.expected_source,
                evidence=inspections,
                review=review,
                error=error,
            ),
            review,
        )

    def execute(self) -> int:
        report, review = self.evaluate()
        with ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
            source=self.expected_source,
        ) as artifacts:
            if review is not None:
                artifacts.write_json(
                    "release-0.0.1/operation-review-input.json",
                    {
                        "artifactKind": "release-operation-review-input",
                        "schemaVersion": 1,
                        "planId": PLAN_ID,
                        "source": self.expected_source,
                        **review,
                    },
                    role=INPUT_ROLE,
                )
            artifacts.write_json(
                "release-0.0.1/mobile-ios-desktop-operation-analysis.json",
                report,
                role=REPORT_ROLE,
            )
            artifacts.write_bytes(
                "release-0.0.1/mobile-ios-desktop-operation-analysis.md",
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role=MARKDOWN_ROLE,
            )
            artifacts.write_bytes(
                "release-0.0.1/mobile-ios-desktop-operation-analysis.html",
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
                    "journeyCount": report["journeyCount"],
                    "uxVerdict": report["uxVerdict"],
                },
            )
        stream = sys.stdout if report["status"] == "PASS" else sys.stderr
        stream.write(f"{report['status']}: {self.gate_id}\n")
        return 0 if report["status"] == "PASS" else 1


def review_report(path: Path) -> int:
    try:
        value = load_review_input(path)
        validate_analysis_report(
            value,
            store=EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT),
            expected_source=parse_source_environment(
                os.environ.get(AGGREGATE_SOURCE_ENV, ""), fallback=source_identity(REPO_ROOT),
            ),
        )
    except GateError as error:
        print(f"FAIL: {GATE_ID}: {error}", file=sys.stderr)
        return 1
    print(f"PASS: {GATE_ID} report review")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-report", type=Path)
    args = parser.parse_args(argv)
    if args.review_report is not None:
        return review_report(args.review_report)
    return OperationAnalysisGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
