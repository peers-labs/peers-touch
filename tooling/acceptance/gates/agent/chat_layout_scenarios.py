"""Native window topology assertions, attached to the Suite-owned client."""

from __future__ import annotations

import json
from typing import Any

from tooling.acceptance.drivers.native import NativeKey
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    require,
    wait_until,
)


def topology(runner: AgentNativeJourney) -> dict[str, Any]:
    return runner.driver.execute_script(
        """
        const root = document.querySelector('[data-pt-agent-workbench]');
        if (!root) return null;
        const visible = selector => [...document.querySelectorAll(selector)]
          .filter(element => element.getClientRects().length > 0);
        const rails = selector => visible(selector).map(element => ({
          state: element.getAttribute(selector.includes('topic')
            ? 'data-pt-topic-rail' : 'data-pt-agent-rail'),
          width: element.getBoundingClientRect().width,
        }));
        return {
          layout: root.dataset.ptAgentLayout,
          width: root.getBoundingClientRect().width,
          agentRails: rails('[data-pt-agent-rail]'),
          topicRails: rails('[data-pt-topic-rail]'),
          composerVisible: visible('[data-pt-agent-composer]').length > 0,
          mobileTopics: visible('[data-pt-agent-mobile-topics]').length > 0,
          drawer: visible('.ant-drawer-content-wrapper').map(element => ({
            left: element.getBoundingClientRect().left,
            top: element.getBoundingClientRect().top,
            width: element.getBoundingClientRect().width,
          })),
          horizontalOverflow: document.documentElement.scrollWidth
            > document.documentElement.clientWidth + 1,
        };
        """
    )


def resize(runner: AgentNativeJourney, width: int, expected: str) -> dict[str, Any]:
    runner.driver.set_window_size(width, 900)
    observed = wait_until(
        lambda: (
            value if (value := topology(runner)) and value["layout"] == expected
            else None
        ),
        f"Native {expected} workbench topology",
    )
    require(not observed["horizontalOverflow"], "Native window horizontally overflows")
    return observed


def wide(runner: AgentNativeJourney) -> dict[str, Any]:
    observed = resize(runner, 1440, "wide")
    require(
        len(observed["agentRails"]) == 1
        and observed["agentRails"][0]["state"] == "expanded"
        and len(observed["topicRails"]) == 1
        and observed["topicRails"][0]["state"] == "expanded"
        and observed["composerVisible"],
        "wide Native window does not expose roster, Topics and Chat",
    )
    return {
        "uiAction": "resize Native window to wide",
        "receiverAssertion": "roster, Topic rail and composer are visible",
        "topology": observed,
    }


def compact(runner: AgentNativeJourney) -> dict[str, Any]:
    observed = resize(runner, 880, "narrow")
    require(
        len(observed["agentRails"]) == 1
        and observed["agentRails"][0]["state"] == "collapsed"
        and len(observed["topicRails"]) == 1
        and observed["topicRails"][0]["state"] == "collapsed"
        and observed["composerVisible"],
        "compact Native window does not retain both collapsed rails",
    )
    runner.click_visible("[data-pt-agent-topics-expand]", "expand compact Topics")
    expanded = wait_until(
        lambda: (
            value if (value := topology(runner))["topicRails"][0]["state"] == "expanded"
            else None
        ),
        "expanded compact Topic rail",
    )
    require(expanded["composerVisible"], "compact rail expansion hides Chat")
    return {
        "uiAction": "resize Native window and expand Topic rail",
        "receiverAssertion": "compact rails retain Chat and Topics remain accessible",
        "topology": observed,
        "expandedTopology": expanded,
    }


