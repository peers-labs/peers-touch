#!/usr/bin/env python3
"""Read canonical Feature declarations and immutable current-source proof."""
from __future__ import annotations

import logging
import sys
from datetime import date
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
from tooling.acceptance.finalizers import load_finalizer_bindings, load_strict_json_object
from tooling.acceptance.core.proof import read_gate_proof

logger = logging.getLogger(__name__)
ACCEPTANCE_ROOT = REPO_ROOT / "tooling/acceptance"
CAPABILITIES_DIR = ACCEPTANCE_ROOT / "capabilities"
FEATURES_DIR = ACCEPTANCE_ROOT / "features"
GATES_FILE = ACCEPTANCE_ROOT / "gates.yaml"
OUTPUT_PATH = REPO_ROOT / "docs/architecture/engineering/acceptance/coverage-report.md"
DOMAIN_ORDER = ["chat", "mobile", "federation", "applet", "station-dashboard"]
DOMAIN_DISPLAY = {
    "chat": "Chat", "mobile": "Mobile", "federation": "Federation",
    "applet": "Applet", "station-dashboard": "Station Dashboard",
}
INFRA_DOMAINS = {"delivery-quality"}


def load_json_or_yaml(path: Path) -> dict:
    return load_strict_json_object(path, str(path))


def load_registered_gates() -> dict[str, dict]:
    return load_json_or_yaml(GATES_FILE)["gates"]


def load_capabilities() -> list:
    return [
        capability
        for path in sorted(CAPABILITIES_DIR.glob("*.yaml"))
        for capability in load_json_or_yaml(path).get("capabilities", [])
    ]


def load_features() -> dict:
    features = {}
    for path in sorted(FEATURES_DIR.glob("*.yaml")):
        feature = load_json_or_yaml(path)
        identity = feature.get("id")
        if not isinstance(identity, str) or not identity or identity in features:
            raise ValueError(f"missing or duplicate Feature identity: {path}")
        features[identity] = feature
    return features


def has_evidence_for_gate(
    gate_id: str, gate_definition: dict | None = None,
    finalizer_binding: Any | None = None, *,
    store: Any = None, current_source: Any = None,
) -> bool:
    from tooling.acceptance.core import EvidenceError, EvidenceStore, source_identity
    try:
        store = store or EvidenceStore.from_environment(repo_root=REPO_ROOT)
        current_source = current_source or source_identity(REPO_ROOT)
        cells = (gate_definition or {}).get("requiredRuntimeCells") or [None]
        for cell in cells:
            read_gate_proof(
                store, gate_id, current_source,
                gate_definition=gate_definition, runtime_cell=cell,
            )
        return True
    except (EvidenceError, KeyError, OSError, TypeError, ValueError):
        return False


def analyze_feature(
    feature_id: str, feature_data: dict,
    registered_gates: dict[str, dict],
    finalizer_bindings: dict[str, Any] | None = None, *,
    gate_proofs: dict[str, bool] | None = None,
) -> dict:
    required = feature_data.get("required_gates", [])
    registered = [gate for gate in required if gate in registered_gates]
    proven = [
        gate for gate in registered
        if (
            gate_proofs.get(gate, False) if gate_proofs is not None else
            has_evidence_for_gate(
                gate, registered_gates[gate], (finalizer_bindings or {}).get(gate),
            )
        )
    ]
    status = (
        "DECLARED" if not required else
        "PARTIAL" if len(registered) < len(required) else
        "COMPLETE" if len(proven) == len(required) else "WIRED"
    )
    return {
        "id": feature_id, "required_gates": required,
        "registered": registered, "proven": proven, "status": status,
    }


def build_domain_report(
    capabilities: list, features: dict, registered_gates: dict[str, dict],
    finalizer_bindings: dict[str, Any] | None = None, *,
    gate_proofs: dict[str, bool] | None = None,
) -> tuple[dict, list]:
    relations: dict[str, set[str]] = {}
    for capability in capabilities:
        for identity in capability.get("features", []):
            domain = capability.get("domain", "unknown")
            relations.setdefault(identity, set()).add(domain)
    domains: dict[str, list] = {}
    infra = []
    for identity, feature in features.items():
        linked = relations.get(identity, set())
        area = feature.get("product_area")
        if area is not None and (not isinstance(area, str) or not area):
            raise ValueError(f"Feature product_area is invalid: {identity}")
        # A Feature is one obligation even when multiple capabilities refer to
        # it. The declared product area groups it; relationships remain visible.
        domain = area or (next(iter(linked)) if len(linked) == 1 else
                          "shared" if linked else "unknown")
        analysis = analyze_feature(
            identity, feature, registered_gates, finalizer_bindings,
            gate_proofs=gate_proofs,
        )
        analysis["domain_relations"] = sorted(linked | ({area} if area else set()))
        (infra if domain in INFRA_DOMAINS else domains.setdefault(domain, [])).append(analysis)
    return domains, infra


