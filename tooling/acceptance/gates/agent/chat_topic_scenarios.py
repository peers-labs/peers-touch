"""Topic UI actions and independent Station authority assertions."""

from __future__ import annotations

from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.drivers.native import NativeKey
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    require,
    wait_until,
)


def label(runner: AgentNativeJourney, key: str) -> str:
    import json

    # Native suites explicitly select English during Suite setup.
    from tooling.acceptance.gates.agent.native_agent_runner import REPO_ROOT
    return json.loads((REPO_ROOT / "packages/locales/en/agent.json").read_text())[key]


def row_selector(topic_id: str) -> str:
    return f'[data-pt-agent-topic-row="{topic_id}"]'


def topic(runner: AgentNativeJourney, topic_id: str) -> dict[str, Any]:
    return runner.invoke_readback_command(
        "agent_conversation_get", {"conversation_id": topic_id},
    )["conversation"]


def prepare_topics(runner: AgentNativeJourney, agent_id: str) -> list[str]:
    """Fixture data is supporting setup; it never proves Topic creation."""
    ids = []
    for index in range(2):
        created = runner.invoke_readback_command("agent_conversation_create", {
            "agent_id": agent_id,
            "title": f"Topic {index} {runner.runtime_manifest['runId']}",
        })["conversation"]
        ids.append(str(created["conversation_id"]))
    return ids


def select_topic(runner: AgentNativeJourney, topic_id: str) -> None:
    runner.click_visible(row_selector(topic_id), "Topic row")
    wait_until(
        lambda: runner.runtime_snapshot()["currentSessionKey"] == topic_id,
        "selected Topic projection",
    )


def navigation(
    runner: AgentNativeJourney, agent_id: str, ids: list[str],
) -> dict[str, Any]:
    rail = "[data-pt-agent-topic-list]"
    title = runner.station_agent(agent_id)["title"]
    require(
        title in runner.driver.find_element(By.CSS_SELECTOR, rail).text,
        "Topic rail omits the owning Agent identity",
    )
    controls = runner.driver.execute_script(
        """
        const root = document.querySelector('[data-pt-agent-topic-list]');
        return arguments[0]
          .map(selector => root.querySelector(selector))
          .filter(element => element?.getClientRects().length)
          .map(element => element.getBoundingClientRect().width);
        """, [
            "[data-pt-agent-session-start]",
            "[data-pt-agent-topic-profile]",
            "[data-pt-agent-topic-search]",
        ],
    )
    require(len(controls) == 3 and max(controls) - min(controls) < 2,
            "Topic action slots have unequal widths")
    require(not runner.driver.execute_script(
        "return Boolean(document.querySelector(arguments[0])?.querySelector('img'))",
        row_selector(ids[0]),
    ), "Topic row carries an Agent avatar")
    runner.click_visible(
        f"{rail} [data-pt-agent-topic-search]", "search Topics",
    )
    search = f'{rail} input[placeholder="{label(runner, "agent.sidebar.searchTopics")}"]'
    runner.wait_visible_element(search, "Topic search input")
    require(runner.visible_element_state("[data-pt-agent-session-start]") is None,
            "Topic search did not replace action row")
    runner.set_input_value(search, topic(runner, ids[0])["title"], "Topic title query")
    runner.wait_visible_element(row_selector(ids[0]), "matching Topic")
    require(runner.visible_element_state(row_selector(ids[1])) is None,
            "title search retained an unrelated Topic")
    runner.set_input_value(search, ids[0], "internal Topic ID query")
    require(runner.visible_element_state(row_selector(ids[0])) is None,
            "Topic search matches an internal identifier instead of the title")
    runner.set_input_value(search, "", "clear Topic query")
    runner.press_native_key(NativeKey.ESCAPE, selector=search)
    runner.wait_visible_element("[data-pt-agent-session-start]", "restored Topic actions")
    # Date group is a real expandable owner, not an API grouping assertion.
    collapsed = runner.driver.execute_script(
        """
        const row = document.querySelector(arguments[0]);
        const button = row?.closest('section')?.querySelector(':scope > button');
        button?.click();
        return Boolean(button);
        """, row_selector(ids[0]),
    )
    require(collapsed, "Topic date group has no collapse action")
    wait_until(lambda: runner.visible_element_state(row_selector(ids[0])) is None,
               "collapsed Topic date group")
    require(runner.driver.execute_script(
        """
        const button = [...document.querySelectorAll(
          '[data-pt-agent-topic-list] section > button')]
          .find(element => element.getClientRects().length);
        button?.click();
        return Boolean(button);
        """
    ), "collapsed Topic group cannot reopen")
    runner.wait_visible_element(row_selector(ids[0]), "expanded Topic date group")
    runner.click_visible("[data-pt-agent-session-start]", "new draft Topic")
    require(
        runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
        .get_attribute("value") == "",
        "New Topic inherited another Topic draft",
    )
    select_topic(runner, ids[0])
    runner.click_visible(
        f'{row_selector(ids[0])} [aria-label="{label(runner, "agent.sidebar.topicActions")}"]',
        "Topic menu scope",
    )
    runner.wait_visible_element(".ant-dropdown-menu-item", "Topic menu")
    menu_text = runner.driver.execute_script(
        """
        return [...document.querySelectorAll('.ant-dropdown-menu-item')]
          .filter(element => element.getClientRects().length)
          .map(element => element.innerText.trim());
        """
    )
    require(set(menu_text) == {
        label(runner, "agent.sidebar.menu.pin"),
        label(runner, "agent.sidebar.menu.rename"),
        label(runner, "agent.sidebar.menu.delete"),
    }, "Topic menu exposes unsupported operations")
    select_topic(runner, ids[0])
    return {
        "uiAction": "search Topic titles, cancel search, collapse group, create new draft and inspect Topic menu",
        "receiverAssertion": "owning Agent, equal action slots, title matches and bounded Topic menu are visible",
        "stationReadback": [topic(runner, topic_id) for topic_id in ids],
        "actionSlotWidths": controls, "menuItems": menu_text,
        "operationIds": [
            "topic.agent-identity", "topic.actions.equal-icon-slots",
            "topic.search.replaces-action-row", "topic.search.cancel-restores-actions",
            "topic.identity.no-avatar", "topic.new", "topic.group-collapse",
            "topic.no-smart-rename", "topic.no-sort-filter", "topic.search-title-only",
        ],
    }


