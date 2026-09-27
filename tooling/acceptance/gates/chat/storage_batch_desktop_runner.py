#!/usr/bin/env python3
"""Exercise batch conversation clearing through the native Desktop UI."""

from __future__ import annotations

import json
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    runtime_station_service,
    wait_until,
)
from tooling.acceptance.gates.chat.storage_governance_runner import (
    ChatStorageAccountingGate,
    STORAGE_REQUIRED_ASSERTIONS,
    STORAGE_REQUIRED_STEPS,
)


GATE_ID = "chat-storage-desktop-batch-clear-e2e"
BATCH_REQUIRED_ASSERTIONS = {
    "storage_batch_explicit_selection",
    "storage_batch_confirmation_context",
    "storage_batch_progress_visible",
    "storage_batch_estimated_reclaimable",
    "storage_batch_canonical_result",
    "storage_batch_partial_failure_retry",
    "storage_batch_scope_change_isolated",
    "storage_batch_unselected_preserved",
    "storage_batch_physical_reclaim",
    "storage_batch_restart_stable",
}
BATCH_REQUIRED_STEPS = {
    "storage.batch.fixture",
    "storage.batch.select",
    "storage.batch.confirm",
    "storage.batch.result",
    "storage.batch.partial_failure",
    "storage.batch.retry",
    "storage.batch.scope_change",
    "storage.batch.restart",
}


