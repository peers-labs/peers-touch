from __future__ import annotations

import unittest

from tooling.acceptance.fixtures.chat_attachment_fault_proxy import (
    ATTACHMENT_DOWNLOAD_PREFIX,
    ATTACHMENT_UPLOAD_BEGIN_PATH,
    _FaultState,
)


class ChatAttachmentFaultProxyTest(unittest.TestCase):
    def test_upload_and_download_loss_are_one_shot_and_independent(self) -> None:
        state = _FaultState()
        state.arm_upload_connection_loss_once()
        state.arm_download_connection_loss_once()
        download_path = f"{ATTACHMENT_DOWNLOAD_PREFIX}object-1"

        self.assertEqual(state.classify(ATTACHMENT_UPLOAD_BEGIN_PATH), "drop")
        self.assertEqual(state.classify(ATTACHMENT_UPLOAD_BEGIN_PATH), "forward")
        self.assertEqual(state.classify(download_path), "drop")
        self.assertEqual(state.classify(download_path), "forward")

        evidence = state.snapshot()
        self.assertEqual(evidence["uploadConnectionLossCount"], 1)
        self.assertEqual(evidence["downloadConnectionLossCount"], 1)
        self.assertEqual(evidence["uploadLossesRemaining"], 0)
        self.assertEqual(evidence["downloadLossesRemaining"], 0)
        self.assertEqual(
            evidence["forwardedPaths"],
            {
                ATTACHMENT_UPLOAD_BEGIN_PATH: 1,
                download_path: 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
