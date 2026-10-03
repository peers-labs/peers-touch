use super::fenced_executor::{CapabilityContract, CapabilityExecutor};
use super::resource_registry::LocalResource;
use crate::application::{mcp, oauth2, tools};
use crate::model::agent::ClientCapabilityRequest;
use serde_json::Value;
#[cfg(feature = "acceptance-webdriver")]
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(feature = "acceptance-webdriver")]
use std::sync::{Mutex, OnceLock};

const EXTERNAL_IDEMPOTENCY_UNSUPPORTED: &str = "CLIENT_CAPABILITY_EXTERNAL_IDEMPOTENCY_UNSUPPORTED";
#[cfg(feature = "acceptance-webdriver")]
const EXTERNAL_IDEMPOTENCY_CONFLICT: &str = "CLIENT_CAPABILITY_EXTERNAL_IDEMPOTENCY_CONFLICT";

#[cfg(feature = "acceptance-webdriver")]
#[derive(Clone)]
struct AcceptanceExternalIdempotencyRecord {
    request_fingerprint: String,
    result: Value,
}

#[cfg(feature = "acceptance-webdriver")]
static ACCEPTANCE_EXTERNAL_IDEMPOTENCY_RESULTS: OnceLock<
    Mutex<HashMap<String, AcceptanceExternalIdempotencyRecord>>,
> = OnceLock::new();

pub struct LocalCapabilityExecutor {
    actor_ptid: String,
    contracts: HashMap<String, CapabilityContract>,
    execution_attempts: AtomicU64,
}

impl LocalCapabilityExecutor {
    pub fn new(
        actor_ptid: &str,
        contracts: impl IntoIterator<Item = CapabilityContract>,
    ) -> Result<Self, String> {
        if !actor_ptid.starts_with("ptid:") {
            return Err("local capability executor requires an actor PTID".to_string());
        }
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
            ) && !is_mcp_capability_id(&contract.capability_id)
                && !is_connector_capability_id(&contract.capability_id)
            {
                return Err(format!(
                    "unsupported local capability contract: {}",
                    contract.capability_id
                ));
            }
            if contract.supports_external_idempotency
                && !has_external_idempotency_adapter(&contract.capability_id)
            {
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
            actor_ptid: actor_ptid.to_string(),
            contracts: indexed,
            execution_attempts: AtomicU64::new(0),
        })
    }

    pub fn execution_attempt_count(&self) -> u64 {
        self.execution_attempts.load(Ordering::SeqCst)
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
        record_side_effect_start: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<Vec<u8>, String> {
        self.execution_attempts.fetch_add(1, Ordering::SeqCst);
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
        let execute_once = || {
            Ok(match request.capability_id.as_str() {
                "filesystem.read" => {
                    record_side_effect_start()?;
                    execute_builtin(
                        "local_file_read",
                        arguments,
                        workspace_root,
                        &allowed_roots,
                        &request.tool_call_id,
                    )?
                }
                "filesystem.list" => {
                    record_side_effect_start()?;
                    execute_builtin(
                        "local_workspace_list",
                        arguments,
                        workspace_root,
                        &allowed_roots,
                        &request.tool_call_id,
                    )?
                }
                "clipboard.read" => {
                    record_side_effect_start()?;
                    execute_builtin(
                        "local_clipboard_read",
                        arguments,
                        None,
                        &[],
                        &request.tool_call_id,
                    )?
                }
                "clipboard.write" => {
                    record_side_effect_start()?;
                    execute_builtin(
                        "local_clipboard_write",
                        arguments,
                        None,
                        &[],
                        &request.tool_call_id,
                    )?
                }
                "shell.execute" => {
                    record_side_effect_start()?;
                    execute_builtin(
                        "local_shell_safe",
                        arguments,
                        workspace_root,
                        &allowed_roots,
                        &request.tool_call_id,
                    )?
                }
                capability_id if is_mcp_capability_id(capability_id) => {
                    record_side_effect_start()?;
                    execute_mcp_capability(
                        &self.actor_ptid,
                        capability_id,
                        arguments,
                        workspace_root,
                        &allowed_roots,
                        &request.tool_call_id,
                    )?
                }
                capability_id if is_connector_capability_id(capability_id) => {
                    record_side_effect_start()?;
                    oauth2::execute_oauth_connector_tool(
                        &self.actor_ptid,
                        capability_id,
                        &request.schema_version,
                        &arguments,
                        Some(&request.tool_call_id),
                    )?
                }
                _ => return Err("CLIENT_CAPABILITY_NOT_REGISTERED".to_string()),
            })
        };
        let mut result = match external_idempotency_key {
            Some(key) => {
                execute_with_external_idempotency(&self.actor_ptid, request, key, execute_once)?
            }
            None => execute_once()?,
        };
        redact_local_locators(&mut result, resources);
        serde_json::to_vec(&result)
            .map_err(|_| "CLIENT_CAPABILITY_RESULT_ENCODING_FAILED".to_string())
    }
}

fn has_external_idempotency_adapter(capability_id: &str) -> bool {
    cfg!(feature = "acceptance-webdriver") && capability_id == "clipboard.read"
}

