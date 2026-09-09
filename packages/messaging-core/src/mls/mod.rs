pub mod actor_device_identity;
pub mod group;
pub mod group_genesis;
pub mod inbound;
pub mod key_packages;
pub mod leave_intent;
pub mod membership_transition;
pub mod outbound;
pub mod provider;
pub mod startup;

pub use inbound::{
    MlsApplicationProcessor, MlsRetirementProcessor, MlsSenderTransitionProcessor,
    MlsTransitionProcessor,
};

#[cfg(test)]
mod test_support {
    use crate::contracts::{
        InteractionReceiveCommit, MlsApplicationReceiveCommit, MlsConversationProjection,
        MlsMessageProjection, MlsRetirementReceiveCommit, MlsSenderTransitionReceiveCommit,
        MlsTransitionReceiveCommit, PendingMlsTransitionState, ReceiveCommitResult,
    };
    use crate::store::{MlsInboundRepository, MlsTransitionRepository, MlsTransitionSendCommit};
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct PersistedTransition {
        pub logical_intent_id: Option<String>,
        pub command_id: String,
        pub conversation_id: String,
        pub transition_id: String,
        pub delivery_plan_sha256: Vec<u8>,
        pub command_bytes: Vec<u8>,
        pub pending_transition_state: Vec<u8>,
        pub created_at_unix_ms: i64,
    }

    #[derive(Default)]
    struct TestRepositoryState {
        authority_heads: HashMap<String, (i64, Vec<u8>)>,
        claimed_items: HashMap<String, Vec<u8>>,
        committed_items: HashMap<String, Vec<u8>>,
        conversations: HashMap<String, MlsConversationProjection>,
        messages: Vec<MlsMessageProjection>,
        mls_sessions: HashMap<String, Vec<u8>>,
        pending_transitions: HashMap<String, PendingMlsTransitionState>,
        provider_pool: Option<Vec<u8>>,
        retired_conversations: HashSet<String>,
    }

    pub struct TestMlsRepository {
        default_authority_head: (i64, Vec<u8>),
        transition: Mutex<Option<PersistedTransition>>,
        state: Mutex<TestRepositoryState>,
    }

    impl TestMlsRepository {
        pub fn new(authority_sequence: i64, authority_hash: Vec<u8>) -> Self {
            Self {
                default_authority_head: (authority_sequence, authority_hash),
                transition: Mutex::new(None),
                state: Mutex::new(TestRepositoryState::default()),
            }
        }

        pub fn transition(&self) -> Option<PersistedTransition> {
            self.transition.lock().unwrap().clone()
        }

        pub fn install_conversation(
            &self,
            conversation_id: &str,
            membership_epoch: i64,
            mls_epoch: i64,
        ) {
            self.state.lock().unwrap().conversations.insert(
                conversation_id.to_string(),
                MlsConversationProjection {
                    conversation_id: conversation_id.to_string(),
                    authority_station_id: "station-local".to_string(),
                    kind: crate::proto::chat::ConversationKind::Group as i32,
                    name: String::new(),
                    owner_ptid: "ptid:alice".to_string(),
                    members: Vec::new(),
                    membership_epoch,
                    mls_epoch,
                    active: true,
                    updated_at_unix_ms: 0,
                },
            );
        }

        pub fn install_authority_head(
            &self,
            conversation_id: &str,
            sequence: i64,
            event_hash: Vec<u8>,
        ) {
            self.state
                .lock()
                .unwrap()
                .authority_heads
                .insert(conversation_id.to_string(), (sequence, event_hash));
        }

        pub fn save_mls_session_state(&self, conversation_id: &str, state: Vec<u8>) {
            self.state
                .lock()
                .unwrap()
                .mls_sessions
                .insert(conversation_id.to_string(), state);
        }

        pub fn save_mls_join_provider_pool(&self, state: Vec<u8>) {
            self.state.lock().unwrap().provider_pool = Some(state);
        }

        pub fn mls_session_state(&self, conversation_id: &str) -> Option<Vec<u8>> {
            self.state
                .lock()
                .unwrap()
                .mls_sessions
                .get(conversation_id)
                .cloned()
        }

        pub fn conversations(&self) -> Vec<MlsConversationProjection> {
            self.state
                .lock()
                .unwrap()
                .conversations
                .values()
                .cloned()
                .collect()
        }

