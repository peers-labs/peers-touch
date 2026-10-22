"""Owner-produced resource observations, before same-run evidence binding."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping


def _text(value: object, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"resource diagnostic {field} must be non-empty text")


@dataclass(frozen=True, init=False)
class ResourceDiagnostic:
    """Copy and validate observations; never infer missing checks or owners."""

    _payload: str

    def __init__(
        self,
        *,
        owner: str,
        recovery_action: str,
        resource_checks: list[dict[str, Any]],
    ) -> None:
        _text(owner, "owner")
        _text(recovery_action, "recoveryAction")
        if not isinstance(resource_checks, list) or not resource_checks:
            raise ValueError("resource diagnostic requires resource checks")
        resources: set[str] = set()
        for check in resource_checks:
            if not isinstance(check, dict):
                raise ValueError("resource check must be an object")
            _text(check.get("resource"), "resource")
            resource = check["resource"]
            if resource in resources:
                raise ValueError("resource diagnostic has duplicate resources")
            resources.add(resource)
            common = {"resource", "expected", "state"}
            if check.get("state") == "OBSERVED":
                required = common | {"observed"}
            elif check.get("state") == "NOT_EVALUATED":
                required = common | {"reason"}
                _text(check.get("reason"), "reason")
            else:
                raise ValueError("resource check has an invalid observation state")
            if set(check) != required or check.get("expected") in (None, ""):
                raise ValueError("resource check has unknown or missing fields")
        payload = {
            "owner": owner,
            "recoveryAction": recovery_action,
            "resourceChecks": resource_checks,
        }
        # A canonical copy prevents caller mutation after an error is raised.
        encoded = json.dumps(payload, sort_keys=True, allow_nan=False)
        object.__setattr__(self, "_payload", encoded)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ResourceDiagnostic":
        if not isinstance(value, Mapping) or set(value) != {
            "owner", "recoveryAction", "resourceChecks",
        }:
            raise ValueError("resource diagnostic has unknown or missing fields")
        return cls(
            owner=value["owner"],
            recovery_action=value["recoveryAction"],
            resource_checks=value["resourceChecks"],
        )

    @classmethod
    def observed(
        cls,
        *,
        owner: str,
        recovery_action: str,
        resource: str,
        expected: Any,
        observed: Any,
    ) -> "ResourceDiagnostic":
        return cls(
            owner=owner,
            recovery_action=recovery_action,
            resource_checks=[{
                "resource": resource,
                "expected": expected,
                "state": "OBSERVED",
                "observed": observed,
            }],
        )

    def require_resource(self, resource: str) -> None:
        if resource not in {
            check["resource"] for check in self.to_dict()["resourceChecks"]
        }:
            raise ValueError("resource diagnostic does not cover blocked resource")

    def to_dict(self) -> dict[str, Any]:
        return json.loads(self._payload)
