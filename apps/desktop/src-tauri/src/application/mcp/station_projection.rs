use super::*;
use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};

pub fn mcp_station_list_servers(actor_ptid: &str, token: &str) -> AppResult<StubPayload> {
    match crate::infrastructure::station_client::request_proto::<_, ListMcpServersResponse>(
        Method::POST,
        MCP_SERVER_LIST_PATH,
        token,
        None,
        Some(&ListMcpServersRequest {
            include_disabled: true,
        }),
    ) {
        Ok(response) => success_payload(
            "mcp_list_servers",
            json!({
                "servers": response
                    .servers
                    .iter()
                    .map(|server| mcp_server_projection(actor_ptid, server, false))
                    .collect::<Vec<_>>()
            }),
        ),
        Err(error) => error.into_app_result("agent.mcpServerListFailed"),
    }
}

pub fn mcp_station_get_server(
    actor_ptid: &str,
    token: &str,
    input: McpNameInput,
) -> AppResult<StubPayload> {
    match get_station_mcp_server(token, "", input.name.trim()) {
        Ok(server) => success_payload(
            "mcp_get_server",
            mcp_server_projection(actor_ptid, &server, true),
        ),
        Err(error) => error.into_app_result("agent.mcpServerGetFailed"),
    }
}

pub fn mcp_station_create_server(
    actor_ptid: &str,
    token: &str,
    input: McpCreateInput,
) -> AppResult<StubPayload> {
    mcp_station_upsert_server(actor_ptid, token, None, input.data)
}

pub fn mcp_station_update_server(
    actor_ptid: &str,
    token: &str,
    input: McpUpdateInput,
) -> AppResult<StubPayload> {
    mcp_station_upsert_server(actor_ptid, token, Some(input.name), input.data)
}

pub fn mcp_station_toggle_server(
    actor_ptid: &str,
    token: &str,
    input: McpToggleInput,
) -> AppResult<StubPayload> {
    let current = match get_station_mcp_server(token, "", input.name.trim()) {
        Ok(server) => server,
        Err(error) => return error.into_app_result("agent.mcpServerGetFailed"),
    };
    let mut data = mcp_server_projection(actor_ptid, &current, true);
    data["enabled"] = json!(input.enabled);
    mcp_station_upsert_server(actor_ptid, token, Some(input.name), data)
}

pub fn mcp_station_delete_server(
    actor_ptid: &str,
    token: &str,
    input: McpNameInput,
) -> AppResult<StubPayload> {
    let current = match get_station_mcp_server(token, "", input.name.trim()) {
        Ok(server) => server,
        Err(error) => return error.into_app_result("agent.mcpServerGetFailed"),
    };
    let request = DeleteMcpServerRequest {
        server_id: current.server_id.clone(),
        expected_revision: current.revision,
        idempotency_key: format!("mcp-delete-{}", ulid::Ulid::new()),
    };
    match crate::infrastructure::station_client::request_proto::<_, DeleteMcpServerResponse>(
        Method::POST,
        MCP_SERVER_DELETE_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => {
            remove_client_executor_projection(actor_ptid, &current.name);
            success_payload(
                "mcp_delete_server",
                json!({
                    "ok": true,
                    "server": response
                        .server
                        .as_ref()
                        .map(|server| mcp_server_projection(actor_ptid, server, false))
                }),
            )
        }
        Err(error) => error.into_app_result("agent.mcpServerDeleteFailed"),
    }
}

pub fn mcp_station_refresh_server(
    actor_ptid: &str,
    token: &str,
    input: McpNameInput,
) -> AppResult<StubPayload> {
    let current = match get_station_mcp_server(token, "", input.name.trim()) {
        Ok(server) => server,
        Err(error) => return error.into_app_result("agent.mcpServerGetFailed"),
    };
    if current.execution_owner == ToolExecutionOwner::Station as i32 {
        let request = RefreshMcpServerRequest {
            server_id: current.server_id.clone(),
            expected_revision: current.revision,
            idempotency_key: format!("mcp-refresh-{}", ulid::Ulid::new()),
        };
        return match crate::infrastructure::station_client::request_proto::<
            _,
            RefreshMcpServerResponse,
        >(
            Method::POST,
            MCP_SERVER_REFRESH_PATH,
            token,
            None,
            Some(&request),
        ) {
            Ok(response) => match response.server {
                Some(server) => success_payload(
                    "mcp_refresh_server",
                    mcp_server_projection(actor_ptid, &server, false),
                ),
                None => AppResult::fail(
                    ErrorCode::InternalError,
                    "Station MCP refresh response is missing server",
                    None,
                ),
            },
            Err(error) => error.into_app_result("agent.mcpServerRefreshFailed"),
        };
    }

    let local = match local_executor_projection(actor_ptid, &current.name) {
        Ok(Some(record)) => record.data,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "Desktop MCP executor projection is unavailable",
                None,
            )
        }
        Err(error) => return persist_error(error),
    };
    mcp_station_upsert_server(actor_ptid, token, Some(current.name), local)
}

