"""Mobile cleanup evidence finalizer for post-Gate evidence validation.

Isolated child process: receives FinalizerInput as JSON on stdin, validates
that the sealed snapshot contains the required cleanup evidence roles, and
writes a FinalizerChildOutcome as JSON to stdout. No imports from Acceptance
Core; all validation uses the JSON wire format.
"""

import hashlib
import json

from tooling.acceptance.gates.mobile.cleanup_evidence_roles import (
    CLEANUP_ROLE_KINDS,
)


FINALIZER_ID = "mobile.native.oauth-cleanup-evidence"

_CHILD_OUTCOME_DOMAIN = "pt.acceptance.finalization.child-outcome.v1"

REQUIRED_CLEANUP_ROLE_KINDS = CLEANUP_ROLE_KINDS


def _domain_separated_sha256(domain, payload):
    canonical = json.dumps(
        {"domain": domain, "payload": payload},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _validate_cleanup_evidence(snapshot):
    artifacts = snapshot.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        return ("REJECTED", [], "snapshot has no artifacts")

    by_role = {}
    for artifact in artifacts:
        role_name = artifact.get("roleName")
        if isinstance(role_name, str):
            by_role.setdefault(role_name, []).append(artifact)

    missing = sorted(set(REQUIRED_CLEANUP_ROLE_KINDS) - set(by_role))
    if missing:
        return ("REJECTED", [], "missing cleanup evidence roles: %s" % missing)

    validated = []

    for role_name in sorted(REQUIRED_CLEANUP_ROLE_KINDS):
        expected_kind = REQUIRED_CLEANUP_ROLE_KINDS[role_name]
        role_artifacts = by_role.get(role_name, [])
        if not role_artifacts:
            return ("REJECTED", [], "no artifacts for role: %s" % role_name)

        for artifact in role_artifacts:
            payload = artifact.get("payload")
            if payload is None or not isinstance(payload, dict):
                discriminator = artifact.get("discriminator")
                return (
                    "REJECTED",
                    [],
                    "artifact has no payload: %s/%s"
                    % (role_name, discriminator),
                )
            raw_value = payload.get("value")
            if not isinstance(raw_value, dict):
                discriminator = artifact.get("discriminator")
                return (
                    "REJECTED",
                    [],
                    "payload value is not an object: %s/%s"
                    % (role_name, discriminator),
                )
            payload_kind = raw_value.get("kind")
            if payload_kind != expected_kind:
                return (
                    "REJECTED",
                    [],
                    "kind mismatch for %s: expected %r, got %r"
                    % (role_name, expected_kind, payload_kind),
                )
            validated.append(
                [role_name, artifact.get("discriminator")]
            )

    validated.sort(key=lambda x: (x[0], x[1] or ""))
    return ("VALIDATED", validated, None)


def build_child_outcome(finalizer_input):
    invocation = finalizer_input["invocation"]
    context = finalizer_input["context"]
    snapshot = finalizer_input["snapshot"]

    status, validated_roles, diagnostic = _validate_cleanup_evidence(
        snapshot,
    )

    if status == "VALIDATED":
        failure_code = None
    elif status == "BLOCKED":
        failure_code = "FINALIZER_BLOCKED"
    else:
        failure_code = "FINALIZER_REJECTED"

    payload = {
        "status": status,
        "finalizerId": FINALIZER_ID,
        "invocationDigest": invocation["invocationDigest"],
        "finalizerInputDigest": finalizer_input["finalizerInputDigest"],
        "snapshotDigest": snapshot["snapshotDigest"],
        "primaryResultDigest": context["primaryResultDigest"],
        "validatedRoleInstances": validated_roles,
        "failureCode": failure_code,
        "diagnostic": diagnostic,
    }
    child_outcome_digest = _domain_separated_sha256(
        _CHILD_OUTCOME_DOMAIN, payload,
    )
    payload["childOutcomeDigest"] = child_outcome_digest
    return payload
