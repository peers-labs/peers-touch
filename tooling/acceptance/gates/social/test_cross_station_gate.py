from __future__ import annotations

import unittest
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

    def test_registered_gate_dispatches_successfully(self) -> None:
        handler = mock.Mock(return_value=0)
        with mock.patch(
            "tooling.acceptance.gates.social.cross_station_gate.resolve_gate",
            return_value=handler,
        ) as resolve:
            status = main(
                [
                    "--gate",
                    "social-cross-station-contract",
                ]
            )

        self.assertEqual(0, status)
        resolve.assert_called_once_with(
            "social-cross-station-contract",
        )
        handler.assert_called_once_with()

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
