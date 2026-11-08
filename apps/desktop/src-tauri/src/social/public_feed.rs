use base64::{engine::general_purpose::STANDARD, Engine as _};
use libp2p_identity::Keypair;
use prost::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use station_trust::feed_log::{self as feed, proto::*};
use tauri::{State, Window};
use zeroize::Zeroizing;

use crate::domain::crypto::load_identity_key;
use crate::infrastructure::local_scope::LocalScope;
use crate::state::AppState;
use super::public_feed_store::PublicFeedStore;

struct PreparedFeed {
    store: PublicFeedStore,
    bundle: FeedBundle,
    root: Vec<u8>,
    actor: String,
    account: String,
    device: String,
    key_id: String,
    token: String,
    scope: crate::application::station_runtime::client::StationRequestScope,
    engine: Arc<crate::messaging::MessagingEngine>,
}

#[derive(Deserialize)]
pub struct PublicFeedPrepareInput {
    pub command_id: String,
    pub kind: i32,
    /// Canonical FeedPayload bytes. Renderer supplies intent only; native
    /// resolves identity, allocates sequence, persists and signs the event.
    pub payload_b64: String,
}

#[derive(Deserialize)]
pub struct PublicFeedSubmitInput {
    pub command_id: String,
    pub kind: i32,
    pub payload_b64: String,
}

fn now_ms() -> Result<i64, String> {
    Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "FEED_INVALID")?.as_millis().try_into().map_err(|_| "FEED_INVALID")?)
}

