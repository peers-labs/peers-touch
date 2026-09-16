pub mod adapter;
pub mod recovery;
pub mod station_trust;
pub mod store;
pub mod worker;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::Duration;

use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use secure_content_core::object::ObjectTransferControl;
use tauri::Manager;
use ulid::Ulid;
use zeroize::Zeroize;

use self::station_trust::TrustedStationSigningKey;
use self::store::SecureContentStore;

const TEARDOWN_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SecureContentSessionKey {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub device_id: String,
    pub jwt_session_id: String,
    pub window_label: String,
    pub session_generation: u64,
}

pub struct SecureContentSession {
    pub key: SecureContentSessionKey,
    pub account_id: String,
    pub station_url: String,
    pub signing_key_id: String,
    pub profile_version: u64,
    pub trusted_station_signing_key: TrustedStationSigningKey,
    cancellation_requested: AtomicBool,
    secrets: RwLock<SecureContentSessionSecrets>,
    requests: Mutex<SecureContentRequestState>,
    requests_drained: Condvar,
}

struct SecureContentSessionSecrets {
    token: String,
    signing_key: Option<SigningKey>,
}

struct SecureContentRequestState {
    accepting: bool,
    active: usize,
}

struct SecureContentRequestSecrets {
    token: String,
    signing_key: Option<SecureContentRequestSigningKey>,
}

struct SecureContentRequestSigningKey {
    verifying_key: VerifyingKey,
}

impl SecureContentRequestSigningKey {
    fn verifying_key(&self) -> VerifyingKey {
        self.verifying_key
    }
}

pub struct SecureContentRequestGuard<'a> {
    secrets: SecureContentRequestSecrets,
    session: &'a SecureContentSession,
}

impl SecureContentRequestGuard<'_> {
    pub fn token(&self) -> &str {
        &self.secrets.token
    }
}

impl Drop for SecureContentRequestGuard<'_> {
    fn drop(&mut self) {
        self.secrets.zeroize();
        self.session.finish_request();
    }
}

impl Drop for SecureContentSessionSecrets {
    fn drop(&mut self) {
        self.token.zeroize();
        self.signing_key.take();
    }
}

impl SecureContentRequestSecrets {
    fn zeroize(&mut self) {
        self.token.zeroize();
        self.signing_key.take();
    }
}

impl Drop for SecureContentRequestSecrets {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl SecureContentSession {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        key: SecureContentSessionKey,
        account_id: String,
        station_url: String,
        token: String,
        signing_key_id: String,
        profile_version: u64,
        signing_key: SigningKey,
        trusted_station_signing_key: TrustedStationSigningKey,
    ) -> Self {
        Self {
            key,
            account_id,
            station_url,
            signing_key_id,
            profile_version,
            trusted_station_signing_key,
            cancellation_requested: AtomicBool::new(false),
            secrets: RwLock::new(SecureContentSessionSecrets {
                token,
                signing_key: Some(signing_key),
            }),
            requests: Mutex::new(SecureContentRequestState {
                accepting: true,
                active: 0,
            }),
            requests_drained: Condvar::new(),
        }
    }

