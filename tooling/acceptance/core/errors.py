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


class BlockedError(ProvisioningError):
    def __init__(self, reason: str, resource: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.resource = resource
