"""Domain-neutral ownership resolution from the registered Acceptance contracts."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Sequence


def load_scope_catalog(root: Path) -> dict[str, Any]:
    """Read the selected catalog's contracts, never a different worktree's registry."""
    from tooling.acceptance.finalizers import load_strict_json_object

    def read(path: Path) -> dict[str, Any]:
        return load_strict_json_object(path, str(path))

    registry = root / "registry.yaml"
    return {
        "capabilities": [
            item for path in sorted((root / "capabilities").glob("*.yaml"))
            for item in read(path).get("capabilities", [])
        ],
        "features": [
            read(path) for path in sorted((root / "features").glob("*.yaml"))
        ],
        "domains": [
            read(path) for path in sorted((root / "domains").glob("*.yaml"))
            if path.name != "index.yaml"
        ],
        "rules": read(registry).get("rules", []) if registry.is_file() else [],
    }


def _identifier(item: Mapping[str, Any], kind: str) -> str:
    if not isinstance(item, Mapping) or not isinstance(item.get("id"), str) or not item["id"]:
        raise ValueError(f"{kind} requires a non-empty id")
    return item["id"]


def _index(items: Sequence[Mapping[str, Any]], kind: str) -> dict[str, Mapping[str, Any]]:
    result = {}
    for item in items:
        identifier = _identifier(item, kind)
        if identifier in result:
            raise ValueError(f"duplicate {kind} id: {identifier}")
        result[identifier] = item
    return result


def _references(item: Mapping[str, Any], field: str) -> list[str]:
    value = item.get(field, [])
    if (
        not isinstance(value, list)
        or any(not isinstance(ref, str) or not ref for ref in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError(f"{item['id']}: {field} must contain unique non-empty references")
    return value


def collect_scope_ownership(
    definitions: Mapping[str, Any],
    capabilities: Sequence[Mapping[str, Any]],
    *,
    features: Sequence[Mapping[str, Any]] = (),
    domains: Sequence[Mapping[str, Any]] = (),
    rules: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Preserve every declared owner; unresolved contracts supply no invented owner."""
    capability_by_id = _index(capabilities, "Capability")
    feature_by_id = _index(features, "Feature")
    domain_by_id = _index(domains, "Domain")
    owners: dict[str, set[str]] = {gate_id: set() for gate_id in definitions}
    sources: dict[str, list[dict[str, Any]]] = {gate_id: [] for gate_id in definitions}
    feature_owners: dict[str, set[str]] = {feature_id: set() for feature_id in feature_by_id}
    known_domains = set(domain_by_id)
    unresolved: list[dict[str, str]] = []

    def add(gate_id: str, kind: str, identifier: str, declared: set[str],
            registry_index: int | None = None) -> None:
        if gate_id not in definitions:
            raise ValueError(f"{kind} {identifier} references missing Gate {gate_id}")
        owners[gate_id].update(declared)
        source = {
            "kind": kind, "id": identifier, "domains": sorted(declared),
        }
        if registry_index is not None:
            source["registryIndex"] = registry_index
        sources[gate_id].append(source)

    for capability_id, capability in capability_by_id.items():
        domain = capability.get("domain")
        if not isinstance(domain, str) or not domain:
            raise ValueError(f"{capability_id}: Capability requires a domain")
        known_domains.add(domain)
        for gate_id in _references(capability, "required_gates"):
            add(gate_id, "capability", capability_id, {domain})
        for feature_id in _references(capability, "features"):
            if feature_id in feature_owners:
                feature_owners[feature_id].add(domain)
            else:
                unresolved.append({
                    "kind": "capability", "id": capability_id, "featureId": feature_id,
                })

    for feature_id, feature in feature_by_id.items():
        area = feature.get("product_area")
        if area is not None:
            if not isinstance(area, str) or not area:
                raise ValueError(f"{feature_id}: product_area must be a non-empty domain")
            feature_owners[feature_id].add(area)
            known_domains.add(area)
        for gate_id in _references(feature, "required_gates"):
            add(gate_id, "feature", feature_id, feature_owners[feature_id])

    for registry_index, rule in enumerate(rules):
        # Registry is an ordered rule list; repeated IDs can cover distinct paths.
        rule_id = _identifier(rule, "Registry rule")
        declared: set[str] = set()
        for feature_id in _references(rule, "features"):
            if feature_id in feature_owners:
                declared.update(feature_owners[feature_id])
            else:
                unresolved.append({
                    "kind": "registry", "id": rule_id, "featureId": feature_id,
                })
        for gate_id in _references(rule, "require"):
            add(gate_id, "registry", rule_id, declared, registry_index)

    for domain_id, domain in domain_by_id.items():
        gate_id = domain.get("validation_gate_id")
        if gate_id is not None:
            if not isinstance(gate_id, str) or not gate_id:
                raise ValueError(f"{domain_id}: validation_gate_id must be non-empty")
            add(gate_id, "domain-validation", domain_id, {domain_id})
        for capability_id in _references(domain, "capabilities"):
            if capability_id not in capability_by_id:
                raise ValueError(f"{domain_id}: references missing Capability {capability_id}")
        # A profile consumes capabilities; it does not reassign their owner domain.

    return {
        "domains": sorted(known_domains),
        "owners": {gate_id: sorted(value) for gate_id, value in owners.items()},
        "sources": {
            gate_id: sorted(
                value, key=lambda item: (item["kind"], item["id"], item.get("registryIndex", -1)),
            )
            for gate_id, value in sources.items()
        },
        "unresolvedFeatureReferences": sorted(
            unresolved, key=lambda item: (item["kind"], item["id"], item["featureId"]),
        ),
    }