class ChatStorageDesktopBatchGate(ChatStorageAccountingGate):
    gate_id = GATE_ID
    phase = "chat-storage-batch-clear"
    bom = ("CSG-G07",)
    spec = ("chat-storage-batch-clear",)

    def _seed_conversation(self, client: Any) -> str:
        station = runtime_station_service(
            self.manifest,
            self.direction_order[0],
        )
        station_peer_id = str(station.get("runtimeIdentity") or "")
        if not station_peer_id:
            raise GateError("batch clear fixture has no Station identity")
        fixture = async_harness(
            client,
            "seedConversationClear",
            {
                "actorPtid": self.ptids[self.direction_order[0]],
                "stationPeerId": station_peer_id,
                "plaintextBytes": 2 * 1024 * 1024,
            },
        )
        conversation_id = str((fixture or {}).get("conversationId") or "")
        if not conversation_id:
            raise GateError("batch clear fixture has no conversation ID")
        return conversation_id

    @staticmethod
    def _select_conversation(client: Any, conversation_id: str) -> bool:
        return bool(
            client.execute_script(
                """
                const row = Array.from(document.querySelectorAll(
                  '[data-chat-storage-conversation]'
                )).find((candidate) => (
                  candidate.getAttribute('data-chat-storage-conversation')
                    === arguments[0]
                ));
                const control = row?.querySelector(
                  '[data-chat-storage-conversation-select]'
                );
                const checkbox = control?.matches('input')
                  ? control
                  : control?.querySelector('input');
                if (!checkbox) return false;
                checkbox.click();
                return true;
                """,
                conversation_id,
            )
        )

    @staticmethod
    def _conversation_selected(client: Any, conversation_id: str) -> bool:
        return bool(
            client.execute_script(
                """
                const row = Array.from(document.querySelectorAll(
                  '[data-chat-storage-conversation]'
                )).find((candidate) => (
                  candidate.getAttribute('data-chat-storage-conversation')
                    === arguments[0]
                ));
                return row?.getAttribute('data-chat-storage-selected')
                  === 'true';
                """,
                conversation_id,
            )
        )

    def _select_conversations(
        self,
        client: Any,
        conversation_ids: tuple[str, ...],
    ) -> dict[str, Any]:
        client.find_element("[data-chat-storage-batch-manage]", 10).click()
        wait_until(
            lambda: client.execute_script(
                """
                return Boolean(document.querySelector(
                  '[data-chat-storage-batch-actions]'
                ));
                """
            ),
            "Desktop batch selection controls",
            timeout=20,
        )
        for conversation_id in conversation_ids:
            if not self._select_conversation(client, conversation_id):
                raise GateError(
                    "Desktop batch selection control is missing for "
                    f"{conversation_id}"
                )
            wait_until(
                lambda conversation_id=conversation_id: (
                    self._conversation_selected(
                        client,
                        conversation_id,
                    )
                ),
                f"selected Desktop storage row {conversation_id}",
                timeout=20,
            )
        return wait_until(
            lambda: (
                value
                if (
                    isinstance(
                        value := client.execute_script(
                            """
                            return {
                              selected: Array.from(document.querySelectorAll(
                                '[data-chat-storage-selected="true"]'
                              )).map((row) => (
                                row.getAttribute(
                                  'data-chat-storage-conversation'
                                ) || ''
                              )),
                              clearEnabled: !document.querySelector(
                                '[data-chat-storage-batch-clear]'
                              )?.disabled,
                            };
                            """
                        ),
                        dict,
                    )
                    and set(value.get("selected") or [])
                    == set(conversation_ids)
                    and value.get("clearEnabled") is True
                )
                else None
            ),
            "selected Desktop storage rows",
            timeout=20,
        )

    @staticmethod
    def _confirmation(client: Any) -> dict[str, Any]:
        client.find_element("[data-chat-storage-batch-clear]", 10).click()
        return wait_until(
            lambda: (
                value
                if (
                    isinstance(
                        value := client.execute_script(
                            """
                            const confirmation = document.querySelector(
                              '[data-chat-storage-batch-confirm]'
                            );
                            const button = confirmation?.querySelector(
                              '[data-chat-storage-batch-confirm-apply]'
                            );
                            if (!button || button.disabled) return null;
                            return {
                              estimatedBytes: Number(
                                confirmation.getAttribute(
                                  'data-chat-storage-batch-estimated-bytes'
                                ) || '0'
                              ),
                              selectedCount: Number(
                                confirmation.getAttribute(
                                  'data-chat-storage-batch-selected-count'
                                ) || '0'
                              ),
                              scope: confirmation.getAttribute(
                                'data-chat-storage-batch-scope'
                              ) || '',
                              text: confirmation.innerText || '',
                            };
                            """
                        ),
                        dict,
                    )
                    and value.get("selectedCount", 0) > 0
                    and value.get("scope") == "current-device"
                    and bool(str(value.get("text") or "").strip())
                )
                else None
            ),
            "Desktop batch confirmation",
            timeout=20,
        )

    @staticmethod
    def _install_progress_probe(client: Any) -> None:
        client.execute_script(
            """
            window.__PT_CHAT_STORAGE_BATCH_PROGRESS__ = [];
            window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__?.disconnect();
            const record = () => {
              const progress = document.querySelector(
                '[data-chat-storage-batch-progress]'
              );
              if (!progress) return;
              const value = {
                completed: Number(progress.getAttribute(
                  'data-chat-storage-batch-completed'
                ) || '0'),
                total: Number(progress.getAttribute(
                  'data-chat-storage-batch-total'
                ) || '0'),
                text: progress.innerText || '',
              };
              const values = window.__PT_CHAT_STORAGE_BATCH_PROGRESS__;
              const previous = values[values.length - 1];
              if (!previous
                || previous.completed !== value.completed
                || previous.total !== value.total) {
                values.push(value);
              }
            };
            const observer = new MutationObserver(record);
            observer.observe(document.body, {
              attributes: true,
              childList: true,
              characterData: true,
              subtree: true,
            });
            window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__ = observer;
            record();
            """
        )

    @staticmethod
    def _progress_observations(client: Any) -> list[dict[str, Any]]:
        value = client.execute_script(
            """
            window.__PT_CHAT_STORAGE_BATCH_PROGRESS_OBSERVER__?.disconnect();
            return window.__PT_CHAT_STORAGE_BATCH_PROGRESS__ || [];
            """
        )
        return value if isinstance(value, list) else []

    @staticmethod
    def _wait_batch_result(client: Any, status: str) -> dict[str, Any]:
        return wait_until(
            lambda: (
                value
                if isinstance(
                    value := client.execute_script(
                        """
                        const result = document.querySelector(
                          `[data-chat-storage-batch-result="${arguments[0]}"]`
                        );
                        if (!result) return null;
                        return {
                          succeeded: Number(
                            result.getAttribute(
                              'data-chat-storage-batch-succeeded'
                            ) || '0'
                          ),
                          failed: Number(
                            result.getAttribute(
                              'data-chat-storage-batch-failed'
                            ) || '0'
                          ),
                          releasedBytes: Number(
                            result.getAttribute(
                              'data-chat-storage-released-bytes'
                            ) || '0'
                          ),
                          retryVisible: Boolean(document.querySelector(
                            '[data-chat-storage-batch-retry]'
                          )),
                          selected: Array.from(document.querySelectorAll(
                            '[data-chat-storage-selected="true"]'
                          )).map((row) => (
                            row.getAttribute(
                              'data-chat-storage-conversation'
                            ) || ''
                          )),
                        };
                        """,
                        status,
                    ),
                    dict,
                )
                else None
            ),
            f"Desktop batch clear {status} result",
            timeout=120,
        )

    @staticmethod
    def _configure_batch_scenario(
        client: Any,
        **scenario: Any,
    ) -> None:
        configured = async_harness(
            client,
            "configureStorageBatchScenario",
            scenario,
        )
        if configured != {"configured": True}:
            raise GateError("Desktop batch acceptance scenario was not configured")

    def _refresh_conversations(
        self,
        client: Any,
        conversation_ids: tuple[str, ...],
    ) -> dict[str, Any]:
        self._set_search(client, "")
        client.find_element("[data-chat-storage-refresh]", 10).click()
        return wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self._storage_snapshot(client),
                        dict,
                    )
                    and set(conversation_ids).issubset(
                        {
                            str(item.get("conversationId") or "")
                            for item in snapshot.get("conversations", [])
                            if isinstance(item, dict)
                        }
                    )
                )
                else None
            ),
            "batch-clear storage rows",
            timeout=60,
        )

    def prove_additional_journey_assertions(self) -> None:
        actor = self.direction_order[0]
        client = self.clients[actor]
        conversation_ids = self.step(
            "storage.batch.fixture",
            lambda: [
                self._seed_conversation(client),
                self._seed_conversation(client),
            ],
            actor,
        )
        first_id, second_id = conversation_ids
        super().prove_additional_journey_assertions()
        before = self._refresh_conversations(
            client,
            (first_id, second_id),
        )
        self._configure_batch_scenario(client, delayMs=400)

        selected = self.step(
            "storage.batch.select",
            lambda: self._select_conversations(
                client,
                (first_id, second_id),
            ),
            actor,
        )
        selected_ids = set(selected.get("selected") or [])
        self.assert_condition(
            "storage_batch_explicit_selection",
            selected_ids == {first_id, second_id}
            and selected.get("clearEnabled") is True,
            json.dumps(selected, sort_keys=True),
        )
        estimated_reclaimable_bytes = sum(
            int(item.get("reclaimableBytes") or 0)
            for item in before.get("conversations", [])
            if isinstance(item, dict)
            and str(item.get("conversationId") or "") in selected_ids
        )

        confirmation = self.step(
            "storage.batch.confirm",
            lambda: self._confirmation(client),
            actor,
        )
        self.assert_condition(
            "storage_batch_estimated_reclaimable",
            estimated_reclaimable_bytes > 0
            and confirmation.get("estimatedBytes")
            == estimated_reclaimable_bytes,
            json.dumps(
                {
                    "expected": estimated_reclaimable_bytes,
                    "displayed": confirmation.get("estimatedBytes"),
                },
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "storage_batch_confirmation_context",
            confirmation.get("selectedCount") == 2
            and confirmation.get("scope") == "current-device",
            json.dumps(confirmation, sort_keys=True),
        )
        self._install_progress_probe(client)
        client.find_element(
            "[data-chat-storage-batch-confirm-apply]",
            10,
        ).click()

        batch_result = self.step(
            "storage.batch.result",
            lambda: self._wait_batch_result(client, "succeeded"),
            actor,
        )
        progress = self._progress_observations(client)
        self.assert_condition(
            "storage_batch_progress_visible",
            any(
                item.get("total") == 2
                and item.get("completed") in {0, 1}
                and bool(str(item.get("text") or "").strip())
                for item in progress
                if isinstance(item, dict)
            ),
            json.dumps(progress, sort_keys=True),
        )
        self.assert_condition(
            "storage_batch_canonical_result",
            batch_result.get("succeeded") == 2
            and batch_result.get("failed") == 0,
            json.dumps(batch_result, sort_keys=True),
        )
        self.assert_condition(
            "storage_batch_physical_reclaim",
            int(batch_result.get("releasedBytes") or 0) > 0
            and int(before.get("physicalTotalBytes") or 0) > 0,
            json.dumps(
                {
                    "before": before.get("physicalTotalBytes"),
                    "result": batch_result,
                },
                sort_keys=True,
            ),
        )

        partial_ids = (
            self._seed_conversation(client),
            self._seed_conversation(client),
        )
        self._refresh_conversations(client, partial_ids)
        self._configure_batch_scenario(
            client,
            failureConversationId=partial_ids[1],
            delayMs=400,
        )
        self._select_conversations(client, partial_ids)
        partial_confirmation = self._confirmation(client)
        self._install_progress_probe(client)
        client.find_element(
            "[data-chat-storage-batch-confirm-apply]",
            10,
        ).click()
        partial_result = self.step(
            "storage.batch.partial_failure",
            lambda: self._wait_batch_result(client, "partial_failure"),
            actor,
        )
        partial_progress = self._progress_observations(client)
        partial_valid = (
            partial_confirmation.get("selectedCount") == 2
            and partial_confirmation.get("scope") == "current-device"
            and partial_result.get("succeeded") == 1
            and partial_result.get("failed") == 1
            and partial_result.get("retryVisible") is True
            and set(partial_result.get("selected") or []) == {partial_ids[1]}
            and any(
                item.get("completed") == 1
                and item.get("total") == 2
                for item in partial_progress
                if isinstance(item, dict)
            )
        )
        if not partial_valid:
            raise GateError(
                "Desktop batch partial-failure UI is incomplete: "
                + json.dumps(
                    {
                        "confirmation": partial_confirmation,
                        "progress": partial_progress,
                        "result": partial_result,
                    },
                    sort_keys=True,
                )
            )
        client.find_element("[data-chat-storage-batch-retry]", 10).click()
        retry_confirmation = wait_until(
            lambda: (
                value
                if (
                    isinstance(
                        value := client.execute_script(
                            """
                            const confirmation = document.querySelector(
                              '[data-chat-storage-batch-confirm]'
                            );
                            if (!confirmation) return null;
                            return {
                              selectedCount: Number(
                                confirmation.getAttribute(
                                  'data-chat-storage-batch-selected-count'
                                ) || '0'
                              ),
                              scope: confirmation.getAttribute(
                                'data-chat-storage-batch-scope'
                              ) || '',
                            };
                            """
                        ),
                        dict,
                    )
                    and value.get("selectedCount") == 1
                )
                else None
            ),
            "failed-only Desktop batch retry confirmation",
            timeout=20,
        )
        client.find_element(
            "[data-chat-storage-batch-confirm-apply]",
            10,
        ).click()
        retry_result = self.step(
            "storage.batch.retry",
            lambda: self._wait_batch_result(client, "succeeded"),
            actor,
        )
        self.assert_condition(
            "storage_batch_partial_failure_retry",
            retry_confirmation.get("scope") == "current-device"
            and retry_result.get("succeeded") == 1
            and retry_result.get("failed") == 0,
            json.dumps(
                {
                    "partial": partial_result,
                    "retry": retry_result,
                },
                sort_keys=True,
            ),
        )

        scope_ids = (
            self._seed_conversation(client),
            self._seed_conversation(client),
        )
        self._refresh_conversations(client, scope_ids)
        self._configure_batch_scenario(
            client,
            scopeChangeConversationId=scope_ids[1],
            delayMs=400,
        )
        self._select_conversations(client, scope_ids)
        self._confirmation(client)
        self._install_progress_probe(client)
        client.find_element(
            "[data-chat-storage-batch-confirm-apply]",
            10,
        ).click()
        scope_ui = self.step(
            "storage.batch.scope_change",
            lambda: wait_until(
                lambda: (
                    value
                    if (
                        isinstance(
                            value := client.execute_script(
                                """
                                return {
                                  actions: Boolean(document.querySelector(
                                    '[data-chat-storage-batch-actions]'
                                  )),
                                  result: Boolean(document.querySelector(
                                    '[data-chat-storage-batch-result]'
                                  )),
                                  summary: Boolean(document.querySelector(
                                    '[data-chat-storage-summary]'
                                  )),
                                };
                                """
                            ),
                            dict,
                        )
                        and value == {
                            "actions": False,
                            "result": False,
                            "summary": False,
                        }
                    )
                    else None
                ),
                "Desktop batch scope-change reset",
                timeout=30,
            ),
            actor,
        )
        scope_progress = self._progress_observations(client)
        restored = async_harness(
            client,
            "restoreStorageScope",
            {"actorPtid": self.ptids[actor]},
        )
        scope_snapshot = self._refresh_conversations(
            client,
            (scope_ids[1],),
        )
        scope_conversation_ids = {
            str(item.get("conversationId") or "")
            for item in scope_snapshot.get("conversations", [])
            if isinstance(item, dict)
        }
        scope_completed = max(
            (
                int(item.get("completed") or 0)
                for item in scope_progress
                if isinstance(item, dict) and item.get("total") == 2
            ),
            default=0,
        )
        remaining_scope_ids = tuple(
            conversation_id
            for conversation_id in scope_ids
            if conversation_id in scope_conversation_ids
        )
        self.assert_condition(
            "storage_batch_scope_change_isolated",
            scope_ui == {
                "actions": False,
                "result": False,
                "summary": False,
            }
            and scope_completed in {0, 1}
            and restored == {
                "restored": True,
                "actorPtid": self.ptids[actor],
            }
            and len(remaining_scope_ids) == 2 - scope_completed,
            json.dumps(
                {
                    "completed": scope_completed,
                    "progress": scope_progress,
                    "remainingConversationIds": remaining_scope_ids,
                    "restored": restored,
                    "ui": scope_ui,
                },
                sort_keys=True,
            ),
        )
        self._select_conversations(client, remaining_scope_ids)
        self._confirmation(client)
        client.find_element(
            "[data-chat-storage-batch-confirm-apply]",
            10,
        ).click()
        self._wait_batch_result(client, "succeeded")

        cleared_ids = (
            first_id,
            second_id,
            *partial_ids,
            *scope_ids,
        )

        def verify_restart() -> dict[str, Any]:
            restarted = self.restart_client(actor)
            for conversation_id in cleared_ids:
                projection = async_harness(
                    restarted,
                    "engineMessages",
                    {
                        "actorPtid": self.ptids[actor],
                        "conversationId": conversation_id,
                    },
                )
                if projection != {"messages": []}:
                    raise GateError(
                        "batch-cleared plaintext returned after Desktop restart"
                    )
            unselected = async_harness(
                restarted,
                "engineMessages",
                {
                    "actorPtid": self.ptids[actor],
                    "conversationId": self.storage_conversation_id,
                },
            )
            unselected_messages = (
                unselected.get("messages")
                if isinstance(unselected, dict)
                else None
            )
            return {
                "conversationIds": list(cleared_ids),
                "native": True,
                "unselectedMessageCount": (
                    len(unselected_messages)
                    if isinstance(unselected_messages, list)
                    else 0
                ),
            }

        restart = self.step("storage.batch.restart", verify_restart, actor)
        self.assert_condition(
            "storage_batch_unselected_preserved",
            restart.get("unselectedMessageCount", 0) > 0,
            json.dumps(restart, sort_keys=True),
        )
        self.assert_condition("storage_batch_restart_stable", True)
        self.report.runtime["batchClear"] = {
            "conversationIds": list(cleared_ids),
            "physicalBytesBefore": int(before.get("physicalTotalBytes") or 0),
            "estimatedReclaimableBytes": estimated_reclaimable_bytes,
            **batch_result,
            "partialFailure": partial_result,
            "scopeChangeProgress": scope_progress,
            "restartStable": restart.get("native") is True,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertions = {item.name for item in self.report.assertions}
        missing = BATCH_REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"required batch assertions are missing: {sorted(missing)}"
            )
        result["batchClear"] = self.report.runtime["batchClear"]
        return result


def main() -> int:
    gate: AcceptanceGate = ChatStorageDesktopBatchGate()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
