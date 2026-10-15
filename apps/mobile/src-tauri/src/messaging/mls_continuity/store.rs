use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use messaging_core::mls::actor_device_identity::ActorDeviceIdentity;
use messaging_core::mls::group::MlsGroupManager;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use super::{
    MlsContinuityBackup, MlsContinuityBinding, MlsContinuityKeyPackage, MlsContinuityProviderPool,
    MlsContinuityScope, MlsContinuityState,
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
            if mls_continuity_table_counts(&connection)?.0 > 0 {
                return Ok(());
            }
        }
        let Some(state) = binding.backup.load()? else {
            return Ok(());
        };
        validate_mls_continuity_state(&state, &binding.scope)?;

        self.with_transaction(|transaction| {
            require_empty_or_initialized_mls_continuity(transaction)?;
            if mls_continuity_table_counts(transaction)?.0 > 0 {
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
            Ok(())
        })
    }

    pub(crate) fn persist_mls_continuity_backup(&self) -> Result<(), String> {
        let Some(binding) = self.mls_continuity.as_ref() else {
            return Ok(());
        };
        let Some(state) = self.mls_continuity_state(binding)? else {
            return Ok(());
        };
        binding.backup.store(&state)
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
            let (_, provider_count, package_count) = mls_continuity_table_counts(&connection)?;
            if provider_count != 0 || package_count != 0 {
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
        drop(connection);

        let state = MlsContinuityState {
            scope: binding.scope.clone(),
            actor_identity_state,
            provider_pool,
            key_packages,
        };
        validate_mls_continuity_state(&state, &binding.scope)?;
        Ok(Some(state))
    }
}

fn require_empty_or_initialized_mls_continuity(connection: &Connection) -> Result<(), String> {
    let (identity_count, provider_count, package_count) = mls_continuity_table_counts(connection)?;
    if identity_count == 0 && (provider_count > 0 || package_count > 0) {
        return Err("mobile messaging MLS continuity tables are partially initialized".to_string());
    }
    Ok(())
}

fn mls_continuity_table_counts(connection: &Connection) -> Result<(i64, i64, i64), String> {
    connection
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM messaging_mls_actor_identity),
               (SELECT COUNT(*) FROM messaging_mls_join_provider_pool),
               (SELECT COUNT(*) FROM messaging_mls_key_packages)",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use messaging_core::identity::{
        generate_fresh_device_identity_for_device, DeviceEnrollmentRepository,
    };
    use messaging_core::mls::group::MlsMemberKeyPackage;
    use messaging_core::store::{MlsKeyPackageRepository, MlsStartupRepository};
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