        pub fn messages(&self) -> Vec<MlsMessageProjection> {
            self.state.lock().unwrap().messages.clone()
        }

        pub fn has_retired_checkpoint(&self, conversation_id: &str) -> bool {
            self.state
                .lock()
                .unwrap()
                .retired_conversations
                .contains(conversation_id)
        }

        fn commit_item(
            state: &mut TestRepositoryState,
            item_id: &str,
            payload_sha256: &[u8],
        ) -> Result<ReceiveCommitResult, String> {
            if let Some(committed_hash) = state.committed_items.get(item_id) {
                return if committed_hash == payload_sha256 {
                    Ok(ReceiveCommitResult::AlreadyCommitted)
                } else {
                    Err("test committed item payload hash mismatch".to_string())
                };
            }
            state
                .committed_items
                .insert(item_id.to_string(), payload_sha256.to_vec());
            Ok(ReceiveCommitResult::Committed)
        }

        fn update_authority_head(
            state: &mut TestRepositoryState,
            conversation_id: &str,
            event_sequence: i64,
            event_hash: &[u8],
        ) {
            state.authority_heads.insert(
                conversation_id.to_string(),
                (event_sequence, event_hash.to_vec()),
            );
        }
    }

    impl MlsTransitionRepository for TestMlsRepository {
        fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .authority_heads
                .get(conversation_id)
                .cloned()
                .unwrap_or_else(|| self.default_authority_head.clone()))
        }

        fn persist_mls_transition(
            &self,
            commit: &MlsTransitionSendCommit<'_>,
        ) -> Result<(), String> {
            let mut transition = self.transition.lock().unwrap();
            if transition.is_some() {
                return Err("test transition already persisted".to_string());
            }
            *transition = Some(PersistedTransition {
                logical_intent_id: commit.logical_intent_id.map(str::to_string),
                command_id: commit.command_id.to_string(),
                conversation_id: commit.conversation_id.to_string(),
                transition_id: commit.transition_id.to_string(),
                delivery_plan_sha256: commit.delivery_plan_sha256.to_vec(),
                command_bytes: commit.command_bytes.to_vec(),
                pending_transition_state: commit.pending_transition_state.to_vec(),
                created_at_unix_ms: commit.created_at_unix_ms,
            });
            self.state.lock().unwrap().pending_transitions.insert(
                commit.conversation_id.to_string(),
                PendingMlsTransitionState {
                    transition_id: commit.transition_id.to_string(),
                    command_id: commit.command_id.to_string(),
                    state: commit.pending_transition_state.to_vec(),
                },
            );
            Ok(())
        }
    }

    impl MlsInboundRepository for TestMlsRepository {
        fn persist_claimed_item(
            &self,
            item_id: &str,
            _event_id: &str,
            _conversation_id: &str,
            _lane_sequence: i64,
            _consumer_epoch: u64,
            payload_sha256: &[u8],
            _opaque_payload: &[u8],
            _now_unix_ms: i64,
        ) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            if let Some(claimed_hash) = state.claimed_items.get(item_id) {
                if claimed_hash != payload_sha256 {
                    return Err("test claimed item payload hash mismatch".to_string());
                }
                return Ok(());
            }
            state
                .claimed_items
                .insert(item_id.to_string(), payload_sha256.to_vec());
            Ok(())
        }

        fn consumption_marker_matches(
            &self,
            item_id: &str,
            payload_sha256: &[u8],
        ) -> Result<bool, String> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .committed_items
                .get(item_id)
                .is_some_and(|committed_hash| committed_hash == payload_sha256))
        }

        fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            MlsTransitionRepository::authority_head(self, conversation_id)
        }

        fn load_mls_session_state(&self, conversation_id: &str) -> Result<Option<Vec<u8>>, String> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .mls_sessions
                .get(conversation_id)
                .cloned())
        }

        fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
            Ok(self.state.lock().unwrap().provider_pool.clone())
        }

        fn has_mls_retired_checkpoint(&self, conversation_id: &str) -> Result<bool, String> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .retired_conversations
                .contains(conversation_id))
        }

        fn pending_mls_transition(
            &self,
            conversation_id: &str,
        ) -> Result<Option<PendingMlsTransitionState>, String> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .pending_transitions
                .get(conversation_id)
                .cloned())
        }

        fn commit_interaction_event(
            &self,
            commit: &InteractionReceiveCommit<'_>,
        ) -> Result<ReceiveCommitResult, String> {
            let mut state = self.state.lock().unwrap();
            let result = Self::commit_item(&mut state, commit.item_id, commit.payload_sha256)?;
            if result == ReceiveCommitResult::Committed {
                if let Some(session_state) = commit.mls_session_state {
                    state
                        .mls_sessions
                        .insert(commit.conversation_id.to_string(), session_state.to_vec());
                }
                Self::update_authority_head(
                    &mut state,
                    commit.conversation_id,
                    commit.event_sequence,
                    commit.event_hash,
                );
            }
            Ok(result)
        }

        fn commit_mls_application(
            &self,
            commit: &MlsApplicationReceiveCommit<'_>,
        ) -> Result<ReceiveCommitResult, String> {
            let mut state = self.state.lock().unwrap();
            let result = Self::commit_item(&mut state, commit.item_id, commit.payload_sha256)?;
            if result == ReceiveCommitResult::Committed {
                state.mls_sessions.insert(
                    commit.conversation_id.to_string(),
                    commit.session_state.to_vec(),
                );
                state.messages.push(commit.projection.clone());
                Self::update_authority_head(
                    &mut state,
                    commit.conversation_id,
                    commit.projection.event_sequence,
                    commit.event_hash,
                );
            }
            Ok(result)
        }

        fn commit_mls_transition_receive(
            &self,
            commit: &MlsTransitionReceiveCommit<'_>,
        ) -> Result<ReceiveCommitResult, String> {
            let mut state = self.state.lock().unwrap();
            let result = Self::commit_item(&mut state, commit.item_id, commit.payload_sha256)?;
            if result == ReceiveCommitResult::Committed {
                state.mls_sessions.insert(
                    commit.conversation_id.to_string(),
                    commit.session_state.to_vec(),
                );
                if let Some(provider_pool) = commit.provider_pool_state {
                    state.provider_pool = Some(provider_pool.to_vec());
                }
                if let Some(projection) = commit.join_projection {
                    state
                        .conversations
                        .insert(commit.conversation_id.to_string(), projection.clone());
                } else if let Some(projection) = state.conversations.get_mut(commit.conversation_id)
                {
                    projection.membership_epoch = commit.to_membership_epoch;
                    projection.mls_epoch = commit.to_mls_epoch;
                }
                Self::update_authority_head(
                    &mut state,
                    commit.conversation_id,
                    commit.event_sequence,
                    commit.event_hash,
                );
            }
            Ok(result)
        }

        fn commit_mls_sender_transition(
            &self,
            commit: &MlsSenderTransitionReceiveCommit<'_>,
        ) -> Result<ReceiveCommitResult, String> {
            let mut state = self.state.lock().unwrap();
            let result = Self::commit_item(&mut state, commit.item_id, commit.payload_sha256)?;
            if result == ReceiveCommitResult::Committed {
                state.mls_sessions.insert(
                    commit.conversation_id.to_string(),
                    commit.session_state.to_vec(),
                );
                state.pending_transitions.remove(commit.conversation_id);
                if let Some(projection) = state.conversations.get_mut(commit.conversation_id) {
                    projection.membership_epoch = commit.membership_epoch;
                    projection.mls_epoch = commit.mls_epoch;
                }
                Self::update_authority_head(
                    &mut state,
                    commit.conversation_id,
                    commit.event_sequence,
                    commit.event_hash,
                );
            }
            Ok(result)
        }

        fn commit_mls_retirement(
            &self,
            commit: &MlsRetirementReceiveCommit<'_>,
        ) -> Result<ReceiveCommitResult, String> {
            let mut state = self.state.lock().unwrap();
            let result = Self::commit_item(&mut state, commit.item_id, commit.payload_sha256)?;
            if result == ReceiveCommitResult::Committed {
                state.mls_sessions.remove(commit.conversation_id);
                state
                    .retired_conversations
                    .insert(commit.conversation_id.to_string());
                state.conversations.insert(
                    commit.conversation_id.to_string(),
                    commit.projection.clone(),
                );
                Self::update_authority_head(
                    &mut state,
                    commit.conversation_id,
                    commit.event_sequence,
                    commit.event_hash,
                );
            }
            Ok(result)
        }
    }

    pub type TestTransitionRepository = TestMlsRepository;
}
