use messaging_core::search::MessagingSearchReader;
use search_core::{ResourceRef, ScoredDocument};

use super::MessagingEngine;

impl MessagingSearchReader for MessagingEngine {
    fn search_revision(&self) -> Result<String, String> {
        MessagingEngine::search_revision(self)
    }

    fn search_authorities(&self) -> Result<Vec<String>, String> {
        MessagingEngine::search_authorities(self)
    }

    fn search_index_ready(&self) -> Result<bool, String> {
        Ok(true)
    }

    fn search_device_documents(
        &self,
        conversation: Option<&str>,
        query: &str,
        attachment_names_only: bool,
        before: Option<(i64, &str, &str)>,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        MessagingEngine::search_device_documents(
            self,
            conversation,
            query,
            attachment_names_only,
            before,
            limit,
            check,
        )
    }

    fn suggest_conversations(
        &self,
        conversation: Option<&str>,
        query: &str,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        MessagingEngine::suggest_conversations(self, conversation, query, limit, check)
    }

    fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        MessagingEngine::search_read_resources(self, refs, check)
    }
}
