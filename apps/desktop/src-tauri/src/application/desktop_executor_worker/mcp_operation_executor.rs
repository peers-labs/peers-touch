use super::operation_executor::LocalOperationExecutor;
use crate::application::mcp;
use crate::model::agent::{CapabilityOperation, CapabilityOperationError};

pub struct McpLifecycleExecutor {
    actor_ptid: String,
}

impl McpLifecycleExecutor {
    pub fn new(actor_ptid: &str) -> Result<Self, String> {
        if !actor_ptid.starts_with("ptid:") {
            return Err("MCP lifecycle executor requires an actor PTID".to_string());
        }
        Ok(Self {
            actor_ptid: actor_ptid.to_string(),
        })
    }
}

impl LocalOperationExecutor for McpLifecycleExecutor {
    fn execute(
        &self,
        operation: &CapabilityOperation,
        _external_idempotency_key: Option<&str>,
    ) -> Result<String, CapabilityOperationError> {
        mcp::execute_lifecycle_operation(&self.actor_ptid, operation)
    }

    fn cleanup(&self, operation: &CapabilityOperation) -> Result<(), String> {
        mcp::cleanup_lifecycle_operation(&self.actor_ptid, operation)
    }
}
