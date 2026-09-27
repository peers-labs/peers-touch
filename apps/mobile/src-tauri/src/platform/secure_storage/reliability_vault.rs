use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use zeroize::Zeroizing;

use crate::error::{MobileError, MobileResult};
use crate::runtime::reliability::{
    KeyVault, ReliabilityError, ReliabilityResult, INSTALL_KEK_RECORD_ID, SCOPE_DEK_RECORD_PREFIX,
};

use super::SecureStorage;

const MAX_SCOPE_KEY_RECORDS: usize = 4096;

pub(crate) trait SecureRecordStore: Send + Sync {
    fn set_record(&self, key: &str, value: &str) -> MobileResult<()>;
    fn get_record(&self, key: &str) -> MobileResult<Option<String>>;
    fn remove_record(&self, key: &str) -> MobileResult<()>;
    fn list_records(&self, prefix: &str) -> MobileResult<Vec<String>>;
}

impl SecureRecordStore for SecureStorage {
    fn set_record(&self, key: &str, value: &str) -> MobileResult<()> {
        self.set(key, value).map_err(Into::into)
    }

    fn get_record(&self, key: &str) -> MobileResult<Option<String>> {
        self.get(key).map_err(Into::into)
    }

    fn remove_record(&self, key: &str) -> MobileResult<()> {
        self.remove(key).map_err(Into::into)
    }

    fn list_records(&self, prefix: &str) -> MobileResult<Vec<String>> {
        self.list(prefix).map_err(Into::into)
    }
}

pub(crate) struct ReliabilityKeyVault<'a, S: SecureRecordStore = SecureStorage> {
    storage: &'a S,
}

impl<'a> ReliabilityKeyVault<'a> {
    pub(crate) fn new(storage: &'a SecureStorage) -> Self {
        Self { storage }
    }
}

impl<S: SecureRecordStore> ReliabilityKeyVault<'_, S> {
    #[cfg(test)]
    fn for_test(storage: &S) -> ReliabilityKeyVault<'_, S> {
        ReliabilityKeyVault { storage }
    }
}

impl<S: SecureRecordStore> KeyVault for ReliabilityKeyVault<'_, S> {
    fn load(&self, record_id: &str) -> ReliabilityResult<Option<Zeroizing<Vec<u8>>>> {
        validate_record_id(record_id)?;
        let encoded = self
            .storage
            .get_record(record_id)
            .map_err(map_storage_error)?;
        encoded
            .map(|encoded| {
                let decoded = STANDARD
                    .decode(encoded.as_bytes())
                    .map_err(|_| ReliabilityError::corrupt("secure key record is not base64"))?;
                if STANDARD.encode(&decoded) != encoded {
                    return Err(ReliabilityError::corrupt(
                        "secure key record is not canonical base64",
                    ));
                }
                Ok(Zeroizing::new(decoded))
            })
            .transpose()
    }

    fn store(&self, record_id: &str, value: &[u8]) -> ReliabilityResult<()> {
        validate_record_id(record_id)?;
        self.storage
            .set_record(record_id, &STANDARD.encode(value))
            .map_err(map_storage_error)
    }

    fn delete(&self, record_id: &str) -> ReliabilityResult<()> {
        validate_record_id(record_id)?;
        self.storage
            .remove_record(record_id)
            .map_err(map_storage_error)
    }

    fn list(&self, prefix: &str) -> ReliabilityResult<Vec<String>> {
        if prefix != SCOPE_DEK_RECORD_PREFIX {
            return Err(ReliabilityError::invalid(
                "secure key inventory supports only the reliability scope namespace",
            ));
        }
        let mut records = self
            .storage
            .list_records(prefix)
            .map_err(map_storage_error)?;
        records.sort();
        records.dedup();
        if records.len() > MAX_SCOPE_KEY_RECORDS
            || records
                .iter()
                .any(|record_id| !record_id.starts_with(prefix))
        {
            return Err(ReliabilityError::corrupt(
                "platform secure storage returned an invalid scope-key inventory",
            ));
        }
        Ok(records)
    }
}

fn validate_record_id(record_id: &str) -> ReliabilityResult<()> {
    if record_id == INSTALL_KEK_RECORD_ID || record_id.starts_with(SCOPE_DEK_RECORD_PREFIX) {
        return Ok(());
    }
    Err(ReliabilityError::invalid(
        "secure key record is outside the Rust-owned reliability namespace",
    ))
}

fn map_storage_error(error: MobileError) -> ReliabilityError {
    ReliabilityError::key_unavailable(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct MemorySecureStore {
        records: Mutex<BTreeMap<String, String>>,
    }

    impl SecureRecordStore for MemorySecureStore {
        fn set_record(&self, key: &str, value: &str) -> MobileResult<()> {
            self.records
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get_record(&self, key: &str) -> MobileResult<Option<String>> {
            Ok(self.records.lock().unwrap().get(key).cloned())
        }

        fn remove_record(&self, key: &str) -> MobileResult<()> {
            self.records.lock().unwrap().remove(key);
            Ok(())
        }

        fn list_records(&self, prefix: &str) -> MobileResult<Vec<String>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect())
        }
    }

    #[test]
    fn stores_binary_records_and_lists_only_scope_keys() {
        let storage = MemorySecureStore::default();
        let vault = ReliabilityKeyVault::for_test(&storage);
        let scope_id = format!("{SCOPE_DEK_RECORD_PREFIX}scope-a");

        vault.store(INSTALL_KEK_RECORD_ID, &[0, 1, 2]).unwrap();
        vault.store(&scope_id, &[3, 4, 5]).unwrap();

        assert_eq!(
            vault
                .load(INSTALL_KEK_RECORD_ID)
                .unwrap()
                .unwrap()
                .as_slice(),
            &[0, 1, 2]
        );
        assert_eq!(
            vault.load(&scope_id).unwrap().unwrap().as_slice(),
            &[3, 4, 5]
        );
        assert_eq!(vault.list(SCOPE_DEK_RECORD_PREFIX).unwrap(), vec![scope_id]);
    }

    #[test]
    fn delete_is_idempotent_and_removes_inventory_entry() {
        let storage = MemorySecureStore::default();
        let vault = ReliabilityKeyVault::for_test(&storage);
        let scope_id = format!("{SCOPE_DEK_RECORD_PREFIX}scope-a");
        vault.store(&scope_id, &[7; 32]).unwrap();

        vault.delete(&scope_id).unwrap();
        vault.delete(&scope_id).unwrap();

        assert!(vault.load(&scope_id).unwrap().is_none());
        assert!(vault.list(SCOPE_DEK_RECORD_PREFIX).unwrap().is_empty());
    }

    #[test]
    fn rejects_non_reliability_namespaces_and_noncanonical_base64() {
        let storage = MemorySecureStore::default();
        let vault = ReliabilityKeyVault::for_test(&storage);
        assert!(vault.store("oauth.session", &[1]).is_err());

        storage
            .records
            .lock()
            .unwrap()
            .insert(INSTALL_KEK_RECORD_ID.to_string(), "AQ==\n".to_string());
        assert!(vault.load(INSTALL_KEK_RECORD_ID).is_err());
    }
}
