use crate::application::agent_runtime;
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::AppResult;

pub fn agent_execute_turn(actor_id: &str, input: AgentExecuteTurnInput) -> AppResult<StubPayload> {
    agent_runtime::execute_turn(actor_id, input)
}

pub fn agent_turn_traces() -> AppResult<StubPayload> {
    agent_runtime::list_traces()
}