def menu(runner: AgentNativeJourney, topic_id: str, action: str) -> None:
    select_topic(runner, topic_id)
    runner.click_visible(
        f'{row_selector(topic_id)} [aria-label="{label(runner, "agent.sidebar.topicActions")}"]',
        "Topic actions",
    )
    text = label(runner, f"agent.sidebar.menu.{action}")
    runner.wait_visible_element(".ant-dropdown-menu-item", "Topic action menu")
    clicked = runner.driver.execute_script(
        """
        const item = [...document.querySelectorAll('.ant-dropdown-menu-item')]
          .find(element => element.getClientRects().length
            && element.innerText.trim() === arguments[0]);
        item?.click();
        return Boolean(item);
        """, text,
    )
    require(clicked, f"Topic {action} action is unavailable")


def rename_and_drafts(
    runner: AgentNativeJourney,
    agent_id: str,
    ids: list[str],
) -> dict[str, Any]:
    original = topic(runner, ids[0])
    select_topic(runner, ids[0])
    runner.set_input_value("[data-pt-agent-composer-input]", "first draft", "first draft")
    select_topic(runner, ids[1])
    require(
        runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]").get_attribute("value") != "first draft",
        "Topic switch leaked the first draft",
    )
    runner.set_input_value("[data-pt-agent-composer-input]", "second draft", "second draft")
    select_topic(runner, ids[0])
    wait_until(
        lambda: runner.driver.find_element(
            By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
        ).get_attribute("value") == "first draft",
        "first Topic draft restoration",
    )
    menu(runner, ids[0], "rename")
    rename_selector = f"{row_selector(ids[0])} input"
    rename = runner.driver.find_element(By.CSS_SELECTOR, rename_selector)
    rename.clear()
    rename.send_keys("cancelled title")
    runner.press_native_key(NativeKey.ESCAPE, selector=rename_selector)
    require(topic(runner, ids[0])["title"] == original["title"], "Escape saved rename")
    menu(runner, ids[0], "rename")
    renamed_title = f"Renamed {runner.runtime_manifest['runId']}"
    rename = runner.driver.find_element(By.CSS_SELECTOR, rename_selector)
    rename.clear()
    rename.send_keys(renamed_title)
    runner.press_native_key(NativeKey.ENTER, selector=rename_selector)
    accepted = wait_until(
        lambda: (
            value if (value := topic(runner, ids[0]))["title"] == renamed_title
            else None
        ),
        "Station accepted Topic title",
    )
    runner.wait_visible_element(row_selector(ids[0]), "renamed Topic")
    require(
        renamed_title in runner.driver.find_element(
            By.CSS_SELECTOR, row_selector(ids[0]),
        ).text,
        "renamed title not projected in Topic rail",
    )
    return {
        "uiAction": "switch Topics, restore draft, cancel rename with Escape, accept rename with Enter",
        "receiverAssertion": "isolated first draft restored and accepted title visible",
        "stationReadback": accepted,
        "agentId": agent_id,
    }


