use crate::error::AppResult;
use crate::interface::contracts::{McpCreateInput, McpNameInput, McpToggleInput, McpUpdateInput, StubPayload};

#[path = "../../application/mcp/mod.rs"]
mod application_mcp;

#[tauri::command]
pub fn mcp_list_servers() -> AppResult<StubPayload> {
    application_mcp::mcp_list_servers()
}

#[tauri::command]
pub fn mcp_get_server(input: McpNameInput) -> AppResult<StubPayload> {
    application_mcp::mcp_get_server(input)
}

#[tauri::command]
pub fn mcp_create_server(input: McpCreateInput) -> AppResult<StubPayload> {
    application_mcp::mcp_create_server(input)
}

#[tauri::command]
pub fn mcp_update_server(input: McpUpdateInput) -> AppResult<StubPayload> {
    application_mcp::mcp_update_server(input)
}

#[tauri::command]
pub fn mcp_delete_server(input: McpNameInput) -> AppResult<StubPayload> {
    application_mcp::mcp_delete_server(input)
}

#[tauri::command]
pub fn mcp_toggle_server(input: McpToggleInput) -> AppResult<StubPayload> {
    application_mcp::mcp_toggle_server(input)
}

#[tauri::command]
pub fn mcp_test_server(input: McpNameInput) -> AppResult<StubPayload> {
    application_mcp::mcp_test_server(input)
}