fn mcp_station_upsert_server(
    actor_ptid: &str,
    token: &str,
    existing_name: Option<String>,
    update: Value,
) -> AppResult<StubPayload> {
    let current = match existing_name.as_deref() {
        Some(name) => match get_station_mcp_server(token, "", name.trim()) {
            Ok(server) => Some(server),
            Err(error) => return error.into_app_result("agent.mcpServerGetFailed"),
        },
        None => None,
    };
    let mut data = if let Some(server) = current.as_ref() {
        if server.execution_owner == ToolExecutionOwner::ClientCapability as i32 {
            match local_executor_projection(actor_ptid, &server.name) {
                Ok(Some(record)) => record.data,
                Ok(None) => mcp_server_projection(actor_ptid, server, false),
                Err(error) => return persist_error(error),
            }
        } else {
            mcp_server_projection(actor_ptid, server, false)
        }
    } else {
        update.clone()
    };
    if current.is_some() {
        let Some(target) = data.as_object_mut() else {
            return invalid_argument("MCP server data must be an object");
        };
        let Some(fields) = update.as_object() else {
            return invalid_argument("MCP server data must be an object");
        };
        for (key, value) in fields {
            target.insert(key.clone(), value.clone());
        }
    }
    if let Err(error) = normalize_mcp_value(&mut data) {
        return invalid_argument(&error);
    }
    let owner = match value_string(&data, "executionOwner")
        .to_ascii_lowercase()
        .as_str()
    {
        "station" => ToolExecutionOwner::Station,
        "client" | "client_capability" | "client-capability" | "" => {
            ToolExecutionOwner::ClientCapability
        }
        _ => return invalid_argument("MCP execution owner must be station or client"),
    };
    let transport = match value_string(&data, "type").as_str() {
        "stdio" => McpTransport::Stdio,
        "http" => McpTransport::Http,
        "sse" => McpTransport::Sse,
        _ => return invalid_argument("MCP transport must be stdio, http, or sse"),
    };
    if let Err(error) = validate_server_configuration(&data) {
        return invalid_argument(&error);
    }
    let server_id = current
        .as_ref()
        .map(|server| server.server_id.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("mcp-server-{}", ulid::Ulid::new()));
    let enabled = data.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    let discovered = if owner == ToolExecutionOwner::ClientCapability && enabled {
        match probe_server(&data) {
            Ok(tools) => tools,
            Err(error) => return invalid_argument(&redact_mcp_error(&error, &data)),
        }
    } else {
        Vec::new()
    };
    let mut station_headers: HashMap<String, String> =
        value_string_map(&data, "headers").into_iter().collect();
    if value_string(&data, "authType").eq_ignore_ascii_case("bearer") {
        let access_token = value_string(&data, "authAccessToken");
        let fallback_token = value_string(&data, "authToken");
        let token = if access_token.is_empty() {
            fallback_token
        } else {
            access_token
        };
        if !token.is_empty() {
            station_headers.insert("Authorization".to_string(), format!("Bearer {token}"));
        }
    }
    let request = UpsertMcpServerRequest {
        server: Some(McpServer {
            server_id: server_id.clone(),
            name: value_string(&data, "name"),
            title: value_string(&data, "title"),
            description: value_string(&data, "description"),
            transport: transport as i32,
            execution_owner: owner as i32,
            command: value_string(&data, "command"),
            args: value_string_array(&data, "args"),
            env_keys: value_string_map(&data, "env")
                .into_iter()
                .map(|(key, _)| key)
                .collect(),
            url: value_string(&data, "url"),
            header_keys: value_string_map(&data, "headers")
                .into_iter()
                .map(|(key, _)| key)
                .collect(),
            enabled,
            tools: discovered,
            ..Default::default()
        }),
        expected_revision: current
            .as_ref()
            .map(|server| server.revision)
            .unwrap_or_default(),
        idempotency_key: format!("mcp-upsert-{}", ulid::Ulid::new()),
        station_secrets: (owner == ToolExecutionOwner::Station).then(|| McpServerSecrets {
            env: value_string_map(&data, "env").into_iter().collect(),
            headers: station_headers,
        }),
    };

    let snapshot = if owner == ToolExecutionOwner::ClientCapability {
        match snapshot_server(actor_ptid, &value_string(&data, "name")) {
            Ok(snapshot) => Some(snapshot),
            Err(error) => return persist_error(error),
        }
    } else {
        None
    };
    if owner == ToolExecutionOwner::ClientCapability {
        data["serverId"] = json!(server_id);
        data["executionOwner"] = json!("client");
        if let Err(error) = upsert_client_executor_projection(actor_ptid, data.clone()) {
            return persist_error(error);
        }
    }
    let response = crate::infrastructure::station_client::request_proto::<_, UpsertMcpServerResponse>(
        Method::POST,
        MCP_SERVER_UPSERT_PATH,
        token,
        None,
        Some(&request),
    );
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            if let Some(snapshot) = snapshot {
                let _ = restore_server_snapshot_unconditionally(
                    actor_ptid,
                    &value_string(&data, "name"),
                    snapshot,
                );
            }
            return error.into_app_result("agent.mcpServerUpsertFailed");
        }
    };
    let Some(server) = response.server else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Station MCP upsert response is missing server",
            None,
        );
    };
    if owner == ToolExecutionOwner::ClientCapability {
        data["configRevision"] = json!(server.revision);
        data["tools"] = json!(server
            .tools
            .iter()
            .map(mcp_tool_projection)
            .collect::<Vec<_>>());
        data["status"] = json!(mcp_status_name(server.status));
        data["runtimeEpoch"] = json!(mcp_runtime_epoch());
        if let Err(error) = upsert_client_executor_projection(actor_ptid, data) {
            return persist_error(error);
        }
    } else {
        remove_client_executor_projection(actor_ptid, &server.name);
    }
    success_payload(
        "mcp_upsert_server",
        mcp_server_projection(actor_ptid, &server, false),
    )
}

