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
    "storage_batch_estimated_reclaimable",
    "storage_batch_canonical_result",
    "storage_batch_physical_reclaim",
    "storage_batch_restart_stable",
}
BATCH_REQUIRED_STEPS = {
    "storage.batch.fixture",
    "storage.batch.select",
    "storage.batch.confirm",
    "storage.batch.result",
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
        self._set_search(client, "")
        client.find_element("[data-chat-storage-refresh]", 10).click()

        before = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self._storage_snapshot(client),
                        dict,
                    )
                    and {first_id, second_id}.issubset(
                        {
                            str(item.get("conversationId") or "")
                            for item in snapshot.get("conversations", [])
                            if isinstance(item, dict)
                        }
                    )
                )
                else None
            ),
            "two batch-clear storage rows",
            timeout=60,
        )

        def select_rows() -> dict[str, Any]:
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
            for conversation_id in (first_id, second_id):
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
                        == {first_id, second_id}
                        and value.get("clearEnabled") is True
                    )
                    else None
                ),
                "two selected storage rows",
                timeout=20,
            )

        selected = self.step(
            "storage.batch.select",
            select_rows,
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

        def confirm() -> int | None:
            client.find_element("[data-chat-storage-batch-clear]", 10).click()
            button = client.find_element(
                "[data-chat-storage-batch-confirm-apply]",
                10,
            )
            if not button.is_displayed() or not button.is_enabled():
                return None
            return client.execute_script(
                """
                const confirmation = document.querySelector(
                  '[data-chat-storage-batch-confirm]'
                );
                if (!confirmation) return null;
                return Number(
                  confirmation.getAttribute(
                    'data-chat-storage-batch-estimated-bytes'
                  ) || '0'
                );
                """
            )

        displayed_estimate = self.step("storage.batch.confirm", confirm, actor)
        self.assert_condition(
            "storage_batch_estimated_reclaimable",
            estimated_reclaimable_bytes > 0
            and displayed_estimate == estimated_reclaimable_bytes,
            json.dumps(
                {
                    "expected": estimated_reclaimable_bytes,
                    "displayed": displayed_estimate,
                },
                sort_keys=True,
            ),
        )
        client.find_element(
            "[data-chat-storage-batch-confirm-apply]",
            10,
        ).click()

        batch_result = self.step(
            "storage.batch.result",
            lambda: wait_until(
                lambda: client.execute_script(
                    """
                    const result = document.querySelector(
                      '[data-chat-storage-batch-result="succeeded"]'
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
                    };
                    """
                ),
                "Desktop batch clear result",
                timeout=120,
            ),
            actor,
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

        def verify_restart() -> dict[str, Any]:
            restarted = self.restart_client(actor)
            for conversation_id in (first_id, second_id):
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
            return {
                "conversationIds": [first_id, second_id],
                "native": True,
            }

        restart = self.step("storage.batch.restart", verify_restart, actor)
        self.assert_condition("storage_batch_restart_stable", True)
        self.report.runtime["batchClear"] = {
            "conversationIds": [first_id, second_id],
            "physicalBytesBefore": int(before.get("physicalTotalBytes") or 0),
            "estimatedReclaimableBytes": estimated_reclaimable_bytes,
            **batch_result,
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
