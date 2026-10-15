use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use messaging_core::mls::actor_device_identity::ActorDeviceIdentity;
use messaging_core::mls::group::MlsGroupManager;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use super::{
    MlsContinuityBackup, MlsContinuityBinding, MlsContinuityKeyPackage,
    MlsContinuityPendingGenesis, MlsContinuityProviderPool, MlsContinuityScope, MlsContinuityState,
};
use crate::messaging::adapter::MobileMessagingStore;

impl MobileMessagingStore {
    pub(crate) fn open_with_mls_continuity(
        path: &Path,
        key: &[u8; 32],
        scope: MlsContinuityScope,
        backup: Arc<dyn MlsContinuityBackup>,
    ) -> Result<Self, String> {
        let mut store = Self::open(path, key)?;
        store.mls_continuity = Some(MlsContinuityBinding { scope, backup });
        Ok(store)
    }

    pub(crate) fn restore_mls_continuity_if_empty(&self) -> Result<(), String> {
        let Some(binding) = self.mls_continuity.as_ref() else {
            return Ok(());
        };
        {
            let connection = self
                .connection
                .lock()
                .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
            require_empty_or_initialized_mls_continuity(&connection)?;
            if mls_continuity_table_counts(&connection)?.identity > 0 {
                return Ok(());
            }
        }
        let Some(state) = binding.backup.load()? else {
            return Ok(());
        };
        validate_mls_continuity_state(&state, &binding.scope)?;

        self.with_transaction(|transaction| {
            require_empty_or_initialized_mls_continuity(transaction)?;
            if mls_continuity_table_counts(transaction)?.identity > 0 {
                return Ok(());
            }
            transaction
                .execute(
                    "INSERT INTO messaging_mls_actor_identity(
                        id, ptid, device_id, identity_state
                     ) VALUES (1, ?1, ?2, ?3)",
                    params![
                        state.scope.actor_ptid,
                        state.scope.device_id,
                        state.actor_identity_state
                    ],
                )
                .map_err(|error| error.to_string())?;
            if let Some(provider_pool) = &state.provider_pool {
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_join_provider_pool(
                            id, provider_pool_state, updated_at_unix_ms
                         ) VALUES (1, ?1, ?2)",
                        params![provider_pool.state, provider_pool.updated_at_unix_ms],
                    )
                    .map_err(|error| error.to_string())?;
            }
            for package in &state.key_packages {
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_key_packages(
                            package_id, data, state, created_at_unix_ms
                         ) VALUES (?1, ?2, ?3, ?4)",
                        params![
                            package.package_id,
                            package.data,
                            package.state,
                            package.created_at_unix_ms
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            for pending in &state.pending_genesis_transitions {
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_pending_transitions(
                            conversation_id, transition_id, command_id, transition_state
                         ) VALUES (?1, ?2, ?3, ?4)",
                        params![
                            pending.conversation_id,
                            pending.transition_id,
                            pending.command_id,
                            pending.state
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                transaction
                    .execute(
                        "INSERT INTO messaging_mls_continuity_restored_transitions(
                            conversation_id, transition_id, command_id
                         ) VALUES (?1, ?2, ?3)",
                        params![
                            pending.conversation_id,
                            pending.transition_id,
                            pending.command_id
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    pub(crate) fn persist_mls_continuity_backup(&self) -> Result<(), String> {
        if let Some(binding) = self.mls_continuity.as_ref() {
            if let Some(state) = self.mls_continuity_state(binding)? {
                binding.backup.store(&state)?;
            }
        }
        self.activate_continuity_backed_commands()
    }

    fn mls_continuity_state(
        &self,
        binding: &MlsContinuityBinding,
    ) -> Result<Option<MlsContinuityState>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "mobile messaging store lock poisoned".to_string())?;
        let actor_identity = connection
            .query_row(
                "SELECT ptid, device_id, identity_state
                 FROM messaging_mls_actor_identity WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((ptid, device_id, actor_identity_state)) = actor_identity else {
            let counts = mls_continuity_table_counts(&connection)?;
            if counts.provider != 0
                || counts.packages != 0
                || counts.pending != 0
                || counts.restored != 0
            {
                return Err("mobile messaging MLS continuity is missing actor identity".to_string());
            }
            return Ok(None);
        };
        if ptid != binding.scope.actor_ptid || device_id != binding.scope.device_id {
            return Err("mobile messaging MLS continuity scope changed".to_string());
        }
        let provider_pool = connection
            .query_row(
                "SELECT provider_pool_state, updated_at_unix_ms
                 FROM messaging_mls_join_provider_pool WHERE id = 1",
                [],
                |row| {
                    Ok(MlsContinuityProviderPool {
                        state: row.get(0)?,
                        updated_at_unix_ms: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT package_id, data, state, created_at_unix_ms
                 FROM messaging_mls_key_packages
                 ORDER BY created_at_unix_ms, package_id",
            )
            .map_err(|error| error.to_string())?;
        let key_packages = statement
            .query_map([], |row| {
                Ok(MlsContinuityKeyPackage {
                    package_id: row.get(0)?,
                    data: row.get(1)?,
                    state: row.get(2)?,
                    created_at_unix_ms: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, transition_id, command_id, transition_state
                 FROM messaging_mls_pending_transitions
                 ORDER BY conversation_id",
            )
            .map_err(|error| error.to_string())?;
        let pending_transitions = statement
            .query_map([], |row| {
                Ok(MlsContinuityPendingGenesis {
                    conversation_id: row.get(0)?,
                    transition_id: row.get(1)?,
                    command_id: row.get(2)?,
                    state: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        drop(connection);
        let mut pending_genesis_transitions = Vec::new();
        for pending in pending_transitions {
            if pending_transition_is_genesis(
                &pending.conversation_id,
                &pending.transition_id,
                &pending.state,
            )? {
                pending_genesis_transitions.push(pending);
            }
        }

        let state = MlsContinuityState {
            scope: binding.scope.clone(),
            actor_identity_state,
            provider_pool,
            key_packages,
            pending_genesis_transitions,
        };
        validate_mls_continuity_state(&state, &binding.scope)?;
        Ok(Some(state))
    }

    fn activate_continuity_backed_commands(&self) -> Result<(), String> {
        self.with_transaction(|transaction| {
            let orphan_count = transaction
                .query_row(
                    "SELECT COUNT(*)
                     FROM messaging_command_outbox outbox
                     WHERE outbox.state = 'continuity_pending'
                       AND NOT EXISTS (
                         SELECT 1 FROM messaging_mls_pending_transitions pending
                         WHERE pending.command_id = outbox.command_id
                           AND pending.conversation_id = outbox.conversation_id
                       )",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?;
            if orphan_count != 0 {
                return Err(
                    "mobile messaging MLS continuity command binding is incomplete".to_string(),
                );
            }
            transaction
                .execute(
                    "UPDATE messaging_command_outbox
                     SET state = 'pending', last_error_code = ''
                     WHERE state = 'continuity_pending'",
                    [],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    }
}

fn require_empty_or_initialized_mls_continuity(connection: &Connection) -> Result<(), String> {
    let counts = mls_continuity_table_counts(connection)?;
    if counts.identity == 0
        && (counts.provider > 0 || counts.packages > 0 || counts.pending > 0 || counts.restored > 0)
    {
        return Err("mobile messaging MLS continuity tables are partially initialized".to_string());
    }
    if counts.restored > counts.pending {
        return Err("mobile messaging MLS continuity restore markers are invalid".to_string());
    }
    Ok(())
}

struct MlsContinuityTableCounts {
    identity: i64,
    provider: i64,
    packages: i64,
    pending: i64,
    restored: i64,
}

fn mls_continuity_table_counts(
    connection: &Connection,
) -> Result<MlsContinuityTableCounts, String> {
    connection
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM messaging_mls_actor_identity),
               (SELECT COUNT(*) FROM messaging_mls_join_provider_pool),
               (SELECT COUNT(*) FROM messaging_mls_key_packages),
               (SELECT COUNT(*) FROM messaging_mls_pending_transitions),
               (SELECT COUNT(*) FROM messaging_mls_continuity_restored_transitions)",
            [],
            |row| {
                Ok(MlsContinuityTableCounts {
                    identity: row.get(0)?,
                    provider: row.get(1)?,
                    packages: row.get(2)?,
                    pending: row.get(3)?,
                    restored: row.get(4)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

fn validate_mls_continuity_state(
    state: &MlsContinuityState,
    expected_scope: &MlsContinuityScope,
) -> Result<(), String> {
    if &state.scope != expected_scope || state.actor_identity_state.is_empty() {
        return Err("mobile messaging MLS continuity scope is invalid".to_string());
    }
    let identity = ActorDeviceIdentity::new();
    identity.import(
        &expected_scope.actor_ptid,
        &expected_scope.device_id,
        &state.actor_identity_state,
    )?;

    let provider_count = match &state.provider_pool {
        Some(provider_pool)
            if !provider_pool.state.is_empty() && provider_pool.updated_at_unix_ms > 0 =>
        {
            MlsGroupManager::new().import_pending_join_providers(&provider_pool.state)?
        }
        Some(_) => {
            return Err("mobile messaging MLS continuity provider pool is invalid".to_string())
        }
        None => 0,
    };
    let pending_package_count = state
        .key_packages
        .iter()
        .filter(|package| package.state == "awaiting_publication")
        .count();
    if pending_package_count > provider_count {
        return Err(
            "mobile messaging MLS continuity has KeyPackages without private providers".to_string(),
        );
    }
    let mut package_ids = HashSet::with_capacity(state.key_packages.len());
    for package in &state.key_packages {
        if package.package_id.trim().is_empty()
            || package.data.is_empty()
            || !matches!(package.state.as_str(), "awaiting_publication" | "published")
            || package.created_at_unix_ms <= 0
            || package.package_id != hex::encode(Sha256::digest(&package.data))
            || !package_ids.insert(package.package_id.as_str())
        {
            return Err("mobile messaging MLS continuity KeyPackage is invalid".to_string());
        }
    }
    let mut conversation_ids = HashSet::with_capacity(state.pending_genesis_transitions.len());
    let mut transition_ids = HashSet::with_capacity(state.pending_genesis_transitions.len());
    let mut command_ids = HashSet::with_capacity(state.pending_genesis_transitions.len());
    for pending in &state.pending_genesis_transitions {
        if pending.command_id.trim().is_empty()
            || !conversation_ids.insert(pending.conversation_id.as_str())
            || !transition_ids.insert(pending.transition_id.as_str())
            || !command_ids.insert(pending.command_id.as_str())
            || !pending_transition_is_genesis(
                &pending.conversation_id,
                &pending.transition_id,
                &pending.state,
            )?
        {
            return Err("mobile messaging MLS continuity pending genesis is invalid".to_string());
        }
    }
    Ok(())
}

pub(super) fn pending_transition_is_genesis(
    conversation_id: &str,
    transition_id: &str,
    state: &[u8],
) -> Result<bool, String> {
    if conversation_id.trim().is_empty() || transition_id.trim().is_empty() || state.is_empty() {
        return Err("mobile messaging MLS pending transition is invalid".to_string());
    }
    let manager = MlsGroupManager::new();
    let prepared = manager.import_pending_transition(conversation_id, state)?;
    if prepared.transition_id != transition_id
        || prepared.to_mls_epoch != prepared.from_mls_epoch.saturating_add(1)
    {
        return Err("mobile messaging MLS pending transition binding mismatch".to_string());
    }
    Ok(prepared.from_mls_epoch == 0 && prepared.to_mls_epoch == 1)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use messaging_core::identity::{
        generate_fresh_device_identity_for_device, DeviceEnrollmentRepository,
    };
    use messaging_core::mls::group::MlsMemberKeyPackage;
    use messaging_core::store::{
        MlsKeyPackageRepository, MlsStartupRepository, MlsTransitionRepository,
        MlsTransitionSendCommit,
    };
    use ulid::Ulid;

    use super::*;

    #[derive(Default)]
    struct MemoryMlsContinuityBackup {
        state: Mutex<Option<MlsContinuityState>>,
    }

    impl MlsContinuityBackup for MemoryMlsContinuityBackup {
        fn load(&self) -> Result<Option<MlsContinuityState>, String> {
            Ok(self.state.lock().unwrap().clone())
        }

        fn store(&self, state: &MlsContinuityState) -> Result<(), String> {
            *self.state.lock().unwrap() = Some(state.clone());
            Ok(())
        }
    }

    struct FailingLoadMlsContinuityBackup;

    impl MlsContinuityBackup for FailingLoadMlsContinuityBackup {
        fn load(&self) -> Result<Option<MlsContinuityState>, String> {
            Err("corrupt backup".to_string())
        }

        fn store(&self, _state: &MlsContinuityState) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn mls_continuity_restores_welcome_private_key_after_database_loss() {
        let root = std::env::temp_dir().join(format!(
            "peers-mobile-mls-continuity-{}-{}",
            std::process::id(),
            Ulid::new()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let first_path = root.join("first.sqlite3");
        let second_path = root.join("second.sqlite3");
        let key = [17u8; 32];
        let scope = MlsContinuityScope::new("station-1", "ptid:bob", "bob-device").unwrap();
        let backup = Arc::new(MemoryMlsContinuityBackup::default());
        let first = MobileMessagingStore::open_with_mls_continuity(
            &first_path,
            &key,
            scope.clone(),
            backup.clone(),
        )
        .unwrap();
        let device =
            generate_fresh_device_identity_for_device("ptid:bob", "bob-device", [18; 32], 1)
                .unwrap();
        DeviceEnrollmentRepository::install_fresh_device_identity(&first, &device).unwrap();
        DeviceEnrollmentRepository::complete_device_enrollment(&first, "bob-device").unwrap();

        let bob_identity = Arc::new(ActorDeviceIdentity::new());
        bob_identity.init("ptid:bob", "bob-device").unwrap();
        let identity_state = bob_identity.export("ptid:bob", "bob-device").unwrap();
        first
            .save_mls_actor_identity("ptid:bob", "bob-device", &identity_state)
            .unwrap();
        let bob = MlsGroupManager::with_actor_identity(bob_identity);
        let key_packages = (0..5)
            .map(|_| bob.generate_key_package().unwrap())
            .collect::<Vec<_>>();
        MlsKeyPackageRepository::install_fresh_mls_key_packages(
            &first,
            &key_packages,
            &bob.export_pending_join_providers().unwrap(),
            10,
        )
        .unwrap();
        MlsKeyPackageRepository::persist_mls_continuity(&first).unwrap();
        for package in MlsKeyPackageRepository::pending_mls_key_packages(&first).unwrap() {
            MlsKeyPackageRepository::complete_mls_key_package_publication(
                &first,
                &package.package_id,
            )
            .unwrap();
        }
        MlsKeyPackageRepository::persist_mls_continuity(&first).unwrap();
        let signing_identity = bob.actor_identity().signing_identity().unwrap();
        drop(first);

        let second =
            MobileMessagingStore::open_with_mls_continuity(&second_path, &key, scope, backup)
                .unwrap();
        second.restore_mls_continuity_if_empty().unwrap();
        let (_, _, restored_identity_state) = second.load_mls_actor_identity().unwrap().unwrap();
        let restored_identity = Arc::new(ActorDeviceIdentity::new());
        restored_identity
            .import("ptid:bob", "bob-device", &restored_identity_state)
            .unwrap();
        let restored_bob = MlsGroupManager::with_actor_identity(restored_identity);
        restored_bob
            .import_pending_join_providers(
                &MlsStartupRepository::load_mls_join_provider_pool(&second)
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(
            restored_bob.actor_identity().signing_identity().unwrap(),
            signing_identity
        );
        assert_eq!(restored_bob.pending_join_provider_count(), 5);
        assert!(MlsKeyPackageRepository::pending_mls_key_packages(&second)
            .unwrap()
            .is_empty());
        assert!(MlsKeyPackageRepository::has_mls_key_packages(&second).unwrap());
        assert_eq!(
            second
                .connection
                .lock()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM messaging_mls_key_packages
                     WHERE state = 'published'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            5
        );

        let alice = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        let created = alice
            .create_group(
                "group-continuity",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: key_packages[0].clone(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-continuity", &created.transition_id)
            .unwrap();
        restored_bob
            .join_group("group-continuity", &created.welcome_bytes)
            .unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-continuity", 1, b"continuity")
            .unwrap()
            .ciphertext;
        assert_eq!(
            restored_bob
                .decrypt("group-continuity", &ciphertext)
                .unwrap(),
            b"continuity"
        );

        drop(second);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn mls_continuity_restores_pending_genesis_after_database_loss() {
        let root = std::env::temp_dir().join(format!(
            "peers-mobile-mls-genesis-continuity-{}-{}",
            std::process::id(),
            Ulid::new()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let first_path = root.join("first.sqlite3");
        let second_path = root.join("second.sqlite3");
        let key = [23u8; 32];
        let scope = MlsContinuityScope::new("station-1", "ptid:alice", "alice-device").unwrap();
        let backup = Arc::new(MemoryMlsContinuityBackup::default());
        let first = MobileMessagingStore::open_with_mls_continuity(
            &first_path,
            &key,
            scope.clone(),
            backup.clone(),
        )
        .unwrap();
        let alice_identity = Arc::new(ActorDeviceIdentity::new());
        alice_identity.init("ptid:alice", "alice-device").unwrap();
        first
            .save_mls_actor_identity(
                "ptid:alice",
                "alice-device",
                &alice_identity.export("ptid:alice", "alice-device").unwrap(),
            )
            .unwrap();
        let alice = MlsGroupManager::with_actor_identity(alice_identity);
        let bob = MlsGroupManager::new();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let created = alice
            .create_group(
                "group-pending-genesis",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        let pending_state = alice
            .export_pending_transition("group-pending-genesis")
            .unwrap();
        MlsTransitionRepository::persist_mls_transition(
            &first,
            &MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: "command-pending-genesis",
                conversation_id: "group-pending-genesis",
                transition_id: &created.transition_id,
                delivery_plan_sha256: &[24; 32],
                command_bytes: b"pending-genesis-command",
                pending_transition_state: &pending_state,
                created_at_unix_ms: 25,
                from_mls_epoch: created.from_mls_epoch,
            },
        )
        .unwrap();
        MlsTransitionRepository::persist_mls_continuity(&first).unwrap();
        assert_eq!(
            first
                .connection
                .lock()
                .unwrap()
                .query_row(
                    "SELECT state FROM messaging_command_outbox
                     WHERE command_id = 'command-pending-genesis'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "pending"
        );
        assert_eq!(
            backup
                .state
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .pending_genesis_transitions
                .len(),
            1
        );
        drop(first);

        let second =
            MobileMessagingStore::open_with_mls_continuity(&second_path, &key, scope, backup)
                .unwrap();
        second.restore_mls_continuity_if_empty().unwrap();
        let restored = MlsStartupRepository::list_pending_mls_transitions(&second).unwrap();
        assert_eq!(
            restored,
            vec![("group-pending-genesis".to_string(), pending_state)]
        );
        let restored_manager = MlsGroupManager::new();
        let prepared = restored_manager
            .import_pending_transition("group-pending-genesis", &restored[0].1)
            .unwrap();
        assert_eq!(prepared.transition_id, created.transition_id);
        let connection = second.connection.lock().unwrap();
        for table in [
            "messaging_local_commands",
            "messaging_command_outbox",
            "messaging_command_attempts",
        ] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*)
                     FROM messaging_mls_continuity_restored_transitions
                     WHERE conversation_id = 'group-pending-genesis'
                       AND transition_id = ?1
                       AND command_id = 'command-pending-genesis'",
                    params![created.transition_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        drop(connection);
        drop(second);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn existing_mls_state_does_not_read_a_stale_continuity_backup() {
        let path =
            std::env::temp_dir().join(format!("peers-mobile-mls-local-{}.sqlite3", Ulid::new()));
        let scope = MlsContinuityScope::new("station-1", "ptid:bob", "bob-device").unwrap();
        let store = MobileMessagingStore::open_with_mls_continuity(
            &path,
            &[19; 32],
            scope,
            Arc::new(FailingLoadMlsContinuityBackup),
        )
        .unwrap();
        let identity = ActorDeviceIdentity::new();
        identity.init("ptid:bob", "bob-device").unwrap();
        store
            .save_mls_actor_identity(
                "ptid:bob",
                "bob-device",
                &identity.export("ptid:bob", "bob-device").unwrap(),
            )
            .unwrap();

        store.restore_mls_continuity_if_empty().unwrap();

        drop(store);
        let _ = std::fs::remove_file(path);
    }
}
