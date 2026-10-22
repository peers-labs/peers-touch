"""Profile identity and avatar actions with Station authority readback."""

from __future__ import annotations

import json
from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, REPO_ROOT, require, wait_until,
)
from tooling.acceptance.gates.chat.native_file_picker import select_native_file


def click_text(runner: AgentNativeJourney, selector: str, text: str) -> None:
    runner.click_visible(
        selector,
        f"visible control {text}",
        text=text,
    )


def identity(runner: AgentNativeJourney, agent_id: str) -> dict[str, Any]:
    labels = json.loads((REPO_ROOT / "packages/locales/en/agent.json").read_text())
    description = f"Description {runner.runtime_manifest['runId']}"
    runner.set_input_value(
        f'textarea[aria-label="{labels["agent.profile.identityDescriptionPlaceholder"]}"]',
        description, "Profile description",
    )
    saved = wait_until(
        lambda: (
            value if (value := runner.station_agent(agent_id)).get("description") == description
            else None
        ), "Profile description autosave",
    )
    wait_until(
        lambda: runner.driver.execute_script(
            "return document.body.innerText.includes(arguments[0])",
            labels["agent.profile.changesSaved"],
        ), "Profile save toast",
    )
    presentation = runner.driver.execute_script(
        """
        const root = document.querySelector('[data-pt-agent-profile-editor]');
        const title = root.querySelector('[data-pt-agent-profile-title]');
        const description = root.querySelector('textarea[aria-label="' + arguments[0] + '"]');
        const avatar = root.querySelector('button[aria-label="' + arguments[1] + '"]');
        const back = root.querySelector('[data-pt-agent-profile-back]');
        return {titleX: title.getBoundingClientRect().x,
                descriptionX: description.getBoundingClientRect().x,
                avatarX: avatar.getBoundingClientRect().x,
                backX: back.getBoundingClientRect().x,
                inlineStatus: [...root.querySelectorAll('[role="status"]')]
                  .some(element => element.getClientRects().length)};
        """, labels["agent.profile.identityDescriptionPlaceholder"],
        labels["agent.profile.changeAvatar"],
    )
    require(
        abs(presentation["titleX"] - presentation["descriptionX"]) < 2
        and abs(presentation["avatarX"] - presentation["backX"]) < 2,
        "Profile title and description do not share identity columns",
    )
    require(not presentation["inlineStatus"], "Profile exposes inline save status")
    runner.click_visible(
        f'button[aria-label="{labels["agent.profile.changeAvatar"]}"]', "avatar picker",
    )
    emoji = "🧪"
    runner.click_visible(
        f'button[aria-label="{labels["agent.profile.avatar.useEmoji"].replace("{{emoji}}", emoji)}"]',
        "experiment emoji",
    )
    wait_until(
        lambda: runner.station_agent(agent_id).get("avatar") == emoji,
        "emoji Station persistence",
    )
    runner.click_visible(
        f'button[aria-label="{labels["agent.profile.changeAvatar"]}"]', "reopen avatar picker",
    )
    click_text(runner, '.ant-modal [role="tab"]', labels["agent.profile.avatar.upload"])
    root = runner.run_root / "identity-fixtures"
    root.mkdir(parents=True, exist_ok=True)
    invalid = root / "invalid.txt"
    invalid.write_text("invalid avatar fixture")
    require(runner.runtime_binding is not None, "avatar upload requires Native runtime binding")

    def choose_avatar(path: Any) -> dict[str, Any]:
        return select_native_file(
            actor=runner.client["id"],
            client=runner.tauri_driver,
            sessions=runner.runtime_sessions,
            runtime_binding=runner.runtime_binding,
            source_path=path,
            trigger=lambda: click_text(
                runner, ".ant-modal button", labels["agent.profile.avatar.choose"],
            ),
        )

    invalid_selection = choose_avatar(invalid)
    alert = runner.wait_visible_element('.ant-modal [role="alert"]', "invalid avatar feedback")
    require(
        runner.driver.find_element(By.CSS_SELECTOR, '.ant-modal [role="alert"]').text
        == labels["agent.profile.avatar.invalidType"],
        "invalid avatar type produced the wrong feedback",
    )
    require(runner.station_agent(agent_id).get("avatar") == emoji, "invalid upload changed avatar")
    import base64
    image = root / "avatar.png"
    image.write_bytes(base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZQAAAABJRU5ErkJggg=="
    ))
    preview_selection = choose_avatar(image)
    runner.wait_visible_element('.ant-modal img', "avatar preview")
    click_text(runner, '.ant-modal button', labels["agent.profile.avatar.cancel"])
    require(runner.station_agent(agent_id).get("avatar") == emoji, "cancel committed avatar preview")
    runner.click_visible(
        f'button[aria-label="{labels["agent.profile.changeAvatar"]}"]', "avatar picker for save",
    )
    click_text(runner, '.ant-modal [role="tab"]', labels["agent.profile.avatar.upload"])
    accepted_selection = choose_avatar(image)
    runner.wait_visible_element('.ant-modal img', "accepted avatar preview")
    click_text(runner, '.ant-modal button', labels["agent.profile.avatar.save"])
    accepted = wait_until(
        lambda: (
            value if (value := runner.station_agent(agent_id)).get("avatar", "").startswith("data:image/png;")
            else None
        ), "image avatar Station persistence",
    )
    runner.click_visible("[data-pt-agent-profile-back]", "Profile back")
    runner.click_agent_action(agent_id, "edit")
    runner.wait_visible_element(
        f'button[aria-label="{labels["agent.profile.changeAvatar"]}"] img',
        "persisted image avatar",
    )
    return {
        "uiAction": "blur description, choose emoji, reject invalid upload, cancel preview, save image and reopen Profile",
        "receiverAssertion": "save toast, aligned identity fields, upload feedback and persisted image are visible",
        "stationReadback": {
            "description": saved.get("description"),
            "avatarImagePersisted": accepted["avatar"].startswith("data:image/png;"),
        },
        "presentation": presentation, "invalidFeedback": alert,
        "nativeFileSelections": [
            invalid_selection, preview_selection, accepted_selection,
        ],
        "operationIds": [
            "profile.identity.save-toast",
            "profile.identity.no-inline-save-status", "profile.identity.alignment",
            "profile.avatar.emoji", "profile.avatar.upload-validation",
            "profile.avatar.upload-cancel", "profile.avatar.image",
            "profile.avatar.persisted-projection",
        ],
    }
