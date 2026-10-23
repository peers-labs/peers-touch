"""Bilateral native Search proof on one source-bound Mobile Suite."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import time
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate, ArtifactSession, GateError, RuntimeReuseContract, SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.fixtures.chat_native_actors import ACTOR_PASSWORD
from tooling.acceptance.gates.mobile.messaging_journey import MobileMessagingJourney
from tooling.acceptance.gates.mobile.simulator_e2e import (
    _redacted_markup, _validate_runtime_identity, _validate_source_identity,
)
from tooling.acceptance.gates.mobile.simulator_social_e2e import SimulatorSocialGate

GATE_ID = "chat-mobile-device-search-native-e2e"
ENVIRONMENT_ID = "chat-mobile-search-simulator"
SCENARIOS = ("ios-search", "android-search", "ios-account", "android-account")
REUSE = RuntimeReuseContract.from_dict({
    "scope": "suite", "entryCheckId": "mobile-device-search",
    "scenarioIds": list(SCENARIOS), "maxProvisioningRuns": 1,
    "maxClientLaunches": 2, "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": True, "requireReceiverVisibleProof": True,
    "allowClientReplacement": False,
})
FIELD = "#mobile-search-input"
PAGE = '[data-product-surface="search.mobile"]'
ROW = ".mobile-search-result"


def require(value: Any, message: str) -> None:
    if not value:
        raise GateError(message)


class MobileDeviceSearchGate(SimulatorSocialGate):
    expected_clients = {"sim-ios": "ios", "sim-android": "android"}
    client_assignments = {
        "sim-ios": ("station", "alice"), "sim-android": ("station", "bob"),
    }
    scenario_gates = {"device-search": GATE_ID}
    scenario_metadata = {"device-search": {
        "phase": "Mobile device Search", "bom": ["SEARCH-MOBILE-FIND-OPEN"],
        "spec": ["chat-mobile-device-search"],
    }}

    def __init__(self) -> None:
        super().__init__("device-search")
        self.environment_id = ENVIRONMENT_ID
        self.frames: dict[str, dict[str, Any]] = {}
        self.costs: dict[str, Any] = {}
        self.denials: dict[str, Any] = {}
        self.current_control = ""

    @staticmethod
    def wait(session: Any, script: str, label: str, *args: Any) -> Any:
        return SimulatorSocialGate._wait_for_value(
            lambda: session.execute_script(script, *args) or None, label,
        )

    def click(self, session: Any, selector: str) -> None:
        self.current_control = selector
        self.wait(session, """
const node = document.querySelector(arguments[0]);
if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
const box = node.getBoundingClientRect();
if (box.width <= 0 || box.height <= 0) return false;
for (let parent = node; parent; parent = parent.parentElement) {
  const style = getComputedStyle(parent);
  if (style.display === 'none' || style.visibility !== 'visible'
      || Number(style.opacity) < 0.99) return false;
}
return true;
""", f"visible enabled control {selector}", selector)
        session.click_element(session.find_element("css selector", selector))

    def open(self, session: Any) -> None:
        if not session.execute_script("return !!document.querySelector(arguments[0]);", FIELD):
            self.click(session, '[data-acceptance-id="mobile-search-open"]')
        self._wait_ui(session, FIELD, "native Search input")
        require(session.execute_script(
            "return document.querySelectorAll(arguments[0]).length === 1;", PAGE,
        ), "Search must have one current detail tree")

    def fill(self, session: Any, query: str, *, submit: bool = True) -> None:
        self.open(session)
        self._set_ui_value(session, FIELD, query, "native Search input change")
        self.wait(session, """
return document.querySelector(arguments[0])?.value === arguments[1];
""", "Search input acknowledgement", FIELD, query)
        if submit:
            self.click(session, ".mobile-search-input-row button[type=submit]")
        self.wait(session, """
const page = document.querySelector(arguments[0]);
return page && ['ready', 'error', 'idle'].includes(page.dataset.searchState);
""", "terminal Search rendering", PAGE)

    @staticmethod
    def rows(session: Any) -> dict[str, str]:
        return session.execute_script("""
return Object.fromEntries([...document.querySelectorAll('.mobile-search-result')]
  .map(row => [row.dataset.resourceId, row.innerText]));
""")

    def has(self, session: Any, resource_id: str, text: str) -> None:
        self.wait(session, """
return [...document.querySelectorAll('.mobile-search-result')].some(
  row => row.dataset.resourceId === arguments[0] && row.innerText.includes(arguments[1]));
""", "real received Search result", resource_id, text)

    @staticmethod
    def surface(session: Any) -> dict:
        return session.execute_script("""
const page = document.querySelector('[data-product-surface="search.mobile"]')
  || document.querySelector('.page-container');
