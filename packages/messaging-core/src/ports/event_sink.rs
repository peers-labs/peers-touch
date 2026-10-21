use crate::contracts::CryptoEndpoint;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineEvent {
    ProjectionChanged {
        conversation_id: String,
        event_id: String,
        lane_sequence: i64,
    },
    CommandReconciled {
        conversation_id: String,
        command_id: String,
    },
    LifecycleChanged {
        endpoint: CryptoEndpoint,
        lifecycle_generation: u64,
    },
}

pub trait EngineEventSink: Send + Sync {
    fn emit(&self, event: EngineEvent) -> Result<(), String>;
}
