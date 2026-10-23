use messaging_core::search::MessagingSearchReader;
use search_core::{ResourceRef, ScoredDocument};

use super::engine::MobileMessagingEngine;

impl MessagingSearchReader for MobileMessagingEngine {
    fn search_revision(&self) -> Result<String, String> {
        self.store().search_revision()
    }

    fn search_authorities(&self) -> Result<Vec<String>, String> {
        let mut authorities = self.store().search_authorities(&self.scope().actor_ptid)?;
        let home = format!("station:{}", self.scope().station_peer_id);
        if !authorities.contains(&home) {
            authorities.push(home);
        }
        authorities.sort();
        Ok(authorities)
    }

    fn search_index_ready(&self) -> Result<bool, String> {
        self.store().search_index_ready()
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
        self.store().search_documents(
            &self.scope().actor_ptid,
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
        self.store().search_conversations(
            &self.scope().actor_ptid,
            conversation,
            query,
            limit,
            check,
        )
    }

    fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        self.store()
            .search_read_resources(refs, &self.scope().actor_ptid, check)
    }
}
