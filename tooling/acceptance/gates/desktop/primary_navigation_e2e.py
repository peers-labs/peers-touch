#!/usr/bin/env python3
"""Prove Desktop navigation ownership in a Native Tauri process."""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    EvidenceStore,
    GateError,
    REPORTS_DIR,
    call_async_harness,
    load_runtime_manifest,
)
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeKey,
    resolve_native_desktop_runtime,
)
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import DEV_ACCOUNT_PASSWORD


REPO_ROOT = Path(__file__).resolve().parents[4]
GATE_ID = "desktop-primary-navigation-e2e"
CLIENT_ID = "alice"
ENVIRONMENT_ID = "desktop-primary-navigation-native"
REPORT_PATH = REPORTS_DIR / f"{GATE_ID}.json"
EVIDENCE_DIR = REPORTS_DIR / "evidence" / GATE_ID


class DesktopPrimaryNavigationGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "DPNC-J01"
    bom = ("DPNC-01-DESKTOP-CUTOVER",)
    spec = ("DPNC-D01", "DPNC-D02")
    report_path = REPORT_PATH
    evidence_dir = EVIDENCE_DIR

    def __init__(self) -> None:
        super().__init__()
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.manifest = load_runtime_manifest(
            Path(manifest_path),
            self.gate_id,
        )
        if self.manifest.get("environmentId") != ENVIRONMENT_ID:
            raise GateError(
                "Desktop navigation requires the native environment"
            )
        clients = self.manifest.get("clients")
        if (
            not isinstance(clients, list)
            or len(clients) != 1
            or clients[0].get("id") != CLIENT_ID
            or clients[0].get("runtime") != "native-tauri"
        ):
            raise GateError(
                "Desktop navigation requires one Native Tauri client"
            )
        source = self.manifest.get("source")
        if (
            not isinstance(source, dict)
            or source.get("workspaceDigest") != "clean"
            or not source.get("commit")
        ):
            raise GateError(
                "Desktop navigation native proof requires clean source"
            )
        cell_id = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL",
            "",
        ).strip()
        if cell_id != "desktop-macos-native":
            raise GateError(
                "Desktop navigation requires desktop-macos-native"
            )
        self.client_spec = clients[0]
        self.runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=self.gate_id,
            source_commit=str(source["commit"]),
        )
        self.runtime_binding.set_runtime_manifest(self.manifest)
        self.actor = self._load_actor()
        self.report.manifest = self.manifest

    def _load_actor(self) -> dict[str, Any]:
        actor_ref = self.manifest.get("actorManifest")
        if not isinstance(actor_ref, dict):
            raise GateError(
                "Desktop navigation runtime omitted actorManifest"
            )
        actors = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        ).read_json(ArtifactRef.from_dict(actor_ref))
        for actor in actors.get("actors", []):
            if isinstance(actor, dict) and actor.get("role") == CLIENT_ID:
                return actor
        raise GateError(
            "Desktop navigation actor manifest omitted Alice"
        )

    @staticmethod
    def _wait(
        session: TauriSession,
        expression: str,
        description: str,
        timeout: float = 30,
    ) -> Any:
        try:
            return WebDriverWait(
                session.driver,
                timeout,
                poll_frequency=0.1,
            ).until(
                lambda driver: driver.execute_script(
                    f"return Boolean({expression})"
                )
            )
        except Exception as error:
            raise GateError(
                f"timed out waiting for {description}: {error}"
            ) from error

    @staticmethod
    def _click(session: TauriSession, selector: str) -> None:
        element = session.find_element(selector, 30)
        element.click()

    @staticmethod
    def _text_present(
        session: TauriSession,
        selector: str,
        expected: str,
    ) -> bool:
        return bool(
            session.execute_script(
                """
                return [...document.querySelectorAll(arguments[0])]
                  .some((element) => element.textContent?.trim() === arguments[1]);
                """,
                selector,
                expected,
            )
        )

    def _native_click(
        self,
        session: TauriSession,
        selector: str,
    ) -> dict[str, Any]:
        process_id = session.process_id
        if process_id is None:
            raise GateError(
                "Native Desktop process identity is unavailable"
            )
        self.runtime_binding.request_cooperative_activation(
            session,
            (session,),
        )
        self._wait(
            session,
            "document.hasFocus()",
            "Native Desktop focus",
        )
        element = session.find_element(selector, 30)
        geometry = session.execute_script(
            """
            const rect = arguments[0].getBoundingClientRect();
            return {
              element: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              },
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
              },
            };
            """,
            element,
        )
        driver_window = session.driver.get_window_rect()
        ratio = float(geometry["viewport"]["devicePixelRatio"])
        native_window = {
            "left": float(driver_window["x"]) / ratio,
            "top": float(driver_window["y"]) / ratio,
            "width": float(driver_window["width"]) / ratio,
            "height": float(driver_window["height"]) / ratio,
        }
        origin = self.runtime_binding.native_adapter.content_origin(
            process_id
        )
        if origin is None:
            origin = (
                native_window["left"]
                + max(
                    0.0,
                    (
                        native_window["width"]
                        - float(geometry["viewport"]["width"])
                    )
                    / 2,
                ),
                native_window["top"]
                + max(
                    0.0,
                    native_window["height"]
                    - float(geometry["viewport"]["height"]),
                ),
            )
        point = (
            origin[0]
            + float(geometry["element"]["left"])
            + float(geometry["element"]["width"]) / 2,
            origin[1]
            + float(geometry["element"]["top"])
            + float(geometry["element"]["height"]) / 2,
        )
        adapter = self.runtime_binding.native_adapter
        adapter.post_mouse((MouseAction.LEFT_DOWN,), point)
        adapter.post_mouse((MouseAction.LEFT_UP,), point)
        return {
            "adapter": adapter.platform,
            "processId": process_id,
            "selector": selector,
            "point": {"x": point[0], "y": point[1]},
        }

    def _login(self, session: TauriSession) -> dict[str, Any]:
        account_ref = str(self.actor.get("accountRef") or "")
        account = account_ref.removeprefix("station-account:")
        if not account:
            raise GateError(
                "Desktop navigation actor account is unavailable"
            )
        login = call_async_harness(
            session,
            "loginWithPassword",
            {
                "account": account,
                "password": DEV_ACCOUNT_PASSWORD,
            },
            namespace="chat",
            script_timeout=30,
        )
        if not isinstance(login, dict) or login.get("authenticated") is not True:
            raise GateError(
                "Desktop navigation actor login did not authenticate"
            )
        self._wait(
            session,
            "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
            "authenticated Native Desktop shell",
        )
        return login

    def _install_observer(self, session: TauriSession) -> None:
        installed = session.execute_script(
            """
            const internals = window.__TAURI_INTERNALS__;
            if (!internals || typeof internals.invoke !== 'function') {
              return false;
            }
            if (window.__PT_NATIVE_NAV_INVOCATIONS__) return true;
            const counts = Object.create(null);
            const original = internals.invoke.bind(internals);
            internals.invoke = (command, args, options) => {
              counts[command] = (counts[command] || 0) + 1;
              return original(command, args, options);
            };
            Object.defineProperty(window, '__PT_NATIVE_NAV_INVOCATIONS__', {
              configurable: false,
              value: counts,
              writable: false,
            });
            return true;
            """
        )
        if installed is not True:
            raise GateError(
                "Native Desktop invocation observer could not be installed"
            )

    @staticmethod
    def _invocation_count(
        session: TauriSession,
        command: str,
    ) -> int:
        return int(
            session.execute_script(
                """
                return Number(
                  window.__PT_NATIVE_NAV_INVOCATIONS__?.[arguments[0]] || 0
                );
                """,
                command,
            )
        )

    def _run_journey(
        self,
        session: TauriSession,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        assertions: dict[str, bool] = {}
        self._login(session)
        self._install_observer(session)

        session.execute_script(
            "location.hash = '#/notes/legacy-document'"
        )
        self._wait(
            session,
            "document.querySelector('[data-page=\"search\"]')",
            "legacy Notes route fallback",
        )
        for entry in ("notes", "oss", "cron", "channels"):
            self.assert_condition(
                f"primary_navigation_omits_{entry}",
                len(
                    session.find_elements(
                        f'[data-pt-primary-nav="{entry}"]'
                    )
                )
                == 0,
            )
        self.assert_condition(
            "primary_navigation_omits_command_palette",
            len(
                session.find_elements(
                    'button[title^="Command palette"]'
                )
            )
            == 0,
        )
        assertions["primary_navigation_clean"] = True
        assertions["notes_route_falls_back_without_applet_redirect"] = True

        self._click(
            session,
            '[data-pt-primary-nav="applets"]',
        )
        self._wait(
            session,
            "document.querySelector('[data-applet-open=\"peers.note\"]')",
            "official Note applet",
        )
        self._click(session, '[data-applet-open="peers.note"]')
        self._wait(
            session,
            "document.querySelector('[data-applet-container-shell=\"peers.note\"]')",
            "official Note applet shell",
        )
        self.assert_condition(
            "official_note_applet_launchable",
            str(session.get_current_url()).endswith(
                "#/applet:peers.note"
            ),
        )
        assertions["official_note_applet_launchable"] = True

        native_input = self._native_click(
            session,
            '[data-pt-primary-nav="settings"]',
        )
        self._wait(
            session,
            "document.querySelector('[data-page=\"settings\"]')",
            "Settings page",
        )
        self._click(session, '[data-pt-secondary-tab="tools"]')
        self._click(session, '[data-pt-section-item="cron"]')
        self._wait(
            session,
            "document.querySelector('[data-pt-section-host=\"cron\"]')",
            "Cron Settings section",
        )
        cron_host = '[data-pt-section-host="cron"]'
        self.assert_condition(
            "cron_jobs_controls_available_in_settings",
            self._text_present(session, f"{cron_host} button", "Refresh")
            and self._text_present(
                session,
                f"{cron_host} button",
                "New Job",
            ),
        )
        cron_count = self._invocation_count(
            session,
            "cron_list_jobs",
        )
        self.assert_condition(
            "cron_jobs_loaded_in_selected_section",
            cron_count >= 1,
        )
        assertions["cron_jobs_controls_available_in_settings"] = True

        self._click(
            session,
            '[data-pt-section-item="command-menu"]',
        )
        self._wait(
            session,
            "document.querySelector('[data-pt-section-host=\"command-menu\"]')",
            "Command Palette Settings section",
        )
        self.assert_condition(
            "hidden_cron_section_unmounted",
            len(
                session.find_elements(
                    '[data-pt-section-host="cron"]'
                )
            )
            == 0,
        )
        time.sleep(15.5)
        self.assert_condition(
            "selected_only_stops_hidden_cron_polling",
            self._invocation_count(
                session,
                "cron_list_jobs",
            )
            == cron_count,
        )
        assertions["selected_only_stops_hidden_cron_polling"] = True

        self._click(
            session,
            "[data-pt-settings-command-palette-open]",
        )
        self._wait(
            session,
            "document.querySelector('.command-menu-modal')",
            "Command Palette overlay",
        )
        self.assert_condition(
            "command_palette_uses_one_global_overlay",
            len(session.find_elements(".command-menu-modal")) == 1,
        )
        self.runtime_binding.native_adapter.post_key_to_process(
            int(session.process_id or 0),
            NativeKey.ESCAPE,
            private_source=True,
        )
        self._wait(
            session,
            "!document.querySelector('.command-menu-modal')",
            "Command Palette dismissal",
        )
        assertions["command_palette_uses_one_global_overlay"] = True

        self._click(session, '[data-pt-secondary-tab="data"]')
        self._click(session, '[data-pt-section-item="oss"]')
        self._wait(
            session,
            "document.querySelector('[data-pt-section-host=\"oss\"]')",
            "My Files Settings section",
        )
        files_host = '[data-pt-section-host="oss"]'
        self.assert_condition(
            "my_files_controls_available_in_settings",
            self._text_present(
                session,
                f"{files_host} button",
                "Upload",
            )
            and self._text_present(
                session,
                f"{files_host} button",
                "Refresh",
            ),
        )
        assertions["my_files_controls_available_in_settings"] = True

        self._click(
            session,
            '[data-pt-secondary-tab="channels"]',
        )
        self._wait(
            session,
            "document.querySelector('[data-pt-section-host=\"channels\"]')",
            "Channels Settings section",
        )
        channels_host = '[data-pt-section-host="channels"]'
        self.assert_condition(
            "channel_management_controls_available_in_settings",
            self._text_present(
                session,
                f"{channels_host} button",
                "Refresh",
            )
            and self._text_present(
                session,
                f"{channels_host} button",
                "Add Channel",
            ),
        )
        assertions["channel_management_controls_available_in_settings"] = True
        return assertions, native_input

    def run(self) -> dict[str, Any]:
        session: TauriSession | None = None
        cleanup: dict[str, Any] = {}
        evidence: dict[str, Any] = {}
        result: dict[str, Any] | None = None
        primary_error: BaseException | None = None
        try:
            session = self.runtime_binding.create_bound_session(
                CLIENT_ID,
                NativeLaunchOptions(),
            )
            assertions, native_input = self._run_journey(session)
            evidence["rendererScreenshot"] = self.save_screenshot(
                session,
                "desktop-primary-navigation-renderer",
            )
            evidence["dom"] = self.save_dom(
                session,
                "desktop-primary-navigation",
            )
            with tempfile.NamedTemporaryFile(
                suffix=".png",
                delete=False,
            ) as native_file:
                native_path = Path(native_file.name)
            try:
                self.runtime_binding.native_adapter.capture_screenshot(
                    native_path
                )
                evidence["nativeScreenshot"] = (
                    self.report.add_evidence_file(
                        "desktop-primary-navigation-native-screenshot",
                        native_path,
                        destination_dir=self.evidence_dir,
                    )
                )
            finally:
                native_path.unlink(missing_ok=True)
            result = {
                "environment": ENVIRONMENT_ID,
                "journey": self.phase,
                "runtimeCell": self.runtime_binding.runtime_identity(),
                "nativeInput": native_input,
                "assertions": assertions,
                "evidence": evidence,
            }
        except BaseException as error:
            primary_error = error
        finally:
            log_path = session.log_path if session is not None else None
            if session is not None:
                try:
                    session.stop()
                except BaseException as error:
                    if primary_error is None:
                        primary_error = error
            if log_path is not None and log_path.is_file():
                evidence["appLog"] = self.report.add_evidence_file(
                    "desktop-primary-navigation-app-log",
                    log_path,
                    destination_dir=self.evidence_dir,
                )
            if session is not None:
                cleanup = self.runtime_binding.finalize_cleanup(
                    (session,),
                    {CLIENT_ID: self.client_spec},
                )
                cleanup_ok = (
                    cleanup.get("portsReleased") is True
                    and cleanup.get("processesReleased") is True
                    and cleanup.get("storageReleased") is True
                    and not cleanup.get("cleanupErrors")
                )
                self.assert_condition(
                    "native_runtime_cleanup",
                    cleanup_ok,
                    json.dumps(cleanup, sort_keys=True),
                )
        if primary_error is not None:
            raise primary_error
        if result is None:
            raise GateError(
                "Desktop navigation native journey produced no result"
            )
        result["cleanup"] = cleanup
        result["evidence"] = evidence
        return result


if __name__ == "__main__":
    raise SystemExit(DesktopPrimaryNavigationGate().execute())
