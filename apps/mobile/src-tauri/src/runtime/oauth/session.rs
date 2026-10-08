use std::mem;

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use super::proto::auth::v1::LoginResponse;
use super::{
    clean_required, ensure_session_scope_matches, load_existing_identity, oauth_error,
    purge_oauth_secure_storage, read_json, scoped_key, write_json, write_public_projection,
    OAuthCoordinator, OAuthPublicPhase, OAuthPublicProjection, OAuthScopeIntent,
    OAuthSessionProjection, PersistedNativeSession, SecretStore, ValidatedScope,
    CURRENT_SESSION_INDEX_KEY, SESSION_KEY_PREFIX,
};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

const LEGACY_WEB_SESSION_KEY: &str = "peers-touch.mobile.auth-session.v1";
const LEGACY_WEB_ACTIVE_SCOPE_KEY: &str = "peers-touch.mobile.auth-active-scope.v1";
const LEGACY_WEB_SCOPED_SESSION_PREFIX: &str = "peers-touch.mobile.auth-session.v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWebSessionScope {
    station_peer_id: String,
    ptid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionProjection {
    pub station_peer_id: String,
    pub session_id: String,
    pub actor_ptid: String,
    pub device_id: String,
    pub lifecycle_generation: u64,
    pub expires_at: String,
}

pub(crate) struct AuthenticatedNativeSession {
    station_peer_id: String,
    station_origin: String,
    session_id: String,
    actor_ptid: String,
    device_id: String,
    lifecycle_generation: u64,
    access_token: Zeroizing<String>,
}

impl AuthenticatedNativeSession {
    pub(crate) fn station_peer_id(&self) -> &str {
        &self.station_peer_id
    }

    pub(crate) fn station_origin(&self) -> &str {
        &self.station_origin
    }

    pub(crate) fn actor_ptid(&self) -> &str {
        &self.actor_ptid
    }

    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn device_id(&self) -> &str {
        &self.device_id
    }

    pub(crate) fn lifecycle_generation(&self) -> u64 {
        self.lifecycle_generation
    }

    pub(crate) fn access_token(&self) -> &str {
        self.access_token.as_str()
    }
}

pub(crate) fn authenticated_native_session(
    storage: &SecureStorage,
    station_peer_id: &str,
    actor_ptid: &str,
    session_id: &str,
) -> MobileResult<AuthenticatedNativeSession> {
    authenticated_native_session_inner(storage, station_peer_id, actor_ptid, session_id)
}

impl OAuthCoordinator {
    pub fn session_projection(
        &self,
        storage: &SecureStorage,
        scope: OAuthScopeIntent,
    ) -> MobileResult<Option<NativeSessionProjection>> {
        let _operation = self.begin_operation()?;
        purge_legacy_web_session(storage)?;
        session_projection_inner(storage, scope)
    }

    pub async fn refresh_session(
        &self,
        storage: &SecureStorage,
        scope: OAuthScopeIntent,
    ) -> MobileResult<NativeSessionProjection> {
        let _operation = self.begin_operation()?;
        purge_legacy_web_session(storage)?;
        self.refresh_session_inner(storage, scope).await
    }

    async fn refresh_session_inner<S: SecretStore>(
        &self,
        storage: &S,
        scope: OAuthScopeIntent,
    ) -> MobileResult<NativeSessionProjection> {
        let scope = ValidatedScope::new(scope)?;
        let (storage_key, current) =
            read_bound_session(storage, &scope)?.ok_or_else(|| oauth_error("sessionMissing"))?;
        let transport_origin = scope.transport_origin()?;
        let response = self
            .transport
            .rotate_session(&transport_origin, &current.access_token)
            .await?;
        let refreshed = rotated_session(&current, response)?;
        persist_rotated_session(storage, &storage_key, &refreshed)?;
        Ok(refreshed.public_projection())
    }
}

impl PersistedNativeSession {
    fn public_projection(&self) -> NativeSessionProjection {
        NativeSessionProjection {
            station_peer_id: self.station_peer_id.clone(),
            session_id: self.session_id.clone(),
            actor_ptid: self.actor_ptid.clone(),
            device_id: self.device_id.clone(),
            lifecycle_generation: self.lifecycle_generation,
            expires_at: self.expires_at.clone(),
        }
    }
}

