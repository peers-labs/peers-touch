from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.station_access.relay_role_security_contract import (
    FORBIDDEN_EGRESS,
    _find_forbidden_egress,
    validate_relay_role_source_contract,
)


class RelayRoleSecurityContractTest(unittest.TestCase):
    def test_current_repository_satisfies_source_contract(self) -> None:
        validate_relay_role_source_contract()

    def test_debug_egress_scan_rejects_station_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "apps" / "station" / "example.go"
            source.parent.mkdir(parents=True)
            source.write_text(
                f'package station\nconst endpoint = "{FORBIDDEN_EGRESS}"\n',
                encoding="utf-8",
            )

            self.assertEqual(
                _find_forbidden_egress(root),
                ["apps/station/example.go"],
            )


if __name__ == "__main__":
    unittest.main()
