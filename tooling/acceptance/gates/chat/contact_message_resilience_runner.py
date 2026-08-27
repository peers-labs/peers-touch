#!/usr/bin/env python3
"""Prove that clicking Message opens the chat view even when createDirect fails."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPORTS_DIR
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.fixtures.chat_native_reset import (
    acceptance_station_environment,
)
from tooling.acceptance.fixtures.chat_contact_message_fault_proxy import (
    AcceptanceStationContactMessageFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    async_harness,
    configure_station,
    enter_chat_page,
    reset_fixture,
    start_authenticated_client,
    wait_until,
)


REPORT_PATH = Path(
    os.environ.get(
        "CHAT_CONTACT_MESSAGE_RESILIENCE_REPORT",
        str(REPORTS_DIR / "chat-contact-message-resilience.json"),
    )
)
CLIENT_PORT = 4461
NAVIGATION_ASSERTION_DEADLINE_MS = 2000


class ContactMessageResilienceGate(AcceptanceGate):
    gate_id = "chat-contact-message-resilience-e2e"
    report_path = REPORT_PATH
    evidence_dir = REPORT_PATH.parent / "chat-contact-message-resilience-evidence"

    def __init__(self) -> None:
        super().__init__()
        self.station_url = os.environ.get(
            "CHAT_NATIVE_STATION_URL",
            DEFAULT_STATION,
        ).rstrip("/")
        self.client: TauriSession | None = None
        self.proxy: AcceptanceStationContactMessageFaultProxy | None = None
        self.ptid = ""
        self.bob_ptid = ""

    def _switch_to_contacts(self) -> None:
        driver = self.client.driver
        contacts_tab = WebDriverWait(driver, 10).until(
            lambda d: d.find_element(By.CSS_SELECTOR, '[data-chat-subpage="contacts"]')
        )
        contacts_tab.click()
        WebDriverWait(driver, 10).until(
            lambda d: d.find_element(
                By.CSS_SELECTOR, '[data-chat-contact-ptid]'
            )
        )

    def _select_contact(self, ptid: str) -> None:
        driver = self.client.driver
        selector = f'[data-chat-contact-ptid="{ptid}"]'
        contact = WebDriverWait(driver, 10).until(
            lambda d: d.find_element(By.CSS_SELECTOR, selector)
        )
        contact.click()
        WebDriverWait(driver, 10).until(
            lambda d: d.find_element(By.CSS_SELECTOR, '[data-chat-contact-message]')
        )

    def _click_message_button(self) -> None:
        driver = self.client.driver
        btn = driver.find_element(By.CSS_SELECTOR, '[data-chat-contact-message]')
        btn.click()

    def _chats_subpage_active(self) -> bool:
        driver = self.client.driver
        try:
            indicator = driver.find_element(
                By.CSS_SELECTOR, '[data-chat-subpage="chats"]'
            )
            classes = indicator.get_attribute("class") or ""
            style = indicator.get_attribute("style") or ""
            return "active" in classes.lower() or "color" in style.lower()
        except Exception:
            return False

    def _chat_area_visible(self) -> bool:
        driver = self.client.driver
        try:
            driver.find_element(By.CSS_SELECTOR, '[data-chat-typing]')
            return True
        except Exception:
            return False

    def _snapshot_regions(self) -> set[str]:
        if not self.client:
            return set()
        try:
            result = self.client.execute_script(
                """
                return Array.from(document.querySelectorAll('[role="region"]'))
                  .map(el => (el.textContent || '').trim())
                  .filter(t => t.length > 0);
                """
            )
            return set(result) if isinstance(result, list) else set()
        except Exception:
            return set()

    def _error_presented(self, baseline: set[str]) -> bool:
        if not self.client:
            return False
        try:
            result = self.client.execute_script(
                """
                const baseline = arguments[0];
                const hasVisibleContent = (el) => {
                  const style = window.getComputedStyle(el);
                  if (style.display === 'none' || style.visibility === 'hidden') return false;
                  if (parseFloat(style.opacity || '1') < 0.1) return false;
                  if (el.children.length === 0) return el.textContent.trim().length > 0;
                  for (const child of el.children) {
                    if (hasVisibleContent(child)) return true;
                  }
                  return false;
                };
                for (const role of ['status', 'alert', 'log']) {
                  for (const el of document.querySelectorAll(`[role="${role}"]`)) {
                    const text = (el.textContent || '').trim();
                    if (text.length > 2 && !baseline.includes(text) && hasVisibleContent(el))
                      return true;
                  }
                }
                for (const el of document.querySelectorAll('[role="region"]')) {
                  const text = (el.textContent || '').trim();
                  if (text.length < 3 || text.length > 500) continue;
                  if (baseline.includes(text)) continue;
                  if (hasVisibleContent(el)) return true;
                }
                return false;
                """,
                list(baseline),
            )
            return bool(result)
        except Exception:
            return False

    def _dump_diagnostics(self, label: str) -> None:
        if not self.client:
            return
        try:
            shot_path = self.evidence_dir / f"{label}.png"
            shot_path.parent.mkdir(parents=True, exist_ok=True)
            self.client.save_screenshot(shot_path)
            result = self.client.execute_script(
                """
                const regions = Array.from(document.querySelectorAll('[role="region"]'))
                  .map((el, i) => ({i, text: (el.textContent||'').trim().slice(0,200),
                    cls: (el.className||'').slice(0,80),
                    visible: (() => { const s = getComputedStyle(el);
                      return s.display !== 'none' && s.visibility !== 'hidden'
                        && parseFloat(s.opacity||'1') > 0.1
                        && el.getBoundingClientRect().width > 1; })()}));
                const roles = ['alert','status','log'].flatMap(r =>
                  Array.from(document.querySelectorAll(`[role="${r}"]`))
                    .map(el => ({role: r, text: (el.textContent||'').trim().slice(0,200),
                      cls: (el.className||'').slice(0,80)})));
                return {bodyText: document.body?.innerText?.slice(-1000) || '', regions, roles};
                """
            )
            baseline = getattr(self, '_last_baseline', set())
            result['baselineRegions'] = list(baseline)
            import json
            dom_path = self.evidence_dir / f"{label}-dom.json"
            dom_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    def _get_first_friend_ptid(self) -> str:
        if not self.client:
            raise GateError("client not started")
        driver = self.client.driver
        elements = driver.find_elements(
            By.CSS_SELECTOR, '[data-chat-contact-ptid]'
        )
        for el in elements:
            ptid = el.get_attribute("data-chat-contact-ptid") or ""
            if ptid.startswith("ptid:"):
                return ptid
        raise GateError("no friend contacts found in contacts panel")

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        try:
            acceptance_station_environment(self.station_url)
        except RuntimeError as error:
            raise GateError(str(error)) from error

        self.report.station_url = self.station_url
        steps: list[dict[str, Any]] = []

        try:
            steps.append({"step": "fixture.reset", "status": "start"})
            reset_fixture(("alice", "bob"))
            steps.append({"step": "fixture.reset", "status": "pass"})

            steps.append({"step": "client.authenticated", "status": "start"})
            self.client, self.ptid = start_authenticated_client(
                "alice",
                CLIENT_PORT,
                self.station_url,
                instance="contact-resilience",
            )
            self.register_driver(self.client)
            self.report.add_actor(
                ActorRuntime(
                    name="alice",
                    runtime="native-tauri-embedded-webdriver",
                    port=self.client.port,
                    gateway_port=self.client.gateway_port,
                    profile=self.client.profile,
                    storage_root=self.client.storage_root,
                    pid=self.client.process_id,
                )
            )
            enter_chat_page(self.client)
            steps.append({"step": "client.authenticated", "status": "pass"})

            steps.append({"step": "navigate.contacts", "status": "start"})
            self._switch_to_contacts()
            self.bob_ptid = self._get_first_friend_ptid()
            self._select_contact(self.bob_ptid)
            steps.append({"step": "navigate.contacts", "status": "pass", "ptid": self.bob_ptid})

            steps.append({"step": "proxy.start", "status": "start"})
            self.proxy = AcceptanceStationContactMessageFaultProxy(
                self.station_url
            )
            self.proxy.start()
            configure_station(self.client, self.proxy.url)
            self.proxy.arm_create_direct_failure()
            steps.append({"step": "proxy.start", "status": "pass"})

            steps.append({"step": "message.click", "status": "start"})
            baseline_regions = self._snapshot_regions()
            click_start = time.monotonic()
            self._click_message_button()
            self._last_baseline = baseline_regions

            navigated_fast = False
            deadline = click_start + (NAVIGATION_ASSERTION_DEADLINE_MS / 1000)
            while time.monotonic() < deadline:
                if self._chats_subpage_active() or self._chat_area_visible():
                    navigated_fast = True
                    break
                time.sleep(0.05)
            navigation_ms = int((time.monotonic() - click_start) * 1000)

            self.assert_condition(
                "navigation_before_create_direct_resolves",
                navigated_fast,
                f"chat view did not appear within {NAVIGATION_ASSERTION_DEADLINE_MS}ms "
                f"(took {navigation_ms}ms); navigation must not be blocked by createDirect failure",
            )
            steps.append({"step": "message.click", "status": "pass", "navigationMs": navigation_ms})

            steps.append({"step": "error.presented", "status": "start"})
            try:
                error_visible = wait_until(
                    lambda: self._error_presented(baseline_regions),
                    "error presentation after createDirect failure",
                    8,
                )
            except GateError:
                self._dump_diagnostics("toast-timeout")
                if self.proxy:
                    proxy_ev = self.proxy.evidence()
                    steps.append({"step": "proxy.evidence", "status": "info", "evidence": proxy_ev})
                raise
            self.assert_condition(
                "error_displayed_in_open_view",
                bool(error_visible),
                "error toast must be presented within the already-open chat view",
            )
            steps.append({"step": "error.presented", "status": "pass"})

            time.sleep(1)
            evidence = self.proxy.evidence()
            self.assert_condition(
                "create_direct_was_intercepted",
                evidence["interceptedCount"] >= 1,
                f"proxy should have intercepted createDirect, got: {evidence}",
            )
            self.assert_condition(
                "proxy_forwarded_other_traffic",
                evidence["forwardedCount"] >= 1,
                f"proxy should have forwarded non-createDirect traffic, got: {evidence}",
            )

            return {
                "bobPtid": self.bob_ptid,
                "navigationMs": navigation_ms,
                "proxyEvidence": evidence,
                "steps": steps,
            }
        finally:
            if self.proxy:
                try:
                    self.proxy.disarm()
                    self.proxy.stop()
                except Exception:
                    pass
                self.proxy = None
            if self.client:
                try:
                    configure_station(self.client, self.station_url)
                except Exception:
                    pass


if __name__ == "__main__":
    raise SystemExit(ContactMessageResilienceGate().execute())
