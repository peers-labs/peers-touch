#!/usr/bin/env python3
"""Validate the source-backed MCA-D11 orchestration entrypoint inventory."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


DEFAULT_FIXTURE = Path("tooling/acceptance/fixtures/agent_d11_entrypoints.yaml")
ENTRY_KEYS = {
    "id",
    "surface",
    "source",
    "symbol",
    "target",
    "disposition",
    "expected_fragments",
    "route",
    "command",
    "handler",
    "input_type",
    "guard",
    "known_defect",
}
GUARD_REQUIRED_KEYS = {"scope_source", "scope_symbol", "first_effect", "current_state"}
GUARD_OPTIONAL_KEYS = {"core_symbol"}
KNOWN_DEFECT_KEYS = {"id", "observed_fragments"}
TOP_LEVEL_KEYS = {
    "version",
    "guard_symbol",
    "allowed_dispositions",
    "route_sets",
    "entrypoints",
    "atelier_aliases",
    "tooling_only",
}
GUARDED_DISPOSITIONS = {"guarded", "guarded-forwarder"}


@dataclass(frozen=True)
class Issue:
    code: str
    item: str
    message: str
    enforcement_only: bool = False
    known_defect: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "item": self.item,
            "message": self.message,
            "enforcementOnly": self.enforcement_only,
            "knownDefect": self.known_defect,
        }


def _mapping(value: Any, label: str, issues: list[Issue]) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    issues.append(Issue("SCHEMA_TYPE", label, "must be a mapping"))
    return {}


def _list(value: Any, label: str, issues: list[Issue]) -> list[Any]:
    if isinstance(value, list):
        return value
    issues.append(Issue("SCHEMA_TYPE", label, "must be a list"))
    return []


def _required_string(
    mapping: dict[str, Any], key: str, label: str, issues: list[Issue]
) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        issues.append(Issue("SCHEMA_REQUIRED", label, f"{key} must be a non-empty string"))
        return ""
    return value


def validate_schema(raw: Any) -> tuple[dict[str, Any], list[Issue]]:
    issues: list[Issue] = []
    data = _mapping(raw, "fixture", issues)
    unknown = sorted(set(data) - TOP_LEVEL_KEYS)
    if unknown:
        issues.append(Issue("SCHEMA_UNKNOWN_KEY", "fixture", f"unknown keys: {unknown}"))
    if data.get("version") != 1:
        issues.append(Issue("SCHEMA_VERSION", "fixture", "version must equal 1"))
    guard_symbol = _required_string(data, "guard_symbol", "fixture", issues)
    allowed = _list(data.get("allowed_dispositions"), "allowed_dispositions", issues)
    if len(allowed) != len(set(allowed)) or any(not isinstance(item, str) for item in allowed):
        issues.append(
            Issue(
                "SCHEMA_DISPOSITIONS",
                "allowed_dispositions",
                "must contain unique strings",
            )
        )
    route_sets = _list(data.get("route_sets"), "route_sets", issues)
    route_set_ids: set[str] = set()
    for index, value in enumerate(route_sets):
        label = f"route_sets[{index}]"
        item = _mapping(value, label, issues)
        if set(item) != {"id", "source", "prefix"}:
            issues.append(
                Issue(
                    "SCHEMA_ROUTE_SET",
                    label,
                    "must contain exactly id, source, and prefix",
                )
            )
        route_id = _required_string(item, "id", label, issues)
        _required_string(item, "source", label, issues)
        _required_string(item, "prefix", label, issues)
        if route_id in route_set_ids:
            issues.append(Issue("SCHEMA_DUPLICATE_ID", label, f"duplicate id {route_id}"))
        route_set_ids.add(route_id)

    entrypoints = _list(data.get("entrypoints"), "entrypoints", issues)
    entry_ids: set[str] = set()
    for index, value in enumerate(entrypoints):
        label = f"entrypoints[{index}]"
        entry = _mapping(value, label, issues)
        unknown_entry = sorted(set(entry) - ENTRY_KEYS)
        if unknown_entry:
            issues.append(
                Issue("SCHEMA_UNKNOWN_KEY", label, f"unknown keys: {unknown_entry}")
            )
        entry_id = _required_string(entry, "id", label, issues)
        for key in ("surface", "source", "symbol", "target", "disposition"):
            _required_string(entry, key, label, issues)
        fragments = _list(entry.get("expected_fragments"), f"{label}.expected_fragments", issues)
        if not fragments or any(not isinstance(item, str) or not item for item in fragments):
            issues.append(
                Issue(
                    "SCHEMA_FRAGMENTS",
                    label,
                    "expected_fragments must contain non-empty strings",
                )
            )
        disposition = entry.get("disposition")
        if disposition not in allowed:
            issues.append(
                Issue(
                    "SCHEMA_DISPOSITION",
                    entry_id or label,
                    f"unknown disposition {disposition!r}",
                )
            )
        if entry_id in entry_ids:
            issues.append(Issue("SCHEMA_DUPLICATE_ID", label, f"duplicate id {entry_id}"))
        entry_ids.add(entry_id)
        guard = entry.get("guard")
        if disposition in GUARDED_DISPOSITIONS and not isinstance(guard, dict):
            issues.append(
                Issue("SCHEMA_GUARD", entry_id or label, "guarded entry requires guard metadata")
            )
        if guard is not None:
            guard_mapping = _mapping(guard, f"{label}.guard", issues)
            guard_keys = set(guard_mapping)
            if not GUARD_REQUIRED_KEYS.issubset(guard_keys) or not guard_keys.issubset(
                GUARD_REQUIRED_KEYS | GUARD_OPTIONAL_KEYS
            ):
                issues.append(
                    Issue(
                        "SCHEMA_GUARD",
                        entry_id or label,
                        "guard must contain required keys "
                        f"{sorted(GUARD_REQUIRED_KEYS)} and optional keys "
                        f"{sorted(GUARD_OPTIONAL_KEYS)}",
                    )
                )
            for key in ("scope_source", "scope_symbol", "first_effect"):
                _required_string(guard_mapping, key, f"{label}.guard", issues)
            if "core_symbol" in guard_mapping:
                _required_string(guard_mapping, "core_symbol", f"{label}.guard", issues)
            if guard_mapping.get("current_state") not in {"absent", "before-effect", "after-effect"}:
                issues.append(
                    Issue(
                        "SCHEMA_GUARD_STATE",
                        entry_id or label,
                        "current_state must be absent, before-effect, or after-effect",
                    )
                )
        defect = entry.get("known_defect")
        if defect is not None:
            defect_mapping = _mapping(defect, f"{label}.known_defect", issues)
            if set(defect_mapping) != KNOWN_DEFECT_KEYS:
                issues.append(
                    Issue(
                        "SCHEMA_KNOWN_DEFECT",
                        entry_id or label,
                        f"known_defect must contain exactly {sorted(KNOWN_DEFECT_KEYS)}",
                    )
                )
            _required_string(defect_mapping, "id", f"{label}.known_defect", issues)
            observed = _list(
                defect_mapping.get("observed_fragments"),
                f"{label}.known_defect.observed_fragments",
                issues,
            )
            if not observed or any(not isinstance(item, str) or not item for item in observed):
                issues.append(
                    Issue(
                        "SCHEMA_KNOWN_DEFECT",
                        entry_id or label,
                        "observed_fragments must contain non-empty strings",
                    )
                )

    aliases = _mapping(data.get("atelier_aliases"), "atelier_aliases", issues)
    if set(aliases) != {"source", "symbol", "expected_count", "entries"}:
        issues.append(
            Issue(
                "SCHEMA_ALIASES",
                "atelier_aliases",
                "must contain exactly source, symbol, expected_count, and entries",
            )
        )
    _required_string(aliases, "source", "atelier_aliases", issues)
    _required_string(aliases, "symbol", "atelier_aliases", issues)
    alias_entries = _list(aliases.get("entries"), "atelier_aliases.entries", issues)
    expected_alias_count = aliases.get("expected_count")
    if (
        not isinstance(expected_alias_count, int)
        or expected_alias_count < 0
        or len(alias_entries) != expected_alias_count
    ):
        issues.append(
            Issue(
                "SCHEMA_ALIAS_COUNT",
                "atelier_aliases",
                "expected_count must be a non-negative integer matching the entry count",
            )
        )
    alias_names: set[str] = set()
    for index, value in enumerate(alias_entries):
        label = f"atelier_aliases.entries[{index}]"
        alias = _mapping(value, label, issues)
        if set(alias) != {"alias", "target", "disposition"}:
            issues.append(
                Issue(
                    "SCHEMA_ALIAS",
                    label,
                    "must contain exactly alias, target, and disposition",
                )
            )
        name = _required_string(alias, "alias", label, issues)
        _required_string(alias, "target", label, issues)
        if alias.get("disposition") not in allowed:
            issues.append(
                Issue(
                    "SCHEMA_DISPOSITION",
                    name or label,
                    f"unknown disposition {alias.get('disposition')!r}",
                )
            )
        if name in alias_names:
            issues.append(Issue("SCHEMA_DUPLICATE_ALIAS", label, f"duplicate alias {name}"))
        alias_names.add(name)

    tooling_only = _list(data.get("tooling_only"), "tooling_only", issues)
    for index, value in enumerate(tooling_only):
        label = f"tooling_only[{index}]"
        item = _mapping(value, label, issues)
        if set(item) != {"source", "forbidden_production_root"}:
            issues.append(
                Issue(
                    "SCHEMA_TOOLING_ONLY",
                    label,
                    "must contain exactly source and forbidden_production_root",
                )
            )
        _required_string(item, "source", label, issues)
        _required_string(item, "forbidden_production_root", label, issues)

    if not guard_symbol:
        issues.append(Issue("SCHEMA_GUARD_SYMBOL", "fixture", "guard_symbol is required"))
    return data, issues


def extract_braced_scope(text: str, anchor_start: int, brace: int | None = None) -> str:
    if brace is None:
        brace = text.find("{", anchor_start)
    if brace < 0:
        return text[anchor_start:]
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(brace, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'", "`"}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[anchor_start : index + 1]
    return text[anchor_start:]


def function_body_brace(text: str, parameter_open: int) -> int:
    depth = 0
    parameter_close = -1
    for index in range(parameter_open, len(text)):
        char = text[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                parameter_close = index
                break
    return text.find("{", parameter_close + 1) if parameter_close >= 0 else -1


def find_symbol_scope(text: str, symbol: str) -> str | None:
    escaped = re.escape(symbol)
    patterns = (
        rf"\bfunc\s+(?:\([^)]*\)\s*)?{escaped}\s*\(",
        rf"\b(?:pub\s+)?fn\s+{escaped}\s*\(",
        rf"\bconst\s+{escaped}\s*=",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            if "const" not in match.group(0):
                brace = function_body_brace(text, match.end() - 1)
                if brace < 0:
                    return None
                return extract_braced_scope(text, match.start(), brace)
            return extract_braced_scope(text, match.start())
    return None


def find_gateway_arm(text: str, command: str) -> str | None:
    match = re.search(rf'"{re.escape(command)}"\s*=>\s*\{{', text)
    if not match:
        return None
    return extract_braced_scope(text, match.start())


def entry_scope(entry: dict[str, Any], text: str) -> str:
    if entry.get("surface") == "browser-gateway" and entry.get("command"):
        return find_gateway_arm(text, entry["command"]) or ""
    if entry.get("surface") in {
        "tauri-commands",
        "canvas-web",
        "station-recovery",
        "station-service",
        "station-scheduler",
        "station-execution",
        "desktop-rust-worker",
    }:
        return find_symbol_scope(text, entry["symbol"]) or ""
    return text


class Checker:
    def __init__(self, repo_root: Path, fixture_path: Path, inventory_only: bool):
        self.repo_root = repo_root.resolve()
        self.fixture_path = fixture_path
        self.inventory_only = inventory_only
        self.data: dict[str, Any] = {}
        self.issues: list[Issue] = []
        self._cache: dict[str, str] = {}

    def read(self, relative: str, item: str) -> str:
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts:
            self.issues.append(
                Issue("SOURCE_PATH", item, f"source must be repo-relative: {relative}")
            )
            return ""
        if relative in self._cache:
            return self._cache[relative]
        full = self.repo_root / path
        if not full.is_file():
            self.issues.append(Issue("SOURCE_MISSING", item, f"missing source {relative}"))
            return ""
        text = full.read_text(encoding="utf-8")
        self._cache[relative] = text
        return text

    def load(self) -> None:
        path = self.fixture_path
        if not path.is_absolute():
            path = self.repo_root / path
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as error:
            self.issues.append(Issue("FIXTURE_LOAD", str(path), str(error)))
            return
        self.data, schema_issues = validate_schema(raw)
        self.issues.extend(schema_issues)

    def validate_entrypoints(self) -> None:
        guard_symbol = self.data["guard_symbol"]
        for entry in self.data["entrypoints"]:
            item = entry["id"]
            text = self.read(entry["source"], item)
            scope = entry_scope(entry, text)
            if not scope:
                self.issues.append(
                    Issue(
                        "ENTRYPOINT_SYMBOL_MISSING",
                        item,
                        f"cannot locate {entry['symbol']} in {entry['source']}",
                    )
                )
                continue
            missing = [
                fragment
                for fragment in entry["expected_fragments"]
                if fragment not in scope
            ]
            if missing:
                defect = entry.get("known_defect")
                observed = defect and all(
                    fragment in scope for fragment in defect["observed_fragments"]
                )
                if observed:
                    self.issues.append(
                        Issue(
                            "KNOWN_ROUTE_DEFECT",
                            item,
                            f"{defect['id']}: expected {missing}; observed known defective forwarding",
                            known_defect=True,
                        )
                    )
                else:
                    self.issues.append(
                        Issue(
                            "ENTRYPOINT_TARGET_MISMATCH",
                            item,
                            f"missing source fragments: {missing}",
                        )
                    )
            self.validate_handler_target(entry)
            guard = entry.get("guard")
            if guard:
                state = self.guard_state(guard, guard_symbol, item)
                if state != guard["current_state"]:
                    self.issues.append(
                        Issue(
                            "GUARD_STATE_DRIFT",
                            item,
                            f"fixture records {guard['current_state']}, source is {state}",
                        )
                    )
                if not self.inventory_only and state != "before-effect":
                    self.issues.append(
                        Issue(
                            "GUARD_ENFORCEMENT",
                            item,
                            f"{guard_symbol} must precede {guard['first_effect']}; source is {state}",
                            enforcement_only=True,
                        )
                    )

    def validate_handler_target(self, entry: dict[str, Any]) -> None:
        handler = entry.get("handler")
        target = entry.get("target")
        if not handler or handler == target:
            return
        candidate_paths = (
            "apps/station/app/subserver/agent/handler/orchestration_handler.go",
            "apps/station/app/subserver/agent/handler/atelier_projection_handler.go",
            "apps/station/app/subserver/official_applets/atelier.go",
        )
        for relative in candidate_paths:
            text = self.read(relative, entry["id"])
            scope = find_symbol_scope(text, handler)
            if scope is not None:
                if target not in scope:
                    self.issues.append(
                        Issue(
                            "HANDLER_TARGET_MISMATCH",
                            entry["id"],
                            f"{handler} does not call {target}",
                        )
                    )
                return
        self.issues.append(
            Issue(
                "HANDLER_SYMBOL_MISSING",
                entry["id"],
                f"cannot locate handler {handler}",
            )
        )

    def guard_state(
        self, guard: dict[str, str], guard_symbol: str, item: str
    ) -> str:
        text = self.read(guard["scope_source"], item)
        scope = find_symbol_scope(text, guard["scope_symbol"])
        if scope is None:
            self.issues.append(
                Issue(
                    "GUARD_SCOPE_MISSING",
                    item,
                    f"cannot locate guard scope {guard['scope_symbol']}",
                )
            )
            return "absent"
        effect_scope = scope
        core_symbol = guard.get("core_symbol")
        if core_symbol:
            core_index = scope.find(core_symbol)
            guard_index = scope.find(guard_symbol)
            if core_index < 0:
                self.issues.append(
                    Issue(
                        "GUARD_CORE_CALL_MISSING",
                        item,
                        f"cannot locate core call {core_symbol!r} in {guard['scope_symbol']}",
                    )
                )
                return "absent"
            if guard_index < 0:
                return "absent"
            if guard_index > core_index:
                return "after-effect"
            effect_scope = find_symbol_scope(text, core_symbol) or ""
            if not effect_scope:
                self.issues.append(
                    Issue(
                        "GUARD_CORE_SCOPE_MISSING",
                        item,
                        f"cannot locate core scope {core_symbol!r}",
                    )
                )
                return "absent"
        effect_index = effect_scope.find(guard["first_effect"])
        if effect_index < 0:
            self.issues.append(
                Issue(
                    "FIRST_EFFECT_MISSING",
                    item,
                    f"cannot locate first effect {guard['first_effect']!r}",
                )
            )
            return "absent"
        guard_index = scope.find(guard_symbol)
        if guard_index < 0:
            return "absent"
        if core_symbol:
            return "before-effect"
        return "before-effect" if guard_index < effect_index else "after-effect"

    def validate_discovered_routes(self) -> None:
        expected: dict[str, set[str]] = {}
        for entry in self.data["entrypoints"]:
            surface = entry["surface"]
            value = entry.get("route") or entry.get("command")
            if value:
                expected.setdefault(surface, set()).add(value)

        agent_text = self.read(
            "apps/station/app/subserver/agent/agent.go", "station-generic"
        )
        actual_generic = set(
            re.findall(r'"(/agent/(?:collaboration|atelier)/[^"]+)"', agent_text)
        )
        self.compare_set(
            "station-generic", actual_generic, expected.get("station-generic", set())
        )

        official_text = self.read(
            "apps/station/app/subserver/official_applets/atelier.go",
            "station-official-atelier",
        )
        official_handlers = find_symbol_scope(official_text, "Handlers") or ""
        actual_official = {
            "/applets/atelier/v1" + suffix
            for suffix in re.findall(
                r'atelierV1Prefix\s*\+\s*"([^"]+)"', official_handlers
            )
        }
        self.compare_set(
            "station-official-atelier",
            actual_official,
            expected.get("station-official-atelier", set()),
        )

        gateway_text = self.read(
            "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
            "browser-gateway",
        )
        actual_gateway = set(
            re.findall(r'"(agent_collaboration_[a-z0-9_]+)"\s*=>', gateway_text)
        )
        self.compare_set(
            "browser-gateway",
            actual_gateway,
            expected.get("browser-gateway", set()),
        )

        tauri_text = self.read(
            "apps/desktop/src-tauri/src/interface/tauri_commands/agent_orchestration.rs",
            "tauri-commands",
        )
        actual_tauri = set(
            re.findall(r"pub fn (agent_collaboration_[a-z0-9_]+)\s*\(", tauri_text)
        )
        self.compare_set(
            "tauri-commands", actual_tauri, expected.get("tauri-commands", set())
        )
        main_text = self.read(
            "apps/desktop/src-tauri/src/main.rs", "tauri-main-registration"
        )
        actual_main = set(
            re.findall(
                r"agent_orchestration::(agent_collaboration_[a-z0-9_]+)",
                main_text,
            )
        )
        self.compare_set(
            "tauri-main-registration",
            actual_main,
            expected.get("tauri-commands", set()),
        )

    def compare_set(self, item: str, actual: set[str], expected: set[str]) -> None:
        missing = sorted(expected - actual)
        unregistered = sorted(actual - expected)
        if missing:
            self.issues.append(
                Issue("DISCOVERY_MISSING", item, f"fixture entries absent from source: {missing}")
            )
        if unregistered:
            self.issues.append(
                Issue(
                    "DISCOVERY_UNREGISTERED",
                    item,
                    f"source entrypoints absent from fixture: {unregistered}",
                )
            )

    def validate_aliases(self) -> None:
        aliases = self.data["atelier_aliases"]
        text = self.read(aliases["source"], "atelier_aliases")
        scope = find_symbol_scope(text, aliases["symbol"])
        if scope is None:
            self.issues.append(
                Issue(
                    "ALIAS_SCOPE_MISSING",
                    "atelier_aliases",
                    f"cannot locate {aliases['symbol']}",
                )
            )
            return
        matches = list(
            re.finditer(
                r'((?:"[^"]+"\s*(?:\|\s*)?)+)\s*=>',
                scope,
            )
        )
        actual: dict[str, str] = {}
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(scope)
            arm = scope[match.start() : end]
            names = re.findall(r'"([^"]+)"', match.group(1))
            target_match = re.search(r'"(/sub-agent/agent/atelier/[^"]+)"', arm)
            if target_match:
                target = target_match.group(1)
            else:
                target = next(
                    (
                        candidate
                        for candidate in (
                            "handle_atelier_workspace_open",
                            "handle_atelier_artifact_preview_open",
                        )
                        if candidate in arm
                    ),
                    "",
                )
            for name in names:
                actual[name] = target
        expected = {entry["alias"]: entry["target"] for entry in aliases["entries"]}
        self.compare_set("atelier_aliases", set(actual), set(expected))
        for name in sorted(set(actual) & set(expected)):
            if actual[name] != expected[name]:
                self.issues.append(
                    Issue(
                        "ALIAS_TARGET_MISMATCH",
                        name,
                        f"expected {expected[name]}, found {actual[name] or '<unknown>'}",
                    )
                )
        if len(actual) != aliases["expected_count"]:
            self.issues.append(
                Issue(
                    "ALIAS_COUNT",
                    "atelier_aliases",
                    f"expected {aliases['expected_count']}, found {len(actual)}",
                )
            )

    def validate_tooling_only(self) -> None:
        for item in self.data["tooling_only"]:
            source = item["source"]
            self.read(source, source)
            root = self.repo_root / item["forbidden_production_root"]
            source_parent = (self.repo_root / source).parent.resolve()
            references: list[str] = []
            for path in root.rglob("*.go"):
                if path.resolve().is_relative_to(source_parent) or path.name.endswith("_test.go"):
                    continue
                text = path.read_text(encoding="utf-8")
                if "atelier_gate_server" in text:
                    references.append(str(path.relative_to(self.repo_root)))
            if references:
                self.issues.append(
                    Issue(
                        "TOOLING_REACHABLE",
                        source,
                        f"tooling-only server referenced by production sources: {references}",
                    )
                )

    def run(self) -> dict[str, Any]:
        self.load()
        if not any(issue.code.startswith("SCHEMA") or issue.code == "FIXTURE_LOAD" for issue in self.issues):
            self.validate_entrypoints()
            self.validate_discovered_routes()
            self.validate_aliases()
            self.validate_tooling_only()
        hard_failures = [
            issue
            for issue in self.issues
            if not issue.known_defect
            and not (self.inventory_only and issue.enforcement_only)
        ]
        if not self.inventory_only:
            hard_failures.extend(issue for issue in self.issues if issue.known_defect)
        known_defects = [issue for issue in self.issues if issue.known_defect]
        guard_entries = [
            entry for entry in self.data.get("entrypoints", []) if entry.get("guard")
        ]
        return {
            "mode": "inventory-only" if self.inventory_only else "enforcement",
            "status": "pass" if not hard_failures else "fail",
            "entrypointCount": len(self.data.get("entrypoints", [])),
            "atelierAliasCount": len(
                self.data.get("atelier_aliases", {}).get("entries", [])
            ),
            "guardedEntrypointCount": len(guard_entries),
            "knownDefectCount": len(known_defects),
            "knownDefects": [issue.as_dict() for issue in known_defects],
            "issues": [issue.as_dict() for issue in self.issues],
        }


def render(report: dict[str, Any]) -> str:
    lines = [
        (
            f"agent D11 entrypoints: {report['status'].upper()} "
            f"mode={report['mode']} entrypoints={report['entrypointCount']} "
            f"aliases={report['atelierAliasCount']} guarded={report['guardedEntrypointCount']}"
        )
    ]
    for issue in report["issues"]:
        level = "KNOWN DEFECT" if issue["knownDefect"] else "ERROR"
        if issue["enforcementOnly"]:
            level = "ENFORCEMENT"
        lines.append(f"{level} {issue['code']} [{issue['item']}]: {issue['message']}")
    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    checker = Checker(args.repo_root, args.fixture, args.inventory_only)
    report = checker.run()
    print(json.dumps(report, indent=2, sort_keys=True) if args.json else render(report))
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
