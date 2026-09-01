#!/usr/bin/env python3
"""Prove that clicking Message opens the chat view even when createDirect fails."""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    GateError,
)
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.fixtures.chat_native_reset import (
    acceptance_station_environment,
)
from tooling.acceptance.fixtures.chat_contact_message_fault_proxy import (
    AcceptanceStationContactMessageFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    DEFAULT_STATION,
    NativeClientLifecycleLedger,
    async_harness,
    cleanup_preserving_primary_failure,
    configure_station,
    enter_chat_page,
    native_runtime_source_identity,
    read_station_version,
    reset_fixture,
    runtime_station_service,
    selected_native_runtime,
    start_authenticated_client,
    stop_client,
    verify_runtime_fixture_ready,
    wait_until,
)


GATE_ID = "chat-contact-message-resilience-e2e"
REPORT_PATH = None
CLIENT_PORT = 4461
NAVIGATION_ASSERTION_DEADLINE_MS = 2000


def selected_runtime() -> tuple[
    dict[str, Any],
    dict[str, Any],
    NativeDesktopRuntimeBinding,
] | None:
    selected = selected_native_runtime(GATE_ID)
    if selected is None:
        return None
    return selected.manifest, selected.actor_manifest, selected.binding


class ContactMessageResilienceGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MP-W13-F"
    bom = ("MP-W13-F",)
    spec = ("chat-product-closure",)
    report_path = REPORT_PATH
    evidence_dir = (
        REPORT_PATH.parent / "chat-contact-message-resilience-evidence"
        if REPORT_PATH is not None
        else None
    )

    def __init__(
        self,
        *,
        manifest: dict[str, Any] | None = None,
        actor_manifest: dict[str, Any] | None = None,
        runtime_binding: NativeDesktopRuntimeBinding | None = None,
    ) -> None:
        super().__init__()
        injected = (manifest, actor_manifest, runtime_binding)
        if any(value is not None for value in injected) and not all(
            value is not None for value in injected
        ):
            raise GateError(
                "runtime manifest, actor manifest, and runtime binding "
                "must be injected together"
            )
        selected_cell = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL",
            "",
        ).strip()
        if selected_cell and runtime_binding is None:
            raise GateError(
                "selected runtime cell requires injected runtime resources"
            )
        if (
            runtime_binding is not None
            and runtime_binding.cell_id != selected_cell
        ):
            raise GateError(
                "injected runtime binding does not match "
                "PT_ACCEPTANCE_RUNTIME_CELL"
            )
        self.runtime_binding = runtime_binding
        self.manifest = manifest or {}
        self.actor_manifest = actor_manifest or {}
        self.client_specs: dict[str, dict[str, Any]] = {}
        self.actor_specs: dict[str, dict[str, Any]] = {}
        if self.runtime_binding is not None:
            station = runtime_station_service(self.manifest)
            self.station_url = str(station.get("endpoint") or "").rstrip("/")
            self.client_specs = {
                str(client.get("actor")): client
                for client in self.manifest.get("clients", [])
                if isinstance(client, dict)
            }
            self.actor_specs = {
                str(actor.get("role")): actor
                for actor in self.actor_manifest.get("actors", [])
                if isinstance(actor, dict)
            }
            if not self.station_url:
                raise GateError("runtime manifest Station URL is required")
            if set(self.client_specs) != {"alice"}:
                raise GateError(
                    "runtime manifest must allocate one isolated Alice client"
                )
            if set(self.actor_specs) != {"alice", "bob"}:
                raise GateError(
                    "actor manifest must contain canonical Alice and Bob identities"
                )
            self.report.manifest = self.manifest
        else:
            self.station_url = os.environ.get(
                "CHAT_NATIVE_STATION_URL",
                DEFAULT_STATION,
            ).rstrip("/")
        self.client: TauriSession | None = None
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.proxy: AcceptanceStationContactMessageFaultProxy | None = None
        self.ptid = ""
        self.bob_ptid = ""
        self.report.runtime.update(
            {
                "runtimeCell": (
                    self.runtime_binding.cell_id
                    if self.runtime_binding is not None
                    else "native-tauri-embedded-webdriver"
                ),
                "journey": "contact-message-resilience",
                "cleanup": {},
            }
        )

    def verify_fixture_ready(self) -> bool:
        if self.runtime_binding is None:
            reset_fixture(("alice", "bob"))
            return True
        verify_runtime_fixture_ready(self.manifest, self.actor_manifest)
        return True

    def source_identity(
        self,
        station_live: dict[str, Any],
    ) -> dict[str, Any]:
        if self.runtime_binding is None:
            return {"stationLive": station_live}
        identity = native_runtime_source_identity(
            gate_id=self.gate_id,
            manifest=self.manifest,
            runtime_binding=self.runtime_binding,
            station_live=station_live,
        )
        runtime_cell = identity["runtimeCell"]
        self.report.runtime["runtimeCellRunId"] = runtime_cell.get("runId")
        self.report.runtime["sourceIdentity"] = identity
        return identity

    def start_client(self) -> tuple[TauriSession, str]:
        if self.runtime_binding is None:
            return start_authenticated_client(
                "alice",
                CLIENT_PORT,
                self.station_url,
                instance="contact-resilience",
            )
        client = self.runtime_binding.create_session(
            "alice",
            self.client_specs["alice"],
            {
                "PEERS_STATION_URL": self.station_url,
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
            },
        )
        self.runtime_instances.append(client)
        expected_ptid = str(self.actor_specs["alice"].get("ptid") or "")
        self.client_lifecycles.register(client, expected_ptid)
        try:
            client.start()
            self.client_lifecycles.mark_live(client)
            client.wait_for_acceptance_harness(30)
            configure_station(client, self.station_url)
            account_ref = str(
                self.actor_specs["alice"].get("accountRef") or ""
            )
            login = async_harness(
                client,
                "loginWithPassword",
                {
                    "account": account_ref.removeprefix("station-account:"),
                    "password": DEV_ACCOUNT_PASSWORD,
                },
                timeout=30,
            )
            if not (login or {}).get("authenticated"):
                raise GateError("alice login did not authenticate")
            self.client_lifecycles.mark_authenticated(client)
            hydration = async_harness(
                client,
                "hydrateActiveActor",
                {},
                timeout=30,
            )
            ptid = str((hydration or {}).get("actorPtid") or "")
            if ptid != expected_ptid:
                raise GateError(
                    "alice login identity mismatch: "
                    f"expected={expected_ptid} actual={ptid}"
                )
            if not client.get_current_url().startswith("tauri://localhost"):
                raise GateError(
                    "alice is not running in native Tauri WebView: "
                    f"{client.get_current_url()}"
                )
            return client, ptid
        except Exception as error:
            cleanup_errors = self.client_lifecycles.release(client)
            if cleanup_errors and hasattr(error, "add_note"):
                error.add_note(
                    "Contact resilience launch cleanup also failed: "
                    f"{json.dumps(cleanup_errors, sort_keys=True)}"
                )
            raise

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
            self.save_screenshot(self.client, label)
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
            with tempfile.NamedTemporaryFile(
                suffix=".json",
                delete=False,
                mode="w",
                encoding="utf-8",
            ) as temporary:
                json.dump(result, temporary, indent=2, ensure_ascii=False)
                temporary.write("\n")
                dom_path = Path(temporary.name)
            try:
                self.report.add_evidence_file(
                    f"{label}-diagnostics",
                    dom_path,
                    destination_dir=self.evidence_dir,
                )
            finally:
                dom_path.unlink(missing_ok=True)
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

    def cleanup_runtime(self) -> dict[str, Any]:
        cleanup_errors: list[dict[str, str]] = []
        if self.proxy:
            try:
                self.proxy.disarm()
                self.proxy.stop()
            except Exception as error:
                cleanup_errors.append(
                    {"resource": "contact-message-proxy", "error": str(error)}
                )
            self.proxy = None
        if self.client:
            try:
                configure_station(self.client, self.station_url)
            except Exception as error:
                cleanup_errors.append(
                    {
                        "resource": "client-station-restore",
                        "error": str(error),
                    }
                )
            try:
                if self.runtime_binding is None:
                    stop_client(self.client)
                else:
                    cleanup_errors.extend(
                        self.client_lifecycles.release_all()
                    )
            except Exception as error:
                cleanup_errors.append(
                    {
                        "resource": f"client:{self.client.profile}",
                        "error": str(error),
                    }
                )

        if self.runtime_binding is None:
            cleanup = {
                "clientsStopped": ["alice"] if self.client else [],
                "cleanupErrors": cleanup_errors,
            }
            self.report.runtime["cleanup"] = cleanup
            return cleanup
        try:
            cleanup = self.runtime_binding.finalize_cleanup(
                self.runtime_instances,
                self.client_specs,
            )
        except Exception as error:
            cleanup = {
                "portsReleased": False,
                "processesReleased": False,
                "storageReleased": False,
                "logsReleased": False,
                "cleanupErrors": [
                    {
                        "resource": "runtime-binding",
                        "error": str(error),
                    }
                ],
            }
        binding_errors = cleanup.get("cleanupErrors")
        if isinstance(binding_errors, list):
            cleanup_errors.extend(
                error
                for error in binding_errors
                if isinstance(error, dict)
            )
        cleanup["cleanupErrors"] = cleanup_errors
        self.report.runtime["cleanup"] = cleanup
        cleanup_passed = (
            bool(cleanup.get("portsReleased"))
            and bool(cleanup.get("processesReleased"))
            and bool(cleanup.get("storageReleased"))
            and bool(cleanup.get("logsReleased"))
            and not cleanup_errors
        )
        if not cleanup_passed:
            raise GateError(
                "contact resilience runtime cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return cleanup

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        if self.runtime_binding is None:
            try:
                acceptance_station_environment(self.station_url)
            except RuntimeError as error:
                raise GateError(str(error)) from error

        self.report.station_url = self.station_url
        steps: list[dict[str, Any]] = []
        result: dict[str, Any] = {}
        cleanup: dict[str, Any] = {}

        try:
            source_identity = (
                self.source_identity(
                    read_station_version(self.station_url)
                )
                if self.runtime_binding is not None
                else {}
            )
            steps.append({"step": "fixture.reset", "status": "start"})
            self.verify_fixture_ready()
            steps.append({"step": "fixture.reset", "status": "pass"})

            steps.append({"step": "client.authenticated", "status": "start"})
            self.client, self.ptid = self.start_client()
            self.register_driver(self.client)
            self.report.add_actor(
                ActorRuntime(
                    name="alice",
                    runtime=(
                        self.runtime_binding.cell_id
                        if self.runtime_binding is not None
                        else "native-tauri-embedded-webdriver"
                    ),
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
            proxy_url = (
                self.runtime_binding.expose_orchestrator_endpoint(
                    self.proxy.url
                ).url
                if self.runtime_binding is not None
                else self.proxy.url
            )
            configure_station(self.client, proxy_url)
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

            result = {
                "runtimeCell": (
                    self.runtime_binding.cell_id
                    if self.runtime_binding is not None
                    else "native-tauri-embedded-webdriver"
                ),
                "bobPtid": self.bob_ptid,
                "navigationMs": navigation_ms,
                "proxyEvidence": evidence,
                "sourceIdentity": source_identity,
                "steps": steps,
            }
        finally:
            cleanup = cleanup_preserving_primary_failure(
                self.cleanup_runtime,
                self.report,
                "Contact message resilience",
            )
            self.report.runtime["steps"] = steps
        result["cleanup"] = cleanup
        return result


if __name__ == "__main__":
    runtime = selected_runtime()
    gate = (
        ContactMessageResilienceGate()
        if runtime is None
        else ContactMessageResilienceGate(
            manifest=runtime[0],
            actor_manifest=runtime[1],
            runtime_binding=runtime[2],
        )
    )
    raise SystemExit(gate.execute())
