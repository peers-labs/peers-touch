#!/usr/bin/env python3

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[4]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(content: str, needle: str, message: str) -> None:
    if needle not in content:
        raise AssertionError(message)


def forbid(content: str, needle: str, message: str) -> None:
    if needle in content:
        raise AssertionError(message)


def main() -> int:
    proto = read("model/domain/agent/capability.proto")
    generated_go = read(
        "apps/station/app/subserver/agent/model/capability.pb.go"
    )
    generated_desktop_ts = read(
        "apps/desktop/src/gen/proto/domain/agent/capability_pb.ts"
    )
    station = read(
        "apps/station/app/subserver/agent/service/mcp_server_service.go"
    )
    runtime = read("apps/station/app/subserver/agent/service/mcp_runtime.go")
    registry = read(
        "apps/station/app/subserver/agent/service/tool_registry_service.go"
    )
    turn = read("apps/station/app/subserver/agent/service/turn_service.go")
    desktop_executor = read(
        "apps/desktop/src-tauri/src/application/desktop_executor_worker/"
        "local_executor.rs"
    )
    desktop_supervisor = read(
        "apps/desktop/src-tauri/src/application/desktop_executor_worker/"
        "supervisor.rs"
    )
    desktop_mcp = read(
        "apps/desktop/src-tauri/src/application/mcp/mod.rs"
    )
    desktop_tools = read(
        "apps/desktop/src-tauri/src/application/tools/mod.rs"
    )
    ui = read("apps/desktop/src/components/MCPTab.tsx")
    retired_operation_executor = (
        ROOT
        / "apps/desktop/src-tauri/src/application/desktop_executor_worker/"
        "mcp_operation_executor.rs"
    )

    require(proto, "enum McpTransport", "MCP transport contract is missing")
    require(
        generated_go,
        "type McpTransport int32",
        "generated Go MCP transport contract is stale",
    )
    require(
        generated_go,
        "type McpServer struct",
        "generated Go MCP server contract is stale",
    )
    require(
        generated_desktop_ts,
        "export enum McpTransport",
        "generated Desktop MCP transport contract is stale",
    )
    require(
        generated_desktop_ts,
        "export const McpServerSchema",
        "generated Desktop MCP server contract is stale",
    )
    require(
        proto,
        "ToolExecutionOwner execution_owner",
        "MCP execution owner is not explicit",
    )
    require(
        station,
        "TOOL_EXECUTION_OWNER_STATION",
        "Station-owned MCP execution is missing",
    )
    require(
        station,
        "TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY",
        "client-owned MCP projection is missing",
    )
    require(
        runtime,
        "exec.CommandContext",
        "Station-local stdio MCP execution is missing",
    )
    forbid(
        runtime,
        "Content-Length:",
        "Station stdio MCP must use newline-delimited JSON-RPC",
    )
    require(
        station,
        "registerMcpManifestsTx",
        "per-tool MCP manifest publication is missing",
    )
    require(
        turn,
        "ActorID:        claim.ActorID",
        "Station MCP execution is not actor-scoped",
    )
    require(
        desktop_executor,
        'strip_prefix("mcp.tool.")',
        "Desktop executor does not accept per-tool MCP capabilities",
    )
    require(
        desktop_mcp,
        "mcp_client_capability_contracts",
        "Desktop MCP executor projection is missing",
    )
    forbid(
        desktop_mcp,
        "MCP frame missing Content-Length",
        "Desktop stdio MCP must use newline-delimited JSON-RPC",
    )
    require(
        ui,
        "executionOwner",
        "MCP execution owner is not configurable in Desktop",
    )
    forbid(
        registry,
        "local_mcp",
        "generic local_mcp registry entry must not return",
    )
    forbid(
        turn,
        '"mcp.invoke"',
        "generic mcp.invoke dispatch must not return",
    )
    forbid(
        desktop_tools,
        "mcp_tool_registry_entries",
        "Desktop must not inject a private MCP tool catalog into Turn",
    )
    forbid(
        desktop_supervisor,
        "CapabilityOperationWorker::new(",
        "Desktop must not run the retired MCP lifecycle operation worker",
    )
    if retired_operation_executor.exists():
        raise AssertionError("retired Desktop MCP lifecycle executor must be deleted")

    print(
        "PASS MCP dual runtime source: Station owns config/manifests; "
        "Station and Desktop execute owner-local MCP tools."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1)