def agent_drafts(
    runner: AgentNativeJourney, agent_id: str, topic_id: str,
) -> dict[str, Any]:
    """Use two real roster entries to prove draft ownership and restoration."""
    from tooling.acceptance.gates.agent.chat_profile_scenarios import create_profile

    select_topic(runner, topic_id)
    first = "first Agent isolated draft"
    runner.set_input_value("[data-pt-agent-composer-input]", first, "first Agent draft")
    sibling = create_profile(runner)["agentId"]
    runner.click_visible("[data-pt-agent-profile-back]", "sibling Profile Back")
    runner.select_agent_chat(sibling)
    composer = "[data-pt-agent-composer-input]"
    require(runner.driver.find_element(By.CSS_SELECTOR, composer).get_attribute("value") != first,
            "Agent switch leaked another Agent's draft")
    second = "second Agent isolated draft"
    runner.set_input_value(composer, second, "second Agent draft")
    runner.select_agent_chat(agent_id)
    select_topic(runner, topic_id)
    wait_until(lambda: runner.driver.find_element(By.CSS_SELECTOR, composer)
               .get_attribute("value") == first, "first Agent draft restored")
    runner.select_agent_chat(sibling)
    wait_until(lambda: runner.driver.find_element(By.CSS_SELECTOR, composer)
               .get_attribute("value") == second, "second Agent draft restored")
    runner.select_agent_chat(agent_id)
    select_topic(runner, topic_id)
    return {
        "uiAction": "type separate drafts and switch between two real Agents",
        "receiverAssertion": "each Agent restores its own composer text",
        "stationReadback": [runner.station_agent(agent_id), runner.station_agent(sibling)],
        "operationIds": ["draft.agent-isolation", "draft.agent-restore"],
    }


def first_send_and_delete(
    runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str],
) -> dict[str, Any]:
    from tooling.acceptance.gates.agent.chat_model_scenarios import select_model

    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new first-send Topic")
    select_model(runner, fixture)
    message = f"First send title {runner.runtime_manifest['runId']}"
    runner.driver.find_element(
        By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
    ).send_keys(message)
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-composer-input]",
    )
    response = f"Profile prompt accepted {runner.runtime_manifest['runId']}"
    wait_until(lambda: runner.driver.execute_script(
        """
        return [...document.querySelectorAll('[data-pt-agent-message-id]')]
          .some(element => element.getClientRects().length
            && element.innerText.includes(arguments[0]));
        """, response,
    ), "first-send Provider reply")
    topic_id = runner.runtime_snapshot()["currentSessionKey"]
    accepted = topic(runner, topic_id)
    require(accepted["title"].strip() and accepted["title"] != label(runner, "agent.sidebar.newTopic"),
            "first send retained an untitled Topic")
    runner.wait_visible_element(row_selector(topic_id), "promoted Topic row")
    require(accepted["title"] in runner.driver.find_element(By.CSS_SELECTOR, row_selector(topic_id)).text,
            "first-send title is absent from Topic rail")
    listed = runner.invoke_readback_command(
        "agent_conversation_list", {"agent_id": agent_id, "page": 1, "page_size": 200},
    )
    # A successful first send promotes the draft; no extra local draft is counted.
    labels = label(runner, "agent.sidebar.topicsCount")
    count_text = labels.replace("{{count}}", str(len(listed["conversations"])))
    require(count_text in runner.driver.find_element(
        By.CSS_SELECTOR, "[data-pt-agent-topic-list]",
    ).text, "inline Topic count disagrees with the persisted Topic list")
    menu(runner, topic_id, "delete")
    runner.wait_visible_element(".ant-modal-confirm", "single Topic confirmation")
    require(topic(runner, topic_id)["conversation_id"] == topic_id,
            "opening confirmation deleted the Topic")
    runner.click_visible(".ant-modal-confirm .ant-btn-primary", "confirm single Topic delete")
    wait_until(lambda: runner.visible_element_state(row_selector(topic_id)) is None,
               "single Topic row removed")
    deleted = runner.invoke_readback_command(
        "agent_conversation_get", {"conversation_id": topic_id},
    )["conversation"]
    require(deleted["status"] == "deleted", "single Topic deletion is not Station-backed")
    require(not runner.driver.execute_script(
        """
        return [...document.querySelectorAll('[data-pt-agent-message-id]')]
          .some(element => element.getClientRects().length
            && element.innerText.includes(arguments[0]));
        """, response,
    ), "deleted Topic messages remain visible")
    return {
        "uiAction": "create Topic, select model, send with Enter and confirm single Topic deletion",
        "receiverAssertion": "promoted title and inline count appear, then Topic and messages disappear",
        "stationReadback": {"created": accepted, "deleted": deleted},
        "operationIds": ["topic.first-send-title", "topic.count.inline", "topic.delete-confirm"],
    }


