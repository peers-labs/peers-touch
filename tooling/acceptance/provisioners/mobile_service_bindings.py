from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioning import EnvironmentContract


@dataclass(frozen=True)
class MobileServiceBinding:
    service_id: str
    kind: str
    endpoint: str
    deployment_environment: str
    producer: str
    health_endpoint: str = ""


def _resolve_environment_reference(
    reference: object,
    environment: Mapping[str, str],
    *,
    service_id: str,
    field: str,
    required: bool,
) -> str:
    raw_reference = str(reference or "").strip()
    if not raw_reference:
        if required:
            raise BlockedError(
                reason=(
                    f"Mobile service {service_id!r} requires a {field} "
                    "environment reference"
                ),
                resource=f"service-binding:{service_id}:{field}",
            )
        return ""
    if not raw_reference.startswith("env:"):
        raise BlockedError(
            reason=(
                f"Mobile service {service_id!r} {field} must use an env: "
                "reference"
            ),
            resource=f"service-binding:{service_id}:{field}",
        )
    variable = raw_reference.removeprefix("env:").strip()
    value = environment.get(variable, "").strip()
    if not variable or not value:
        raise BlockedError(
            reason=(
                f"Mobile service {service_id!r} requires injected variable "
                f"{variable or '<empty>'}"
            ),
            resource=f"service-binding:{service_id}:{field}:{variable}",
        )
    return value


def resolve_mobile_service_bindings(
    contract: EnvironmentContract,
    contract_path: Path,
    *,
    environment: Mapping[str, str] | None = None,
) -> dict[str, MobileServiceBinding]:
    if contract.profile.required or contract.profile.identity_match:
        raise BlockedError(
            reason=(
                f"Mobile environment {contract.id!r} must not depend on an "
                "active development profile"
            ),
            resource=f"service-binding:{contract.id}:active-profile",
        )
    if not contract.services:
        return {}

    try:
        payload = json.loads(contract_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProvisioningError(
            f"invalid Mobile environment contract at {contract_path}: {error}"
        ) from error
    raw_services = payload.get("services") if isinstance(payload, dict) else None
    if not isinstance(raw_services, dict):
        raise ProvisioningError(
            f"invalid Mobile environment contract at {contract_path}: "
            "services must be an object"
        )

    runtime_environment = environment if environment is not None else os.environ
    bindings: dict[str, MobileServiceBinding] = {}
    for service_id, requirement in contract.services.items():
        declaration = raw_services.get(service_id)
        if not isinstance(declaration, dict):
            raise BlockedError(
                reason=(
                    f"Mobile service {service_id!r} has no runtime binding "
                    "declaration"
                ),
                resource=f"service-binding:{service_id}:declaration",
            )
        if str(declaration.get("kind") or "") != requirement.kind:
            raise BlockedError(
                reason=(
                    f"Mobile service {service_id!r} binding kind does not "
                    "match its Environment Contract"
                ),
                resource=f"service-binding:{service_id}:kind",
            )
        producer = requirement.attestation_producer.strip()
        if not producer:
            raise BlockedError(
                reason=(
                    f"Mobile service {service_id!r} has no attestation producer"
                ),
                resource=f"service-binding:{service_id}:producer",
            )
        bindings[service_id] = MobileServiceBinding(
            service_id=service_id,
            kind=requirement.kind,
            endpoint=_resolve_environment_reference(
                declaration.get("endpoint_ref"),
                runtime_environment,
                service_id=service_id,
                field="endpoint",
                required=True,
            ),
            deployment_environment=_resolve_environment_reference(
                declaration.get("deployment_environment_ref"),
                runtime_environment,
                service_id=service_id,
                field="deployment-environment",
                required=True,
            ),
            health_endpoint=_resolve_environment_reference(
                declaration.get("health_endpoint_ref"),
                runtime_environment,
                service_id=service_id,
                field="health-endpoint",
                required=False,
            ),
            producer=producer,
        )

    endpoints = [binding.endpoint for binding in bindings.values()]
    deployments = [
        binding.deployment_environment for binding in bindings.values()
    ]
    if len(set(endpoints)) != len(endpoints):
        raise BlockedError(
            reason="Mobile service bindings must use distinct endpoints",
            resource=f"service-binding:{contract.id}:duplicate-endpoint",
        )
    if len(set(deployments)) != len(deployments):
        raise BlockedError(
            reason=(
                "Mobile service bindings must use distinct deployment "
                "environments"
            ),
            resource=f"service-binding:{contract.id}:duplicate-deployment",
        )
    return bindings