fn get_station_mcp_server(
    token: &str,
    server_id: &str,
    name: &str,
) -> Result<McpServer, StationClientError> {
    crate::infrastructure::station_client::request_proto::<_, GetMcpServerResponse>(
        Method::POST,
        MCP_SERVER_GET_PATH,
        token,
        None,
        Some(&GetMcpServerRequest {
            server_id: server_id.to_string(),
            name: name.to_string(),
        }),
    )
    .and_then(|response| {
        response.server.ok_or_else(|| {
            StationClientError::new(
                StationClientErrorKind::InvalidResponse,
                "Station MCP response is missing server",
                None,
            )
        })
    })
}

fn mcp_server_projection(actor_ptid: &str, server: &McpServer, include_secrets: bool) -> Value {
    let mut env = server
        .env_keys
        .iter()
        .map(|key| (key.clone(), String::new()))
        .collect::<HashMap<_, _>>();
    let mut headers = server
        .header_keys
        .iter()
        .map(|key| (key.clone(), String::new()))
        .collect::<HashMap<_, _>>();
    if include_secrets && server.execution_owner == ToolExecutionOwner::ClientCapability as i32 {
        if let Ok(Some(local)) = local_executor_projection(actor_ptid, &server.name) {
            env = value_string_map(&local.data, "env").into_iter().collect();
            headers = value_string_map(&local.data, "headers")
                .into_iter()
                .collect();
        }
    }
    json!({
        "serverId": server.server_id,
        "name": server.name,
        "title": server.title,
        "description": server.description,
        "version": server.revision.to_string(),
        "type": mcp_transport_name(server.transport),
        "executionOwner": mcp_owner_name(server.execution_owner),
        "command": server.command,
        "args": server.args,
        "env": env,
        "envKeys": server.env_keys,
        "url": server.url,
        "headers": headers,
        "headerKeys": server.header_keys,
        "enabled": server.enabled,
        "revision": server.revision,
        "status": mcp_status_name(server.status),
        "lastError": server.last_error,
        "lastTestedAt": server.last_tested_at.as_ref().map(timestamp_string).unwrap_or_default(),
        "tools": server.tools.iter().map(mcp_tool_projection).collect::<Vec<_>>(),
        "toolCount": server.tools.len(),
        "source": "user",
        "metaAvatar": "",
        "metaTags": [],
        "createdAt": server.created_at.as_ref().map(timestamp_string).unwrap_or_default(),
        "updatedAt": server.updated_at.as_ref().map(timestamp_string).unwrap_or_default()
    })
}

