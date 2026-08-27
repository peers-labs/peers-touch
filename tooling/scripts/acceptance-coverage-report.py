#!/usr/bin/env python3
"""
Acceptance Coverage Report Generator

Reads capability, feature, and gate declarations from tooling/acceptance/
and produces a Markdown coverage report grouped by domain.

Usage:
    python3 tooling/scripts/acceptance-coverage-report.py
"""

import json
import logging
import os
import sys
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ACCEPTANCE_ROOT = REPO_ROOT / "tooling" / "acceptance"
CAPABILITIES_DIR = ACCEPTANCE_ROOT / "capabilities"
FEATURES_DIR = ACCEPTANCE_ROOT / "features"
GATES_FILE = ACCEPTANCE_ROOT / "gates.yaml"
EVIDENCE_DIR = ACCEPTANCE_ROOT / "evidence"
OUTPUT_PATH = REPO_ROOT / "docs" / "architecture" / "acceptance-framework" / "coverage-report.md"

# Domain display order and mapping
DOMAIN_ORDER = ["chat", "federation", "applet", "station-dashboard"]
DOMAIN_DISPLAY = {
    "chat": "Chat",
    "federation": "Federation",
    "applet": "Applet",
    "station-dashboard": "Station Dashboard",
}
INFRA_DOMAINS = {"delivery-quality"}


# ---------------------------------------------------------------------------
# YAML/JSON loading (gates.yaml and capabilities are actually JSON despite .yaml ext)
# ---------------------------------------------------------------------------


def load_json_or_yaml(path: Path) -> dict:
    """Load a file as JSON first; fall back to YAML if JSON fails."""
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Fallback: try PyYAML
    try:
        import yaml
        return yaml.safe_load(text) or {}
    except ImportError:
        logger.error("File %s is not valid JSON and PyYAML is not available.", path)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Data collection
# ---------------------------------------------------------------------------


def load_registered_gates() -> set:
    """Return the set of gate IDs registered in gates.yaml."""
    if not GATES_FILE.exists():
        logger.warning("gates.yaml not found at %s", GATES_FILE)
        return set()
    data = load_json_or_yaml(GATES_FILE)
    gates = data.get("gates", {})
    return set(gates.keys())


def load_capabilities() -> list:
    """Load all capability declarations from capabilities/*.yaml."""
    capabilities = []
    if not CAPABILITIES_DIR.exists():
        return capabilities
    for f in sorted(CAPABILITIES_DIR.glob("*.yaml")):
        data = load_json_or_yaml(f)
        for cap in data.get("capabilities", []):
            capabilities.append(cap)
    return capabilities


def load_features() -> dict:
    """Load all feature declarations. Returns {feature_id: feature_dict}."""
    features = {}
    if not FEATURES_DIR.exists():
        return features
    for f in sorted(FEATURES_DIR.glob("*.yaml")):
        data = load_json_or_yaml(f)
        fid = data.get("id")
        if fid:
            features[fid] = data
    return features


def has_evidence_for_gate(gate_id: str) -> bool:
    """
    Heuristic check: does evidence exist for the given gate?
    We check for JSON evidence files that reference the gate name, or evidence
    directories with matching names.
    """
    if not EVIDENCE_DIR.exists():
        return False

    # Check for any JSON file containing gate references
    gate_slug = gate_id.replace("-", "_")
    gate_kebab = gate_id

    for json_file in EVIDENCE_DIR.rglob("*.json"):
        try:
            content = json_file.read_text(encoding="utf-8")
            data = json.loads(content)
            # Evidence JSON files often have a "gate" or "status" field
            if isinstance(data, dict):
                if data.get("gate") == gate_id or data.get("gate") == gate_kebab:
                    if data.get("status") == "PASS":
                        return True
                # Also check "result" field
                if data.get("result") == "PASS" and gate_id in content:
                    return True
        except (json.JSONDecodeError, OSError):
            continue

    # Check for directory-based evidence matching gate slug
    for d in EVIDENCE_DIR.rglob("*"):
        if d.is_dir() and (gate_slug in d.name or gate_kebab in d.name):
            # If directory has files, consider evidence exists
            if any(d.iterdir()):
                return True

    return False


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def analyze_feature(feature_id: str, feature_data: dict, registered_gates: set) -> dict:
    """
    Analyze a single feature and determine its coverage state.

    Returns dict with: id, required_gates, registered (list), proven (list), status
    """
    required_gates = feature_data.get("required_gates", [])

    registered = [g for g in required_gates if g in registered_gates]
    proven = [g for g in registered if has_evidence_for_gate(g)]

    if not required_gates:
        status = "DECLARED"
    elif len(registered) < len(required_gates):
        status = "PARTIAL"
    elif len(proven) == len(required_gates):
        status = "COMPLETE"
    else:
        status = "WIRED"

    return {
        "id": feature_id,
        "required_gates": required_gates,
        "registered": registered,
        "proven": proven,
        "status": status,
    }


