from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stderr
from unittest import mock

from tooling.acceptance.gates.social.cross_station_gate import (
    GATE_MODULES,
    main,
    resolve_gate,
)


class CrossStationGateDispatcherTest(unittest.TestCase):
    def test_registry_is_closed(self) -> None:
        self.assertEqual(
            {
                "browser-social-zero-registration",
                "social-cross-station-contract",
                "social-cross-station-delivery",
                "social-cross-station-desktop-functional",
                "social-cross-station-eventbus-contract",
                "social-cross-station-interaction",
                "social-cross-station-native-e2e",
                "social-cross-station-prekey",
                "social-cross-station-revocation-recovery",
            },
            set(GATE_MODULES),
        )

    def test_registered_gate_without_implementation_fails_closed(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            status = main(
                [
                    "--gate",
                    "social-cross-station-contract",
                ]
            )

        self.assertEqual(2, status)
        payload = json.loads(stderr.getvalue())
        self.assertEqual(
            "SOCIAL_CROSS_STATION_GATE_UNAVAILABLE",
            payload["code"],
        )
        self.assertEqual(
            "social-cross-station-contract",
            payload["gateId"],
        )

    def test_dispatches_only_callable_main(self) -> None:
        handler = mock.Mock(return_value=0)
        module = mock.Mock(main=handler)
        with mock.patch(
            "tooling.acceptance.gates.social.cross_station_gate."
            "importlib.import_module",
            return_value=module,
        ):
            resolved = resolve_gate("social-cross-station-delivery")
            self.assertEqual(0, resolved())

        handler.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
