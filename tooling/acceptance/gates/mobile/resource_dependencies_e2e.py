"""Native Profile resource journeys; source checks cannot satisfy these Gates."""

from __future__ import annotations

import os
from typing import Any

from tooling.acceptance.core import AcceptanceGate
from .resource_dependencies_functional import ResourceDependencyJourney


class SharingGate(AcceptanceGate):
    gate_id = "profile-resource-id-sharing-native-e2e"
    spec = ("LDCP-R01", "LDCP-R02", "LDCP-R03", "LDCP-R04", "LDCP-R06", "LDCP-R07", "LDCP-R10")

    def run(self) -> dict[str, Any]:
        return ResourceDependencyJourney(self).exercise("sharing", formal=True)


class OverwriteGate(AcceptanceGate):
    gate_id = "profile-resource-overwrite-native-e2e"
    spec = ("LDCP-R05", "LDCP-R08", "LDCP-R09")

    def run(self) -> dict[str, Any]:
        return ResourceDependencyJourney(self).exercise("overwrite", formal=True)


def main() -> int:
    gates = {SharingGate.gate_id: SharingGate, OverwriteGate.gate_id: OverwriteGate}
    return gates[os.environ["PT_ACCEPTANCE_GATE_ID"]]().execute()


if __name__ == "__main__":
    raise SystemExit(main())