def build_domain_report(capabilities: list, features: dict, registered_gates: set) -> dict:
    """
    Build per-domain feature analysis.

    Returns: {domain: [feature_analysis, ...]}
    Also returns infra features separately.
    """
    # Map feature -> domain from capabilities
    feature_domain_map = {}
    for cap in capabilities:
        domain = cap.get("domain", "unknown")
        for fid in cap.get("features", []):
            if fid not in feature_domain_map:
                feature_domain_map[fid] = domain

    # Also infer domain from feature files' product_area field
    for fid, fdata in features.items():
        if fid not in feature_domain_map:
            pa = fdata.get("product_area", "unknown")
            feature_domain_map[fid] = pa

    # Analyze each feature
    domain_features = {}
    infra_features = []

    for fid, fdata in features.items():
        domain = feature_domain_map.get(fid, "unknown")
        analysis = analyze_feature(fid, fdata, registered_gates)

        if domain in INFRA_DOMAINS:
            infra_features.append(analysis)
        else:
            domain_features.setdefault(domain, []).append(analysis)

    return domain_features, infra_features


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def format_gate_list(gates: list) -> str:
    """Format a list of gates as comma-separated inline code."""
    if not gates:
        return "-"
    return ", ".join(f"`{g}`" for g in gates)


def compute_summary(domain_features: dict) -> list:
    """Compute summary stats per domain."""
    rows = []
    total_features = 0
    total_wired = 0
    total_proven = 0

    for domain in DOMAIN_ORDER:
        features = domain_features.get(domain, [])
        n_features = len(features)
        n_wired = sum(1 for f in features if f["status"] in ("WIRED", "COMPLETE"))
        n_proven = sum(1 for f in features if f["status"] == "COMPLETE")
        coverage = (n_proven / n_features * 100) if n_features > 0 else 0

        rows.append({
            "domain": domain,
            "features": n_features,
            "wired": n_wired,
            "proven": n_proven,
            "coverage": coverage,
        })

        total_features += n_features
        total_wired += n_wired
        total_proven += n_proven

    total_coverage = (total_proven / total_features * 100) if total_features > 0 else 0
    rows.append({
        "domain": "**Total**",
        "features": total_features,
        "wired": total_wired,
        "proven": total_proven,
        "coverage": total_coverage,
    })

    return rows


def generate_report(domain_features: dict, infra_features: list) -> str:
    """Generate the full Markdown report."""
    lines = []

    lines.append("# Acceptance Coverage Report")
    lines.append("")
    lines.append("> Auto-generated by `tooling/scripts/acceptance-coverage-report.py`")
    lines.append(f"> Last updated: {date.today().isoformat()}")
    lines.append("")

    # Summary table
    lines.append("## Summary")
    lines.append("")
    lines.append("| Domain | Features | Wired | Proven | Coverage |")
    lines.append("|--------|----------|-------|--------|----------|")

    summary = compute_summary(domain_features)
    for row in summary:
        domain_label = row["domain"]
        if domain_label != "**Total**":
            domain_label = DOMAIN_DISPLAY.get(domain_label, domain_label)
        lines.append(
            f"| {domain_label} | {row['features']} | {row['wired']} | "
            f"{row['proven']} | {row['coverage']:.0f}% |"
        )

    lines.append("")

    # Infra section
    lines.append("## Infra (Core Self-Validation)")
    lines.append("")
    lines.append("| Feature | Gates | Registered | Status |")
    lines.append("|---------|-------|------------|--------|")

    for f in infra_features:
        gates_str = format_gate_list(f["required_gates"])
        reg_count = f"{len(f['registered'])}/{len(f['required_gates'])}"
        lines.append(f"| `{f['id']}` | {gates_str} | {reg_count} | {f['status']} |")

    lines.append("")

    # Per-domain sections
    for domain in DOMAIN_ORDER:
        display_name = DOMAIN_DISPLAY.get(domain, domain)
        lines.append(f"## {display_name}")
        lines.append("")
        lines.append("| Feature | Required Gates | Registered | Proven | Status |")
        lines.append("|---------|---------------|------------|--------|--------|")

        features = domain_features.get(domain, [])
        for f in sorted(features, key=lambda x: x["id"]):
            gates_str = format_gate_list(f["required_gates"])
            reg_count = f"{len(f['registered'])}/{len(f['required_gates'])}"
            proven_count = f"{len(f['proven'])}/{len(f['required_gates'])}"
            lines.append(
                f"| `{f['id']}` | {gates_str} | {reg_count} | {proven_count} | {f['status']} |"
            )

        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # Validate paths
    if not ACCEPTANCE_ROOT.exists():
        logger.error("Acceptance root not found: %s", ACCEPTANCE_ROOT)
        return 1

    # Load data
    registered_gates = load_registered_gates()
    capabilities = load_capabilities()
    features = load_features()

    if not features:
        logger.error("No feature files found in %s", FEATURES_DIR)
        return 1

    logger.info("Loaded %d registered gates", len(registered_gates))
    logger.info("Loaded %d capabilities", len(capabilities))
    logger.info("Loaded %d features", len(features))

    # Build analysis
    domain_features, infra_features = build_domain_report(capabilities, features, registered_gates)

    # Generate report
    report = generate_report(domain_features, infra_features)

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(report, encoding="utf-8")

    logger.info("Coverage report written to %s", OUTPUT_PATH.relative_to(REPO_ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