fn prepare(state: &AppState, window: &Window, input: &PublicFeedPrepareInput)
    -> Result<PreparedFeed, String> {
    let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
    let active = state.sessions.get(window.label()).ok_or("FEED_AUTHENTICATION_REQUIRED")?;
    if active.jwt.is_empty() { return Err("FEED_AUTHENTICATION_REQUIRED".into()); }
    let scope = state.station.client().active_scope().ok_or("FEED_STATION_REQUIRED")?;
    let actor = active.actor.ptid.clone();
    let engine = state.messaging_engines.get(&active.account_id)?.ok_or("FEED_DEVICE_REQUIRED")?;
    if engine.endpoint().ptid != actor { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
    let device = engine.endpoint().device_id.clone();
    let enrollment = engine.store().device_enrollment()?.ok_or("FEED_DEVICE_REQUIRED")?;
    let identity = load_identity_key(&LocalScope::from_actor_ptid(&actor).identity_key_ref())
        .map_err(|e| e.to_string())?.ok_or("FEED_IDENTITY_REQUIRED")?;
    let root = identity.verifying_key.to_bytes().to_vec();
    if enrollment.certificate.actor_identity_public_key != root {
        return Err("FEED_WRITER_NOT_AUTHORIZED".into());
    }
    let (key_id, signing_key) = engine.device_signing_identity()?.ok_or("FEED_DEVICE_REQUIRED")?;
    if enrollment.certificate.device_signing_public_key != signing_key.verifying_key().to_bytes() ||
        enrollment.certificate.signing_key_id != key_id {
        return Err("FEED_WRITER_NOT_AUTHORIZED".into());
    }
    let seed = Zeroizing::new(signing_key.to_bytes());
    let writer = Keypair::ed25519_from_bytes(*seed).map_err(|_| "FEED_DEVICE_REQUIRED")?;
    let mut store = PublicFeedStore::open(&actor)?;
    let now = now_ms()?;
    if let Some(bundle) = store.authorization(&actor, &root)? {
        let grant = bundle.writer_grant.as_ref().and_then(|g| g.statement.as_ref()).ok_or("FEED_INVALID")?;
        if grant.device_id != device || grant.signing_key_id != key_id ||
            grant.device_public_key != signing_key.verifying_key().to_bytes() {
            return Err("FEED_WRITER_NOT_AUTHORIZED".into());
        }
    } else {
        let actor_seed = Zeroizing::new(identity.seed_bytes());
        let root_key = Keypair::ed25519_from_bytes(*actor_seed).map_err(|_| "FEED_IDENTITY_REQUIRED")?;
        let genesis = feed::sign_genesis(FeedGenesisStatement{
            format_version: 1, actor_ptid: actor.clone(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
            actor_identity_public_key: root.clone(),
        }, &root_key).map_err(|e| e.to_string())?;
        let grant = feed::sign_grant(FeedWriterGrantStatement{
            format_version: 1, actor_ptid: actor.clone(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
            genesis_hash: feed::hash(feed::GENESIS_DOMAIN, &genesis).map_err(|e| e.to_string())?,
            device_id: device.clone(), signing_key_id: key_id.clone(),
            device_public_key: signing_key.verifying_key().to_bytes().to_vec(),
        }, &root_key).map_err(|e| e.to_string())?;
        store.initialize(&genesis, &grant, &actor, &root)?;
    }
    let payload: FeedPayload = feed::decode_canonical(
        &STANDARD.decode(&input.payload_b64).map_err(|_| "FEED_INVALID")?).map_err(|e| e.to_string())?;
    validate_session(state, window, &actor, &active.account_id, &active.jwt, &device, &key_id, &scope)?;
    let bundle = store.stage(&actor, &root, &input.command_id, input.kind, &payload, now, &writer)?;
    Ok(PreparedFeed{store, bundle, root, actor, account: active.account_id.clone(),
        device, key_id, token: active.jwt.clone(), scope, engine})
}

fn validate_prepared(state: &AppState, window: &Window, p: &PreparedFeed) -> Result<(), String> {
    validate_session(state, window, &p.actor, &p.account, &p.token, &p.device, &p.key_id, &p.scope)?;
    let current = state.messaging_engines.get(&p.account)?.ok_or("FEED_SESSION_CHANGED")?;
    if !Arc::ptr_eq(&current, &p.engine) {
        return Err("FEED_SESSION_CHANGED".into());
    }
    Ok(())
}

fn validate_session(state: &AppState, window: &Window, actor: &str, account: &str,
    token: &str, device: &str, key_id: &str,
    scope: &crate::application::station_runtime::client::StationRequestScope) -> Result<(), String> {
    let current = state.sessions.get(window.label()).ok_or("FEED_SESSION_CHANGED")?;
    let current_scope = state.station.client().active_scope().ok_or("FEED_SESSION_CHANGED")?;
    if current.actor.ptid != actor || current.account_id != account || current.jwt != token ||
        current_scope.station_peer_id != scope.station_peer_id ||
        current_scope.lifecycle_generation != scope.lifecycle_generation {
        return Err("FEED_SESSION_CHANGED".into());
    }
    let engine = state.messaging_engines.get(account)?.ok_or("FEED_SESSION_CHANGED")?;
    if engine.endpoint().ptid != actor || engine.endpoint().device_id != device ||
        engine.device_signing_identity()?.map(|(id, _)| id).as_deref() != Some(key_id) {
        return Err("FEED_SESSION_CHANGED".into());
    }
    Ok(())
}

fn decode_submit_response(envelope: crate::model::common::PeersResponse)
    -> Result<SubmitFeedEventResponse, String> {
    if envelope.code != "200" { return Err("FEED_INVALID_RESPONSE".into()); }
    let any = envelope.data.ok_or("FEED_INVALID_RESPONSE")?;
    if any.type_url != "type.googleapis.com/peers_touch.model.social.feed.v1.SubmitFeedEventResponse" {
        return Err("FEED_INVALID_RESPONSE".into());
    }
    feed::decode_canonical(&any.value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn social_public_feed_prepare(state: State<'_, Arc<AppState>>, window: Window,
    input: PublicFeedPrepareInput) -> Result<Value, String> {
    let PreparedFeed{bundle, ..} = prepare(&state, &window, &input)?;
    Ok(json!({"commandId": input.command_id, "bundleB64": STANDARD.encode(bundle.encode_to_vec()),
        "sequence": bundle.events[0].statement.as_ref().ok_or("FEED_INVALID")?.sequence.to_string(),
        "state": "PENDING_SUBMISSION"}))
}

#[tauri::command]
pub fn social_public_feed_submit(state: State<'_, Arc<AppState>>, window: Window,
    input: PublicFeedSubmitInput) -> Result<Value, String> {
    let prepared = PublicFeedPrepareInput{command_id: input.command_id.clone(), kind: input.kind, payload_b64: input.payload_b64};
    let mut p = prepare(&state, &window, &prepared)?;
    let client = state.station.client();
    {
        let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
        validate_prepared(&state, &window, &p)?;
    }
    let response: crate::model::common::PeersResponse = client.request_proto_for_device(
        reqwest::Method::POST, "/api/v1/social/feed/events/submit", &p.token, None,
        Some(&SubmitFeedEventRequest{bundle: Some(p.bundle.clone())}), &p.device).map_err(|e| e.to_string())?;
    // Network success may arrive after logout, account switch, device restart
    // or Station replacement. Such an ACK cannot touch the new session.
    let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
    validate_prepared(&state, &window, &p)?;
    let response = decode_submit_response(response)?;
    let head = response.head.as_ref().ok_or("FEED_INVALID")?;
    p.store.confirm(&p.actor, &p.root, &input.command_id, head)?;
    Ok(json!({"commandId": input.command_id, "state": "COMMITTED", "duplicate": response.duplicate,
        "headB64": STANDARD.encode(head.encode_to_vec()), "sequence": head.sequence.to_string(),
        "bundleB64": STANDARD.encode(p.bundle.encode_to_vec()), "homeStationPeerId": p.scope.station_peer_id}))
}

/// Reopen retained intent after a process restart or a lost ACK. Returning the
/// original payload/command lets submit reuse the exact journal event.
#[tauri::command]
pub fn social_public_feed_status(state: State<'_, Arc<AppState>>, window: Window) -> Result<Value, String> {
    let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
    let active = state.sessions.get(window.label()).ok_or("FEED_AUTHENTICATION_REQUIRED")?;
    if active.jwt.is_empty() { return Err("FEED_AUTHENTICATION_REQUIRED".into()); }
    let actor = &active.actor.ptid;
    let identity = load_identity_key(&LocalScope::from_actor_ptid(actor).identity_key_ref())
        .map_err(|e| e.to_string())?.ok_or("FEED_IDENTITY_REQUIRED")?;
    let root = identity.verifying_key.to_bytes();
    let store = PublicFeedStore::open(actor)?;
    if store.authorization(actor, &root)?.is_none() {
        return Ok(json!({"state": "NOT_INITIALIZED", "pending": []}));
    }
    let head = store.head(actor)?;
    let pending: Vec<Value> = store.pending(actor, &root)?.into_iter().map(|(command, event)| {
        json!({"commandId": command, "kind": event.statement.as_ref().map(|s| s.kind),
            "payloadB64": STANDARD.encode(&event.payload), "eventB64": STANDARD.encode(event.encode_to_vec()),
            "state": "PENDING_SUBMISSION"})
    }).collect();
    Ok(json!({"headB64": STANDARD.encode(head.encode_to_vec()), "sequence": head.sequence.to_string(), "pending": pending}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_success_with_the_exact_submit_envelope_is_decoded() {
        let payload = SubmitFeedEventResponse{head: Some(FeedHead{
            actor_ptid: "actor".into(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
            sequence: 1, event_hash: vec![1; 32]}), duplicate: false};
        let envelope = crate::model::common::PeersResponse{
            code: "200".into(), msg: String::new(), data: Some(prost_types::Any{
                type_url: "type.googleapis.com/peers_touch.model.social.feed.v1.SubmitFeedEventResponse".into(),
                value: payload.encode_to_vec()})};
        assert_eq!(decode_submit_response(envelope.clone()).unwrap(), payload);
        let mut invalid = envelope.clone();
        invalid.code = "409".into();
        assert!(decode_submit_response(invalid).is_err());
        let mut invalid = envelope.clone();
        invalid.data.as_mut().unwrap().type_url = "type.googleapis.com/other.Response".into();
        assert!(decode_submit_response(invalid).is_err());
        let mut invalid = envelope;
        invalid.data.as_mut().unwrap().value.extend_from_slice(&[0x28, 1]);
        assert!(decode_submit_response(invalid).is_err());
    }
}
