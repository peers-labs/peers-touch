use crate::proto::chat::{
    ResolveConversationCommandResultsRequest, ResolvedConversationCommandResult,
};

pub trait CommandResultTransport: Send + Sync {
    fn resolve(
        &self,
        request: ResolveConversationCommandResultsRequest,
    ) -> Result<Vec<ResolvedConversationCommandResult>, String>;
}
