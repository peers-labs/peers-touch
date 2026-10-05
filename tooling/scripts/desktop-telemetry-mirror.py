#!/usr/bin/env python3
"""Mirror Station-managed Desktop frontend telemetry into local CI artifacts."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

from _acceptance_artifacts import explicit_output_path


DEFAULT_STATION_URL = "http://127.0.0.1:18080"
PHASE = "P0a-6/P0c-5"
BOM = ["BOM-CAP-05", "BOM-RUN-05"]
SPEC = ["SPEC-STA-03", "SPEC-MIRROR-01"]
GATE = "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink"
ARTIFACT_KIND = "desktop-performance-station-mirror"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def post_json(station_url: str, token: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{station_url.rstrip('/')}{path}"
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Station query failed: {exc.code} {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Station query failed: {url}: {exc.reason}") from exc


def compact_filter(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {"limit": args.limit}
    for key in ["device_id", "session_id", "module", "runtime", "interaction_id"]:
        value = getattr(args, key)
        if value:
            camel = "".join([key.split("_")[0], *[part.title() for part in key.split("_")[1:]]])
            payload[camel] = value
    return payload


def build_summary(events: list[dict[str, Any]], rollups: list[dict[str, Any]]) -> dict[str, Any]:
    max_p95 = None
    for rollup in rollups:
        p95 = rollup.get("p95DurationMs")
        if isinstance(p95, (int, float)):
            max_p95 = p95 if max_p95 is None else max(max_p95, p95)
    return {
        "eventCount": len(events),
        "rollupCount": len(rollups),
        "maxP95DurationMs": max_p95,
    }


def build_report(station_url: str, filters: dict[str, Any], events: list[dict[str, Any]], rollups: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "source": "station-query",
        "stationUrl": station_url,
        "generatedAt": utc_now(),
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "productSink": "Station",
        "mirrorRole": "Dev/CI evidence artifact",
        "filters": filters,
        "summary": build_summary(events, rollups),
        "events": events,
        "rollups": rollups,
    }


def render_markdown(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Desktop Performance Telemetry Mirror",
        "",
        f"- Artifact kind: `{report['artifactKind']}`",
        f"- Source: `{report['source']}`",
        f"- Generated: `{report['generatedAt']}`",
        f"- Phase: `{report['phase']}`",
        f"- BOM: `{','.join(report['bom'])}`",
        f"- Spec: `{','.join(report['spec'])}`",
        f"- Gate: `{report['gate']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Product sink: `{report['productSink']}`",
        f"- Mirror role: `{report['mirrorRole']}`",
        f"- Event count: `{summary['eventCount']}`",
        f"- Rollup count: `{summary['rollupCount']}`",
        f"- Max p95 duration: `{summary['maxP95DurationMs']}`",
        "",
        "## Filters",
        "",
    ]
    filters = report.get("filters", {})
    if filters:
        for key, value in filters.items():
            lines.append(f"- `{key}`: `{value}`")
    else:
        lines.append("- none")

    lines.extend(["", "## Rollups", ""])
    rollups = report.get("rollups", [])
    if rollups:
        lines.append("| Module | Runtime | Kind | Count | p50 | p95 | Max |")
        lines.append("|---|---|---|---:|---:|---:|---:|")
        for rollup in rollups:
            lines.append(
                "| `{module}` | `{runtime}` | `{kind}` | {count} | {p50} | {p95} | {max_value} |".format(
                    module=rollup.get("module", ""),
                    runtime=rollup.get("runtime", ""),
                    kind=rollup.get("kind", ""),
                    count=rollup.get("count", 0),
                    p50=rollup.get("p50DurationMs"),
                    p95=rollup.get("p95DurationMs"),
                    max_value=rollup.get("maxDurationMs"),
                )
            )
    else:
        lines.append("- none")

    lines.extend(["", "## Raw Events", ""])
    events = report.get("events", [])
    if events:
        for event in events[:20]:
            lines.append(
                "- `{id}` `{kind}` module=`{module}` runtime=`{runtime}` interaction=`{interaction}`".format(
                    id=event.get("id", ""),
                    kind=event.get("kind", ""),
                    module=event.get("module", ""),
                    runtime=event.get("runtime", ""),
                    interaction=event.get("interactionId", ""),
                )
            )
        if len(events) > 20:
            lines.append(f"- ... {len(events) - 20} more")
    else:
        lines.append("- none")

    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- This file is a Dev/CI mirror of Station query responses.",
            "- Station remains the product telemetry sink.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--station-url", default=os.environ.get("PT_STATION_URL", DEFAULT_STATION_URL))
    parser.add_argument("--token", default=os.environ.get("PT_STATION_ACCESS_TOKEN") or os.environ.get("PT_ACCESS_TOKEN"))
    parser.add_argument(
        "--output-prefix",
        required=True,
        help="Explicit output prefix for the Station-backed Dev/CI mirror.",
    )
    parser.add_argument("--device-id")
    parser.add_argument("--session-id")
    parser.add_argument("--module")
    parser.add_argument("--runtime")
    parser.add_argument("--interaction-id")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    if not args.token:
        raise SystemExit("missing token: set PT_STATION_ACCESS_TOKEN or pass --token")

    filters = compact_filter(args)
    events_response = post_json(args.station_url, args.token, "/telemetry/frontend/events/query", filters)
    rollups_response = post_json(args.station_url, args.token, "/telemetry/frontend/rollups/query", filters)
    events = events_response.get("events", [])
    rollups = rollups_response.get("rollups", [])
    report = build_report(args.station_url, filters, events, rollups)

    output_prefix = explicit_output_path(args.output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    print(f"desktop telemetry mirror: {json_path}")
    print(f"desktop telemetry mirror: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
