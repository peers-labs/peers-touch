from __future__ import annotations


class GateError(RuntimeError):
    pass


class DriverError(RuntimeError):
    pass


class EvidenceError(RuntimeError):
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