    pub fn begin_request(&self) -> Result<SecureContentRequestGuard<'_>, String> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| "secure content request lock poisoned".to_string())?;
        if !requests.accepting || self.cancellation_requested.load(Ordering::Acquire) {
            return Err("secure content session is cancelled".to_string());
        }
        let secrets = self
            .secrets
            .read()
            .map_err(|_| "secure content session secret lock poisoned".to_string())?;
        if self.cancellation_requested.load(Ordering::Acquire)
            || secrets.token.trim().is_empty()
            || secrets.signing_key.is_none()
        {
            return Err("secure content session is cancelled".to_string());
        }
        let snapshot = SecureContentRequestSecrets {
            token: secrets.token.clone(),
            signing_key: secrets
                .signing_key
                .as_ref()
                .map(|key| SecureContentRequestSigningKey {
                    verifying_key: key.verifying_key(),
                }),
        };
        requests.active = requests
            .active
            .checked_add(1)
            .ok_or_else(|| "secure content request guard capacity exceeded".to_string())?;
        drop(secrets);
        drop(requests);
        Ok(SecureContentRequestGuard {
            secrets: snapshot,
            session: self,
        })
    }

    pub fn matches_token(&self, token: &str) -> Result<bool, String> {
        let secrets = self
            .secrets
            .read()
            .map_err(|_| "secure content session secret lock poisoned".to_string())?;
        Ok(!self.cancellation_requested.load(Ordering::Acquire) && secrets.token == token)
    }

    pub fn sign(&self, payload: &[u8]) -> Result<Vec<u8>, String> {
        if self.cancellation_requested.load(Ordering::Acquire) {
            return Err("secure content session is cancelled".to_string());
        }
        let secrets = self
            .secrets
            .read()
            .map_err(|_| "secure content session secret lock poisoned".to_string())?;
        if self.cancellation_requested.load(Ordering::Acquire) {
            return Err("secure content session is cancelled".to_string());
        }
        secrets
            .signing_key
            .as_ref()
            .map(|key| key.sign(payload).to_bytes().to_vec())
            .ok_or_else(|| "secure content signing key is unavailable".to_string())
    }

    fn cancel_and_zeroize(&self) {
        {
            let mut requests = self
                .requests
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            requests.accepting = false;
            self.cancellation_requested.store(true, Ordering::Release);
        }
        let mut secrets = self
            .secrets
            .write()
            .unwrap_or_else(|error| error.into_inner());
        secrets.token.zeroize();
        secrets.signing_key.take();
    }

    fn finish_request(&self) {
        let drained = {
            let mut requests = self
                .requests
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if requests.active == 0 {
                return;
            }
            requests.active -= 1;
            requests.active == 0
        };
        if drained {
            self.requests_drained.notify_all();
        }
    }

    fn wait_for_request_drain(&self, timeout: Duration) -> bool {
        let requests = self
            .requests
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (requests, _) = self
            .requests_drained
            .wait_timeout_while(requests, timeout, |requests| requests.active > 0)
            .unwrap_or_else(|error| error.into_inner());
        requests.active == 0
    }

    #[cfg(test)]
    fn is_cancelled(&self) -> bool {
        self.cancellation_requested.load(Ordering::Acquire)
    }

    #[cfg(test)]
    fn secrets_are_zeroized(&self) -> bool {
        let secrets = self
            .secrets
            .read()
            .unwrap_or_else(|error| error.into_inner());
        secrets.token.is_empty() && secrets.signing_key.is_none()
    }
}

impl Drop for SecureContentSession {
    fn drop(&mut self) {
        self.cancellation_requested.store(true, Ordering::Release);
        let secrets = self
            .secrets
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        secrets.token.zeroize();
        secrets.signing_key.take();
    }
}

#[derive(Clone)]
pub struct SecureContentLease {
    pub session: Arc<SecureContentSession>,
    pub store: Arc<SecureContentStore>,
    pub transfer_control: Arc<ObjectTransferControl>,
    pub renderer_generation: u64,
}

struct ActiveRuntime {
    lease: SecureContentLease,
}

pub struct SecureContentSupervisor {
    active: Mutex<HashMap<String, ActiveRuntime>>,
    active_publications: Mutex<HashSet<String>>,
    media_grants: Mutex<HashMap<String, PrivateMediaGrant>>,
    app_handle: RwLock<Option<tauri::AppHandle>>,
    lifecycle_epoch: AtomicU64,
    next_generation: AtomicU64,
}

struct PrivateMediaGrant {
    session_key: SecureContentSessionKey,
    path: std::path::PathBuf,
    media_type: String,
}

pub struct SecureContentPublishGuard<'a> {
    supervisor: &'a SecureContentSupervisor,
    key: String,
}

impl Drop for SecureContentPublishGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.supervisor.active_publications.lock() {
            active.remove(&self.key);
        }
    }
}

