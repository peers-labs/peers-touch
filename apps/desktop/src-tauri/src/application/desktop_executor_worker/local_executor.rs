use super::fenced_executor::{CapabilityContract, CapabilityExecutor};
use super::resource_registry::LocalResource;
use crate::application::{mcp, tools};
use crate::contracts::McpExecuteToolInput;
use crate::model::agent::ClientCapabilityRequest;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

pub struct LocalCapabilityExecutor {
    contracts: HashMap<String, CapabilityContract>,
    execution_attempts: AtomicU64,
    side_effects_started: AtomicU64,
}

impl LocalCapabilityExecutor {
    pub fn new(contracts: impl IntoIterator<Item = CapabilityContract>) -> Result<Self, String> {
        let mut indexed = HashMap::new();
        for contract in contracts {
            if contract.capability_id.trim().is_empty()
                || contract.schema_version.trim().is_empty()
                || contract.max_argument_bytes == 0
            {
                return Err("local capability contract is incomplete".to_string());
            }
            if !matches!(
                contract.capability_id.as_str(),
                "filesystem.read"
                    | "filesystem.list"
                    | "clipboard.read"
                    | "clipboard.write"
                    | "shell.execute"
                    | "mcp.invoke"
            ) {
                return Err(format!(
                    "unsupported local capability contract: {}",
                    contract.capability_id
                ));
            }
            if contract.supports_external_idempotency {
                return Err(format!(
                    "{} has no external-idempotency adapter",
                    contract.capability_id
                ));
            }
            if indexed
                .insert(contract.capability_id.clone(), contract)
                .is_some()
            {
                return Err("duplicate local capability contract".to_string());
            }
        }
        Ok(Self {
            contracts: indexed,
            execution_attempts: AtomicU64::new(0),
            side_effects_started: AtomicU64::new(0),
        })
    }

    pub fn execution_attempt_count(&self) -> u64 {
        self.execution_attempts.load(Ordering::SeqCst)
    }

    pub fn side_effect_count(&self) -> u64 {
        self.side_effects_started.load(Ordering::SeqCst)
    }
}

impl CapabilityExecutor for LocalCapabilityExecutor {
    fn contract(&self, capability_id: &str) -> Option<CapabilityContract> {
        self.contracts.get(capability_id).cloned()
    }

    fn execute(
        &self,
        request: &ClientCapabilityRequest,
        resources: &[LocalResource],
        external_idempotency_key: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        self.execution_attempts.fetch_add(1, Ordering::SeqCst);
        if external_idempotency_key.is_some() {
            return Err("CLIENT_CAPABILITY_EXTERNAL_IDEMPOTENCY_UNSUPPORTED".to_string());
        }
        let arguments: Value = serde_json::from_slice(&request.bounded_arguments)
            .map_err(|_| "CLIENT_CAPABILITY_ARGUMENTS_INVALID".to_string())?;
        if requires_local_resource(&request.capability_id) && resources.is_empty() {
            return Err("CLIENT_CAPABILITY_RESOURCE_REQUIRED".to_string());
        }
        let workspace_root = resources.first().map(|resource| resource.locator.as_str());
        let allowed_roots = resources
            .iter()
            .map(|resource| resource.locator.clone())
            .collect::<Vec<_>>();
        let mut result = match request.capability_id.as_str() {
            "filesystem.read" => {
                self.side_effects_started.fetch_add(1, Ordering::SeqCst);
                execute_builtin(
                    "local_file_read",
                    arguments,
                    workspace_root,
                    &allowed_roots,
                    &request.tool_call_id,
                )?
            }
            "filesystem.list" => {
                self.side_effects_started.fetch_add(1, Ordering::SeqCst);
                execute_builtin(
                    "local_workspace_list",
                    arguments,
                    workspace_root,
                    &allowed_roots,
                    &request.tool_call_id,
                )?
            }
            "clipboard.read" => {
                self.side_effects_started.fetch_add(1, Ordering::SeqCst);
                execute_builtin(
                    "local_clipboard_read",
                    arguments,
                    None,
                    &[],
                    &request.tool_call_id,
                )?
            }
            "clipboard.write" => {
                self.side_effects_started.fetch_add(1, Ordering::SeqCst);
                execute_builtin(
                    "local_clipboard_write",
                    arguments,
                    None,
                    &[],
                    &request.tool_call_id,
                )?
            }
            "shell.execute" => {
                self.side_effects_started.fetch_add(1, Ordering::SeqCst);
                execute_builtin(
                    "local_shell_safe",
                    arguments,
                    workspace_root,
                    &allowed_roots,
                    &request.tool_call_id,
                )?
            }
            "mcp.invoke" => {
                self.side_effects_started.fetch_add(1, Ordering::SeqCst);
                execute_mcp(
                    arguments,
                    workspace_root,
                    &allowed_roots,
                    &request.tool_call_id,
                )?
            }
            _ => return Err("CLIENT_CAPABILITY_NOT_REGISTERED".to_string()),
        };
        redact_local_locators(&mut result, resources);
        serde_json::to_vec(&result)
            .map_err(|_| "CLIENT_CAPABILITY_RESULT_ENCODING_FAILED".to_string())
    }
}

