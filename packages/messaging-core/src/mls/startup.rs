use super::group::MlsGroupManager;
use crate::store::MlsStartupRepository;

pub fn restore_persisted_mls_state<R: MlsStartupRepository>(
    manager: &MlsGroupManager,
    repository: &R,
) -> Result<(), String> {
    for (conversation_id, session_state) in repository.list_mls_session_states()? {
        manager.import_session_state(&conversation_id, &session_state)?;
    }
    if let Some(provider_pool) = repository.load_mls_join_provider_pool()? {
        manager.import_pending_join_providers(&provider_pool)?;
    }
    for (conversation_id, pending_state) in repository.list_pending_mls_transitions()? {
        manager.import_pending_transition(&conversation_id, &pending_state)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mls::group::MlsMemberKeyPackage;
    use std::sync::Arc;

    struct TestStartupRepository {
        sessions: Vec<(String, Vec<u8>)>,
        provider_pool: Option<Vec<u8>>,
        pending: Vec<(String, Vec<u8>)>,
    }

    impl MlsStartupRepository for TestStartupRepository {
        fn list_mls_session_states(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
            Ok(self.sessions.clone())
        }

        fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String> {
            Ok(self.provider_pool.clone())
        }

        fn list_pending_mls_transitions(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
            Ok(self.pending.clone())
        }
    }

    #[test]
    fn restore_rehydrates_established_and_pending_group_state() {
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        let charlie = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        charlie
            .actor_identity()
            .init("ptid:charlie", "charlie-device")
            .unwrap();
        let genesis = alice
            .create_group(
                "group-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-1", &genesis.transition_id)
            .unwrap();
        alice
            .add_member(
                "group-1",
                &MlsMemberKeyPackage {
                    ptid: "ptid:charlie".to_string(),
                    device_id: "charlie-device".to_string(),
                    key_package: charlie.generate_key_package().unwrap(),
                },
            )
            .unwrap();

        let repository = TestStartupRepository {
            sessions: vec![(
                "group-1".to_string(),
                alice.export_session_state("group-1").unwrap(),
            )],
            provider_pool: Some(alice.export_pending_join_providers().unwrap()),
            pending: vec![(
                "group-1".to_string(),
                alice.export_pending_transition("group-1").unwrap(),
            )],
        };
        let restored = MlsGroupManager::with_actor_identity(alice.actor_identity());

        restore_persisted_mls_state(&restored, &repository).unwrap();

        assert!(restored.has_session("group-1"));
        assert!(restored.has_pending_transition("group-1"));
        assert_eq!(restored.group_epoch("group-1").unwrap(), 1);
    }
}
