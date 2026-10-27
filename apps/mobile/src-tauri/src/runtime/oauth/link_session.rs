//! Device Link uses the existing native Session owner. Staging does not change
//! its current index, active credential or public projection.
use prost::Message;
use zeroize::Zeroizing;

use super::{
    access_gate::{validated_submit_request, NativeAccessSubmitInput},
    load_existing_identity, oauth_error, read_json, scoped_key,
    session::NativeSessionProjection,
    write_json, write_public_projection, OAuthPublicPhase, OAuthPublicProjection, OAuthScopeIntent,
    OAuthSessionProjection, PersistedNativeSession, SecretStore, ValidatedScope,
    CURRENT_SESSION_INDEX_KEY, SESSION_KEY_PREFIX,
};
use crate::{error::MobileResult, platform::secure_storage::SecureStorage};

const PENDING: &str = "oauth.session.device-link.pending";

pub(crate) fn submission(
    storage: &SecureStorage,
    input: NativeAccessSubmitInput,
) -> MobileResult<super::proto::access_gate::v1::SubmitAccessGateRequest> {
    let scope = ValidatedScope::new(OAuthScopeIntent {
        station_origin: input.station_origin.clone(),
        station_peer_id: input.station_peer_id.clone(),
    })?;
    let identity = load_existing_identity(storage)?;
    let id = input.submission_id.clone();
    validated_submit_request(input, &scope, &identity, &id)
}

pub(crate) fn stage<S: SecretStore>(
    storage: &S,
    scope: OAuthScopeIntent,
    delivery_id: &str,
    login: &schema_core::proto::peers_touch::model::auth::v1::LoginResponse,
) -> MobileResult<()> {
    let scope = ValidatedScope::new(scope)?;
    let identity = load_existing_identity(storage)?;
    let bytes = Zeroizing::new(login.encode_to_vec());
    let login = super::proto::auth::v1::LoginResponse::decode(bytes.as_slice())
        .map_err(|_| oauth_error("deviceLinkCredentialInvalid"))?;
    let tokens = login
        .tokens
        .ok_or_else(|| oauth_error("deviceLinkCredentialInvalid"))?;
    if delivery_id.is_empty()
        || login.session_id.is_empty()
        || login.actor_ref.as_ref().is_none_or(|a| a.ptid.is_empty())
        || tokens.access_token.is_empty()
        || tokens.token_type != "Bearer"
        || tokens
            .expires_at
            .parse::<prost_types::Timestamp>()
            .ok()
            .and_then(|t| super::timestamp_to_unix_ms(Some(&t)).ok())
            .is_none_or(|t| t <= super::now_unix_ms())
    {
        return Err(oauth_error("deviceLinkCredentialInvalid"));
    }
    let session = PersistedNativeSession {
        station_peer_id: scope.station_peer_id,
        station_origin: scope.station_origin,
        device_id: identity.device_id,
        lifecycle_generation: identity.generation,
        candidate_id: format!("device-link:{delivery_id}"),
        session_id: login.session_id,
        actor_ptid: login.actor_ref.unwrap().ptid,
        legacy_token: String::new(),
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: tokens.expires_at,
        acknowledged: false,
    };
    write_json(storage, PENDING, &session)?;
    let readback = read_json::<_, PersistedNativeSession>(storage, PENDING)?
        .ok_or_else(|| oauth_error("deviceLinkPersistenceFailed"))?;
    if readback.session_id != session.session_id
        || readback.candidate_id != session.candidate_id
        || readback.access_token != session.access_token
        || readback.acknowledged
    {
        return Err(oauth_error("deviceLinkPersistenceFailed"));
    }
    Ok(())
}

pub(crate) fn commit<S: SecretStore>(
    storage: &S,
    station: &str,
    actor: &str,
    delivery_id: &str,
    session_id: &str,
) -> MobileResult<NativeSessionProjection> {
    let identity = load_existing_identity(storage)?;
    let mut session = read_json::<_, PersistedNativeSession>(storage, PENDING)?
        .ok_or_else(|| oauth_error("deviceLinkPendingMissing"))?;
    if session.station_peer_id != station
        || session.actor_ptid != actor
        || session.device_id != identity.device_id
        || session.lifecycle_generation != identity.generation
        || session.candidate_id != format!("device-link:{delivery_id}")
        || session.session_id != session_id
    {
        return Err(oauth_error("deviceLinkSessionScopeMismatch"));
    }
    session.acknowledged = true;
    let key = scoped_key(
        SESSION_KEY_PREFIX,
        station,
        &identity.device_id,
        identity.generation,
    );
    // Keep the pending record until the caller has durably recorded completion.
    // Repeated commit after a crash writes exactly the same canonical Session.
    write_json(storage, &key, &session)?;
    storage.set_secret(CURRENT_SESSION_INDEX_KEY, &key)?;
    let projection = NativeSessionProjection {
        station_peer_id: station.to_string(),
        actor_ptid: actor.to_string(),
        session_id: session.session_id.clone(),
        device_id: session.device_id.clone(),
        lifecycle_generation: session.lifecycle_generation,
        expires_at: session.expires_at.clone(),
    };
    write_public_projection(
        storage,
        &OAuthPublicProjection {
            phase: OAuthPublicPhase::ActiveSession,
            station_peer_id: Some(station.to_string()),
            result: Some("DEVICE_LINK_COMMITTED".to_string()),
            session: Some(OAuthSessionProjection {
                actor_ptid: projection.actor_ptid.clone(),
                session_id: projection.session_id.clone(),
                device_id: projection.device_id.clone(),
                lifecycle_generation: projection.lifecycle_generation,
                expires_at: projection.expires_at.clone(),
            }),
            ..Default::default()
        },
    )?;
    Ok(projection)
}