def pin(runner: AgentNativeJourney, topic_id: str) -> dict[str, Any]:
    menu(runner, topic_id, "pin")
    pinned = wait_until(
        lambda: (
            value if (value := topic(runner, topic_id)).get("meta", {}).get("pinned") == "true"
            else None
        ),
        "Station pinned Topic",
    )
    # Reopening the actual menu must expose Unpin after authority projection.
    menu(runner, topic_id, "unpin")
    restored = wait_until(
        lambda: (
            value if (value := topic(runner, topic_id)).get("meta", {}).get("pinned") != "true"
            else None
        ),
        "Station unpinned Topic",
    )
    return {
        "uiAction": "Pin Topic, reopen menu and Unpin",
        "receiverAssertion": "menu changes to Unpin for the pinned Topic",
        "pinnedReadback": pinned, "stationReadback": restored,
    }


def batch_delete(
    runner: AgentNativeJourney,
    agent_id: str,
    ids: list[str],
) -> dict[str, Any]:
    runner.click_visible(
        "[data-pt-agent-topic-list] [data-pt-agent-topic-batch-select]",
        "select Topics",
    )
    for topic_id in ids:
        runner.click_visible(row_selector(topic_id), "select owned Topic")
    runner.click_visible(
        "[data-pt-agent-topic-list] [data-pt-agent-topic-batch-delete]",
        "delete selected Topics",
    )
    runner.wait_visible_element(".ant-modal-confirm", "Topic batch confirmation")
    before = [topic(runner, topic_id) for topic_id in ids]
    require(len(before) == len(ids), "confirmation mutated Topics before acceptance")
    runner.click_visible(".ant-modal-confirm .ant-btn-dangerous", "confirm Topic batch delete")
    def batch_absent() -> dict[str, Any] | None:
        value = runner.invoke_readback_command(
            "agent_conversation_list",
            {"agent_id": agent_id, "page": 1, "page_size": 200},
        )
        remaining = {
            conversation["conversation_id"]
            for conversation in value["conversations"]
        }
        return value if not set(ids).intersection(remaining) else None

    listed = wait_until(
        batch_absent,
        "whole batch removed from Station",
    )
    for topic_id in ids:
        wait_until(
            lambda topic_id=topic_id: runner.visible_element_state(row_selector(topic_id)) is None,
            "deleted Topic row removal",
        )
    draft = runner.driver.find_element(
        By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
    ).get_attribute("value")
    require(draft not in {"first draft", "second draft"}, "deleted Topic draft remains")
    return {
        "uiAction": "select two owned Topics and confirm batch deletion",
        "receiverAssertion": "both Topic rows and their composer drafts disappear",
        "stationReadback": listed,
        "confirmationReadback": before,
    }


def delete_agent(runner: AgentNativeJourney, agent_id: str) -> dict[str, Any]:
    # Keep persisted history and an unsent draft alive until the actual Agent
    # deletion action; deleting an already empty Agent cannot prove a cascade.
    ids = prepare_topics(runner, agent_id)
    runner.harness("reconcileChatSuiteTopicProjection")
    runner.select_agent_chat(agent_id)
    select_topic(runner, ids[0])
    draft = f"Deleted Agent draft {runner.runtime_manifest['runId']}"
    runner.set_input_value("[data-pt-agent-composer-input]", draft, "cascade draft")
    runner.delete_lifecycle_agent(agent_id)
    absent = runner.station_agent_absent(agent_id)
    require(absent is not None, "deleted Agent remains in Station roster")
    deleted = [topic(runner, topic_id) for topic_id in ids]
    require(all(value["status"] == "deleted" for value in deleted),
            "Agent deletion left an authoritative Topic alive")
    for topic_id in ids:
        require(runner.visible_element_state(row_selector(topic_id)) is None,
                "deleted Agent Topic remains visible")
    require(runner.selected_profile() is None, "deleted Agent Profile remains mounted")
    composer = runner.visible_element_state("[data-pt-agent-composer-input]")
    if composer is not None:
        require(runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
                .get_attribute("value") != draft, "deleted Agent draft remains visible")
    return {
        "uiAction": "open Agent delete and confirm",
        "receiverAssertion": "Agent, its Topic rows, Profile and composer draft disappear",
        "stationReadback": {"roster": absent, "topics": deleted},
    }
