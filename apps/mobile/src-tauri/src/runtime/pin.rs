//! Native application lock; OS Keychain continues to own credentials at rest.
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use argon2::password_hash::{PasswordHash, SaltString};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use base64::{engine::general_purpose::STANDARD, Engine};
use prost::Message;
use rand::rngs::OsRng;
use tauri::State;
use zeroize::Zeroizing;

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::current_session_actor_scope;
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    MobilePinRecord, MobilePinRequest, MobilePinResetRecord, MobilePinStatus,
};

const MAX_FAILURES: u32 = 5;
const LOCKOUT_MS: i64 = 300_000;
const PREFIX: &str = "mobile.security.pin.";
const RESET_KEY: &str = "mobile.security.pin-reset";
static UNLOCKED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static OPERATIONS: Mutex<()> = Mutex::new(());

fn scope_key(station: &str, actor: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("{station}\u{1f}{actor}").as_bytes());
    format!(
        "{PREFIX}{}",
        digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

fn unlocked() -> &'static Mutex<HashSet<String>> {
    UNLOCKED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn pin_error(code: &'static str) -> MobileError {
    MobileError::coded(code, "native application lock requires verification")
}

fn read_record(storage: &SecureStorage, key: &str) -> MobileResult<Option<MobilePinRecord>> {
    storage
        .get(key)?
        .map(|value| {
            let bytes = STANDARD
                .decode(value)
                .map_err(|_| pin_error("MOBILE_PIN_STORAGE_INVALID"))?;
            MobilePinRecord::decode(bytes.as_slice())
                .map_err(|_| pin_error("MOBILE_PIN_STORAGE_INVALID"))
        })
        .transpose()
}

fn write_record(storage: &SecureStorage, key: &str, record: &MobilePinRecord) -> MobileResult<()> {
    storage.set(key, &STANDARD.encode(record.encode_to_vec()))
}

pub(crate) fn require_unlocked(
    storage: &SecureStorage,
    station: &str,
    actor: &str,
) -> MobileResult<()> {
    let key = scope_key(station, actor);
    if read_record(storage, &key)?.is_some() {
        locked_scopes()
            .lock()
            .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
            .insert(key);
        require_runtime_unlocked(station, actor)?;
    }
    Ok(())
}

pub(crate) fn require_runtime_unlocked(station: &str, actor: &str) -> MobileResult<()> {
    let key = scope_key(station, actor);
    // Only configured scopes are installed in LOCKED; unconfigured accounts
    // continue to use ordinary native Session admission.
    if locked_scopes()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .contains(&key)
        && !unlocked()
            .lock()
            .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
            .contains(&key)
    {
        return Err(pin_error("MOBILE_PIN_LOCKED"));
    }
    Ok(())
}

static LOCKED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
fn locked_scopes() -> &'static Mutex<HashSet<String>> {
    LOCKED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn status(storage: &SecureStorage, request: &MobilePinRequest) -> MobileResult<MobilePinStatus> {
    let scope = current_session_actor_scope(storage)?;
    let Some((station, actor)) = scope else {
        return Ok(MobilePinStatus::default());
    };
    if (!request.station_peer_id.is_empty() && request.station_peer_id != station)
        || (!request.actor_ptid.is_empty() && request.actor_ptid != actor)
    {
        return Err(pin_error("MOBILE_PIN_SCOPE_MISMATCH"));
    }
    let key = scope_key(&station, &actor);
    let record = read_record(storage, &key)?;
    if record.is_some() {
        locked_scopes()
            .lock()
            .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
            .insert(key.clone());
    }
    let is_unlocked = unlocked()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .contains(&key);
    let expired = record
        .as_ref()
        .is_some_and(|r| r.locked_until_unix_ms > 0 && r.locked_until_unix_ms <= now_ms());
    Ok(MobilePinStatus {
        station_peer_id: station,
        actor_ptid: actor,
        configured: record.is_some(),
        locked: record.is_some() && !is_unlocked,
        attempts_remaining: if expired {
            MAX_FAILURES
        } else {
            MAX_FAILURES.saturating_sub(record.as_ref().map_or(0, |r| r.failed_attempts))
        },
        locked_until_unix_ms: record.as_ref().map_or(0, |r| r.locked_until_unix_ms),
    })
}

fn verify(record: &mut MobilePinRecord, pin: &str, now: i64) -> MobileResult<()> {
    if record.locked_until_unix_ms > now {
        return Err(pin_error("MOBILE_PIN_COOLDOWN"));
    }
    if record.locked_until_unix_ms > 0 {
        record.failed_attempts = 0;
        record.locked_until_unix_ms = 0;
    }
    let hash = PasswordHash::new(&record.verification_hash)
        .map_err(|_| pin_error("MOBILE_PIN_STORAGE_INVALID"))?;
    if Argon2::default()
        .verify_password(pin.as_bytes(), &hash)
        .is_err()
    {
        record.failed_attempts = record.failed_attempts.saturating_add(1);
        if record.failed_attempts >= MAX_FAILURES {
            record.locked_until_unix_ms = now + LOCKOUT_MS;
        }
        return Err(pin_error("MOBILE_PIN_WRONG"));
    }
    record.failed_attempts = 0;
    record.locked_until_unix_ms = 0;
    Ok(())
}

fn new_record(pin: &str) -> MobileResult<MobilePinRecord> {
    if !(4..=16).contains(&pin.len()) || !pin.bytes().all(|b| b.is_ascii_digit()) {
        return Err(pin_error("MOBILE_PIN_FORMAT"));
    }
    let salt = SaltString::generate(&mut OsRng);
    let verification_hash = Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .to_string();
    Ok(MobilePinRecord {
        verification_hash,
        ..Default::default()
    })
}

fn decode(bytes: Vec<u8>) -> MobileResult<MobilePinRequest> {
    let bytes = Zeroizing::new(bytes);
    if bytes.len() > 1024 {
        return Err(pin_error("MOBILE_PIN_FORMAT"));
    }
    MobilePinRequest::decode(bytes.as_slice()).map_err(|_| pin_error("MOBILE_PIN_FORMAT"))
}

#[tauri::command]
pub fn mobile_pin_status(
    storage: State<'_, SecureStorage>,
    request_bytes: Vec<u8>,
) -> MobileResult<Vec<u8>> {
    let _operation = OPERATIONS
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?;
    Ok(status(&storage, &decode(request_bytes)?)?.encode_to_vec())
}

#[tauri::command]
pub fn mobile_pin_unlock(
    storage: State<'_, SecureStorage>,
    request_bytes: Vec<u8>,
) -> MobileResult<Vec<u8>> {
    let _operation = OPERATIONS
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?;
    let mut request = decode(request_bytes)?;
    let current = status(&storage, &request)?;
    let key = scope_key(&current.station_peer_id, &current.actor_ptid);
    let pin = Zeroizing::new(std::mem::take(&mut request.current_pin));
    let mut record =
        read_record(&storage, &key)?.ok_or_else(|| pin_error("MOBILE_PIN_NOT_CONFIGURED"))?;
    let result = verify(&mut record, pin.as_str(), now_ms());
    // Persist failures even when verification fails. Relaunch cannot reset cooldown.
    write_record(&storage, &key, &record)?;
    result?;
    unlocked()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .insert(key);
    Ok(status(&storage, &request)?.encode_to_vec())
}

#[tauri::command]
pub fn mobile_pin_configure(
    storage: State<'_, SecureStorage>,
    request_bytes: Vec<u8>,
) -> MobileResult<Vec<u8>> {
    let _operation = OPERATIONS
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?;
    let mut request = decode(request_bytes)?;
    let current = status(&storage, &request)?;
    if current.actor_ptid.is_empty() {
        return Err(pin_error("MOBILE_PIN_SCOPE_MISMATCH"));
    }
    let key = scope_key(&current.station_peer_id, &current.actor_ptid);
    let old_pin = Zeroizing::new(std::mem::take(&mut request.current_pin));
    let pin = Zeroizing::new(std::mem::take(&mut request.new_pin));
    if let Some(mut record) = read_record(&storage, &key)? {
        let result = verify(&mut record, old_pin.as_str(), now_ms());
        write_record(&storage, &key, &record)?;
        result?;
    }
    if request.remove {
        storage.remove(&key)?;
        locked_scopes()
            .lock()
            .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
            .remove(&key);
    } else {
        write_record(&storage, &key, &new_record(pin.as_str())?)?;
        locked_scopes()
            .lock()
            .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
            .insert(key.clone());
    }
    unlocked()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .insert(key);
    Ok(status(&storage, &request)?.encode_to_vec())
}

#[tauri::command]
pub fn mobile_pin_lock(
    storage: State<'_, SecureStorage>,
    request_bytes: Vec<u8>,
) -> MobileResult<Vec<u8>> {
    let _operation = OPERATIONS
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?;
    let request = decode(request_bytes)?;
    let current = status(&storage, &request)?;
    unlocked()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .remove(&scope_key(&current.station_peer_id, &current.actor_ptid));
    Ok(status(&storage, &request)?.encode_to_vec())
}

#[tauri::command]
pub fn mobile_pin_request_reset(
    storage: State<'_, SecureStorage>,
    request_bytes: Vec<u8>,
) -> MobileResult<()> {
    let _operation = OPERATIONS
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?;
    let current = status(&storage, &decode(request_bytes)?)?;
    if !current.configured {
        return Err(pin_error("MOBILE_PIN_NOT_CONFIGURED"));
    }
    let reset = MobilePinResetRecord {
        station_peer_id: current.station_peer_id,
        actor_ptid: current.actor_ptid,
        expires_at_unix_ms: now_ms() + 600_000,
    };
    storage.set(RESET_KEY, &STANDARD.encode(reset.encode_to_vec()))
}

pub(crate) fn finish_reauthentication<S: crate::runtime::oauth::SecretStore>(
    storage: &S,
    station: &str,
    actor: &str,
) -> MobileResult<()> {
    let _operation = OPERATIONS
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?;
    let Some(value) = storage.get_secret(RESET_KEY)? else {
        return Ok(());
    };
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| pin_error("MOBILE_PIN_STORAGE_INVALID"))?;
    let reset = MobilePinResetRecord::decode(bytes.as_slice())
        .map_err(|_| pin_error("MOBILE_PIN_STORAGE_INVALID"))?;
    if reset.expires_at_unix_ms <= now_ms() {
        return storage.remove_secret(RESET_KEY);
    }
    if reset.station_peer_id != station || reset.actor_ptid != actor {
        return Ok(());
    }
    let key = scope_key(station, actor);
    storage.remove_secret(&key)?;
    storage.remove_secret(RESET_KEY)?;
    locked_scopes()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .remove(&key);
    unlocked()
        .lock()
        .map_err(|_| pin_error("MOBILE_PIN_UNAVAILABLE"))?
        .insert(key);
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::oauth::SecretStore;

    #[derive(Default)]
    struct MemoryStore(Mutex<std::collections::HashMap<String, String>>);
    impl SecretStore for MemoryStore {
        fn set_secret(&self, key: &str, value: &str) -> MobileResult<()> {
            self.0
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
        fn get_secret(&self, key: &str) -> MobileResult<Option<String>> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn remove_secret(&self, key: &str) -> MobileResult<()> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn pin_reset_requires_newly_authenticated_exact_station_actor() {
        let storage = MemoryStore::default();
        let key = scope_key("station-a", "ptid:a");
        storage.set_secret(&key, "protected").unwrap();
        let reset = MobilePinResetRecord {
            station_peer_id: "station-a".to_string(),
            actor_ptid: "ptid:a".to_string(),
            expires_at_unix_ms: now_ms() + 600_000,
        };
        storage
            .set_secret(RESET_KEY, &STANDARD.encode(reset.encode_to_vec()))
            .unwrap();
        finish_reauthentication(&storage, "station-b", "ptid:a").unwrap();
        finish_reauthentication(&storage, "station-a", "ptid:b").unwrap();
        assert!(storage.get_secret(&key).unwrap().is_some());
        finish_reauthentication(&storage, "station-a", "ptid:a").unwrap();
        assert!(storage.get_secret(&key).unwrap().is_none());
        assert!(storage.get_secret(RESET_KEY).unwrap().is_none());
    }

    #[test]
    fn cooldown_survives_serialization_and_correct_pin_cannot_skip_it() {
        let mut record = new_record("345678").unwrap();
        for _ in 0..MAX_FAILURES {
            assert!(verify(&mut record, "000000", 1000).is_err());
        }
        let mut restored = MobilePinRecord::decode(record.encode_to_vec().as_slice()).unwrap();
        assert!(verify(&mut restored, "345678", 2000).is_err());
        assert!(verify(&mut restored, "345678", 301001).is_ok());
        assert_eq!(restored.failed_attempts, 0);
        assert_eq!(restored.locked_until_unix_ms, 0);
    }

    #[test]
    fn pins_are_numeric_and_scopes_are_station_actor_bound() {
        assert!(new_record("123").is_err());
        assert!(new_record("12ab").is_err());
        assert_ne!(
            scope_key("station-a", "ptid:a"),
            scope_key("station-b", "ptid:a")
        );
        assert_ne!(
            scope_key("station-a", "ptid:a"),
            scope_key("station-a", "ptid:b")
        );
    }
}
