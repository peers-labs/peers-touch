from __future__ import annotations

import unittest

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_onboarding import (
    GATE_ID,
    ONBOARDING_REQUIRED_ASSERTIONS,
    SELECTORS,
    LifecycleOnboardingGate,
    accepted_conversation_id,
    counterparty_requests,
    matching_requests,
)
from tooling.acceptance.gates.chat.lifecycle_onboarding_e2e import (
    validate_onboarding_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    is_current_profile_gate,
    journey_for_gate,
)


class LifecycleOnboardingContractTest(unittest.TestCase):
    def test_find_people_close_targets_its_own_modal(self) -> None:
        class CloseButton:
            clicked = False

            def click(inner_self) -> None:
                inner_self.clicked = True

        class Modal:
            locator = None

            def find_element(inner_self, by: str, selector: str) -> CloseButton:
                inner_self.locator = (by, selector)
                return close_button

        class Surface:
            locator = None

            def find_element(inner_self, by: str, selector: str) -> Modal:
                inner_self.locator = (by, selector)
                return modal

        class Client:
            selector = None
            script = None

            def find_element(inner_self, selector: str, timeout: int) -> Surface:
                inner_self.selector = (selector, timeout)
                return surface

            def execute_script(
                inner_self,
                script: str,
                target: CloseButton,
            ) -> None:
                inner_self.script = (script, target)
                target.click()

        surface = Surface()
        modal = Modal()
        close_button = CloseButton()
        client = Client()

        LifecycleOnboardingGate._close_find_people(client)

        self.assertEqual(client.selector, (SELECTORS["find_people"], 10))
        self.assertEqual(surface.locator[0], "xpath")
        self.assertIn("ancestor::div", surface.locator[1])
        self.assertEqual(modal.locator, ("css selector", ".ant-modal-close"))
        self.assertEqual(
            client.script,
            ("arguments[0].click();", close_button),
        )
        self.assertTrue(close_button.clicked)

    def test_request_matching_uses_exact_actor_pair_and_state(self) -> None:
        snapshot = {
            "requests": [
                {
                    "id": "pending",
                    "senderPtid": "ptid:alice",
                    "receiverPtid": "ptid:bob",
                    "status": 1,
                },
                {
                    "id": "rejected",
                    "senderPtid": "ptid:alice",
                    "receiverPtid": "ptid:bob",
                    "status": 3,
                },
                {
                    "id": "other",
                    "senderPtid": "ptid:carol",
                    "receiverPtid": "ptid:bob",
                    "status": 1,
                },
            ]
        }

        self.assertEqual(
            matching_requests(
                snapshot,
                sender_ptid="ptid:alice",
                receiver_ptid="ptid:bob",
                status=1,
            ),
            [snapshot["requests"][0]],
        )

    def test_direct_conversation_requires_one_shared_identity(self) -> None:
        self.assertEqual(
            accepted_conversation_id(
                (
                    {"conversationIds": ["direct-1"]},
                    {"conversationIds": ["direct-1"]},
                )
            ),
            "direct-1",
        )
        self.assertIsNone(
            accepted_conversation_id(
                (
                    {"conversationIds": ["direct-1", "direct-2"]},
                    {"conversationIds": ["direct-1"]},
                )
            )
        )
        self.assertIsNone(
            accepted_conversation_id(
                (
                    {"conversationIds": ["direct-1"]},
                    {"conversationIds": ["direct-2"]},
                )
            )
        )

    def test_counterparty_history_includes_both_directions_only_for_one_ptid(
        self,
    ) -> None:
        snapshot = {
            "requests": [
                {
                    "id": "outgoing",
                    "senderPtid": "ptid:alice",
                    "receiverPtid": "ptid:bob",
                },
                {
                    "id": "incoming",
                    "senderPtid": "ptid:bob",
                    "receiverPtid": "ptid:alice",
                },
                {
                    "id": "other",
                    "senderPtid": "ptid:carol",
                    "receiverPtid": "ptid:alice",
                },
            ],
        }

        self.assertEqual(
            [
                request["id"]
                for request in counterparty_requests(
                    snapshot,
                    viewer_ptid="ptid:alice",
                    peer_ptid="ptid:bob",
                )
            ],
            ["outgoing", "incoming"],
        )

    def test_onboarding_is_a_current_profile_gate_variant(self) -> None:
        self.assertTrue(is_current_profile_gate(GATE_ID))
        self.assertEqual(
            journey_for_gate(GATE_ID),
            "onboarding-first-message",
        )
        self.assertIn(
            "native_account_resume_without_credentials",
            ONBOARDING_REQUIRED_ASSERTIONS,
        )
        self.assertIn(
            "friend_request_history_consolidated_selectable",
            ONBOARDING_REQUIRED_ASSERTIONS,
        )
        self.assertIn(
            "station_identity_human_readable_copyable",
            ONBOARDING_REQUIRED_ASSERTIONS,
        )

    def test_onboarding_validator_requires_distinct_retry_and_shared_direct(self) -> None:
        valid = {
            "runtime": {
                "conversationId": "direct-1",
                "onboarding": {
                    "discovery": {"pendingRequestId": "request-1"},
                    "retry": {"pendingRequestId": "request-2"},
                    "snapshots": [
                        {"conversationIds": ["direct-1"]},
                        {"conversationIds": ["direct-1"]},
                    ],
                },
            },
        }
        validate_onboarding_report(valid)

        valid["runtime"]["onboarding"]["retry"]["pendingRequestId"] = "request-1"
        with self.assertRaisesRegex(
            RuntimeError,
            "reject/retry identities",
        ):
            validate_onboarding_report(valid)

    def test_runner_does_not_bypass_onboarding_with_direct_creation(self) -> None:
        source = (
            REPO_ROOT
            / "tooling/acceptance/gates/chat/lifecycle_onboarding.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn('"createDirectConversation"', source)
        for selector in (
            "data-chat-find-people-result",
            "data-chat-find-people-scope",
            "data-chat-friend-request-action",
            "data-chat-contact-message",
        ):
            self.assertIn(selector, source)
        for contract in (
            "prove_additional_journey_assertions",
            "_restart_and_resume_account",
            "data-login-email",
            "data-login-password",
            'input[inputmode="numeric"]',
        ):
            self.assertIn(contract, source)
        shared_runner = (
            REPO_ROOT
            / "tooling/acceptance/gates/chat/native_two_client_runner.py"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "self.prove_additional_journey_assertions()",
            shared_runner,
        )

    def test_find_people_close_targets_its_visible_modal(self) -> None:
        source = (
            REPO_ROOT
            / "tooling/acceptance/gates/chat/lifecycle_onboarding.py"
        ).read_text(encoding="utf-8")

        self.assertIn("visible_close_buttons", source)
        self.assertIn("len(visible_close_buttons) != 1", source)
        self.assertIn(
            '".ant-modal-close"',
            source,
        )
        self.assertIn("invisibility_of_element_located", source)
        self.assertNotIn(
            'client.find_element(".ant-modal-close", 10).click()',
            source,
        )

    def test_find_people_uses_canonical_pending_and_station_scope(self) -> None:
        source = (
            REPO_ROOT
            / "apps/desktop/src/components/chat/FindPeopleModal.tsx"
        ).read_text(encoding="utf-8")
        self.assertNotIn("sentIds", source)
        self.assertIn("pendingReceiverIds.has(receiverPtid)", source)
        self.assertIn(
            "station_id: searchScope === 'station' ? selectedStationId : undefined",
            source,
        )
        self.assertIn('data-chat-find-people-scope="station"', source)
        self.assertIn("data-chat-find-people-ptid", source)
        self.assertIn("data-chat-find-people-request-error", source)
        self.assertIn("requestIdentityUnavailable", source)
        self.assertNotIn("message.error(", source)
        search_failure = source[
            source.index("} catch (e: unknown) {"):
            source.index("} finally {", source.index("} catch (e: unknown) {"))
        ]
        self.assertNotIn("setResults([])", search_failure)

    def test_request_actions_keep_visible_recovery_state(self) -> None:
        source = (
            REPO_ROOT
            / "apps/desktop/src/components/chat/ChatContactsPanel.tsx"
        ).read_text(encoding="utf-8")
        for marker in (
            "data-chat-friend-request-id",
            'data-chat-friend-request-action="accept"',
            'data-chat-friend-request-action="reject"',
            "data-chat-friend-request-error",
            "data-chat-friend-request-attempt-count",
            "personContactSelection",
            "error.chat.conversationActionFailed",
        ):
            self.assertIn(marker, source)
        detail_source = (
            REPO_ROOT
            / "apps/desktop/src/components/chat/ChatContactsDetailPanel.tsx"
        ).read_text(encoding="utf-8")
        for marker in (
            "data-chat-contact-detail-home-station-name",
            "station-peer-id",
            "actor-ptid",
        ):
            self.assertIn(marker, detail_source)
        profile_source = (
            REPO_ROOT
            / "apps/desktop/src/components/profile/PublicProfileCard.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("data-chat-profile-technical-details", profile_source)
        self.assertIn("data-chat-profile-copy", profile_source)

        provisioner = (
            REPO_ROOT
            / "tooling/acceptance/provisioners/native_tauri_current_profile.py"
        ).read_text(encoding="utf-8")
        self.assertIn(GATE_ID, provisioner)


if __name__ == "__main__":
    unittest.main()
