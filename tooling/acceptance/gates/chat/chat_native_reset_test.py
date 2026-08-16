from __future__ import annotations

import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import profile_three_environment


class ProfileThreeTargetTest(unittest.TestCase):
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            "PT_DEPLOY_HOST": "10.37.94.156",
            "PT_DEPLOY_USER": "acceptance",
        },
    )
    def test_accepts_exact_profile_three_station_url(self, _environment) -> None:
        resolved = profile_three_environment("http://10.37.94.156:18080/")
        self.assertEqual(resolved["PT_DEPLOY_HOST"], "10.37.94.156")

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            "PT_DEPLOY_HOST": "10.37.94.156",
            "PT_DEPLOY_USER": "acceptance",
        },
    )
    def test_rejects_non_profile_three_targets(self, _environment) -> None:
        for station_url in (
            "http://127.0.0.1:18080",
            "http://10.37.94.156:8080",
            "http://10.37.94.156:18080/other",
            "http://10.37.94.156:18080/?target=other",
        ):
            with self.subTest(station_url=station_url):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "Profile Three target mismatch",
                ):
                    profile_three_environment(station_url)


if __name__ == "__main__":
    unittest.main()