impl SecureContentSupervisor {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
            active_publications: Mutex::new(HashSet::new()),
            media_grants: Mutex::new(HashMap::new()),
            app_handle: RwLock::new(None),
            lifecycle_epoch: AtomicU64::new(1),
            next_generation: AtomicU64::new(1),
        }
    }

    pub fn bind_app_handle(&self, app_handle: tauri::AppHandle) {
        *self
            .app_handle
            .write()
            .unwrap_or_else(|error| error.into_inner()) = Some(app_handle);
    }

    fn app_handle(&self) -> Option<tauri::AppHandle> {
        self.app_handle
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn activate(
        &self,
        session: SecureContentSession,
        renderer_generation: u64,
    ) -> Result<SecureContentLease, String> {
        let lifecycle_epoch = self.lifecycle_epoch();
        self.activate_if_epoch(session, renderer_generation, lifecycle_epoch)
    }

    pub fn lifecycle_epoch(&self) -> u64 {
        self.lifecycle_epoch.load(Ordering::Acquire)
    }

    pub fn activate_if_epoch(
        &self,
        session: SecureContentSession,
        renderer_generation: u64,
        expected_lifecycle_epoch: u64,
    ) -> Result<SecureContentLease, String> {
        let store = Arc::new(SecureContentStore::open(&session.key.actor_ptid)?);
        self.activate_with_store_if_epoch(
            session,
            renderer_generation,
            store,
            expected_lifecycle_epoch,
        )
    }

    fn activate_with_store(
        &self,
        session: SecureContentSession,
        renderer_generation: u64,
        store: Arc<SecureContentStore>,
    ) -> Result<SecureContentLease, String> {
        let lifecycle_epoch = self.lifecycle_epoch();
        self.activate_with_store_if_epoch(session, renderer_generation, store, lifecycle_epoch)
    }

    fn activate_with_store_if_epoch(
        &self,
        mut session: SecureContentSession,
        renderer_generation: u64,
        store: Arc<SecureContentStore>,
        expected_lifecycle_epoch: u64,
    ) -> Result<SecureContentLease, String> {
        if renderer_generation == 0 {
            return Err("secure content renderer generation is required".to_string());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "secure content supervisor lock poisoned".to_string())?;
        let window_label = session.key.window_label.clone();
        if let Some(runtime) = active.get(&window_label) {
            if runtime.lease.session.key.station_peer_id == session.key.station_peer_id
                && runtime.lease.session.key.actor_ptid == session.key.actor_ptid
                && runtime.lease.session.key.device_id == session.key.device_id
                && runtime.lease.session.key.jwt_session_id == session.key.jwt_session_id
                && runtime.lease.renderer_generation == renderer_generation
            {
                return Ok(runtime.lease.clone());
            }
        }
        if self.lifecycle_epoch.load(Ordering::Acquire) != expected_lifecycle_epoch {
            return Err("secure content lifecycle changed during activation".to_string());
        }

        let generation = self.next_generation.fetch_add(1, Ordering::AcqRel);
        session.key.session_generation = generation;
        #[cfg(not(test))]
        {
            let actor_has_runtime = active
                .values()
                .any(|runtime| runtime.lease.session.key.actor_ptid == session.key.actor_ptid);
            if !actor_has_runtime {
                worker::clear_stale_plaintext_generations(&session.key.actor_ptid)?;
            }
        }
        store.bind_session_generation(generation)?;
        store.recover_orphaned_leases()?;
        let lease = SecureContentLease {
            session: Arc::new(session),
            store,
            transfer_control: Arc::new(ObjectTransferControl::new()),
            renderer_generation,
        };
        let previous = active.insert(
            window_label,
            ActiveRuntime {
                lease: lease.clone(),
            },
        );
        drop(active);
        if let Some(previous) = previous {
            retire_runtime(previous, self.app_handle().as_ref())?;
        }
        Ok(lease)
    }

    pub fn lease(
        &self,
        actor_ptid: &str,
        renderer_generation: u64,
        window_label: &str,
    ) -> Result<SecureContentLease, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "secure content supervisor lock poisoned".to_string())?;
        let lease = active
            .get(window_label)
            .map(|runtime| runtime.lease.clone())
            .ok_or_else(|| "secure content supervisor is not active".to_string())?;
        if lease.session.key.actor_ptid != actor_ptid
            || lease.session.key.window_label != window_label
            || lease.renderer_generation != renderer_generation
        {
            return Err("secure content session generation is stale".to_string());
        }
        Ok(lease)
    }

    pub fn is_current(&self, key: &SecureContentSessionKey) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|active| {
                active
                    .get(&key.window_label)
                    .map(|runtime| runtime.lease.session.key == *key)
            })
            .unwrap_or(false)
    }

    pub fn with_current<T>(
        &self,
        key: &SecureContentSessionKey,
        operation: impl FnOnce(&SecureContentLease) -> Result<T, String>,
    ) -> Result<T, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "secure content supervisor lock poisoned".to_string())?;
        let lease = active
            .get(&key.window_label)
            .map(|runtime| &runtime.lease)
            .filter(|lease| lease.session.key == *key)
            .ok_or_else(|| "secure content session generation is stale".to_string())?;
        operation(lease)
    }

    pub fn grant_private_media(
        &self,
        key: &SecureContentSessionKey,
        path: &std::path::Path,
        media_type: &str,
    ) -> Result<String, String> {
        let expected_root = std::fs::canonicalize(worker::secure_cache_dir(
            &key.actor_ptid,
            key.session_generation,
        )?)
        .map_err(|error| format!("resolve private Moment cache root: {error}"))?;
        let path = std::fs::canonicalize(path)
            .map_err(|error| format!("resolve private Moment media: {error}"))?;
        if !matches!(
            media_type,
            "image/jpeg" | "image/png" | "image/gif" | "image/webp"
        ) || !path.is_file()
            || !path.starts_with(&expected_root)
        {
            return Err("private Moment media grant input is invalid".to_string());
        }
        self.with_current(key, |_| {
            let grant_id = Ulid::new().to_string();
            self.media_grants
                .lock()
                .map_err(|_| "secure content media grant lock poisoned".to_string())?
                .insert(
                    grant_id.clone(),
                    PrivateMediaGrant {
                        session_key: key.clone(),
                        path,
                        media_type: media_type.to_string(),
                    },
                );
            Ok(grant_id)
        })
    }

    pub fn begin_private_publish(
        &self,
        key: &SecureContentSessionKey,
        draft_id: &str,
        draft_revision: u64,
    ) -> Result<SecureContentPublishGuard<'_>, String> {
        self.try_begin_private_publish(key, draft_id, draft_revision)?
            .ok_or_else(|| "private Moment publication is already in progress".to_string())
    }

    pub fn try_begin_private_publish(
        &self,
        key: &SecureContentSessionKey,
        draft_id: &str,
        draft_revision: u64,
    ) -> Result<Option<SecureContentPublishGuard<'_>>, String> {
        if draft_id.trim().is_empty() || draft_revision == 0 {
            return Err("private Moment draft identity is invalid".to_string());
        }
        self.with_current(key, |_| Ok(()))?;
        let operation_key = format!(
            "{}:{}:{}:{}",
            key.window_label, key.session_generation, draft_id, draft_revision
        );
        let mut active = self
            .active_publications
            .lock()
            .map_err(|_| "secure content publication lock poisoned".to_string())?;
        if !active.insert(operation_key.clone()) {
            return Ok(None);
        }
        Ok(Some(SecureContentPublishGuard {
            supervisor: self,
            key: operation_key,
        }))
    }

    pub fn revoke_private_media_path(
        &self,
        key: &SecureContentSessionKey,
        path: &std::path::Path,
    ) -> Result<(), String> {
        let mut grants = self
            .media_grants
            .lock()
            .map_err(|_| "secure content media grant lock poisoned".to_string())?;
        let canonical = std::fs::canonicalize(path).ok();
        grants.retain(|_, grant| {
            grant.session_key != *key
                || canonical
                    .as_ref()
                    .map_or(grant.path != path, |path| grant.path != *path)
        });
        Ok(())
    }

    pub fn read_private_media(
        &self,
        window_label: &str,
        grant_id: &str,
    ) -> Result<(Vec<u8>, String), String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "secure content supervisor lock poisoned".to_string())?;
        let lease = active
            .get(window_label)
            .map(|runtime| &runtime.lease)
            .ok_or_else(|| "secure content media authority is unavailable".to_string())?;
        let grants = self
            .media_grants
            .lock()
            .map_err(|_| "secure content media grant lock poisoned".to_string())?;
        let grant = grants
            .get(grant_id)
            .filter(|grant| grant.session_key == lease.session.key)
            .ok_or_else(|| "secure content media grant is stale".to_string())?;
        let bytes = std::fs::read(&grant.path)
            .map_err(|error| format!("read private Moment media: {error}"))?;
        Ok((bytes, grant.media_type.clone()))
    }

    pub fn teardown_actor(&self, actor_ptid: &str) -> Result<(), String> {
        let previous = {
            let mut active = self
                .active
                .lock()
                .map_err(|_| "secure content supervisor lock poisoned".to_string())?;
            let labels = active
                .iter()
                .filter_map(|(label, runtime)| {
                    (runtime.lease.session.key.actor_ptid == actor_ptid).then(|| label.clone())
                })
                .collect::<Vec<_>>();
            self.lifecycle_epoch.fetch_add(1, Ordering::AcqRel);
            let previous = labels
                .into_iter()
                .filter_map(|label| active.remove(&label))
                .collect::<Vec<_>>();
            if !previous.is_empty() {
                self.next_generation.fetch_add(1, Ordering::AcqRel);
            }
            previous
        };
        self.media_grants
            .lock()
            .map_err(|_| "secure content media grant lock poisoned".to_string())?
            .retain(|_, grant| grant.session_key.actor_ptid != actor_ptid);
        let mut errors = Vec::new();
        for runtime in previous {
            if let Err(error) = retire_runtime(runtime, self.app_handle().as_ref()) {
                errors.push(error);
            }
        }
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let previous = {
            let mut active = self
                .active
                .lock()
                .map_err(|_| "secure content supervisor lock poisoned".to_string())?;
            let previous = active
                .drain()
                .map(|(_, runtime)| runtime)
                .collect::<Vec<_>>();
            self.lifecycle_epoch.fetch_add(1, Ordering::AcqRel);
            self.next_generation.fetch_add(1, Ordering::AcqRel);
            previous
        };
        self.media_grants
            .lock()
            .map_err(|_| "secure content media grant lock poisoned".to_string())?
            .clear();
        let mut errors = Vec::new();
        for runtime in previous {
            if let Err(error) = retire_runtime(runtime, self.app_handle().as_ref()) {
                errors.push(error);
            }
        }
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        Ok(())
    }
}