const rect = page?.getBoundingClientRect();
const bounds = selector => {
  const box = document.querySelector(selector)?.getBoundingClientRect();
  return box ? {top: box.top, bottom: box.bottom, width: box.width, height: box.height} : null;
};
const textContrast = node => {
  const rgba = value => {
    const modern = value.match(/^color\\(srgb (.+)\\)$/);
    const match = modern || value.match(/^rgba?\\((.+)\\)$/);
    if (!match) return null;
    const parts = match[1].split(/[\\s,/]+/).map(Number);
    const scale = modern ? 255 : 1;
    return [parts[0] * scale, parts[1] * scale, parts[2] * scale, parts[3] ?? 1];
  };
  const over = (front, back) => [
    ...front.slice(0, 3).map((value, index) =>
      value * front[3] + back[index] * (1 - front[3])), 1,
  ];
  const layers = [];
  for (let parent = node; parent; parent = parent.parentElement) {
    layers.push(getComputedStyle(parent));
  }
  let background = [255, 255, 255, 1];
  for (const style of [...layers].reverse()) {
    const color = rgba(style.backgroundColor);
    if (!color) return 0;
    background = over(color, background);
  }
  const foreground = rgba(layers[0].color);
  if (!foreground) return 0;
  foreground[3] *= layers.reduce((opacity, style) => opacity * Number(style.opacity), 1);
  const luminance = color => color.slice(0, 3).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + [0.2126, 0.7152, 0.0722][index]
      * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  }, 0);
  const front = luminance(over(foreground, background));
  const back = luminance(background);
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
};
return {
  painted: !!rect && rect.width > 0 && rect.height > 0,
  viewportWidth: innerWidth, viewportHeight: innerHeight,
  visualViewport: {top: visualViewport?.offsetTop || 0, height: visualViewport?.height || innerHeight},
  inputBounds: bounds('#mobile-search-input'),
  submitBounds: bounds('.mobile-search-input-row button[type=submit]'),
  contentBounds: bounds('.mobile-search-viewport'),
  colorScheme: document.documentElement.dataset.mobileColorScheme || '',
  background: page ? getComputedStyle(page).backgroundColor : '',
  foreground: page ? getComputedStyle(page).color : '',
  textContrasts: [...document.querySelectorAll(
    '.mobile-search-page h1,.mobile-search-result__title,.mobile-search-result__meta,'
    + '.mobile-search-coverage span,.mobile-search-scope .ant-typography,'
    + '.mobile-search-filters button,#mobile-search-input')]
    .map(textContrast),
  documentWidth: document.documentElement.scrollWidth,
  searchState: document.querySelector('[data-search-state]')?.dataset.searchState || '',
  query: document.querySelector('#mobile-search-input')?.value || '',
  notice: document.querySelector('.mobile-search-notice')?.innerText || '',
  rows: [...document.querySelectorAll('.mobile-search-result')]
    .map(row => ({id: row.dataset.resourceId, text: row.innerText})),
  activeMessage: document.activeElement?.getAttribute('data-message-ulid') || '',
  unresolvedCopy: [...document.querySelectorAll('button,h1,h2,[role=status]')]
    .some(node => /\\b(?:search|mobile|common)\\.[a-z][\\w.]+\\b/.test(node.innerText)),
  rawIdentityCopy: [...document.querySelectorAll('.mobile-search-result__meta')]
    .some(node => /\\b(?:ptid:|did:|https?:\\/\\/)/i.test(node.innerText)),
  controls: [...document.querySelectorAll(
    '.mobile-search-page .page-header > button,.mobile-search-filters button,'
    + '.mobile-search-input-row button[type=submit],.mobile-search-pagination button')]
    .map(node => ({width: node.getBoundingClientRect().width,
                  height: node.getBoundingClientRect().height})),
};
""")

    def capture(self, artifacts: ArtifactSession, session: Any, name: str,
                *, concealed: bool = False, diagnostic: bool = False) -> None:
        deadline = time.monotonic() + 30
        while True:
            rendering = self.surface(session)
            if session.platform == "android":
                # The adapter binds nativeWebScreenshot: UiAutomator owns these pixels.
                screenshot = session.screenshot_bytes()
            else:
                session.switch_to_native()
                screenshot = session.screenshot_bytes()
                session.switch_to_app_webview()
            markup = _redacted_markup(session.get_page_source())
            if self.surface(session) == rendering:
                break
            require(time.monotonic() < deadline, f"{name} stable native capture timed out")
            time.sleep(0.25)
        base = f"mobile-device-search/{session.client_id}/{name}"
        captured = {
            "clientId": session.client_id,
            "screenshot": artifacts.write_bytes(
                f"{base}/screenshot.png", screenshot, media_type="image/png",
                role=f"mobile-search-screenshot/{session.client_id}/{name}",
            ).to_dict(),
            "dom": artifacts.write_bytes(
                f"{base}/dom.html", markup, media_type="text/html",
                role=f"mobile-search-dom/{session.client_id}/{name}",
            ).to_dict(),
        }
        frame = {**captured, "rendering": rendering, "assertionPassed": False}
        self.frames[f"{session.client_id}/{name}"] = frame
        if diagnostic:
            return
        require(rendering["painted"], f"{name} must be painted")
        require(rendering["documentWidth"] <= rendering["viewportWidth"] + 1,
                f"{name} must not overflow horizontally")
        require(not rendering["unresolvedCopy"], f"{name} has unresolved localization keys")
        require(not rendering["rawIdentityCopy"], f"{name} exposes an identity locator as display copy")
        require(all(value >= 4.5 for value in rendering["textContrasts"]),
                f"{name} has unreadable Search text contrast")
        require(all(row["width"] >= 43.5 and row["height"] >= 43.5
                    for row in rendering["controls"]), f"{name} has undersized controls")
        require(rendering["searchState"] not in (
            {"loading"} if concealed else {"loading", "concealed"}),
                f"{name} must be terminal")
        if concealed:
            require(not rendering["rows"], f"{name} must contain no private result rows")
        if name == "keyboard":
            visual = rendering["visualViewport"]
            for field in ("inputBounds", "submitBounds", "contentBounds"):
                box = rendering[field]
                require(box and box["height"] > 0
                        and box["top"] >= visual["top"] - 1
                        and box["bottom"] <= visual["top"] + visual["height"] + 1,
                        f"native keyboard obscures Search {field}")
        frame["assertionPassed"] = True

    def tap_android_input(self, artifacts: ArtifactSession, session: Any,
                          markup: str, target: dict) -> None:
        webviews = [
            node for node in ET.fromstring(markup).iter()
            if node.get("class") == "android.webkit.WebView"
            and node.get("package") == session.build.application_id
            and node.get("displayed") == "true"
        ]
        require(len(webviews) == 1, "one observed native product WebView is required")
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",
                              webviews[0].get("bounds", ""))
        require(bounds, "native product WebView bounds are required")
        left, top, right, bottom = map(int, bounds.groups())
        require(right > left and bottom > top
                and target["width"] > 0 and target["height"] > 0,
                "native and WebView input geometry must be positive")
        scale_x = (right - left) / target["width"]
        scale_y = (bottom - top) / target["height"]
        require(abs(scale_x - scale_y) <= scale_x * 0.02,
                "native and WebView input coordinate scales must agree")
        point = {"x": round(left + target["x"] * scale_x),
                 "y": round(top + target["y"] * scale_y)}
        require(left < point["x"] < right and top < point["y"] < bottom,
                "Search input tap must remain inside the native product WebView")
        artifacts.write_json(
            f"mobile-device-search/{session.client_id}/keyboard/native-target.json",
            {"input": target, "webviewBounds": [left, top, right, bottom], "tap": point},
            role=f"mobile-search-native-target/{session.client_id}",
        )
        session.execute_script("mobile: clickGesture", point)

    def keyboard(self, artifacts: ArtifactSession, session: Any, fixture: dict) -> None:
        target = self.wait(session, """