fn execute_with_external_idempotency<F>(
    actor_ptid: &str,
    request: &ClientCapabilityRequest,
    external_idempotency_key: &str,
    execute_once: F,
) -> Result<Value, String>
where
    F: FnOnce() -> Result<Value, String>,
{
    #[cfg(not(feature = "acceptance-webdriver"))]
    {
        let _ = (actor_ptid, request, external_idempotency_key, execute_once);
        Err(EXTERNAL_IDEMPOTENCY_UNSUPPORTED.to_string())
    }
    #[cfg(feature = "acceptance-webdriver")]
    {
        if !has_external_idempotency_adapter(&request.capability_id)
            || external_idempotency_key.trim().is_empty()
        {
            return Err(EXTERNAL_IDEMPOTENCY_UNSUPPORTED.to_string());
        }
        let scope = acceptance_idempotency_hash(&[
            actor_ptid.as_bytes(),
            request.capability_id.as_bytes(),
            external_idempotency_key.as_bytes(),
        ]);
        let request_fingerprint = acceptance_idempotency_hash(&[
            request.capability_id.as_bytes(),
            request.schema_version.as_bytes(),
            &request.bounded_arguments,
        ]);
        let mut records = ACCEPTANCE_EXTERNAL_IDEMPOTENCY_RESULTS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "acceptance external-idempotency adapter lock poisoned".to_string())?;
        if let Some(existing) = records.get(&scope) {
            if existing.request_fingerprint != request_fingerprint {
                return Err(EXTERNAL_IDEMPOTENCY_CONFLICT.to_string());
            }
            return Ok(existing.result.clone());
        }
        let result = execute_once()?;
        records.insert(
            scope,
            AcceptanceExternalIdempotencyRecord {
                request_fingerprint,
                result: result.clone(),
            },
        );
        Ok(result)
    }
}

#[cfg(feature = "acceptance-webdriver")]
fn acceptance_idempotency_hash(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    hex::encode(hasher.finalize())
}

fn is_connector_capability_id(capability_id: &str) -> bool {
    let Some(hash) = capability_id.strip_prefix("connector.resource.") else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_mcp_capability_id(capability_id: &str) -> bool {
    let Some(hash) = capability_id.strip_prefix("mcp.tool.") else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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

fn execute_mcp_capability(
    actor_ptid: &str,
    capability_id: &str,
    arguments: Value,
    workspace_root: Option<&str>,
    allowed_roots: &[String],
    tool_call_id: &str,
) -> Result<Value, String> {
    let execution = mcp::mcp_execute_capability(
        actor_ptid,
        capability_id,
        arguments,
        Some(tool_call_id.to_string()),
        workspace_root.map(str::to_string),
        Some(allowed_roots.to_vec()),
    );
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
        "filesystem.read" | "filesystem.list" | "shell.execute"
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
        assert!(!requires_local_resource(&format!(
            "mcp.tool.{}",
            "a".repeat(64)
        )));
        assert!(!requires_local_resource("clipboard.read"));

        let executor = LocalCapabilityExecutor::new(
            "ptid:person:test",
            [CapabilityContract {
                capability_id: "filesystem.read".to_string(),
                schema_version: "1".to_string(),
                max_argument_bytes: 1024,
                max_result_bytes: 1024,
                supports_external_idempotency: false,
            }],
        )
        .unwrap();
        let request = ClientCapabilityRequest {
            capability_id: "filesystem.read".to_string(),
            bounded_arguments: br#"{"path":"note.txt"}"#.to_vec(),
            ..Default::default()
        };
        assert_eq!(executor.execution_attempt_count(), 0);
        let mut side_effect_starts = 0;
        assert_eq!(
            executor
                .execute(&request, &[], None, &mut || {
                    side_effect_starts += 1;
                    Ok(())
                })
                .unwrap_err(),
            "CLIENT_CAPABILITY_RESOURCE_REQUIRED"
        );
        assert_eq!(executor.execution_attempt_count(), 1);
        assert_eq!(side_effect_starts, 0);
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

    #[test]
    fn connector_contracts_require_station_derived_capability_ids() {
        let capability_id = format!("connector.resource.{}", "a".repeat(64));
        let executor = LocalCapabilityExecutor::new(
            "ptid:person:test",
            [CapabilityContract {
                capability_id: capability_id.clone(),
                schema_version: "manifest-version".to_string(),
                max_argument_bytes: 1024,
                max_result_bytes: 1024,
                supports_external_idempotency: false,
            }],
        )
        .expect("Station-derived Connector capability should register");
        assert!(executor.contract(&capability_id).is_some());

        let invalid = LocalCapabilityExecutor::new(
            "ptid:person:test",
            [CapabilityContract {
                capability_id: "connector.github".to_string(),
                schema_version: "1".to_string(),
                max_argument_bytes: 1024,
                max_result_bytes: 1024,
                supports_external_idempotency: false,
            }],
        );
        assert!(invalid.is_err());
    }

    #[cfg(feature = "acceptance-webdriver")]
    #[test]
    fn acceptance_external_idempotency_reuses_result_and_rejects_payload_conflict() {
        let request = ClientCapabilityRequest {
            capability_id: "clipboard.read".to_string(),
            schema_version: "1".to_string(),
            bounded_arguments: br#"{}"#.to_vec(),
            ..Default::default()
        };
        let key = format!("external-key-{}", std::process::id());
        let mut side_effect_count = 0;
        let first = execute_with_external_idempotency("ptid:person:test", &request, &key, || {
            side_effect_count += 1;
            Ok(json!({"text": "first"}))
        })
        .unwrap();
        let replay = execute_with_external_idempotency("ptid:person:test", &request, &key, || {
            side_effect_count += 1;
            Ok(json!({"text": "second"}))
        })
        .unwrap();
        assert_eq!(first, replay);
        assert_eq!(side_effect_count, 1);

        let conflicting = ClientCapabilityRequest {
            bounded_arguments: br#"{"different":true}"#.to_vec(),
            ..request
        };
        assert_eq!(
            execute_with_external_idempotency("ptid:person:test", &conflicting, &key, || {
                side_effect_count += 1;
                Ok(json!({"text": "conflict"}))
            },)
            .unwrap_err(),
            EXTERNAL_IDEMPOTENCY_CONFLICT
        );
        assert_eq!(side_effect_count, 1);
    }
}