fn retire_runtime(
    runtime: ActiveRuntime,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    runtime.lease.transfer_control.request_shutdown();
    runtime.lease.session.cancel_and_zeroize();
    let cache_dir = worker::secure_cache_dir(
        &runtime.lease.session.key.actor_ptid,
        runtime.lease.session.key.session_generation,
    );
    if let (Some(app_handle), Ok(cache_dir)) = (app_handle, cache_dir.as_ref()) {
        if let Err(error) = app_handle
            .asset_protocol_scope()
            .forbid_directory(cache_dir, true)
        {
            errors.push(format!(
                "revoke Secure Content asset scope during teardown: {error}"
            ));
        }
    }
    if !runtime
        .lease
        .session
        .wait_for_request_drain(TEARDOWN_DRAIN_TIMEOUT)
    {
        errors.push("secure content requests did not drain before teardown".to_string());
    }
    if let Err(error) = runtime
        .lease
        .store
        .checkpoint_session_generation(runtime.lease.session.key.session_generation)
    {
        errors.push(format!(
            "persist Secure Content ciphertext checkpoints during teardown: {error}"
        ));
    }
    let drained = runtime
        .lease
        .transfer_control
        .request_shutdown_and_wait(TEARDOWN_DRAIN_TIMEOUT);
    if !drained {
        errors.push("secure content object transfers did not drain before teardown".to_string());
    }
    match cache_dir {
        Ok(cache_dir) => match std::fs::remove_dir_all(cache_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("remove Secure Content plaintext cache: {error}")),
        },
        Err(error) => errors.push(format!("resolve Secure Content plaintext cache: {error}")),
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

impl Default for SecureContentSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::sync::mpsc;
    use std::thread;

    fn session(actor: &str) -> SecureContentSession {
        session_for_window(actor, "main")
    }

    fn session_for_window(actor: &str, window_label: &str) -> SecureContentSession {
        let trusted_station_signing_key = SigningKey::from_bytes(&[8; 32]);
        SecureContentSession::new(
            SecureContentSessionKey {
                station_peer_id: "station-1".to_string(),
                actor_ptid: actor.to_string(),
                device_id: "device-1".to_string(),
                jwt_session_id: "session-1".to_string(),
                window_label: window_label.to_string(),
                session_generation: 0,
            },
            "account-1".to_string(),
            "https://station.invalid".to_string(),
            "secret-token".to_string(),
            "signing-key-1".to_string(),
            1,
            SigningKey::from_bytes(&[7; 32]),
            TrustedStationSigningKey {
                key_id: "station-signing-key-1".to_string(),
                verifying_key: trusted_station_signing_key.verifying_key(),
            },
        )
    }

    #[test]
    fn secure_content_supervisor_fences_renderer_and_session_generations() {
        let supervisor = SecureContentSupervisor::new();
        let first = supervisor
            .activate_with_store(
                session("ptid:alice"),
                7,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        assert!(supervisor.is_current(&first.session.key));
        assert!(supervisor.lease("ptid:alice", 8, "main").is_err());
        assert!(supervisor.lease("ptid:alice", 7, "other").is_err());

        let second = supervisor
            .activate_with_store(
                session("ptid:alice"),
                8,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        assert!(second.session.key.session_generation > first.session.key.session_generation);
        assert!(first.session.is_cancelled());
        assert!(first.session.sign(b"stale").is_err());
        assert!(!supervisor.is_current(&first.session.key));
        assert!(supervisor.is_current(&second.session.key));
    }

    #[test]
    fn secure_content_supervisor_teardown_is_actor_scoped_and_idempotent() {
        let supervisor = SecureContentSupervisor::new();
        let lease = supervisor
            .activate_with_store(
                session("ptid:alice"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        supervisor.teardown_actor("ptid:bob").unwrap();
        assert!(supervisor.is_current(&lease.session.key));
        supervisor.teardown_actor("ptid:alice").unwrap();
        supervisor.teardown_actor("ptid:alice").unwrap();
        assert!(lease.session.is_cancelled());
        assert!(lease.session.begin_request().is_err());
        assert!(!supervisor.is_current(&lease.session.key));
    }

    #[test]
    fn secure_content_supervisor_keeps_independent_window_authorities() {
        let supervisor = SecureContentSupervisor::new();
        let alice = supervisor
            .activate_with_store(
                session_for_window("ptid:alice", "alice-window"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        let bob = supervisor
            .activate_with_store(
                session_for_window("ptid:bob", "bob-window"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();

        assert!(supervisor.is_current(&alice.session.key));
        assert!(supervisor.is_current(&bob.session.key));
        supervisor.teardown_actor("ptid:alice").unwrap();
        assert!(!supervisor.is_current(&alice.session.key));
        assert!(supervisor.is_current(&bob.session.key));
    }

    #[test]
    fn secure_content_current_gate_rejects_retired_generation() {
        let supervisor = SecureContentSupervisor::new();
        let first = supervisor
            .activate_with_store(
                session("ptid:alice"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        supervisor
            .activate_with_store(
                session("ptid:alice"),
                2,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();

        assert!(supervisor
            .with_current(&first.session.key, |_| Ok(()))
            .is_err());
    }

    #[test]
    fn secure_content_activation_rejects_a_pre_teardown_lifecycle_snapshot() {
        let supervisor = SecureContentSupervisor::new();
        let lifecycle_epoch = supervisor.lifecycle_epoch();

        supervisor.teardown_actor("ptid:alice").unwrap();

        assert!(supervisor
            .activate_with_store_if_epoch(
                session("ptid:alice"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
                lifecycle_epoch,
            )
            .is_err());
        assert!(supervisor.lease("ptid:alice", 1, "main").is_err());
    }

    #[test]
    fn secure_content_private_media_grant_is_window_and_generation_scoped() {
        let supervisor = SecureContentSupervisor::new();
        let alice_actor = format!("ptid:media-grant-alice:{}", Ulid::new());
        let bob_actor = format!("ptid:media-grant-bob:{}", Ulid::new());
        let alice = supervisor
            .activate_with_store(
                session_for_window(&alice_actor, "alice-window"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        supervisor
            .activate_with_store(
                session_for_window(&bob_actor, "bob-window"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        let path = worker::secure_cache_dir(
            &alice.session.key.actor_ptid,
            alice.session.key.session_generation,
        )
        .unwrap()
        .join(format!("{}.jpg", Ulid::new()));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"private-image").unwrap();
        let url = supervisor
            .grant_private_media(&alice.session.key, &path, "image/jpeg")
            .unwrap();
        let grant_id = url.rsplit('/').next().unwrap();

        assert_eq!(
            supervisor
                .read_private_media("alice-window", grant_id)
                .unwrap()
                .0,
            b"private-image"
        );
        assert!(supervisor
            .read_private_media("bob-window", grant_id)
            .is_err());
        supervisor.teardown_actor(&alice_actor).unwrap();
        assert!(supervisor
            .read_private_media("alice-window", grant_id)
            .is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn secure_content_publish_guard_serializes_one_draft_revision() {
        let supervisor = SecureContentSupervisor::new();
        let lease = supervisor
            .activate_with_store(
                session("ptid:alice"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        let guard = supervisor
            .begin_private_publish(&lease.session.key, "draft-1", 1)
            .unwrap();
        assert!(supervisor
            .begin_private_publish(&lease.session.key, "draft-1", 1)
            .is_err());
        assert!(supervisor
            .try_begin_private_publish(&lease.session.key, "draft-1", 1)
            .unwrap()
            .is_none());
        drop(guard);
        assert!(supervisor
            .begin_private_publish(&lease.session.key, "draft-1", 1)
            .is_ok());
    }

    #[test]
    fn secure_content_teardown_waits_for_request_guard_before_success() {
        let supervisor = Arc::new(SecureContentSupervisor::new());
        let lease = supervisor
            .activate_with_store(
                session("ptid:alice"),
                1,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        let request = lease.session.begin_request().unwrap();
        let worker = supervisor.clone();
        let (completed_tx, completed_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let result = worker.teardown_actor("ptid:alice");
            completed_tx.send(result).unwrap();
        });

        let cancellation_deadline = std::time::Instant::now() + Duration::from_secs(1);
        while !lease.session.is_cancelled() {
            assert!(
                std::time::Instant::now() < cancellation_deadline,
                "teardown did not stop request admission"
            );
            thread::yield_now();
        }
        assert!(lease.session.begin_request().is_err());
        assert!(
            completed_rx
                .recv_timeout(Duration::from_millis(100))
                .is_err(),
            "teardown succeeded while a request-held secret remained"
        );

        drop(request);
        let result = completed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("teardown did not finish after request guard drop");
        result.unwrap();
        assert!(lease.session.secrets_are_zeroized());
        handle.join().unwrap();
    }

    #[test]
    fn secure_content_teardown_checkpoints_in_flight_publication_as_unknown() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let request_bytes = b"canonical-publication".to_vec();
        store
            .persist_prekey_publication(
                &store::StoredPublication {
                    command_id: "cpk-pub-v1-teardown".to_string(),
                    key_kind: 1,
                    pool_epoch: 1,
                    request_sha256: Sha256::digest(&request_bytes).into(),
                    request_bytes,
                    state: store::PublicationState::PendingPublication,
                    lease_generation: 0,
                    session_generation: 0,
                },
                &[("key-1".to_string(), Some([7; 32]), [8; 32])],
            )
            .unwrap();
        let lease = supervisor
            .activate_with_store(session("ptid:alice"), 1, store.clone())
            .unwrap();
        store
            .acquire_publication("cpk-pub-v1-teardown", lease.session.key.session_generation)
            .unwrap();

        supervisor.teardown_actor("ptid:alice").unwrap();

        let pending = store.publications_requiring_reconciliation().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].state, store::PublicationState::UnknownCommit);
        assert!(store.endpoint_prekey("key-1").unwrap().is_some());
    }
}