fn session_projection_inner<S: SecretStore>(
    storage: &S,
    scope: OAuthScopeIntent,
) -> MobileResult<Option<NativeSessionProjection>> {
    let scope = ValidatedScope::new(scope)?;
    Ok(read_bound_session(storage, &scope)?.map(|(_, session)| session.public_projection()))
}

pub(super) fn bound_session_id<S: SecretStore>(
    storage: &S,
    scope: &ValidatedScope,
) -> MobileResult<Option<String>> {
    Ok(read_bound_session(storage, scope)?.map(|(_, session)| session.session_id.clone()))
}

fn read_bound_session<S: SecretStore>(
    storage: &S,
    scope: &ValidatedScope,
) -> MobileResult<Option<(String, PersistedNativeSession)>> {
    let Some(storage_key) = storage.get_secret(CURRENT_SESSION_INDEX_KEY)? else {
        return Ok(None);
    };
    let storage_key = clean_required(storage_key, "currentSessionStorageKey")?;
    let identity = load_existing_identity(storage)?;
    let expected_key = scoped_key(
        SESSION_KEY_PREFIX,
        &scope.station_peer_id,
        &identity.device_id,
        identity.generation,
    );
    if storage_key != expected_key {
        return Err(oauth_error("sessionIndexScopeMismatch"));
    }
    let session = read_json::<_, PersistedNativeSession>(storage, &storage_key)?
        .ok_or_else(|| oauth_error("sessionIndexCorrupt"))?;
    ensure_session_scope_matches(&session, Some(&identity), scope)?;
    if !session.acknowledged
        || session.session_id.trim().is_empty()
        || session.actor_ptid.trim().is_empty()
        || session.access_token.is_empty()
        || session.expires_at.trim().is_empty()
    {
        return Err(oauth_error("sessionCredentialIncomplete"));
    }
    Ok(Some((storage_key, session)))
}

fn authenticated_native_session_inner<S: SecretStore>(
    storage: &S,
    station_peer_id: &str,
    actor_ptid: &str,
    session_id: &str,
) -> MobileResult<AuthenticatedNativeSession> {
    let station_peer_id = clean_required(station_peer_id.to_string(), "stationPeerId")?;
    let actor_ptid = clean_required(actor_ptid.to_string(), "actorPtid")?;
    let session_id = clean_required(session_id.to_string(), "sessionId")?;
    let identity = load_existing_identity(storage)?;
    let expected_key = scoped_key(
        SESSION_KEY_PREFIX,
        &station_peer_id,
        &identity.device_id,
        identity.generation,
    );
    let current_key = storage
        .get_secret(CURRENT_SESSION_INDEX_KEY)?
        .map(|value| clean_required(value, "currentSessionStorageKey"))
        .transpose()?
        .ok_or_else(|| oauth_error("sessionMissing"))?;
    if current_key != expected_key {
        return Err(oauth_error("sessionIndexScopeMismatch"));
    }
    let session = read_json::<_, PersistedNativeSession>(storage, &current_key)?
        .ok_or_else(|| oauth_error("sessionIndexCorrupt"))?;
    if session.station_peer_id != station_peer_id
        || session.actor_ptid != actor_ptid
        || session.session_id != session_id
        || session.device_id != identity.device_id
        || session.lifecycle_generation != identity.generation
        || session.access_token.is_empty()
        || !session.acknowledged
    {
        return Err(oauth_error("sessionTransportBindingMismatch"));
    }
    let canonical_origin = super::transport::validate_station_origin(&session.station_origin)?;
    if canonical_origin != session.station_origin {
        return Err(oauth_error("sessionTransportBindingMismatch"));
    }
    let station_origin = crate::runtime::station_route::active_transport_origin(
        &session.station_peer_id,
        &canonical_origin,
    )?;
    Ok(AuthenticatedNativeSession {
        station_peer_id: session.station_peer_id.clone(),
        station_origin,
        session_id: session.session_id.clone(),
        actor_ptid: session.actor_ptid.clone(),
        device_id: session.device_id.clone(),
        lifecycle_generation: session.lifecycle_generation,
        access_token: Zeroizing::new(session.access_token.clone()),
    })
}