fn execute_builtin(
    tool_name: &str,
    arguments: Value,
    workspace_root: Option<&str>,
    allowed_roots: &[String],
    tool_call_id: &str,
) -> Result<Value, String> {
    tools::execute_builtin_local_tool(
        tool_name,
        arguments,
        workspace_root,
        Some(allowed_roots),
        Some(tool_call_id),
    )
    .map_err(|_| "CLIENT_CAPABILITY_EXECUTION_FAILED".to_string())
}

fn execute_mcp(
    arguments: Value,
    workspace_root: Option<&str>,
    allowed_roots: &[String],
    tool_call_id: &str,
) -> Result<Value, String> {
    let server_name = arguments
        .get("server_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "CLIENT_CAPABILITY_MCP_SERVER_REQUIRED".to_string())?;
    let tool_name = arguments
        .get("tool_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "CLIENT_CAPABILITY_MCP_TOOL_REQUIRED".to_string())?;
    let execution = mcp::mcp_execute_tool(McpExecuteToolInput {
        server_name: server_name.to_string(),
        tool_name: tool_name.to_string(),
        arguments: arguments.get("arguments").cloned(),
        call_id: Some(tool_call_id.to_string()),
        workspace_root: workspace_root.map(str::to_string),
        allowed_roots: Some(allowed_roots.to_vec()),
    });
    if !execution.ok {
        return Err("CLIENT_CAPABILITY_EXECUTION_FAILED".to_string());
    }
    let payload = execution
        .data
        .ok_or_else(|| "CLIENT_CAPABILITY_EXECUTION_FAILED".to_string())?;
    serde_json::from_str(&payload.status)
        .map_err(|_| "CLIENT_CAPABILITY_RESULT_ENCODING_FAILED".to_string())
}

fn redact_local_locators(value: &mut Value, resources: &[LocalResource]) {
    match value {
        Value::String(text) => {
            *text = redact_text(text, resources);
        }
        Value::Array(items) => {
            for item in items {
                redact_local_locators(item, resources);
            }
        }
        Value::Object(fields) => {
            let existing = std::mem::take(fields);
            for (key, mut item) in existing {
                redact_local_locators(&mut item, resources);
                fields.insert(redact_text(&key, resources), item);
            }
        }
        _ => {}
    }
}

fn requires_local_resource(capability_id: &str) -> bool {
    matches!(
        capability_id,
        "filesystem.read" | "filesystem.list" | "shell.execute" | "mcp.invoke"
    )
}

fn redact_text(text: &str, resources: &[LocalResource]) -> String {
    resources
        .iter()
        .fold(text.to_string(), |redacted, resource| {
            if resource.locator.is_empty() {
                redacted
            } else {
                redacted.replace(&resource.locator, &resource.opaque_ref)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn resource() -> LocalResource {
        LocalResource {
            opaque_ref: "resource-1".to_string(),
            locator: "/private/device/alice/workspace".to_string(),
            permission_grant_id: "grant-1".to_string(),
            integrity_hash: "sha256:file".to_string(),
        }
    }

    #[test]
    fn resource_capabilities_fail_closed_without_an_opaque_resource() {
        assert!(requires_local_resource("filesystem.read"));
        assert!(requires_local_resource("filesystem.list"));
        assert!(requires_local_resource("shell.execute"));
        assert!(requires_local_resource("mcp.invoke"));
        assert!(!requires_local_resource("clipboard.read"));

        let executor = LocalCapabilityExecutor::new([CapabilityContract {
            capability_id: "filesystem.read".to_string(),
            schema_version: "1".to_string(),
            max_argument_bytes: 1024,
            max_result_bytes: 1024,
            supports_external_idempotency: false,
        }])
        .unwrap();
        let request = ClientCapabilityRequest {
            capability_id: "filesystem.read".to_string(),
            bounded_arguments: br#"{"path":"note.txt"}"#.to_vec(),
            ..Default::default()
        };
        assert_eq!(executor.execution_attempt_count(), 0);
        assert_eq!(executor.side_effect_count(), 0);
        assert_eq!(
            executor.execute(&request, &[], None).unwrap_err(),
            "CLIENT_CAPABILITY_RESOURCE_REQUIRED"
        );
        assert_eq!(executor.execution_attempt_count(), 1);
        assert_eq!(executor.side_effect_count(), 0);
    }

    #[test]
    fn locator_redaction_covers_nested_values_and_object_keys() {
        let mut value = json!({
            "/private/device/alice/workspace/key": {
                "message": "failed opening /private/device/alice/workspace/file.txt"
            }
        });
        redact_local_locators(&mut value, &[resource()]);
        let encoded = serde_json::to_string(&value).unwrap();
        assert!(!encoded.contains("/private/device/alice/workspace"));
        assert!(encoded.contains("resource-1/file.txt"));
        assert!(encoded.contains("resource-1/key"));
    }
}
