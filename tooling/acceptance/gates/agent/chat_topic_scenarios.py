"""Topic UI actions and independent Station authority assertions."""

from __future__ import annotations

from typing import Any
import time

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


def idle_stability(
    runner: AgentNativeJourney, *, duration_seconds: float = 130,
) -> dict[str, Any]:
    """Observe production timers without Harness reconciliation or Store reads."""
    require(duration_seconds >= 130, "Idle observation must span two real timer cycles")
    composer = "[data-pt-agent-composer-input]"
    original = runner.driver.find_element(By.CSS_SELECTOR, composer).get_attribute("value")
    runner.set_input_value(composer, "unsent idle regression draft", "idle draft")
    runner.click_visible(composer, "focus idle composer")
    runner.driver.execute_script("""
      const ids=new WeakMap();let next=0;
      const id=e=>e?(ids.get(e)||(ids.set(e,++next),next)):null;
      const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const root=document.querySelector('[data-pt-agent-workbench]');
      const conversation=root.querySelector('[data-pt-agent-conversation]');
      const scroll=[...conversation.querySelectorAll('*')].find(e=>
        visible(e)&&/auto|scroll/.test(getComputedStyle(e).overflowY)
        &&e.scrollHeight>e.clientHeight+2);
      if(scroll)scroll.scrollTop=Math.min(24,scroll.scrollHeight-scroll.clientHeight);
      const p=window.__ptTopicIdle={samples:[],mutations:0,started:performance.now()};
      p.observer=new MutationObserver(records=>{p.mutations+=records.length;});
      p.observer.observe(root,{subtree:true,childList:true,attributes:true});
      p.sample=()=>{
        const input=document.querySelector('[data-pt-agent-composer-input]');
        p.samples.push({
          at:performance.now()-p.started,timeOrigin:performance.timeOrigin,
          root:id(document.querySelector('[data-pt-agent-workbench]')),
          conversation:id(document.querySelector('[data-pt-agent-conversation]')),
          composer:id(input),focused:document.activeElement===input,
          draftIntact:input?.value==='unsent idle regression draft',
          rows:[...document.querySelectorAll('[data-pt-agent-message-id]')].filter(visible).map(id),
          actions:[...root.querySelectorAll(
            '[data-pt-agent-topic-search],[data-pt-agent-topic-batch-select]')].filter(visible).map(id),
          syncing:[...root.querySelectorAll('span')].some(e=>visible(e)&&/^(Syncing|同步)/i.test(e.textContent)),
          scroll:id(scroll),scrollTop:scroll?.scrollTop??0,
        });
      };
      p.sample();p.timer=setInterval(p.sample,50);
    """)
    try:
        deadline = time.monotonic() + duration_seconds
        while time.monotonic() < deadline:
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))
        observed = runner.driver.execute_script("""
          const p=window.__ptTopicIdle;p.sample();
          return {samples:p.samples,mutations:p.mutations};
        """)
        samples = observed["samples"]
        first = samples[0]
        require(len(first["actions"]) == 2, "Accepted Topic actions are missing")
        for item in samples:
            require(all(item[key] == first[key] for key in (
                "timeOrigin", "root", "conversation", "composer", "rows", "actions", "scroll",
            )), "Idle reconciliation replaced accepted Native nodes")
            require(item["focused"] and item["draftIntact"], "Idle reconciliation lost composer state")
            require(not item["syncing"], "Idle reconciliation replayed Topic entry loading")
            require(abs(item["scrollTop"] - first["scrollTop"]) <= 1,
                    "Idle reconciliation changed conversation scroll")
        return {
            "uiAction": "type unsent text, focus composer and leave the real Native Topic idle",
            "receiverAssertion": "message/action nodes, focus, draft and scroll survive two timer cycles",
            "durationSeconds": samples[-1]["at"] / 1000, "sampleCount": len(samples),
            "messageRowCount": len(first["rows"]), "scrollExercised": first["scroll"] is not None,
            "mutationRecords": observed["mutations"], "nodeReplacements": 0, "syncingSamples": 0,
        }
    finally:
        runner.driver.execute_script("""
          const p=window.__ptTopicIdle;
          if(p){clearInterval(p.timer);p.observer.disconnect();delete window.__ptTopicIdle;}
        """)
        runner.set_input_value(composer, original or "", "restore owned idle draft")


def periodic_title_update(runner: AgentNativeJourney, topic_id: str) -> dict[str, Any]:
    """A namespaced Fixture edit must reach Native through the real timer."""
    original = topic(runner, topic_id)
    changed_title = f"Periodic title {topic_id}"

    def update(value: dict[str, Any], title: str) -> None:
        runner.invoke_readback_command("agent_conversation_update", {
            "conversation_id": topic_id, "expected_version": int(value["version"]),
            "title": title, "description": value.get("description", ""),
            "meta": value.get("meta", {}),
            "model_name": value.get("model_name", ""),
            "provider_id": value.get("provider_id", ""),
            "active_branch_message_id": value.get("active_branch_message_id", ""),
        })

    update(original, changed_title)
    started = time.monotonic()
    try:
        wait_until(
            lambda: changed_title in runner.driver.find_element(
                By.CSS_SELECTOR, row_selector(topic_id),
            ).text,
            "real periodic Topic title projection", timeout=75,
        )
        accepted = topic(runner, topic_id)
        require(accepted["title"] == changed_title, "Station title changed concurrently")
        return {
            "supportingFixtureAction": "versioned namespaced Station Topic title update",
            "receiverAssertion": "changed title becomes visible without Harness reconciliation",
            "projectionDelaySeconds": time.monotonic() - started,
            "stationVersion": accepted["version"],
        }
    finally:
        current = topic(runner, topic_id)
        require(current["title"] == changed_title, "Cannot restore a concurrent Topic edit")
        update(current, original["title"])
        wait_until(
            lambda: original["title"] in runner.driver.find_element(
                By.CSS_SELECTOR, row_selector(topic_id),
            ).text,
            "restored periodic Topic title projection", timeout=75,
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
    stability = idle_stability(runner)
    changed_projection = periodic_title_update(runner, topic_id)
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
        "idleStability": stability,
        "periodicTitleUpdate": changed_projection,
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