const input = document.querySelector(arguments[0]);
if (!input || input.disabled || input.readOnly || input.value !== arguments[1]) return false;
const box = input.getBoundingClientRect();
const x = box.left + box.width / 2, y = box.top + box.height / 2;
if (box.width <= 0 || box.height <= 0 || x <= 0 || x >= innerWidth
    || y <= 0 || y >= innerHeight || document.elementFromPoint(x, y) !== input) return false;
return {id: input.id, x, y, width: innerWidth, height: innerHeight};
""", "visible semantic Search input target", FIELD, fixture["query"])
        session.switch_to_native()
        try:
            markup = session.get_page_source()
            artifacts.write_bytes(
                f"mobile-device-search/{session.client_id}/keyboard/native-input.xml",
                _redacted_markup(markup), media_type="application/xml",
                role=f"mobile-search-native-input/{session.client_id}",
            )
            if session.platform == "android":
                # Android may expose the native WebView without its Chromium children.
                self.tap_android_input(artifacts, session, markup, target)
                element = None
            else:
                fields = [
                    node for node in ET.fromstring(markup).iter()
                    if node.get("type", node.tag) == "XCUIElementTypeTextField"
                    and node.get("value") == fixture["query"]
                ]
                require(len(fields) == 1, "one observed native Search input is required")
                selector = f"//*[@type='XCUIElementTypeTextField' and @value='{fixture['query']}']"
                element = session.find_element("xpath", selector)
                session.click_element(element)
            self.wait(session, "mobile: isKeyboardShown", "native software keyboard")
            if session.platform == "android":
                session.execute_script("mobile: pressKey", {"keycode": 123})  # MOVE_END
                session.execute_script("mobile: pressKey", {"keycode": 62})  # SPACE
            else:
                session.switch_to_app_webview()
                session.execute_script("""
