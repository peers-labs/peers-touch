"""Suite-owned real Skills and client MCP catalogue resources."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.gates.agent.native_agent_runner import AgentNativeJourney, require, wait_until


CHAT_MCP_FIXTURE_SCRIPT = r"""
import json
import os
import sys

for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    method = request.get("method")
    if method == "initialize":
        result = {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "chat-suite", "version": "1"},
        }
    elif method == "tools/list":
        result = {"tools": [{
            "name": os.environ["CHAT_SUITE_TOOL_NAME"],
            "description": "Return the supplied Suite receiver result",
            "inputSchema": {"type": "object", "properties": {}},
        }]}
    elif method == "tools/call":
        if request.get("params", {}).get("name") != os.environ["CHAT_SUITE_TOOL_NAME"]:
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"],
                              "error": {"code": -32602, "message": "Unknown tool"}}),
                  flush=True)
            continue
        result = {"content": [{"type": "text",
                              "text": os.environ["CHAT_SUITE_RESULT"]}]}
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": request["id"],
                          "error": {"code": -32601, "message": "Unknown method"}}),
              flush=True)
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}),
          flush=True)
"""


def prepare_extensions(
    runner: AgentNativeJourney,
    agent_id: str,
) -> dict[str, Any]:
    marker = str(runner.runtime_manifest["runId"]).lower()
    skill = runner.invoke_readback_command("skills_create", {
        "agent_id": agent_id,
        "name": f"chat-suite-{marker}",
        "content": "Describe supplied facts precisely and preserve the user's request.",
    })
    runner.chat_skill_fixture_ids.append({
        "agentId": agent_id,
        "skillId": skill["id"],
    })
    require(runner.runtime_binding is not None, "MCP fixture requires the Native cell")
    root = runner.run_root / "extension-fixtures"
    root.mkdir(parents=True, exist_ok=True)
    script = root / "server.py"
    script.write_text(CHAT_MCP_FIXTURE_SCRIPT + "\n", encoding="utf-8")
    staged = runner.runtime_binding.stage_native_file(runner.client["id"], script)
    name = f"chat-suite-mcp-{marker}"
    runner.invoke_readback_command("mcp_create_server", {
        "data": {
            "name": name, "title": "Suite MCP",
            "type": "stdio", "executionOwner": "client",
            "command": "/usr/bin/python3", "args": [str(staged)], "enabled": True,
            "env": {
                "CHAT_SUITE_TOOL_NAME": f"chat_suite_echo_{marker.replace('-', '_')}",
                "CHAT_SUITE_RESULT": "Suite MCP receiver result.",
            },
        },
    })
    runner.chat_mcp_fixture_names.append(name)

    def catalogue() -> dict[str, Any] | None:
        value = runner.invoke_readback_command("mcp_get_server", {"name": name})
        return value if value.get("toolCount", 0) > 0 else None

    observed = wait_until(catalogue, "real MCP discovered tool catalogue")
    runner.harness("reconcileChatSuiteCapabilityProjection")
    return {
        "skillId": skill["id"],
        "skillCapabilityId": f"skill:{skill['id']}",
        "mcpName": name,
        "mcpToolCount": observed["toolCount"],
    }
