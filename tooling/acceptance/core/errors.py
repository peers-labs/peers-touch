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


class EphemeralLaunchError(GateError):
    code = "EPHEMERAL_LAUNCH_ERROR"

    def __init__(self, message: str, *, operation: str = "") -> None:
        super().__init__(message)
        self.operation = operation


class EphemeralLaunchContextInvalid(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_CONTEXT_INVALID"


class EphemeralLaunchTransportUnsupported(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_TRANSPORT_UNSUPPORTED"


class EphemeralLaunchBindFailed(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_BIND_FAILED"


class EphemeralLaunchHandshakeFailed(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_HANDSHAKE_FAILED"


class EphemeralLaunchProtocolError(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_PROTOCOL_ERROR"


class EphemeralLaunchTimeout(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_TIMEOUT"


class EphemeralCapabilityBlocked(EphemeralLaunchError, BlockedError):
    code = "EPHEMERAL_CAPABILITY_BLOCKED"

    def __init__(
        self,
        reason: str,
        *,
        resource: str = "",
        operation: str = "invoke",
    ) -> None:
        EphemeralLaunchError.__init__(self, reason, operation=operation)
        self.reason = reason
        self.resource = resource


class EphemeralLaunchCleanupFailed(EphemeralLaunchError):
    code = "EPHEMERAL_LAUNCH_CLEANUP_FAILED"

    def __init__(
        self,
        message: str,
        *,
        operation: str = "",
        result: object = None,
    ) -> None:
        super().__init__(message, operation=operation)
        self.result = result
