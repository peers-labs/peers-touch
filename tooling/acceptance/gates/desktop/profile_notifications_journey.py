"""Reusable Native Account Journey; the caller owns runtime and proof policy."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from pathlib import Path
from typing import Any, Callable

from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import GateError, call_async_harness, workspace_id
from tooling.acceptance.drivers.native import NativeKey
from tooling.acceptance.drivers.native.runtime import (
    LocalMacOSRuntimeBinding,
    NativeDesktopRuntimeBinding,
)
from tooling.acceptance.drivers.tauri import LocalTauriLauncher, TauriSession
from tooling.acceptance.gates.chat.native_support import DEV_ACCOUNT_PASSWORD, shared_federation_id


PROFILE_FIELDS = ("display_name", "note", "region", "timezone", "tags", "links", "avatar", "header")
REPO_ROOT = Path(__file__).resolve().parents[4]


def wait(session: TauriSession, predicate: Callable[[], Any], description: str) -> Any:
    return WebDriverWait(session.driver, 30, poll_frequency=0.1).until(
        lambda _: predicate(), description,
    )


def click_text(session: TauriSession, text: str) -> None:
    button = wait(session, lambda: next(
        (button for button in session.find_elements("button")
         if button.is_displayed() and button.is_enabled() and button.text.strip() == text),
        None,
    ), f"enabled {text} button")
    button.click()


def read_profile(session: TauriSession) -> dict[str, Any]:
    return read_payload(session, "profile_get")


def read_payload(session: TauriSession, command: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    response = session.invoke_app_result(command, payload or {})
    if response.get("ok") is not True:
        raise GateError(f"authoritative {command} failed: {response.get('error')}")
    return json.loads(response["data"]["status"])


def assert_profile(session: TauriSession, expected: dict[str, Any]) -> dict[str, Any]:
    actual = read_profile(session)
    mismatches = [key for key, value in expected.items() if actual.get(key) != value]
    if mismatches:
        raise GateError(f"authoritative profile differs in {', '.join(mismatches)}")
    return actual


def fill(session: TauriSession, selector: str, value: str) -> None:
    field = session.find_element(selector, 30)
    field.click()
    field.clear()
    field.send_keys(value)


def select_native_image(
    session: TauriSession,
    binding: NativeDesktopRuntimeBinding,
    field: str,
) -> dict[str, Any]:
    if session.process_id is None:
        raise GateError("Native chooser has no owning process")
    staged = binding.stage_native_file(
        "profile",
        REPO_ROOT / "apps/desktop/src-tauri/icon-source.png",
    )
    adapter = binding.native_adapter
    baseline = wait(session, lambda: adapter.activate_and_focused_control(
        session.process_id or 0,
    ), "Native chooser owner")
    session.find_element(f'button[aria-label="Change {field}"]', 30).click()

    def panel_ready() -> Any:
        control = adapter.focused_control(session.process_id or 0)
        return control if (
            control.dialog_count > baseline.dialog_count
            or control.window_count > baseline.window_count
            or control.kind in {"list", "text-field", "application-dialog"}
        ) else None

    wait(session, panel_ready, "Native image chooser")
    selected = adapter.select_file_chooser_path_to_process(session.process_id, str(staged))
    if selected is None or selected.dialog_count:
        raise GateError("Native image chooser did not commit the selected file")
    return {"nativeChooser": True, "sha256": binding.native_file_sha256("profile", staged)}


def run_profile_journey(
    session: TauriSession,
    binding: NativeDesktopRuntimeBinding,
    artifacts: Path,
) -> dict[str, Any]:
    """Exercise C1-C6 and preference persistence through the actual renderer."""
    artifacts.mkdir(parents=True, exist_ok=True)
    original = read_profile(session)
    result: dict[str, Any] = {"journey": "DUI-C1-C9", "steps": [], "assertions": {}}
    changed = False
    preferences_changed = False
    original_social_enabled: str | None = None
    try:
        session.find_element('[data-pt-primary-nav="settings"] [role="button"]', 30).click()
        session.invoke_app_result("acceptance_request_activation")
        wait(session, lambda: session.execute_script("return document.hasFocus()"), "Native focus")
        session.find_element('[data-pt-secondary-tab="general"]', 30).click()
        session.find_element('[data-pt-section-item="account"]', 30).click()
        marker = f"Native Profile {time.time_ns()}"
        fill(session, "fieldset input", marker)
        assert_profile(session, {key: original[key] for key in PROFILE_FIELDS})
        click_text(session, "Discard changes")
        wait(session, lambda: session.find_element("fieldset input").get_attribute("value")
             == original["display_name"], "Discard restores canonical profile")
        result["steps"].append("draft_and_discard")

        for field in ("avatar", "header"):
            changed = True
            before = read_profile(session)
            chooser = select_native_image(session, binding, field)
            wait(session, lambda: read_profile(session)[field] != before[field], f"{field} OSS commit")
            uploaded = read_profile(session)
            if uploaded["profile_revision"] <= before["profile_revision"]:
                raise GateError(f"{field} upload did not advance revision")
            if field == "avatar":
                wait(session, lambda: session.find_element("[data-pt-account-avatar-url]").get_attribute(
                    "data-pt-account-avatar-url",
                ) == uploaded[field], "Account avatar projection")
                wait(session, lambda: session.execute_script(
                    """return [...document.querySelectorAll('[data-pt-account-avatar-url] img')]
                    .some(image => image.complete && image.naturalWidth > 0)""",
                ), "Account avatar image loads")
            else:
                wait(session, lambda: uploaded[field] in session.find_element(
                    'button[aria-label="Change header"]',
                ).get_attribute("style"), "Account header projection")
                loaded = session.execute_async_script(
                    """
                    const done = arguments[arguments.length - 1];
                    const background = getComputedStyle(
                      document.querySelector('button[aria-label="Change header"]')
                    ).backgroundImage;
                    const match = background.match(/^url\\(["']?(.*?)["']?\\)$/);
                    if (!match) { done(false); return; }
                    const image = new Image();
                    image.onload = () => done(image.naturalWidth > 0);
                    image.onerror = () => done(false);
                    image.src = match[1];
                    """,
                )
                if loaded is not True:
                    raise GateError("Account header image failed to load")
            result["assertions"][f"{field}_native_oss"] = chooser
        result["steps"].append("native_avatar_and_header_oss")

        fill(session, "fieldset input", marker)
        fill(session, "fieldset textarea", f"Native saved bio {marker}")
        region = session.find_elements("fieldset input")[1]
        region.click()
        region.clear()
        region.send_keys("Native test region")
        timezone = session.find_elements("fieldset input")[2]
        timezone.click()
        timezone.clear()
        timezone.send_keys("Europe/London")
        binding.native_adapter.post_key_to_process(session.process_id or 0, NativeKey.TAB, private_source=True)
        tag = session.find_element(".ant-select-multiple input")
        tag.click()
        tag.send_keys("native-proof,")
        wait(session, lambda: any("native-proof" == item.text.strip()
             for item in session.find_elements(".ant-select-selection-item-content")), "tag token")
        click_text(session, "Add")
        labels = session.find_elements('input[placeholder="Label (e.g. GitHub)"]')
        labels[-1].send_keys("Native proof")
        session.find_elements('input[placeholder="https://..."]')[-1].send_keys("https://example.com/native-proof")
        click_text(session, "Save profile")
        changed = True
        wait(session, lambda: read_profile(session)["display_name"] == marker, "profile Save")
        snapshot = assert_profile(session, {
            "display_name": marker, "note": f"Native saved bio {marker}",
            "region": "Native test region", "timezone": "Europe/London",
        })
        if "native-proof" not in snapshot["tags"] or not any(
            link["url"] == "https://example.com/native-proof" for link in snapshot["links"]
        ):
            raise GateError("saved tag or link did not reach Station")
        result["steps"].append("save_profile_readback")

        while session.find_elements(".ant-select-selection-item-remove"):
            session.find_elements(".ant-select-selection-item-remove")[0].click()
        while session.find_elements('fieldset button:has(svg[class*="lucide-trash"])'):
            session.find_elements('fieldset button:has(svg[class*="lucide-trash"])')[0].click()
        click_text(session, "Save profile")
        wait(session, lambda: read_profile(session)["tags"] == [] and read_profile(session)["links"] == [],
             "empty collections replace canonical values")
        snapshot = read_profile(session)
        session.find_element('[data-pt-section-item="general"]').click()
        session.find_element('[data-pt-section-item="account"]').click()
        wait(session, lambda: session.find_element("fieldset input").get_attribute("value") == marker,
             "Account remount preserves profile")
        if session.find_elements(".ant-select-selection-item") or session.find_elements('input[placeholder="https://..."]'):
            raise GateError("cleared collections returned after Account remount")
        result["steps"].append("clear_collections_and_remount")
        for key, value in {
            "ptid": snapshot["peers_touch"]["network_id"],
            "handle": snapshot["federated_handle"],
            "home-station": snapshot["home_station_domain"],
        }.items():
            if not value or value not in session.find_element(f'[data-pt-account-identity="{key}"]').text:
                raise GateError(f"canonical {key} is absent from Account")
        result["steps"].append("canonical_identity_fields")

        fill(session, "fieldset input", f"Uncommitted conflict {marker}")
        external = session.invoke_app_result("profile_update", {"input": {
            "note": f"External revision {marker}", "observed_revision": snapshot["profile_revision"],
        }})
        if external.get("ok") is not True:
            raise GateError("external revision fixture failed")
        click_text(session, "Save profile")
        wait(session, lambda: "Your profile changed elsewhere." in session.execute_script(
            "return document.body.innerText",
        ), "revision conflict explanation")
        if session.find_element("fieldset input").get_attribute("value") != f"Uncommitted conflict {marker}":
            raise GateError("conflict discarded the local draft")
        assert_profile(session, {"display_name": marker, "note": f"External revision {marker}"})
        click_text(session, "Use latest profile")
        wait(session, lambda: session.find_element("fieldset input").get_attribute("value") == marker,
             "Use latest profile restores canonical snapshot")
        result["steps"].append("revision_conflict_preserves_draft")
        session.save_screenshot(artifacts / "profile.png")

        session.find_element('[data-pt-section-item="notifications"]', 30).click()
        selector = '[data-notification-category="social"] button[role="switch"]'
        switch = session.find_element(selector, 30)
        original_social_enabled = switch.get_attribute("aria-checked")
        switch.click()
        preferences_changed = True
        wait(session, lambda: session.find_element(selector).get_attribute("aria-checked") != original_social_enabled,
             "Social preference changes")
        wait(session, lambda: session.find_element(selector).is_enabled(), "preference save completes")
        session.find_element('[data-pt-section-item="general"]').click()
        session.find_element('[data-pt-section-item="notifications"]').click()
        if session.find_element(selector, 30).get_attribute("aria-checked") == original_social_enabled:
            raise GateError("notification preference did not survive remount")
        session.find_element(selector).click()
        wait(session, lambda: session.find_element(selector).get_attribute("aria-checked") == original_social_enabled,
             "Social preference restores")
        wait(session, lambda: session.find_element(selector).is_enabled(), "preference restoration completes")
        preferences_changed = False
        result["steps"].append("notification_preference_persistence_restore")
        session.save_screenshot(artifacts / "notifications.png")
    finally:
        if preferences_changed and original_social_enabled is not None:
            selector = '[data-notification-category="social"] button[role="switch"]'
            if session.find_element(selector, 30).get_attribute("aria-checked") != original_social_enabled:
                session.find_element(selector).click()
            wait(session, lambda: session.find_element(selector).is_enabled(), "preference cleanup")
        if changed:
            current = read_profile(session)
            restored = session.invoke_app_result("profile_update", {"input": {
                **{key: original[key] for key in PROFILE_FIELDS},
                "observed_revision": current["profile_revision"],
            }})
            if restored.get("ok") is not True:
                raise GateError("profile restoration command failed")
            assert_profile(session, {key: original[key] for key in PROFILE_FIELDS})
            result["profileRestoredExactly"] = True
    return result


def run_notifications_journey(
    receiver: TauriSession,
    sender: TauriSession,
    artifacts: Path,
) -> dict[str, Any]:
    """Use production Social commands and receiver UI without resetting actors."""
    receiver_profile = read_profile(receiver)
    sender_profile = read_profile(sender)
    sender_ptid = sender_profile["peers_touch"]["network_id"]
    receiver_ptid = receiver_profile["peers_touch"]["network_id"]
    federation_id = shared_federation_id(
        {"receiver": receiver, "sender": sender}, ("receiver", "sender"),
    )
    initial_relationship = call_async_harness(receiver, "refreshOnboardingProjection", {
        "peerPtid": sender_ptid,
    }, namespace="chat")
    if initial_relationship["acceptedFriendship"] or any(
        request["status"] == 1 for request in initial_relationship["requests"]
    ):
        raise GateError("notification fixture requires an existing actor pair without accepted or pending requests")
    baseline = read_payload(receiver, "notification_unread_counts")["total"]
    original_policy = receiver_profile["contact_policy"]
    result: dict[str, Any] = {"steps": [], "assertions": {}, "notificationIds": []}
    policy_changed = original_policy != "everyone"
    try:
        receiver.invoke_app_result("acceptance_request_activation")
        if policy_changed:
            read_payload(receiver, "profile_update", {"input": {
                "contact_policy": "everyone",
                "observed_revision": receiver_profile["profile_revision"],
            }})
        marker = f"desktop-notification-{time.time_ns()}"
        for index in range(8):
            response = sender.invoke_app_result("social_friend_request_send", {"input": {
                "receiver_ptid": receiver_ptid,
                "receiver_home_station_peer_id": receiver_profile["home_station_peer_id"],
                "federation_id": federation_id,
                "message": f"{marker}-{index}",
            }})
            if response.get("ok") is not True:
                raise GateError(f"production friend request failed: {response.get('error')}")
            item = wait(receiver, lambda: next((
                candidate for candidate in read_payload(receiver, "notification_list", {
                    "input": {"limit": 20},
                })["notifications"] if candidate["body"] == f"{marker}-{index}"
            ), None), "Social post-commit notification")
            result["notificationIds"].append(item["id"])
            wait(receiver, lambda: read_payload(receiver, "notification_unread_counts")["total"] == baseline + 1,
                 "authoritative unread increment")
            bell_selector = 'button[aria-haspopup="dialog"]'
            wait(receiver, lambda: receiver.execute_script(
                """const bell = document.querySelector(arguments[0]);
                return bell?.parentElement?.querySelector('.ant-badge-count')?.title
                  === String(arguments[1]);""",
                bell_selector, baseline + 1,
            ), "receiver Native notification badge increment")
            receiver.find_element(bell_selector, 30).click()
            row = receiver.find_element(f'[data-shell-notification="{item["id"]}"]', 30)
            if f"{marker}-{index}" not in row.text:
                raise GateError("receiver notification body differs from the production command")
            decision = "Accept" if index == 7 else "Decline"
            row.find_element("css selector", f'button[aria-label^="{decision}"], button[title^="{decision}"]').click()
            wait(receiver, lambda: read_payload(receiver, "notification_unread_counts")["total"] == baseline,
                 "inline decision reconciles authoritative unread")
            snapshot = call_async_harness(receiver, "refreshOnboardingProjection", {
                "peerPtid": sender_ptid,
            }, namespace="chat")
            expected_status = 2 if index == 7 else 3
            if not any(request["id"] == item["targetId"] and request["status"] == expected_status
                       for request in snapshot["requests"]):
                raise GateError(f"{decision} did not reach Social request authority")
            receiver.save_screenshot(artifacts / f"notification-{decision.lower()}-{index}.png")
            click_text(receiver, "More notifications")
            search_selector = '[data-notification-mode="all"] input'
            fill(receiver, search_selector, f"{marker}-{index}")
            wait(receiver, lambda: len(receiver.find_elements(
                '[data-notification-mode="all"] [data-shell-notification]',
            )) == 1, "notification search result")
            if f"{marker}-{index}" not in receiver.find_element(
                '[data-notification-mode="all"] [data-shell-notification]',
            ).text:
                raise GateError("notification search matched a different row")
            if index == 7:
                fill(receiver, search_selector, marker)
                wait(receiver, lambda: len(receiver.find_elements(
                    '[data-notification-mode="all"] [data-shell-notification]',
                )) == 6, "notification first page")
                first_page = {row.get_attribute("data-shell-notification") for row in receiver.find_elements(
                    '[data-notification-mode="all"] [data-shell-notification]',
                )}
                receiver.find_element('.ant-pagination-item-2', 30).click()
                wait(receiver, lambda: len(receiver.find_elements(
                    '[data-notification-mode="all"] [data-shell-notification]',
                )) == 2, "notification second page")
                second_page = {row.get_attribute("data-shell-notification") for row in receiver.find_elements(
                    '[data-notification-mode="all"] [data-shell-notification]',
                )}
                if first_page & second_page or first_page | second_page != set(result["notificationIds"]):
                    raise GateError("notification pagination lost or duplicated generated rows")
                fill(receiver, search_selector, f"{marker}-absent")
                wait(receiver, lambda: not receiver.find_elements(
                    '[data-notification-mode="all"] [data-shell-notification]',
                ), "notification empty search")
                receiver.save_screenshot(artifacts / "notification-search-empty.png")
            receiver.find_element('.ant-modal-close', 30).click()
            wait(receiver, lambda: not receiver.find_elements('[data-notification-mode="all"]'),
                 "notification modal dismissal")
        result["steps"].extend([
            "social_post_commit_receiver_notifications", "inline_decline_and_accept",
            "receiver_unread_increment_and_clear", "notification_search_and_pagination",
        ])
        result["assertions"].update(C7=True, C9=True)

        receiver.find_element('[data-pt-primary-nav="settings"] [role="button"]', 30).click()
        receiver.find_element('[data-pt-secondary-tab="general"]', 30).click()
        receiver.find_element('[data-pt-section-item="notifications"]', 30).click()
        registrations = read_payload(receiver, "notification_push_devices")["registrations"]
        wait(receiver, lambda: len(receiver.find_elements("[data-push-registration]")) == len(registrations),
             "push registrations reflect authority")
        if not registrations:
            wait(receiver, lambda: "No mobile push devices are registered." in receiver.execute_script(
                "return document.body.innerText",
            ), "truthful push device empty state")
        for registration in registrations:
            row = receiver.find_element(f'[data-push-registration="{registration["registrationId"]}"]')
            if registration["deviceId"] not in row.text or row.find_elements("css selector", "button,input"):
                raise GateError("push registration projection is inaccurate or exposes an unsupported mutation")
        if any(key.lower() in {"token", "push_token", "pushtoken"} for value in registrations for key in value):
            raise GateError("push device response exposes a token")
        receiver.save_screenshot(artifacts / "push-devices.png")
        result["steps"].append("push_device_authority_read_only")
        result["assertions"]["C8"] = True
    finally:
        if policy_changed:
            current = read_profile(receiver)
            read_payload(receiver, "profile_update", {"input": {
                "contact_policy": original_policy, "observed_revision": current["profile_revision"],
            }})
            assert_profile(receiver, {"contact_policy": original_policy})
            result["contactPolicyRestoredExactly"] = True
    return result


def main() -> int:
    """Development-only runtime owner; never publishes formal proof."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--account", required=True)
    parser.add_argument("--sender-account", required=True)
    parser.add_argument("--notifications-only", action="store_true")
    parser.add_argument("--recover-probe-collections", action="store_true")
    args = parser.parse_args()
    station_url = os.environ["PT_STATION_URL"]
    if "localhost" in station_url or "127.0.0.1" in station_url:
        raise GateError("Native development requires the approved remote Station")
    workspace = Path.home() / ".peers-touch/dev/workspaces" / workspace_id(REPO_ROOT)
    active = json.loads((workspace / "workflow/active-work.json").read_text())
    if active.get("currentTaskId") != "DUI-01-PROFILE-NOTIFICATIONS" or active.get("devState") != "FUNCTIONAL_RUNNING":
        raise GateError("Native Profile diagnostics require the current functional Task")
    session_id = str(active["sessionId"])
    if Path(session_id).name != session_id:
        raise GateError("Development Session identity is invalid")
    artifacts = workspace / "debug" / session_id / f"profile-{time.time_ns()}"
    artifacts.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    session = TauriSession(LocalTauriLauncher(
        port=port, profile="profile-notifications-development",
        environment={"PT_STATION_URL": station_url, "PT_STATION_HEALTH_URL": f"{station_url}/sub-oss/healthz"},
    ))
    binding = LocalMacOSRuntimeBinding()
    result: dict[str, Any] = {"policy": "development", "proof": "UNPROVEN"}
    sender: TauriSession | None = None
    client_specs: dict[str, dict[str, Any]] = {}
    sessions = [session]
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            sender_port = probe.getsockname()[1]
        sender = TauriSession(LocalTauriLauncher(
            port=sender_port, profile="profile-notifications-sender",
            environment={"PT_STATION_URL": station_url, "PT_STATION_HEALTH_URL": f"{station_url}/sub-oss/healthz"},
        ))
        sessions.append(sender)
        for role, client, account, client_port in (
            ("receiver", session, args.account, port),
            ("sender", sender, args.sender_account, sender_port),
        ):
            client.start()
            client.wait_for_acceptance_harness(30)
            client.invoke_app_result("station_add", {"input": {"url": station_url}})
            client.invoke_app_result("station_set_active", {"input": {"url": station_url}})
            login = call_async_harness(client, "loginWithPassword", {
                "account": account, "password": DEV_ACCOUNT_PASSWORD,
            }, namespace="chat", script_timeout=90)
            if login.get("authenticated") is not True:
                raise GateError(f"existing {role} actor did not authenticate")
            client_specs[role] = {
                "webdriver_port": client_port, "renderer_port": client_port,
                "storage_root": client.storage_root, "storage_lifecycle": "ephemeral",
            }
        if args.recover_probe_collections:
            snapshot = read_profile(session)
            expected = {
                "tags": [tag for tag in snapshot["tags"] if not tag.startswith("native-proof")],
                "links": [link for link in snapshot["links"] if link["url"] != "https://example.com/native-proof"],
            }
            response = session.invoke_app_result("profile_update", {"input": {
                **expected, "observed_revision": snapshot["profile_revision"],
            }})
            if response.get("ok") is not True:
                raise GateError("prior probe collection recovery failed")
            assert_profile(session, expected)
        result["notifications"] = run_notifications_journey(session, sender, artifacts)
        if not args.notifications_only:
            result.update(run_profile_journey(session, binding, artifacts))
        result["result"] = "PASS"
    except Exception as error:
        result.update(result="FAIL", failure=str(error), failureType=type(error).__name__)
        if session.is_alive():
            result["body"] = session.execute_script("return document.body.innerText")
            session.save_screenshot(artifacts / "failure.png")
    finally:
        result["nativeProcessIds"] = [client.process_id for client in sessions if client.process_id]
        for client in reversed(sessions):
            client.stop()
        cleanup = binding.finalize_cleanup(tuple(sessions), client_specs)
        result["cleanup"] = cleanup
        (artifacts / "result.json").write_text(json.dumps(result, indent=2))
        sys.stdout.write(json.dumps(result, indent=2) + "\n")
    return 0 if result.get("result") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
