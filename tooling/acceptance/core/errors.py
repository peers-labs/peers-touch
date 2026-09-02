from __future__ import annotations


class GateError(RuntimeError):
    pass


class DriverError(RuntimeError):
    pass


class EvidenceError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        operation: str = "",
        path_role: str = "",
    ) -> None:
        super().__init__(message)
        self.operation = operation
        self.path_role = path_role


class EvidenceRootInvalid(EvidenceError):
    pass


class EvidenceRootForbidden(EvidenceError):
    pass


class EvidencePermissionDenied(EvidenceError):
    pass


class EvidenceNoSpace(EvidenceError):
    pass


class EvidenceQuotaExceeded(EvidenceError):
    pass


class EvidencePathTraversal(EvidenceError):
    pass


class EvidenceSymlinkRejected(EvidenceError):
    pass


class EvidenceConflict(EvidenceError):
    pass


class EvidenceWriteInterrupted(EvidenceError):
    pass


class EvidenceManifestInvalid(EvidenceError):
    pass


class EvidenceRunActive(EvidenceError):
    pass


class FixtureError(RuntimeError):
    pass


class ProvisioningError(RuntimeError):
    pass


class ClientBindingError(ProvisioningError):
    def __init__(
        self,
        *,
        code: str,
        numeric_code: int,
        stage: str,
        client_id: str,
        binding_role: str,
        detail: str,
        result: str = "BLOCKED",
    ) -> None:
        super().__init__(
            f"{code} ({numeric_code}) for client {client_id!r} "
            f"role {binding_role!r}: {detail}"
        )
        self.code = code
        self.numeric_code = numeric_code
        self.stage = stage
        self.client_id = client_id
        self.binding_role = binding_role
        self.detail = detail
        self.result = result

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "numericCode": self.numeric_code,
            "stage": self.stage,
            "clientId": self.client_id,
            "bindingRole": self.binding_role,
            "detail": self.detail,
            "result": self.result,
        }


class BlockedError(ProvisioningError):
    def __init__(self, reason: str, resource: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.resource = resource