def ordered_domains(domain_features: dict) -> list[str]:
    return [domain for domain in DOMAIN_ORDER if domain in domain_features] + sorted(
        set(domain_features) - set(DOMAIN_ORDER)
    )


def compute_summary(domain_features: dict) -> list:
    rows = []
    for domain in ordered_domains(domain_features):
        features = domain_features[domain]
        proven = sum(item["status"] == "COMPLETE" for item in features)
        rows.append({
            "domain": domain, "features": len(features),
            "wired": sum(item["status"] in {"WIRED", "COMPLETE"} for item in features),
            "proven": proven, "coverage": proven / len(features) * 100 if features else 0,
        })
    total = {key: sum(row[key] for row in rows) for key in ("features", "wired", "proven")}
    rows.append({
        "domain": "**Total**", **total,
        "coverage": total["proven"] / total["features"] * 100 if total["features"] else 0,
    })
    return rows


def format_gate_list(gates: list) -> str:
    return ", ".join(f"`{gate}`" for gate in gates) or "-"


def generate_report(domain_features: dict, infra_features: list) -> str:
    lines = [
        "# Acceptance Coverage Report", "",
        "> Auto-generated by `tooling/scripts/acceptance-coverage-report.py`",
        f"> Last updated: {date.today().isoformat()}", "",
        f"Declared Features: {sum(map(len, domain_features.values())) + len(infra_features)}. "
        f"Core self-validation Features: {len(infra_features)}.", "",
        "## Summary", "",
        "| Domain | Features | Wired | Proven | Coverage |",
        "|--------|----------|-------|--------|----------|",
    ]
    for row in compute_summary(domain_features):
        lines.append(
            f"| {DOMAIN_DISPLAY.get(row['domain'], row['domain'])} | {row['features']} | "
            f"{row['wired']} | {row['proven']} | {row['coverage']:.0f}% |"
        )
    lines += ["", "## Infra (Core Self-Validation)", "",
              "| Feature | Gates | Registered | Status |",
              "|---------|-------|------------|--------|"]
    for feature in infra_features:
        lines.append(
            f"| `{feature['id']}` | {format_gate_list(feature['required_gates'])} | "
            f"{len(feature['registered'])}/{len(feature['required_gates'])} | {feature['status']} |"
        )
    for domain in ordered_domains(domain_features):
        lines += ["", f"## {DOMAIN_DISPLAY.get(domain, domain)}", "",
                  "| Feature | Required Gates | Registered | Proven | Status | Domain relationships |",
                  "|---------|---------------|------------|--------|--------|----------------------|"]
        for feature in sorted(domain_features[domain], key=lambda item: item["id"]):
            count = len(feature["required_gates"])
            lines.append(
                f"| `{feature['id']}` | {format_gate_list(feature['required_gates'])} | "
                f"{len(feature['registered'])}/{count} | {len(feature['proven'])}/{count} | "
                f"{feature['status']} | {', '.join(feature.get('domain_relations', [])) or '-'} |"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    from tooling.acceptance.core import EvidenceError, EvidenceStore, source_identity
    logging.basicConfig(level=logging.INFO)
    try:
        gates = load_registered_gates()
        bindings = dict(load_finalizer_bindings(ACCEPTANCE_ROOT, gates))
        features = load_features()
        if not features:
            raise ValueError("no Feature declarations")
        # One source snapshot and one assessment per unique Gate per report.
        source = source_identity(REPO_ROOT)
        store = EvidenceStore.from_environment(repo_root=REPO_ROOT)
        proofs = {
            gate: has_evidence_for_gate(
                gate, gates[gate], bindings.get(gate), store=store, current_source=source,
            )
            for gate in sorted({
                gate for feature in features.values()
                for gate in feature.get("required_gates", []) if gate in gates
            })
        }
        domains, infra = build_domain_report(
            load_capabilities(), features, gates, bindings, gate_proofs=proofs,
        )
        if source != source_identity(REPO_ROOT):
            raise ValueError("source changed during coverage assessment")
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(generate_report(domains, infra), encoding="utf-8")
        return 0
    except (EvidenceError, OSError, TypeError, ValueError) as error:
        logger.error("coverage assessment failed closed: %s", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
