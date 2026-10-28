"""Resolve declared service roles through reviewed Profiles, before acquisition."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping
from pathlib import Path

from .errors import BlockedError
from .provisioner import resolve_machine_profile_environment
from .provisioning import EnvironmentContract
from .resource_diagnostic import ResourceDiagnostic


PROFILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def resolve_service_profiles(
    contract: EnvironmentContract,
    supplied: Mapping[str, str],
    *,
    kinds: frozenset[str],
    repo_root: Path,
) -> dict[str, str]:
    """Explicit role bindings override declarations; a sole role uses active Profile.

    Multiple services of the same kind require declared or caller-selected Profiles.
    No endpoint, deployment, actor, or cross-service topology is inferred.
    """
    services = {
        service_id: service for service_id, service in contract.services.items()
        if service.kind in kinds
    }
    unexpected = set(supplied) - set(services)
    if unexpected:
        raise BlockedError(
            reason=f"{contract.id}: undeclared Profile roles {sorted(unexpected)}",
            resource="service-profile-bindings",
        )
    services = {
        service_id: service for service_id, service in services.items()
        if service.required or service_id in supplied or service.profile_ref
    }
    counts = Counter(service.kind for service in services.values())
    result: dict[str, str] = {}
    active: str | None = None
    for service_id, service in services.items():
        profile = supplied.get(service_id, "")
        if not profile and service.profile_ref:
            prefix, separator, profile = service.profile_ref.partition(":")
            if prefix != "profile" or not separator:
                raise BlockedError(
                    reason=f"{contract.id}: invalid profile_ref for {service_id!r}",
                    resource="service-profile-bindings",
                )
        if not profile and counts[service.kind] == 1:
            if active is None:
                active, _, _, _ = resolve_machine_profile_environment(repo_root)
            profile = active
        if not profile:
            if not service.required:
                continue
            resource = f"service-profile:{service_id}"
            raise BlockedError(
                reason=f"{contract.id}: multiple {service.kind} roles require explicit Profile bindings",
                resource=resource,
                diagnostic=ResourceDiagnostic.observed(
                    owner="acceptance-profile-bindings",
                    recovery_action=(
                        "Declare profile_ref on each service or pass "
                        "--service-profile SERVICE_ID=PROFILE for the selected topology."
                    ),
                    resource=resource,
                    expected={"role": service_id, "kind": service.kind, "profileBound": True},
                    observed={"profileBound": False},
                ),
            )
        if not isinstance(profile, str) or PROFILE_NAME.fullmatch(profile) is None:
            raise BlockedError(
                reason=f"{contract.id}: invalid Profile name for {service_id!r}",
                resource="service-profile-bindings",
            )
        result[service_id] = profile
    return result