fn mcp_tool_projection(tool: &McpToolDescriptor) -> Value {
    json!({
        "name": tool.tool_name,
        "providerToolName": tool.provider_tool_name,
        "description": tool.description,
        "inputSchema": serde_json::from_str::<Value>(&tool.input_schema_json)
            .unwrap_or_else(|_| json!({"type": "object", "properties": {}})),
        "capabilityId": tool.capability_id,
        "capabilityVersion": tool.capability_version
    })
}

fn timestamp_string(value: &prost_types::Timestamp) -> String {
    time::OffsetDateTime::from_unix_timestamp(value.seconds)
        .ok()
        .and_then(|time| {
            time.format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_default()
}

fn mcp_transport_name(value: i32) -> &'static str {
    match McpTransport::try_from(value).unwrap_or(McpTransport::Unspecified) {
        McpTransport::Stdio => "stdio",
        McpTransport::Http => "http",
        McpTransport::Sse => "sse",
        McpTransport::Unspecified => "unknown",
    }
}

fn mcp_owner_name(value: i32) -> &'static str {
    match ToolExecutionOwner::try_from(value).unwrap_or(ToolExecutionOwner::Unspecified) {
        ToolExecutionOwner::Station => "station",
        ToolExecutionOwner::ClientCapability => "client",
        ToolExecutionOwner::Unspecified => "unknown",
    }
}

fn mcp_status_name(value: i32) -> &'static str {
    match McpServerStatus::try_from(value).unwrap_or(McpServerStatus::Unspecified) {
        McpServerStatus::Disconnected => "disconnected",
        McpServerStatus::Ready => "connected",
        McpServerStatus::Failed => "failed",
        McpServerStatus::Unspecified => "unknown",
    }
}

fn local_executor_projection(
    actor_ptid: &str,
    server_name: &str,
) -> Result<Option<McpServerRecord>, String> {
    let _lock = mcp_store_lock()
        .lock()
        .map_err(|error| format!("lock MCP executor projection: {error}"))?;
    let store = McpStore::load(actor_ptid)?;
    Ok(store
        .servers
        .into_iter()
        .find(|server| server.name == server_name.trim()))
}

pub(super) fn upsert_client_executor_projection(
    actor_ptid: &str,
    data: Value,
) -> Result<(), String> {
    let record = record_from_value(data)?;
    let _lock = mcp_store_lock()
        .lock()
        .map_err(|error| format!("lock MCP executor projection: {error}"))?;
    let mut store = McpStore::load(actor_ptid)?;
    if let Some(current) = store
        .servers
        .iter_mut()
        .find(|server| server.name == record.name)
    {
        *current = record;
    } else {
        store.servers.push(record);
    }
    persist_store(&store)
}

fn remove_client_executor_projection(actor_ptid: &str, server_name: &str) {
    let Ok(_lock) = mcp_store_lock().lock() else {
        return;
    };
    let Ok(mut store) = McpStore::load(actor_ptid) else {
        return;
    };
    store.servers.retain(|server| server.name != server_name);
    let _ = persist_store(&store);
}

fn restore_server_snapshot_unconditionally(
    actor_ptid: &str,
    server_name: &str,
    snapshot: McpServerSnapshot,
) -> Result<(), String> {
    let _lock = mcp_store_lock()
        .lock()
        .map_err(|error| format!("lock MCP executor projection: {error}"))?;
    let mut store = McpStore::load(actor_ptid)?;
    store.servers.retain(|server| server.name != server_name);
    if let Some(record) = snapshot.record {
        store.servers.insert(
            snapshot
                .index
                .unwrap_or(store.servers.len())
                .min(store.servers.len()),
            record,
        );
    }
    persist_store(&store)
}
