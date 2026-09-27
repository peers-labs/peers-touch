#!/usr/bin/env python3
"""Prove Chat storage accounting through the native Desktop surface."""

from __future__ import annotations

import json
import os
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.gates.chat.native_two_client_runner import (
    NativeTwoClientGate,
    runtime_manifest,
    wait_until,
)


GATE_ID = "chat-storage-accounting-e2e"
STORAGE_REQUIRED_ASSERTIONS = {
    "storage_physical_total",
    "storage_category_accounting",
    "storage_conversation_usage",
    "storage_search",
    "storage_sort",
    "storage_refresh",
}
STORAGE_REQUIRED_STEPS = {
    "storage.navigate",
    "storage.snapshot",
    "storage.search",
    "storage.sort",
    "storage.refresh",
}


def storage_snapshot_is_valid(
    snapshot: object,
    conversation_id: str,
) -> bool:
    if not isinstance(snapshot, dict):
        return False
    categories = snapshot.get("categories")
    conversations = snapshot.get("conversations")
    if not isinstance(categories, dict) or not isinstance(conversations, list):
        return False
    matching = [
        item
        for item in conversations
        if isinstance(item, dict)
        and item.get("conversationId") == conversation_id
    ]
    return (
        int(snapshot.get("physicalTotalBytes") or 0) > 0
        and set(categories) == {"message", "media", "cache", "system"}
        and all(int(value or 0) >= 0 for value in categories.values())
        and len(matching) == 1
        and int(matching[0].get("messageBytes") or 0) > 0
    )


class ChatStorageAccountingGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "chat-storage-accounting"
    bom = ("CSG-G01",)
    spec = ("chat-storage-observability",)

    def __init__(self) -> None:
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if cell_id != "desktop-macos-native":
            raise GateError(
                "Chat storage accounting requires desktop-macos-native"
            )
        manifest, actor_manifest = runtime_manifest(self.gate_id)
        source = manifest.get("source")
        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        if not source_commit:
            raise GateError("runtime manifest source commit is required")
        runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=self.gate_id,
            source_commit=source_commit,
        )
        runtime_binding.set_runtime_manifest(manifest)
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=self.gate_id,
            allow_existing_fixture=False,
        )
        self.report.runtime["journey"] = "storage-observability"
        self.storage_conversation_id = ""

    def open_conversation(self) -> str:
        conversation_id = super().open_conversation()
        self.storage_conversation_id = conversation_id
        return conversation_id

    @staticmethod
    def _storage_snapshot(client: Any) -> dict[str, Any] | None:
        snapshot = client.execute_script(
            """
            const summary = document.querySelector(
              '[data-chat-storage-summary]'
            );
            if (!summary) return null;
            const categories = {};
            for (const item of document.querySelectorAll(
              '[data-chat-storage-category]'
            )) {
              categories[item.getAttribute('data-chat-storage-category')] =
                Number(item.getAttribute('data-chat-storage-category-bytes'));
            }
            const conversations = Array.from(document.querySelectorAll(
              '[data-chat-storage-conversation]'
            )).map((item) => ({
              conversationId:
                item.getAttribute('data-chat-storage-conversation') || '',
              messageBytes: Number(
                item.getAttribute('data-chat-storage-message-bytes')
              ),
              mediaBytes: Number(
                item.getAttribute('data-chat-storage-media-bytes')
              ),
              reclaimableBytes: Number(
                item.getAttribute('data-chat-storage-reclaimable-bytes')
              ),
              text: item.innerText || '',
            }));
            return {
              physicalTotalBytes: Number(
                summary.getAttribute('data-chat-storage-physical-bytes')
              ),
              measuredAtUnixMs: Number(
                summary.getAttribute('data-chat-storage-measured-at')
              ),
              categories,
              conversations,
              sortMode: document.querySelector('[data-chat-storage-sort]')
                ?.getAttribute('data-chat-storage-sort') || '',
            };
            """
        )
        return snapshot if isinstance(snapshot, dict) else None

    @staticmethod
    def _set_search(client: Any, value: str) -> None:
        client.execute_script(
            """
            const host = document.querySelector('[data-chat-storage-search]');
            const input = host?.matches('input') ? host : host?.querySelector(
              'input'
            );
            if (!input) throw new Error('storage search input missing');
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value',
            )?.set;
            if (!setter) throw new Error('input setter missing');
            setter.call(input, arguments[0]);
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: arguments[0],
              inputType: 'insertText',
            }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            value,
        )

    def prove_additional_journey_assertions(self) -> None:
        actor = self.direction_order[0]
        client = self.clients[actor]
        conversation_id = self.storage_conversation_id
        if not conversation_id:
            raise GateError("storage journey has no conversation identity")

        def navigate() -> bool:
            clicked = client.execute_script(
                """
                const wrapper = document.querySelector(
                  '[data-pt-primary-nav="settings"]'
                );
                const target = wrapper?.querySelector(
                  'button, [role="button"]'
                ) || wrapper?.firstElementChild;
                if (!target) return '';
                target.click();
                return target.tagName || 'clicked';
                """
            )
            if not clicked:
                raise GateError("Settings navigation action is unavailable")
            wait_until(
                lambda: client.execute_script(
                    """
                    const page = document.querySelector(
                      '[data-page="settings"]'
                    );
                    return page?.style.display === 'contents'
                      ? 'visible'
                      : '';
                    """
                ),
                "visible Settings page",
                timeout=20,
            )
            client.find_element(
                '[data-pt-secondary-tab="data"]',
                20,
            ).click()
            storage_sections = client.find_elements(
                '[data-pt-section-item="storage"]'
            )
            if storage_sections:
                storage_sections[0].click()
            wait_until(
                lambda: (
                    summary
                    if (
                        summary := client.find_element(
                            "[data-chat-storage-summary]",
                            10,
                        )
                    ).is_displayed()
                    else None
                ),
                "visible Chat storage summary",
                timeout=30,
            )
            return True

        self.step("storage.navigate", navigate, actor)
        snapshot = self.step(
            "storage.snapshot",
            lambda: wait_until(
                lambda: (
                    value
                    if storage_snapshot_is_valid(
                        value := self._storage_snapshot(client),
                        conversation_id,
                    )
                    else None
                ),
                "non-zero Chat storage snapshot",
                timeout=45,
            ),
            actor,
        )
        self.assert_condition(
            "storage_physical_total",
            int(snapshot.get("physicalTotalBytes") or 0) > 0,
            json.dumps(snapshot, sort_keys=True),
        )
        self.assert_condition(
            "storage_category_accounting",
            set(snapshot.get("categories") or {})
            == {"message", "media", "cache", "system"},
            json.dumps(snapshot.get("categories"), sort_keys=True),
        )
        self.assert_condition(
            "storage_conversation_usage",
            storage_snapshot_is_valid(snapshot, conversation_id),
            json.dumps(snapshot.get("conversations"), sort_keys=True),
        )

        def search() -> dict[str, Any] | None:
            self._set_search(client, conversation_id)
            value = self._storage_snapshot(client)
            rows = value.get("conversations") if isinstance(value, dict) else None
            return value if (
                isinstance(rows, list)
                and len(rows) == 1
                and rows[0].get("conversationId") == conversation_id
            ) else None

        searched = self.step(
            "storage.search",
            lambda: wait_until(
                search,
                "conversation storage search result",
                timeout=20,
            ),
            actor,
        )
        self.assert_condition(
            "storage_search",
            len(searched.get("conversations") or []) == 1,
            json.dumps(searched, sort_keys=True),
        )

        def sort_recent() -> dict[str, Any] | None:
            client.find_element(
                '[data-chat-storage-sort-option="recent"]',
                10,
            ).click()
            return wait_until(
                lambda: (
                    value
                    if (
                        isinstance(
                            value := self._storage_snapshot(client),
                            dict,
                        )
                        and value.get("sortMode") == "recent"
                    )
                    else None
                ),
                "recent storage sort",
                timeout=10,
            )

        sorted_snapshot = self.step("storage.sort", sort_recent, actor)
        self.assert_condition(
            "storage_sort",
            sorted_snapshot.get("sortMode") == "recent",
            json.dumps(sorted_snapshot, sort_keys=True),
        )

        initial_measured_at = int(snapshot.get("measuredAtUnixMs") or 0)

        def refresh() -> dict[str, Any] | None:
            client.find_element("[data-chat-storage-refresh]", 10).click()
            return wait_until(
                lambda: (
                    value
                    if (
                        storage_snapshot_is_valid(
                            value := self._storage_snapshot(client),
                            conversation_id,
                        )
                        and int(value.get("measuredAtUnixMs") or 0)
                        >= initial_measured_at
                    )
                    else None
                ),
                "refreshed Chat storage snapshot",
                timeout=45,
            )

        refreshed = self.step("storage.refresh", refresh, actor)
        self.assert_condition(
            "storage_refresh",
            storage_snapshot_is_valid(refreshed, conversation_id),
            json.dumps(refreshed, sort_keys=True),
        )
        self.report.runtime["storageSnapshot"] = refreshed

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertions = {item.name for item in self.report.assertions}
        missing = STORAGE_REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"required storage assertions are missing: {sorted(missing)}"
            )
        result["storageSnapshot"] = self.report.runtime["storageSnapshot"]
        return result


def main() -> int:
    gate: AcceptanceGate = ChatStorageAccountingGate()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
