use crate::contracts::ConversationId;

pub trait ProjectionSink: Send + Sync {
    fn emit_projection_changed(
        &self,
        conversation_id: &ConversationId,
        event_id: &str,
        lane_sequence: i64,
    );
}
