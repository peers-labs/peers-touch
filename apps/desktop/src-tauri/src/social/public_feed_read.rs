use base64::{engine::general_purpose::STANDARD, Engine as _};
use prost::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use station_trust::feed_log::{self as feed, proto::*};
use tauri::{State, Window};

use crate::model::actor::{ActorKind, ActorRef, GetActorEndpointManifestRequest, GetActorEndpointManifestResponse};
use crate::secure_content::station_trust::{resolve_station_signing_key_for_actor, verify_actor_identity_manifest};
use crate::state::AppState;
use super::public_feed_store::PublicFeedStore;

#[derive(Deserialize)]
pub struct PublicFeedReadInput {
    pub actor_ptid: String,
    /// Routing hint only. Identity is authenticated by the signed manifest's
    /// PTID and retained root, never by this renderer-provided handle.
    pub federated_handle: String,
    pub limit: u32,
    #[serde(default)]
    pub after_sequence: u64,
    #[serde(default)]
    pub after_thread_cursor: u64,
}

/// Returns original verified event bytes rather than trusting a Station's
/// mutable Moment projection. Renderer must reduce these events for display.
#[tauri::command]
pub fn social_public_feed_read(state: State<'_, Arc<AppState>>, window: Window,
    input: PublicFeedReadInput) -> Result<Value, String> {
    if input.limit == 0 || input.limit > 64 || input.actor_ptid.trim().is_empty() {
        return Err("FEED_INVALID".into());
    }
    let active = state.sessions.get(window.label()).ok_or("FEED_AUTHENTICATION_REQUIRED")?;
    if active.jwt.is_empty() { return Err("FEED_AUTHENTICATION_REQUIRED".into()); }
    let engine = state.messaging_engines.get(&active.account_id)?.ok_or("FEED_DEVICE_REQUIRED")?;
    let scope = state.station.client().active_scope().ok_or("FEED_STATION_REQUIRED")?;
    let client = state.station.client();
    let validate = || -> Result<(), String> {
        let current = state.sessions.get(window.label()).ok_or("FEED_SESSION_CHANGED")?;
        let current_engine = state.messaging_engines.get(&active.account_id)?.ok_or("FEED_SESSION_CHANGED")?;
        let current_scope = client.active_scope().ok_or("FEED_SESSION_CHANGED")?;
        if current.account_id != active.account_id || current.actor.ptid != active.actor.ptid ||
            current.jwt != active.jwt || !std::sync::Arc::ptr_eq(&engine, &current_engine) ||
            current_scope.station_peer_id != scope.station_peer_id ||
            current_scope.lifecycle_generation != scope.lifecycle_generation {
            return Err("FEED_SESSION_CHANGED".into());
        }
        Ok(())
    };
    let manifest: GetActorEndpointManifestResponse = client.request_proto_for_device(
        reqwest::Method::POST, "/actor/endpoint-manifest", &active.jwt, None,
        Some(&GetActorEndpointManifestRequest{actor: Some(ActorRef{
            ptid: input.actor_ptid.clone(), kind: ActorKind::Person as i32, ..Default::default()
        })}), &engine.endpoint().device_id).map_err(|e| e.to_string())?;
    validate()?;
    let manifest = manifest.manifest.ok_or("FEED_INVALID_RESPONSE")?;
    let home = &manifest.home_station_peer_id;
    let key = resolve_station_signing_key_for_actor(client, state.station.registry(), home,
        &input.federated_handle, &active.jwt, &engine.endpoint().device_id, Some(&input.actor_ptid))?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "FEED_INVALID")?.as_millis().try_into().map_err(|_| "FEED_INVALID")?;
    let root = verify_actor_identity_manifest(&manifest, &key, &input.actor_ptid, now)?;
    let mut store = PublicFeedStore::open(&active.actor.ptid)?;
    {
        let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
        validate()?;
        store.pin_actor(&input.actor_ptid, home, &root)?;
    }
    let previous = store.remote_head(&input.actor_ptid, &root, home)?;
    let request = ReadFeedRequest{actor_ptid: input.actor_ptid.clone(), chain_id: feed::PUBLIC_CHAIN_ID.into(),
        after_sequence: previous.as_ref().map_or(0, |h| h.sequence), limit: input.limit,
        include_thread: true, after_thread_cursor: store.thread_cursor(&input.actor_ptid)?};
    let envelope: crate::model::common::PeersResponse = client.request_proto_for_device(
        reqwest::Method::POST, "/api/v1/social/feed/read", &active.jwt, None,
        Some(&request), &engine.endpoint().device_id).map_err(|e| e.to_string())?;
    if envelope.code != "200" { return Err("FEED_INVALID_RESPONSE".into()); }
    let any = envelope.data.ok_or("FEED_INVALID_RESPONSE")?;
    if any.type_url != "type.googleapis.com/peers_touch.model.social.feed.v1.ReadFeedResponse" {
        return Err("FEED_INVALID_RESPONSE".into());
    }
    let response: ReadFeedResponse = feed::decode_canonical(&any.value).map_err(|e| e.to_string())?;
    if response.thread_entries.len() > 32 { return Err("FEED_INVALID_RESPONSE".into()); }
    let mut roots = std::collections::BTreeMap::new();
    let mut pins = Vec::new();
    for entry in &response.thread_entries {
        let actor = &entry.receipt.as_ref().and_then(|r| r.event.as_ref())
            .and_then(|e| e.statement.as_ref()).ok_or("FEED_INVALID_RESPONSE")?.actor_ptid;
        if roots.contains_key(actor) { continue; }
        let identity: GetActorEndpointManifestResponse = client.request_proto_for_device(
            reqwest::Method::POST,"/actor/endpoint-manifest",&active.jwt,None,
            Some(&GetActorEndpointManifestRequest{actor:Some(ActorRef{
                ptid:actor.clone(),kind:ActorKind::Person as i32,..Default::default()})}),
            &engine.endpoint().device_id).map_err(|e| e.to_string())?;
        validate()?;
        let identity = identity.manifest.ok_or("FEED_INVALID_RESPONSE")?;
        if identity.home_station_peer_id != entry.interaction_home_station { return Err("FEED_WRITER_NOT_AUTHORIZED".into()); }
        let handle = &identity.actor.as_ref().ok_or("FEED_INVALID_RESPONSE")?.acct;
        let key = resolve_station_signing_key_for_actor(client,state.station.registry(),
            &identity.home_station_peer_id,handle,&active.jwt,&engine.endpoint().device_id,Some(actor))?;
        let root = verify_actor_identity_manifest(&identity,&key,actor,now)?;
        roots.insert(actor.clone(),root.clone());
        pins.push((actor.clone(),identity.home_station_peer_id,root));
    }
    let _identity = state.identity_transition.lock().map_err(|_| "FEED_SESSION_CHANGED")?;
    validate()?;
    for (actor,home,root) in pins { store.pin_actor(&actor,&home,&root)?; }
    let head = store.import_remote_page(&request, &response, &root, home)?;
    store.import_thread(&request,&response,&roots)?;
    let (page, page_head) = store.remote_page(&request.actor_ptid, &root, home,
        input.after_sequence, input.limit)?;
    let threads = store.thread_page(&request.actor_ptid,input.after_thread_cursor)?;
    let next_thread = threads.last().map_or(input.after_thread_cursor,|e| e.cursor);
    let thread_cursor = store.thread_cursor(&request.actor_ptid)?;
    Ok(json!({"actorPtid": request.actor_ptid, "homeStationPeerId": home, "state": "VERIFIED",
        "bundleB64": STANDARD.encode(page.bundle.ok_or("FEED_INVALID_RESPONSE")?.encode_to_vec()),
        "headB64": STANDARD.encode(head.encode_to_vec()), "sequence": head.sequence.to_string(),
        "afterSequence": input.after_sequence.to_string(), "nextSequence": page_head.sequence.to_string(),
        "pageHeadB64": STANDARD.encode(page_head.encode_to_vec()),
        "threadEntriesB64": threads.iter().map(|e| STANDARD.encode(e.encode_to_vec())).collect::<Vec<_>>(),
        "nextThreadCursor": next_thread.to_string(), "threadCursor": thread_cursor.to_string(),
        "threadHasMore": next_thread < thread_cursor || response.thread_has_more,
        "hasMore": page.has_more || response.has_more}))
}