pub(super) fn purge_legacy_web_session<S: SecretStore>(storage: &S) -> MobileResult<()> {
    if let Some(raw_scope) = storage.get_secret(LEGACY_WEB_ACTIVE_SCOPE_KEY)? {
        if let Ok(scope) = serde_json::from_str::<LegacyWebSessionScope>(&raw_scope) {
            let station_peer_id = legacy_scope_part(&scope.station_peer_id);
            let ptid = legacy_scope_part(&scope.ptid);
            if !station_peer_id.is_empty() && !ptid.is_empty() {
                storage.remove_secret(&format!(
                    "{LEGACY_WEB_SCOPED_SESSION_PREFIX}.{station_peer_id}.{ptid}"
                ))?;
            }
        }
        storage.remove_secret(LEGACY_WEB_ACTIVE_SCOPE_KEY)?;
    }
    storage.remove_secret(LEGACY_WEB_SESSION_KEY)
}

fn legacy_scope_part(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

pub(super) fn persist_access_gate_credential<S: SecretStore>(
    storage: &S,
    scope: &ValidatedScope,
    identity: &super::PersistedIdentity,
    submission_id: &str,
    mut response: LoginResponse,
) -> MobileResult<NativeSessionProjection> {
    let session_id = clean_required(mem::take(&mut response.session_id), "sessionId")?;
    let actor_ptid = response
        .actor_ref
        .take()
        .map(|actor| actor.ptid)
        .and_then(|ptid| {
            let ptid = ptid.trim().to_string();
            (!ptid.is_empty()).then_some(ptid)
        })
        .ok_or_else(|| oauth_error("accessGateSessionActorMissing"))?;
    let mut tokens = response
        .tokens
        .take()
        .ok_or_else(|| oauth_error("accessGateSessionCredentialMissing"))?;
    let mut legacy_token = mem::take(&mut tokens.token);
    let mut access_token = mem::take(&mut tokens.access_token);
    if access_token.is_empty() {
        access_token = mem::take(&mut legacy_token);
    }
    legacy_token.zeroize();
    if access_token.is_empty() {
        return Err(oauth_error("accessGateSessionAccessTokenMissing"));
    }
    let session = PersistedNativeSession {
        station_peer_id: scope.station_peer_id.clone(),
        station_origin: scope.station_origin.clone(),
        device_id: identity.device_id.clone(),
        lifecycle_generation: identity.generation,
        candidate_id: format!(
            "access:{}",
            clean_required(submission_id.to_string(), "submissionId")?
        ),
        session_id,
        actor_ptid,
        legacy_token: String::new(),
        access_token,
        refresh_token: mem::take(&mut tokens.refresh_token),
        token_type: clean_required(mem::take(&mut tokens.token_type), "tokenType")?,
        expires_at: clean_required(mem::take(&mut tokens.expires_at), "expiresAt")?,
        acknowledged: true,
    };
    let key = scoped_key(
        SESSION_KEY_PREFIX,
        &scope.station_peer_id,
        &identity.device_id,
        identity.generation,
    );
    let persist = || -> MobileResult<()> {
        write_json(storage, &key, &session)?;
        storage.set_secret(CURRENT_SESSION_INDEX_KEY, &key)?;
        write_public_projection(
            storage,
            &OAuthPublicProjection {
                phase: OAuthPublicPhase::ActiveSession,
                station_peer_id: Some(session.station_peer_id.clone()),
                result: Some("ACCESS_GATE_RESULT_GRANTED".to_string()),
                session: Some(OAuthSessionProjection {
                    session_id: session.session_id.clone(),
                    actor_ptid: session.actor_ptid.clone(),
                    device_id: session.device_id.clone(),
                    lifecycle_generation: session.lifecycle_generation,
                    expires_at: session.expires_at.clone(),
                }),
                ..OAuthPublicProjection::default()
            },
        )
    };
    if let Err(error) = persist() {
        let _ = purge_oauth_secure_storage(storage, None, Some(&key));
        return Err(error);
    }
    Ok(session.public_projection())
}

fn rotated_session(
    current: &PersistedNativeSession,
    mut response: LoginResponse,
) -> MobileResult<PersistedNativeSession> {
    let session_id = clean_required(mem::take(&mut response.session_id), "sessionId")?;
    let actor_ptid = response
        .actor_ref
        .take()
        .map(|actor| actor.ptid)
        .and_then(|ptid| {
            let ptid = ptid.trim().to_string();
            (!ptid.is_empty()).then_some(ptid)
        })
        .ok_or_else(|| oauth_error("sessionRefreshActorMissing"))?;
    if actor_ptid != current.actor_ptid {
        return Err(oauth_error("sessionRefreshIdentityMismatch"));
    }

    let mut tokens = response
        .tokens
        .take()
        .ok_or_else(|| oauth_error("sessionRefreshCredentialMissing"))?;
    let mut legacy_token = mem::take(&mut tokens.token);
    let mut access_token = mem::take(&mut tokens.access_token);
    if access_token.is_empty() {
        access_token = mem::take(&mut legacy_token);
    }
    legacy_token.zeroize();
    if access_token.is_empty() {
        return Err(oauth_error("sessionRefreshAccessTokenMissing"));
    }
    let refresh_token = mem::take(&mut tokens.refresh_token);
    let token_type = clean_required(mem::take(&mut tokens.token_type), "tokenType")?;
    let expires_at = clean_required(mem::take(&mut tokens.expires_at), "expiresAt")?;

    Ok(PersistedNativeSession {
        station_peer_id: current.station_peer_id.clone(),
        station_origin: current.station_origin.clone(),
        device_id: current.device_id.clone(),
        lifecycle_generation: current.lifecycle_generation,
        candidate_id: current.candidate_id.clone(),
        session_id,
        actor_ptid,
        legacy_token: String::new(),
        access_token,
        refresh_token,
        token_type,
        expires_at,
        acknowledged: true,
    })
}

fn persist_rotated_session<S: SecretStore>(
    storage: &S,
    storage_key: &str,
    session: &PersistedNativeSession,
) -> MobileResult<()> {
    let persist = || -> MobileResult<()> {
        write_json(storage, storage_key, session)?;
        storage.set_secret(CURRENT_SESSION_INDEX_KEY, storage_key)?;
        write_public_projection(
            storage,
            &OAuthPublicProjection {
                phase: OAuthPublicPhase::ActiveSession,
                station_peer_id: Some(session.station_peer_id.clone()),
                result: Some("OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED".to_string()),
                session: Some(OAuthSessionProjection {
                    session_id: session.session_id.clone(),
                    actor_ptid: session.actor_ptid.clone(),
                    device_id: session.device_id.clone(),
                    lifecycle_generation: session.lifecycle_generation,
                    expires_at: session.expires_at.clone(),
                }),
                ..OAuthPublicProjection::default()
            },
        )
    };
    if let Err(error) = persist() {
        return match purge_oauth_secure_storage(storage, None, Some(storage_key)) {
            Ok(_) => Err(error),
            Err(_) => Err(MobileError::oauth(
                "mobile.auth.sessionRefreshPersistenceCleanupFailed",
            )),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::super::proto::actor::v1::ActorRef;
    use super::super::proto::auth::v1::AuthTokens;
    use super::super::{
        read_public_projection, PersistedIdentity, AUTH_GENERATION_KEY, DEVICE_ID_KEY,
    };
    use super::*;

    #[derive(Default)]
    struct MemoryStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for MemoryStore {
        fn set_secret(&self, key: &str, value: &str) -> MobileResult<()> {
            self.values
                .lock()
                .expect("memory store lock")
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get_secret(&self, key: &str) -> MobileResult<Option<String>> {
            Ok(self
                .values
                .lock()
                .expect("memory store lock")
                .get(key)
                .cloned())
        }

        fn remove_secret(&self, key: &str) -> MobileResult<()> {
            self.values.lock().expect("memory store lock").remove(key);
            Ok(())
        }
    }

    fn persisted_session() -> PersistedNativeSession {
        PersistedNativeSession {
            station_peer_id: "12D3KooWStation".to_string(),
            station_origin: "https://station.example:443".to_string(),
            device_id: "device-id".to_string(),
            lifecycle_generation: 7,
            candidate_id: "candidate".to_string(),
            session_id: "session-old".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            legacy_token: "legacy-old".to_string(),
            access_token: "access-old".to_string(),
            refresh_token: "refresh-old".to_string(),
            token_type: "Bearer".to_string(),
            expires_at: "2030-01-02T03:04:05Z".to_string(),
            acknowledged: true,
        }
    }

    fn rotation_response(actor_ptid: &str) -> LoginResponse {
        LoginResponse {
            tokens: Some(AuthTokens {
                token: "legacy-new".to_string(),
                access_token: "access-new".to_string(),
                refresh_token: "refresh-new".to_string(),
                token_type: "Bearer".to_string(),
                expires_at: "2030-02-03T04:05:06Z".to_string(),
            }),
            session_id: "session-new".to_string(),
            actor_ref: Some(ActorRef {
                ptid: actor_ptid.to_string(),
                ..ActorRef::default()
            }),
        }
    }

    #[test]
    fn rotation_preserves_scope_and_rejects_actor_replacement() {
        let current = persisted_session();
        let refreshed =
            rotated_session(&current, rotation_response("ptid:alice")).expect("refresh session");
        assert_eq!(refreshed.station_peer_id, current.station_peer_id);
        assert_eq!(refreshed.device_id, current.device_id);
        assert_eq!(refreshed.lifecycle_generation, current.lifecycle_generation);
        assert_eq!(refreshed.candidate_id, current.candidate_id);
        assert_eq!(refreshed.session_id, "session-new");
        assert_eq!(refreshed.access_token, "access-new");
        assert!(rotated_session(&current, rotation_response("ptid:bob")).is_err());
    }

    #[test]
    fn persisted_rotation_publishes_metadata_without_credentials() {
        let storage = MemoryStore::default();
        let identity = PersistedIdentity {
            device_id: "device-id".to_string(),
            generation: 7,
        };
        storage
            .set_secret(DEVICE_ID_KEY, &identity.device_id)
            .expect("persist device");
        storage
            .set_secret(AUTH_GENERATION_KEY, &identity.generation.to_string())
            .expect("persist generation");
        let key = scoped_key(
            SESSION_KEY_PREFIX,
            "12D3KooWStation",
            &identity.device_id,
            identity.generation,
        );
        let refreshed = rotated_session(&persisted_session(), rotation_response("ptid:alice"))
            .expect("refresh session");
        persist_rotated_session(&storage, &key, &refreshed).expect("persist rotation");

        let scope = OAuthScopeIntent {
            station_origin: "https://station.example".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
        };
        let projection = session_projection_inner(&storage, scope)
            .expect("read projection")
            .expect("active projection");
        assert_eq!(projection.session_id, "session-new");
        assert_eq!(projection.device_id, identity.device_id);
        assert_eq!(projection.lifecycle_generation, identity.generation);
        let serialized = serde_json::to_string(&projection).expect("serialize projection");
        assert!(!serialized.contains("access-new"));
        assert!(!serialized.contains("refresh-new"));
        assert!(!serialized.contains("legacy-new"));

        let oauth_projection = read_public_projection(&storage).expect("read oauth projection");
        assert_eq!(oauth_projection.phase, OAuthPublicPhase::ActiveSession);
        let public_session = oauth_projection.session.expect("public session");
        assert_eq!(public_session.actor_ptid, "ptid:alice");
        assert_eq!(public_session.device_id, identity.device_id);
        assert_eq!(public_session.lifecycle_generation, identity.generation);
    }

    #[test]
    fn authenticated_transport_session_requires_exact_native_binding() {
        let storage = MemoryStore::default();
        storage
            .set_secret(DEVICE_ID_KEY, "device-id")
            .expect("persist device");
        storage
            .set_secret(AUTH_GENERATION_KEY, "7")
            .expect("persist generation");
        let key = scoped_key(SESSION_KEY_PREFIX, "12D3KooWStation", "device-id", 7);
        write_json(&storage, &key, &persisted_session()).expect("persist session");
        storage
            .set_secret(CURRENT_SESSION_INDEX_KEY, &key)
            .expect("persist session index");

        let session = authenticated_native_session_inner(
            &storage,
            "12D3KooWStation",
            "ptid:alice",
            "session-old",
        )
        .expect("load authenticated session");
        assert_eq!(session.station_peer_id(), "12D3KooWStation");
        assert_eq!(session.station_origin(), "https://station.example:443");
        assert_eq!(session.actor_ptid(), "ptid:alice");
        assert_eq!(session.device_id(), "device-id");
        assert_eq!(session.lifecycle_generation(), 7);
        assert_eq!(session.access_token(), "access-old");

        assert!(authenticated_native_session_inner(
            &storage,
            "12D3KooWStation",
            "ptid:bob",
            "session-old",
        )
        .is_err());
        assert!(authenticated_native_session_inner(
            &storage,
            "12D3KooWStation",
            "ptid:alice",
            "session-stale",
        )
        .is_err());
    }

    #[test]
    fn native_session_read_removes_legacy_web_credential_records() {
        let storage = MemoryStore::default();
        storage
            .set_secret(
                LEGACY_WEB_ACTIVE_SCOPE_KEY,
                r#"{"stationPeerId":"station-a","ptid":"ptid:alice"}"#,
            )
            .expect("persist legacy scope");
        storage
            .set_secret(
                "peers-touch.mobile.auth-session.v1.station-a.ptid_alice",
                "legacy-secret",
            )
            .expect("persist scoped legacy credential");
        storage
            .set_secret(LEGACY_WEB_SESSION_KEY, "legacy-secret")
            .expect("persist legacy credential");

        purge_legacy_web_session(&storage).expect("purge legacy web credentials");

        assert!(storage
            .get_secret(LEGACY_WEB_ACTIVE_SCOPE_KEY)
            .expect("read scope")
            .is_none());
        assert!(storage
            .get_secret("peers-touch.mobile.auth-session.v1.station-a.ptid_alice")
            .expect("read scoped credential")
            .is_none());
        assert!(storage
            .get_secret(LEGACY_WEB_SESSION_KEY)
            .expect("read legacy credential")
            .is_none());
    }

    #[test]
    fn password_gate_credential_is_native_only_and_reuses_session_projection() {
        let storage = MemoryStore::default();
        let identity = PersistedIdentity {
            device_id: "device-id".to_string(),
            generation: 7,
        };
        storage
            .set_secret(DEVICE_ID_KEY, &identity.device_id)
            .expect("persist device");
        storage
            .set_secret(AUTH_GENERATION_KEY, &identity.generation.to_string())
            .expect("persist generation");
        let scope = ValidatedScope::new(OAuthScopeIntent {
            station_origin: "https://station.example".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
        })
        .expect("scope");

        let projection = persist_access_gate_credential(
            &storage,
            &scope,
            &identity,
            "submission-a",
            rotation_response("ptid:alice"),
        )
        .expect("persist password credential");
        assert_eq!(projection.session_id, "session-new");
        assert_eq!(projection.device_id, identity.device_id);
        assert_eq!(projection.lifecycle_generation, identity.generation);
        let public = serde_json::to_string(&projection).expect("serialize projection");
        assert!(!public.contains("access-new"));
        assert!(!public.contains("refresh-new"));

        let index = storage
            .get_secret(CURRENT_SESSION_INDEX_KEY)
            .expect("read index")
            .expect("session index");
        let stored: PersistedNativeSession = read_json(&storage, &index)
            .expect("read credential")
            .expect("stored credential");
        assert_eq!(stored.access_token, "access-new");
        assert!(stored.acknowledged);
    }
}