const input = document.querySelector(arguments[0]);
input.setSelectionRange(input.value.length, input.value.length);
return true;
""", FIELD)
                session.switch_to_native()
                session.send_keys(element, " ")
            require(session.execute_script("mobile: isKeyboardShown") is True,
                    "native software keyboard must remain visible after typing")
        finally:
            session.switch_to_app_webview()
        self.wait(session, "return document.querySelector(arguments[0])?.value === arguments[1];",
                  "real native Search typing", FIELD, fixture["query"] + " ")
        self.has(session, fixture["root"], fixture["query"])
        self.capture(artifacts, session, "keyboard")
        session.execute_script("document.activeElement?.blur(); return true;")
        session.switch_to_native()
        try:
            if session.execute_script("mobile: isKeyboardShown"):
                session.execute_script("mobile: hideKeyboard")
            self._wait_for_value(
                lambda: True if session.execute_script("mobile: isKeyboardShown") is False else None,
                "native keyboard dismissal",
            )
        finally:
            session.switch_to_app_webview()
        self.fill(session, fixture["query"])

    def themes(self, artifacts: ArtifactSession, session: Any, fixture: dict) -> None:
        backgrounds = []
        modes = ("light", "dark") if self.surface(session)["colorScheme"] == "dark" else ("dark", "light")
        for mode in modes:
            labels = ("Light", "浅色") if mode == "light" else ("Dark", "深色")
            self.fill(session, "字体")
            self.click(session, ".mobile-search-filters button:last-child")
            self.click(session, '[data-search-function="chat-settings"]')
            self.click(session, ".settings-section .settings-row .ant-select")
            options = ",".join(
                f'.ant-select-dropdown:not(.ant-select-dropdown-hidden) '
                f'.ant-select-item-option[title="{label}"]' for label in labels
            )
            self.click(session, options)
            self.click(session, ".settings-dirty-buttons .ant-btn-primary")
            self.wait(session, """
return document.documentElement.dataset.mobileColorScheme === arguments[0]
  && !!document.querySelector('[data-product-surface="settings.detail-saved"]');
""", "persisted native theme", mode)
            self.click(session, ".page-header > button:first-child")
            self.click(session, ".mobile-search-filters button:first-child")
            self.fill(session, fixture["query"])
            self.has(session, fixture["root"], fixture["query"])
            self.capture(artifacts, session, f"theme-{mode}")
            backgrounds.append(self.surface(session)["background"])
        require(backgrounds[0] != backgrounds[1], "native Search themes must actually differ")

    def _capture_runtime_failure(self, artifacts: ArtifactSession) -> list[dict[str, Any]]:
        diagnostics = []
        for session in self.sessions:
            try:
                rendering = self.surface(session)
                def observe(action: str, payload: dict | None = None) -> Any:
                    try:
                        return session.call_action(action, payload or {})
                    except Exception as error:
                        return {"errorType": type(error).__name__}
                reference = artifacts.write_json(
                    f"mobile-device-search/{session.client_id}/failure-query.json",
                    {
                        "clientId": session.client_id,
                        "rendering": rendering,
                        "navigation": observe("navigation.snapshot"),
                        "runtimeErrors": [
                            {"operation": item["operation"],
                             "message": _redacted_markup(item["message"]).decode("utf-8")}
                            for item in session.execute_script(
                                "return window.__PEERS_SEARCH_RUNTIME_ERRORS__ || [];",
                            )
                        ],
                        "readState": observe("search.state"),
                        "readCosts": observe("search.reads"),
                        "nativeQuery": observe(
                            "search.page", {"query": rendering["query"]},
                        ) if rendering["query"] else None,
                    },
                    role=f"mobile-search-failed-query/{session.client_id}",
                )
                diagnostics.append({"clientId": session.client_id, "artifact": reference.to_dict()})
            except Exception as error:
                diagnostics.append({"clientId": session.client_id, "errorType": type(error).__name__})
            try:
                self.capture(artifacts, session, "failure", diagnostic=True)
            except Exception as error:
                diagnostics.append({"clientId": session.client_id, "errorType": type(error).__name__})
            try:
                recovery = session.call_action("recovery.snapshot")
                reference = artifacts.write_json(
                    f"mobile-device-search/{session.client_id}/failure-admission.json",
                    {
                        "clientId": session.client_id,
                        "writeAdmission": recovery["writeAdmission"],
                        "isWriteBlocked": recovery["isWriteBlocked"],
                        "stateKinds": [state["kind"] for state in recovery["states"]],
                    },
                    role=f"mobile-search-failed-admission/{session.client_id}",
                )
                diagnostics.append({"clientId": session.client_id, "artifact": reference.to_dict()})
            except Exception as error:
                diagnostics.append({"clientId": session.client_id, "errorType": type(error).__name__})
        diagnostics.extend(super()._capture_runtime_failure(artifacts))
        reference = artifacts.write_json(
            "mobile-device-search/observations.json",
            {"frames": self.frames, "costs": self.costs, "denials": self.denials,
             "currentControl": self.current_control},
            role="mobile-search-failed-observations",
        )
        diagnostics.append({"artifact": reference.to_dict()})
        return diagnostics

    def cost(self, session: Any, name: str, action: Any, *, refresh: bool = False) -> None:
        before = session.call_action("search.reads")
        require(before["sourceReads"] > 0, "native source observations must be present")
        action()
        self.wait(session, """