def narrow(runner: AgentNativeJourney) -> dict[str, Any]:
    chat = resize(runner, 540, "ultra-narrow")
    require(
        not chat["agentRails"] and not chat["topicRails"] and chat["composerVisible"],
        "ultra-narrow window must initially expose Chat",
    )
    runner.click_visible("[data-pt-agent-mobile-back]", "mobile Topic list")
    topics = wait_until(
        lambda: (
            value if (value := topology(runner))["mobileTopics"]
            and not value["composerVisible"] else None
        ),
        "full-height mobile Topic list",
    )
    runner.click_visible("[data-pt-agent-mobile-switch]", "mobile Agent drawer")
    drawer = wait_until(
        lambda: (
            value if (value := topology(runner))["drawer"] else None
        ),
        "left Agent drawer",
    )
    require(
        drawer["drawer"][0]["width"] <= 320
        and bool(drawer["agentRails"]),
        "mobile Agent navigation is not a bounded left drawer",
    )
    menu_agent_id = runner.driver.execute_script(
        """
        const row = [...document.querySelectorAll('.ant-drawer [data-pt-agent-row]')]
          .find(element => element.getClientRects().length);
        return row?.dataset.ptAgentId ?? null;
        """
    )
    require(menu_agent_id, "mobile roster has no visible Agent row")
    menu_selector = f'.ant-drawer {runner.lifecycle_selector("menu", agent_id=menu_agent_id)}'
    runner.click_visible(menu_selector, "mobile Agent row menu")
    geometry = wait_until(lambda: runner.driver.execute_script(
        """
        const trigger = document.querySelector(arguments[0]);
        const menu = [...document.querySelectorAll('.ant-dropdown')]
          .find(element => element.getClientRects().length);
        if (!trigger || !menu) return null;
        const a = trigger.getBoundingClientRect(), b = menu.getBoundingClientRect();
        return {triggerY: a.y, menuY: b.y, left: b.left, right: b.right,
                viewport: document.documentElement.clientWidth};
        """, menu_selector,
    ), "mobile menu anchored to Agent row")
    require(abs(geometry["triggerY"] - geometry["menuY"]) < 100
            and geometry["left"] >= -1
            and geometry["right"] <= geometry["viewport"] + 1,
            "mobile Agent menu escaped its trigger or viewport")
    runner.press_native_key(NativeKey.ESCAPE)
    runner.click_visible(".ant-drawer-close", "close Agent drawer")
    closed = wait_until(
        lambda: (
            value if not (value := topology(runner))["drawer"] else None
        ),
        "mobile drawer unmount",
    )
    require(closed["mobileTopics"], "closing drawer lost the Topic list")
    wait_until(lambda: runner.driver.execute_script(
        """
        return document.activeElement === document.querySelector(
          '[data-pt-agent-mobile-switch]');
        """
    ), "closed drawer restores focus to Switch Agent")
    require(
        not any(value["horizontalOverflow"] for value in (chat, topics, drawer, closed)),
        "mobile navigation caused horizontal overflow",
    )
    return {
        "uiAction": "resize Native window, open Topics and left drawer, inspect row menu and close",
        "receiverAssertion": "menu stays anchored and closing restores Topics and trigger focus",
        "chat": chat, "topics": topics, "drawer": drawer, "closed": closed,
        "menuGeometry": geometry,
        "operationIds": [
            "layout.mobile-chat", "layout.mobile-topic-list",
            "layout.mobile-left-drawer", "layout.mobile-no-bottom-sheet",
            "layout.mobile-menu-anchor", "layout.zero-horizontal-overflow",
            "layout.drawer.close-focus",
        ],
    }


def reduced_motion(
    runner: AgentNativeJourney, fixture: dict[str, str],
) -> dict[str, Any]:
    """Change the actual isolated Linux preference, never replace matchMedia."""
    from tooling.acceptance.provisioners.native_desktop_linux import NativeDesktopLinuxProvisioner
    from tooling.acceptance.gates.agent.chat_conversation_scenarios import send_stop

    require(runner.runtime_binding is not None
            and runner.runtime_binding.cell_id == "desktop-linux-native",
            "reduced-motion scenario requires the declared isolated Linux cell")
    cell = NativeDesktopLinuxProvisioner()
    state = json.loads(cell.state_path.read_text())
    require(state["sourceCommit"] == runner.runtime_manifest["source"]["commit"],
            "motion preference target has different source identity")
    script = (
        "import os,pathlib,subprocess,sys;"
        "os.environ['DBUS_SESSION_BUS_ADDRESS']=pathlib.Path("
        "'/workspace/run/dbus.state').read_text().splitlines()[0];"
        "os.environ['HOME']='/workspace/run/home';"
        "os.environ['XDG_RUNTIME_DIR']='/workspace/run/runtime';"
        "result=subprocess.run(['gsettings',sys.argv[1],"
        "'org.gnome.desktop.interface','enable-animations',*sys.argv[2:]],"
        "check=True,capture_output=True,text=True);print(result.stdout.strip())"
    )

    def preference(*args: str) -> str:
        return cell.transport.run_argv(
            ("docker", "exec", state["containerName"], "python3", "-c", script, *args),
            timeout=15, check=True,
        ).stdout.strip()

    previous = preference("get")
    try:
        preference("set", "false")
        wait_until(lambda: runner.driver.execute_script(
            "return matchMedia('(prefers-reduced-motion: reduce)').matches;"
        ), "actual OS reduced-motion media preference")
        selected = runner.harness("getCoreLifecycleAgentState")["agent"]["id"]
        result = send_stop(runner, selected, fixture)
        result["osPreference"] = "enable-animations=false"
        result["operationIds"] = ["motion.reduced"]
        return result
    finally:
        preference("set", previous)