pub(crate) fn discard<S: SecretStore>(storage: &S) -> MobileResult<()> {
    storage.remove_secret(PENDING)
}

pub(super) fn pending<S: SecretStore>(storage: &S) -> MobileResult<Option<PersistedNativeSession>> {
    read_json(storage, PENDING)
}

pub(crate) fn current<S: SecretStore>(
    storage: &S,
    scope: OAuthScopeIntent,
) -> MobileResult<Option<NativeSessionProjection>> {
    super::session::session_projection_inner(storage, scope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    struct Store(Mutex<HashMap<String, String>>);
    impl SecretStore for Store {
        fn set_secret(&self, key: &str, value: &str) -> MobileResult<()> {
            self.0.lock().unwrap().insert(key.into(), value.into());
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
    fn staged() -> Store {
        let store = Store::default();
        store
            .set_secret(super::super::DEVICE_ID_KEY, "installation")
            .unwrap();
        store
            .set_secret(super::super::AUTH_GENERATION_KEY, "7")
            .unwrap();
        store
            .set_secret(CURRENT_SESSION_INDEX_KEY, "previous-account")
            .unwrap();
        store
            .set_secret("previous-account", "previous-credential")
            .unwrap();
        let login = schema_core::proto::peers_touch::model::auth::v1::LoginResponse {
            session_id: "linked-session".into(),
            actor_ref: Some(
                schema_core::proto::peers_touch::model::actor::v1::ActorRef {
                    ptid: "actor".into(),
                    ..Default::default()
                },
            ),
            tokens: Some(
                schema_core::proto::peers_touch::model::auth::v1::AuthTokens {
                    access_token: "test-native-access".into(),
                    refresh_token: "test-native-refresh".into(),
                    token_type: "Bearer".into(),
                    expires_at: "2030-01-01T00:00:00Z".into(),
                    ..Default::default()
                },
            ),
        };
        stage(
            &store,
            OAuthScopeIntent {
                station_origin: "https://station.example".into(),
                station_peer_id: "station".into(),
            },
            "delivery",
            &login,
        )
        .unwrap();
        store
    }
    #[test]
    fn staged_link_preserves_previous_account_and_is_not_acknowledged() {
        let store = staged();
        assert_eq!(
            store
                .get_secret(CURRENT_SESSION_INDEX_KEY)
                .unwrap()
                .as_deref(),
            Some("previous-account")
        );
        let pending: PersistedNativeSession = read_json(&store, PENDING).unwrap().unwrap();
        assert!(!pending.acknowledged);
        discard(&store).unwrap();
        assert!(store.get_secret(PENDING).unwrap().is_none());
        assert_eq!(
            store.get_secret("previous-account").unwrap().as_deref(),
            Some("previous-credential")
        );
    }
    #[test]
    fn committed_link_reuses_exact_session_and_rejects_scope_or_generation_drift() {
        let store = staged();
        assert!(commit(
            &store,
            "other-station",
            "actor",
            "delivery",
            "linked-session"
        )
        .is_err());
        assert!(commit(
            &store,
            "station",
            "other-actor",
            "delivery",
            "linked-session"
        )
        .is_err());
        let first = commit(&store, "station", "actor", "delivery", "linked-session").unwrap();
        let retry = commit(&store, "station", "actor", "delivery", "linked-session").unwrap();
        assert_eq!(first, retry);
        assert_eq!(first.device_id, "installation");
        assert_eq!(first.lifecycle_generation, 7);
        assert!(!serde_json::to_string(&first)
            .unwrap()
            .contains("test-native"));
        store
            .set_secret(super::super::AUTH_GENERATION_KEY, "8")
            .unwrap();
        assert!(commit(&store, "station", "actor", "delivery", "linked-session").is_err());
    }
}