return document.querySelector('[data-search-state]')?.dataset.searchState === 'ready';
""", f"{name} terminal state")
        after = session.call_action("search.reads")
        require(after["sourceReads"] > before["sourceReads"] if refresh else (
            after["sourceReads"] == before["sourceReads"]
            and after["hydrationReads"] == before["hydrationReads"]
        ), f"{name} violates original-source read cost")
        self.costs[f"{session.client_id}/{name}"] = {"before": before, "after": after}

    def denial(self, session: Any, name: str, action: str, payload: dict, code: str) -> None:
        result = session.call_action(action, payload)
        require(result == {"accepted": False, "errorCode": code}, f"{name} typed denial failed")
        self.denials[f"{session.client_id}/{name}"] = result

    @staticmethod
    def native_page(session: Any, query: str, **kwargs: Any) -> dict:
        result = session.call_action("search.page", {"query": query, **kwargs})
        require(result.get("accepted") is True, "native Search diagnostic query failed")
        return result["value"]

    @staticmethod
    def mutate_when_admitted(session: Any, action: str, payload: dict) -> Any:
        # Observe full production admission and invoke in one WebView turn.
        # Separate driver calls leave a window for Session/Recovery closure.
        result = session.execute_async_script("""
const action = arguments[0], input = arguments[1];
const done = arguments[arguments.length - 1];
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
const deadline = Date.now() + 30000;
(async () => {
  let reason = 'unavailable';
  while (Date.now() < deadline) {
    const snapshot = await root['recovery.snapshot']({});
    if (snapshot.writeAdmission?.open === true && snapshot.isWriteBlocked === false) {
      // The original action still performs its own guard. Never retry it.
      return {value: await root[action](input)};
    }
    reason = snapshot.writeAdmission?.reason || 'recovery_projection_blocked';
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return {error: 'write admission timeout', reason};
})().then(done).catch(error => done({
  error: String(error?.message || error), reason: error?.reason || '',
}));
""", action, payload)
        require(isinstance(result, dict) and "value" in result,
                f"{action} failed after admission: {result}")
        return result["value"]

    def seed(self, journey: MobileMessagingJourney, sender_session: Any,
             receiver_session: Any, conversation: str, token: str) -> dict:
        query = f"周会 {token}"
        sent_count = 0
        def send(text: str, **extra: Any) -> str:
            nonlocal sent_count
            journey._await_condition(
                lambda: journey._social_runtime_active(sender_session, sender_session.client_id)
                and journey._social_runtime_active(receiver_session, receiver_session.client_id),
                f"Search fixture {sent_count + 1} writable Messaging runtime",
            )
            try:
                sent = self.mutate_when_admitted(sender_session, "messaging.send", {
                    "conversationId": conversation, "plaintext": text, **extra,
                })
            except Exception as error:
                raise GateError(
                    f"{sender_session.client_id} fixture send {sent_count + 1}: {error}",
                ) from error
            require(bool(sent.get("messageId")), "real Messaging identity required")
            journey._await_message(
                receiver_session, conversation, sent["messageId"],
                lambda row: row.get("plaintext") == text,
                f"Search fixture {sent_count + 1} receiver commit",
            )
            sent_count += 1
            return sent["messageId"]
        root = send(f"{query} 原始正文")
        reply_query = f"线程 {token}"
        reply = send(reply_query, replyToMessageId=root, threadRootMessageId=root)
        filler = [send(f"历史 {token} {index:03}") for index in range(105)]
        filename = f"附件计划-{token}-预算与研发进度审查-跨团队评审-{('年度执行计划' * 7)}.txt"
        content = f"real attachment {token}".encode()
        staged = self.mutate_when_admitted(sender_session, "messaging.attachment.stage", {
            "filename": filename, "mimeType": "text/plain",
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytesBase64": base64.b64encode(content).decode(),
        })
        attachment = send(f"文件 {token}", attachmentStageIds=[staged["stageId"]])
        return {"conversation": conversation, "query": query, "root": root,
                "reply": reply, "replyQuery": reply_query, "filler": filler,
                "attachment": attachment, "filename": filename, "token": token}

    def target(self, artifacts: ArtifactSession, session: Any,
               query: str, message_id: str, name: str) -> None:
        self.fill(session, query)
        self.has(session, message_id, query)
        self.click(session, f'{ROW}[data-resource-id="{message_id}"]')
        observation: dict[str, Any] = {}
        def focus() -> dict | None:
            nonlocal observation
            observation = session.execute_script("""
return {
  activeMessage: document.activeElement?.getAttribute('data-message-ulid') || '',
  activeElement: document.activeElement?.outerHTML.slice(0, 1024) || '',
  surfaces: [...document.querySelectorAll('[data-product-surface]')]
    .map(node => node.dataset.productSurface),
  windows: [...document.querySelectorAll('[data-window-surface]')]
    .map(node => ({surface: node.dataset.windowSurface, total: node.dataset.windowTotal})),
  messages: [...document.querySelectorAll('[data-message-ulid]')]
    .map(node => ({id: node.dataset.messageUlid, text: node.innerText.slice(0, 256)})),
  runtimeErrors: window.__PEERS_SEARCH_RUNTIME_ERRORS__ || [],
  body: document.body.innerText.slice(0, 4096),
};
""")
            return observation if observation["activeMessage"] == message_id else None
        try:
            self._wait_for_value(focus, "canonical Chat message focus")
        except Exception:
            artifacts.write_json(
                f"mobile-device-search/{session.client_id}/{name}/focus-failure.json",
                json.loads(_redacted_markup(json.dumps({
                    "targetMessage": message_id, "observation": observation,
                })).decode("utf-8")),
                role=f"mobile-search-focus-failure/{session.client_id}/{name}",
            )
            raise
        self.capture(artifacts, session, name)
        self.cost(session, f"{name}-return",
                  lambda: self.click(session, ".chat-thread-header > button"))
        self.has(session, message_id, query)

    def search_scenario(self, artifacts: ArtifactSession, session: Any, sender_session: Any,
                        fixture: dict) -> dict:
        self.fill(session, fixture["query"])
        self.capture(artifacts, session, "submitted", diagnostic=True)
        self.has(session, fixture["root"], fixture["query"])
        self.capture(artifacts, session, "chinese")
        self.keyboard(artifacts, session, fixture)
        self.themes(artifacts, session, fixture)
        self.cost(session, "repeat", lambda: self.click(
            session, ".mobile-search-input-row button[type=submit]"))
        self.cost(session, "reopen", lambda: (
            self.click(session, f"{PAGE} .page-header > button:first-child"),
            self.open(session),
        ))
        self.fill(session, fixture["query"], submit=False)
        self.fill(session, fixture["query"] + "z", submit=False)
        self.cost(session, "backspace", lambda: self.fill(
            session, fixture["query"], submit=False))
        self.cost(session, "refresh", lambda: self.click(
            session, f"{PAGE} .page-header > button:last-child"), refresh=True)
        self.target(artifacts, session, fixture["query"], fixture["root"], "historical")
        self.target(artifacts, session, fixture["replyQuery"], fixture["reply"], "thread")
        self.fill(session, f'历史 {fixture["token"]}')
        self.wait(session, "return document.querySelectorAll('.mobile-search-result').length === 100;",
                  "first bounded Search page")
        self.capture(artifacts, session, "page-one")
        self.click(session, ".mobile-search-pagination button:last-child")
        self.wait(session, "return document.querySelectorAll('.mobile-search-result').length === 5;",
                  "last bounded Search page")
        self.capture(artifacts, session, "page-two")
        self.fill(session, f'附件计划-{fixture["token"]}')
        self.click(session, ".mobile-search-filters button:nth-child(3)")
        self.has(session, fixture["attachment"], fixture["filename"])
        self.capture(artifacts, session, "long-filename")
        self.click(session, ".mobile-search-filters button:first-child")
        self.fill(session, fixture["query"])
        self.has(session, fixture["root"], fixture["query"])
        self.click(session, f'{ROW}[data-resource-id="{fixture["root"]}"]')
        self._wait_ui(session, ".chat-header-actions", "original Chat actions")
        self.click(session, ".chat-header-actions > button:last-child")
        self.click(session, ".chat-action-group > button:first-child")
        self.fill(session, fixture["query"])
        self.has(session, fixture["root"], fixture["query"])
        self._wait_ui(session, ".mobile-search-scope button", "scoped Search expansion")
        self.capture(artifacts, session, "conversation-scope")
        self.click(session, ".mobile-search-scope button")
        self._wait_ui_absent(session, ".mobile-search-scope button", "global scope restored")
        self.fill(session, fixture["query"])
        original = next(item["resource"] for item in self.native_page(
            session, fixture["query"])["items"] if item["resource"]["messageId"] == fixture["root"])
        self.denial(session, "forged-authority", "search.resolve", {
            "resource": {**original, "authorityNamespace": "station:forged"},
        }, "SEARCH_PROTOCOL")
        edited = f'{fixture["query"]} 更新正文'
        self.mutate_when_admitted(sender_session, "messaging.interact", {
            "conversationId": fixture["conversation"], "messageId": fixture["root"],
            "kind": "edit", "plaintext": edited,
        })
        self.has(session, fixture["root"], edited)
        self.capture(artifacts, session, "edit")
        self.denial(session, "stale-reference", "search.resolve",
                    {"resource": original}, "SEARCH_RESOURCE_UNAVAILABLE")
        fresh = next(item["resource"] for item in self.native_page(
            session, fixture["query"])["items"] if item["resource"]["messageId"] == fixture["root"])
        self.mutate_when_admitted(sender_session, "messaging.interact", {
            "conversationId": fixture["conversation"], "messageId": fixture["root"], "kind": "retract",
        })
        self.wait(session, """
return document.querySelector('[data-search-state]')?.dataset.searchState === 'ready'
  && ![...document.querySelectorAll('.mobile-search-result')]
    .some(row => row.dataset.resourceId === arguments[0]);
""", "retracted content removed from receiver Search", fixture["root"])
        self.capture(artifacts, session, "retract")
        self.denial(session, "retracted-reference", "search.resolve",
                    {"resource": fresh}, "SEARCH_RESOURCE_UNAVAILABLE")
        self.fill(session, "...")
        self.wait(session, "return !!document.querySelector('.mobile-search-notice[role=alert]');",
                  "typed invalid-query UI")
        self.capture(artifacts, session, "invalid")
        self.fill(session, fixture["replyQuery"])
        self.has(session, fixture["reply"], fixture["replyQuery"])
        self.capture(artifacts, session, "recovered")
        self.fill(session, f'不存在 {fixture["token"]}')
        require(not self.rows(session), "empty Search must have no result rows")
        self.capture(artifacts, session, "empty")
        self.fill(session, "隐私")
        self.click(session, ".mobile-search-filters button:last-child")
        self.click(session, '[data-search-function="privacy-security"]')
        self._wait_ui_absent(session, PAGE, "real Settings target")
        self.capture(artifacts, session, "settings")
        self.click(session, ".page-header > button:first-child")
        self._wait_ui(session, FIELD, "Settings return to Search")
        self.click(session, ".mobile-search-filters button:first-child")
        self.fill(session, fixture["replyQuery"])
        session.call_action("lifecycle.suspend")
        require(session.execute_script("return !document.querySelector('.mobile-search-result');"),
                "suspended Search must remove private result DOM")
        self.capture(artifacts, session, "suspended", concealed=True)
        session.call_action("lifecycle.resume")
        self.has(session, fixture["reply"], fixture["replyQuery"])
        self.capture(artifacts, session, "resumed")
        for locale, label in (("en", "English"), ("zh-CN", "简体中文")):
            self.fill(session, "语言")
            self.click(session, ".mobile-search-filters button:last-child")
            self.click(session, '[data-search-function="language"]')
            self.click(session, ".settings-section .ant-select")
            self.click(session, f'.ant-select-dropdown:not(.ant-select-dropdown-hidden) '
                       f'.ant-select-item-option[title="{label}"]')
            self.wait(session, """
const input = document.querySelector('.settings-section [role=combobox]');
return input && !input.disabled && document.documentElement.lang === arguments[0];
""", "persisted UI language", locale)
            self.click(session, ".page-header > button:first-child")
            self.click(session, ".mobile-search-filters button:first-child")
            self.fill(session, fixture["replyQuery"])
            self.has(session, fixture["reply"], fixture["replyQuery"])
            self.capture(artifacts, session, f"locale-{locale}")
        return {
            "uiAction": f"{session.client_id}:search-query-open-back-refresh",
            "receiverAssertion": f"{session.client_id}:received-message-thread-file-and-fences",
            "supportingObservation": f"{session.client_id}:native-read-cost-and-denials",
        }

    def account_scenario(self, artifacts: ArtifactSession, session: Any, peer_session: Any,
                         actor: Any, peer: Any, fixture: dict, journey: MobileMessagingJourney) -> dict:
        self.fill(session, fixture["replyQuery"])
        self.has(session, fixture["reply"], fixture["replyQuery"])
        page = self.native_page(session, f'历史 {fixture["token"]}', limit=20)
        require(bool(page.get("nextCursor")), "old-account paging cursor required")
        before = session.call_action("search.state")
        session.call_action("session.logout", {"draftDisposition": "discard"})
        require(session.execute_script("return !document.querySelector('#mobile-search-input')"
                                       " && !document.querySelector('.mobile-search-result');"),
                "logout must clear private Search DOM")
        journey.authenticate(session, replace(peer, client_id=session.client_id),
                             password=ACTOR_PASSWORD)
        self.open(session)
        require(session.execute_script("return document.querySelector('#mobile-search-input').value === '';"),
                "account change must clear the Search query")
        after = session.call_action("search.state")
        require(before["readScope"] != after["readScope"], "account change must replace native scope")
        self.denial(session, "old-account-cursor", "search.page", {
            "query": f'历史 {fixture["token"]}', "limit": 20, "cursor": page["nextCursor"],
        }, "SEARCH_CURSOR_EXPIRED")
        # This installation has not acquired the newly selected actor's Direct.
        # Reopen through the original owner before sending; login is not recovery.
        direct = self.mutate_when_admitted(session, "messaging.createDirect", {
            "peerPtid": actor.ptid, "federationId": peer.federation_id,
        })
        require(direct.get("conversationId") == fixture["conversation"],
                "account handoff must reopen the same original Direct")
        artifacts.write_json(
            f"mobile-device-search/{session.client_id}/account-conversation.json",
            {"clientId": session.client_id, "direct": direct},
            role=f"mobile-search-account-conversation/{session.client_id}",
        )
        own_query = f'账号切换 {fixture["token"]}'
        sent = self.mutate_when_admitted(session, "messaging.send", {
            "conversationId": fixture["conversation"], "plaintext": own_query,
        })
        self.fill(session, own_query)
        self.has(session, sent["messageId"], own_query)
        self.capture(artifacts, session, "account-isolation")
        session.call_action("session.logout", {"draftDisposition": "discard"})
        journey.authenticate(session, actor, password=ACTOR_PASSWORD)
        # Restore the original peer session revoked by the real account handoff.
        peer_session.call_action("session.logout", {"draftDisposition": "discard"})
        journey.authenticate(peer_session, peer, password=ACTOR_PASSWORD)
        return {
            "uiAction": f"{session.client_id}:same-process-account-search",
            "receiverAssertion": f"{session.client_id}:new-account-result-old-cursor-denial",
            "supportingObservation": f"{session.client_id}:native-scope-replaced",
        }

    def _run_social_journey(self, artifacts: ArtifactSession, manifest: Mapping[str, Any]) -> dict:
        source = _validate_source_identity(manifest)
        resources = self._required_object(manifest, "mobileSimulator", "Search runtime")
        self._reject_credentials(manifest, resources)
        runtime = _validate_runtime_identity(resources, self.expected_clients)
        specs = self._client_specs(resources)
        sessions = {
            spec.client_id: self._start_social_session(
                artifacts, resources["appium"]["serverUrl"], spec,
            ) for spec in specs
        }
        identities = {
            spec.client_id: self._verify_build_identity(
                sessions[spec.client_id], resources["applications"][spec.platform]["buildIdentity"],
                f"{spec.client_id} source-bound Search build",
            ) for spec in specs
        }
        actors = self._load_actors(artifacts, manifest)
        journey = MobileMessagingJourney(timeout_seconds=90)
        # Reset-owned actors have one fresh identity across the two Suite devices.
        # Prepare both scopes before enrollment; this is not recovery of a live actor.
        for actor in actors.values():
            seed = bytearray(secrets.token_bytes(32))
            try:
                for client_id, session in sessions.items():
                    self._prepare_fresh_actor_identity(
                        session, replace(actor, client_id=client_id), seed=seed,
                    )
            finally:
                seed[:] = b"\x00" * len(seed)
        for client_id, actor in actors.items():
            journey.authenticate(sessions[client_id], actor, password=ACTOR_PASSWORD)
            sessions[client_id].execute_script("""
window.__PEERS_SEARCH_RUNTIME_ERRORS__ = [];
window.addEventListener('mobile:messaging-runtime-error', event => {
  const detail = event.detail;
  if (!detail?.operation || !detail?.message) return;
  const errors = window.__PEERS_SEARCH_RUNTIME_ERRORS__;
  errors.push({operation: String(detail.operation).slice(0, 128),
               message: String(detail.message).slice(0, 4096)});
  if (errors.length > 32) errors.shift();
});
return true;
""")
            read_state = sessions[client_id].call_action("search.state")
            require(read_state.get("readScope") and read_state.get("sourceRevision"),
                    f"{client_id} authenticated native Search admission is required")
            artifacts.write_json(
                f"mobile-device-search/{client_id}/native-admission.json",
                {"clientId": client_id, "readState": read_state},
                role=f"mobile-search-native-admission/{client_id}",
            )
        ledger = SuiteRuntimeLedger(
            REUSE, suite_runtime_id=f"mobile-search-{artifacts.run_id}",
            source_digest=source["commit"], fixture_epoch=manifest["runId"],
        )
        self.suite_runtime_ledger = ledger
        ledger.record(SuiteRuntimeAction.PROVISION, resource_id=ENVIRONMENT_ID)
        ledger.record(SuiteRuntimeAction.ACCOUNT_PROVISION, resource_id="actors:alice,bob")
        for client_id in sessions:
            ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=client_id)
            ledger.record(SuiteRuntimeAction.LOGIN, resource_id=client_id)
        conversation = journey._create_direct(
            sessions["sim-android"], sessions["sim-ios"],
            actors["sim-android"], actors["sim-ios"],
        )
        fixtures = {}
        for receiver_id, sender_id in (("sim-ios", "sim-android"), ("sim-android", "sim-ios")):
            fixtures[receiver_id] = self.seed(
                journey, sessions[sender_id], sessions[receiver_id], conversation,
                f"{artifacts.run_id[-8:]}-{self.expected_clients[receiver_id]}",
            )
            artifacts.write_json(
                f"mobile-device-search/{receiver_id}/fixture.json",
                {"senderClientId": sender_id, "receiverClientId": receiver_id,
                 **fixtures[receiver_id]},
                role=f"mobile-search-received-fixture/{receiver_id}",
            )
        results = []
        for scenario_id in SCENARIOS:
            client_id = "sim-ios" if scenario_id.startswith("ios") else "sim-android"
            peer_id = "sim-android" if client_id == "sim-ios" else "sim-ios"
            ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=scenario_id)
            start = time.monotonic()
            try:
                result = self.search_scenario(
                    artifacts, sessions[client_id], sessions[peer_id], fixtures[client_id],
                ) if scenario_id.endswith("search") else self.account_scenario(
                    artifacts, sessions[client_id], sessions[peer_id], actors[client_id], actors[peer_id],
                    fixtures[client_id], journey,
                )
                for action, field in (
                    (SuiteRuntimeAction.UI_ACTION, "uiAction"),
                    (SuiteRuntimeAction.RECEIVER_ASSERTION, "receiverAssertion"),
                    (SuiteRuntimeAction.SUPPORTING_OBSERVATION, "supportingObservation"),
                ):
                    ledger.record(action, scenario_id=scenario_id, resource_id=result[field])
            finally:
                # End lifecycle even on failure; missing assertions remain unproven.
                ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario_id)
            results.append({"id": scenario_id, "durationSeconds": time.monotonic() - start, **result})
        return {
            **self._result_base("PASS"), "source": source, "runtime": runtime,
            "buildIdentity": identities, "journey": results, "fixtures": fixtures,
            "frames": self.frames, "costs": self.costs, "denials": self.denials,
        }


if __name__ == "__main__":
    gate: AcceptanceGate = MobileDeviceSearchGate()
    raise SystemExit(gate.execute())
