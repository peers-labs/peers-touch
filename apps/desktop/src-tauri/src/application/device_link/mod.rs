//! Window-scoped, cancellable native Device Link owner. UI holds projections.
mod cancellation;
mod lifecycle;
mod projection;
pub use projection::Projection;

use crate::{
    application::station_runtime::client::{StationClient, StationClientError},
    domain::identity::ActiveSession,
    state::AppState,
};
use device_link_core::{canonical, crypto, digest, offer, proto::*, transcript};
use ed25519_dalek::{Signer, SigningKey};
use messaging_core::identity::enrollment::generate_device_identity_for_device_from_parts;
use prost::Message;
use reqwest::Method;
use schema_core::proto::{schema_action::Action, SchemaAction};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use zeroize::{Zeroize, Zeroizing};

struct Slot {
    cancelled: AtomicBool,
    flow: Mutex<Option<Flow>>,
}

/// Native command admission; never serialized or accepted from the renderer.
pub struct CreateAdmission {
    window: String,
    slot: Arc<Slot>,
}

impl CreateAdmission {
    fn ensure_open(&self) -> Result<(), String> {
        if self.slot.cancelled.load(Ordering::SeqCst) {
            return Err("deviceLink.scopeChanged".into());
        }
        Ok(())
    }
}

struct Flow {
    session: ActiveSession,
    station_peer_id: String,
    station_name: String,
    station_root: Vec<u8>,
    client: StationClient,
    key: crypto::ReceiverKey,
    signing: SigningKey,
    offer: Option<offer::VerifiedOffer>,
    qr_link: String,
    status: Option<DeviceLinkStatus>,
    approval: Option<ApproveDeviceLinkRequest>,
    create_request: Option<CreateDeviceLinkRequest>,
    cancellation_offer_id: Option<String>,
}

impl Drop for Flow {
    fn drop(&mut self) {
        self.session.jwt.zeroize();
        self.qr_link.zeroize();
        if let Some(offer) = &mut self.offer {
            offer.statement.scan_capability.zeroize();
        }
    }
}

fn post<Req: Message, Resp: Message + Default>(
    flow: &Flow,
    operation: &str,
    request: &Req,
) -> Result<Resp, String> {
    post_native(flow, operation, request).map_err(|_| "deviceLink.stationRejected".to_string())
}

fn post_native<Req: Message, Resp: Message + Default>(
    flow: &Flow,
    operation: &str,
    request: &Req,
) -> Result<Resp, crate::application::station_runtime::client::StationClientError> {
    flow.client.request_proto_for_actor_at_station(
        &flow.station_peer_id,
        Method::POST,
        &format!("/auth/device-link/{operation}"),
        &flow.session.jwt,
        None,
        Some(request),
    )
}

fn sign(signing: &SigningKey, operation: &str, bytes: &[u8]) -> Vec<u8> {
    signing
        .sign(
            &[
                format!("peers-touch/device-link/{operation}/v1\0").as_bytes(),
                bytes,
            ]
            .concat(),
        )
        .to_bytes()
        .to_vec()
}

fn station_error_code(error: &StationClientError) -> Option<String> {
    error
        .details
        .as_ref()
        .and_then(|details| details.get("body"))
        .and_then(serde_json::Value::as_str)
        .filter(|body| body.len() <= 8192)
        .and_then(|body| serde_json::from_str::<serde_json::Value>(body).ok())
        .and_then(|body| body["code"].as_str().map(str::to_owned))
}

fn recover_create(flow: &mut Flow) -> Result<(), String> {
    if flow.offer.is_some() {
        return Ok(());
    }
    let request = flow.create_request.as_ref().ok_or("deviceLink.notReady")?;
    let response: CreateDeviceLinkResponse = match post_native(flow, "create", request) {
        Ok(response) => response,
        Err(error) => {
            let code = station_error_code(&error);
            if code.as_deref() == Some("DEVICE_LINK_ERROR_CODE_PROFILE_STALE") {
                // Station checks exact retained requests before current-profile
                // validation. This typed rejection proves no offer was allocated.
                flow.create_request = None;
                return Err("deviceLink.profileChanged".into());
            }
            return Err("deviceLink.stationRejected".into());
        }
    };
    let signed = response.offer.ok_or("deviceLink.invalidOffer")?;
    let offer = offer::verify(
        &signed,
        &flow.station_peer_id,
        &flow.station_root,
        device_link_core::bootstrap::unix_ms(),
    )
    .map_err(|e| e.to_string())?;
    if offer
        .statement
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        != Some(flow.session.actor.ptid.as_str())
        || offer
            .statement
            .actor
            .as_ref()
            .map(|actor| actor.encode_to_vec())
            != request
                .desktop_certificate
                .as_ref()
                .and_then(|c| c.device.as_ref())
                .and_then(|d| d.actor.as_ref())
                .map(|actor| actor.encode_to_vec())
        || offer.statement.desktop_hpke_public_key != flow.key.public()
        || offer.statement.desktop_device_id
            != request
                .desktop_certificate
                .as_ref()
                .and_then(|c| c.device.as_ref())
                .map(|d| d.device_id.as_str())
                .unwrap_or_default()
    {
        return Err("deviceLink.identityConflict".into());
    }
    let action = SchemaAction {
        protocol_version: 1,
        action: Some(
            response
                .locator
                .map(Action::DeviceLinkLocator)
                .unwrap_or(Action::DeviceLinkOffer(signed)),
        ),
    };
    flow.qr_link = schema_core::encode_action(&action).map_err(|_| "deviceLink.qrTooLarge")?;
    flow.status = Some(DeviceLinkStatus {
        offer_id: offer.statement.offer_id.clone(),
        state: DeviceLinkState::Open as i32,
        revision: response.revision,
        expires_at_unix_ms: offer.statement.expires_at_unix_ms,
        ..Default::default()
    });
    flow.offer = Some(offer);
    Ok(())
}

/// Called by the session owner's write observer. No session-registry reentry.
/// Approval authority is withdrawn immediately; remote cancellation is bounded
/// by StationTransport and runs after any in-flight operation settles.
pub fn invalidate(window: &str) {
    lifecycle::invalidate(window);
}

pub fn admit_create(window: &str) -> Result<CreateAdmission, String> {
    Ok(CreateAdmission {
        window: window.into(),
        slot: lifecycle::reserve(window)?,
    })
}

pub fn begin_cancel(window: &str) -> Result<(), String> {
    lifecycle::withdraw(window)
}

pub fn finish_cancel(window: &str) -> Result<(), String> {
    lifecycle::cleanup_retired(window)
}

fn current_slot(state: &AppState, window: &str) -> Result<Arc<Slot>, String> {
    let slot = lifecycle::current(window)?;
    let guard = slot.flow.lock().map_err(|_| "deviceLink.runtimeLock")?;
    let flow = guard.as_ref().ok_or("deviceLink.notReady")?;
    let valid = !slot.cancelled.load(Ordering::SeqCst)
        && state
            .sessions
            .get(window)
            .is_some_and(|session| session.activation_id == flow.session.activation_id)
        && state.station.active_station_peer_id().as_deref() == Some(flow.station_peer_id.as_str());
    drop(guard);
    if !valid {
        invalidate(window);
        return Err("deviceLink.scopeChanged".into());
    }
    Ok(slot)
}

pub fn create(state: &Arc<AppState>, admission: CreateAdmission) -> Result<Projection, String> {
    // The IPC handler reserved this exact slot before dispatching the worker.
    admission.ensure_open()?;
    let CreateAdmission { window, slot } = admission;
    let window = window.as_str();
    let session = state
        .sessions
        .get(window)
        .ok_or("deviceLink.authenticationRequired")?;
    let station_peer_id = state
        .station
        .active_station_peer_id()
        .ok_or("deviceLink.stationUnavailable")?;
    let station = state
        .station
        .registry()
        .entry(&station_peer_id)
        .ok_or("deviceLink.stationUnavailable")?;
    lifecycle::cleanup_retired_in_scope(
        window,
        &session,
        &station_peer_id,
        &station.pinned_station_root_public_key,
    )?;
    let mut guard = slot.flow.lock().map_err(|_| "deviceLink.runtimeLock")?;
    if slot.cancelled.load(Ordering::SeqCst) {
        return Err("deviceLink.scopeChanged".into());
    }
    if let Some(flow) = guard.as_mut() {
        if flow.session.activation_id != session.activation_id
            || flow.station_peer_id != station_peer_id
            || slot.cancelled.load(Ordering::SeqCst)
        {
            return Err("deviceLink.scopeChanged".into());
        }
        if flow.create_request.is_some() {
            recover_create(flow)?;
            let projection =
                projection::project(flow, flow.status.as_ref().ok_or("deviceLink.notReady")?)?;
            drop(guard);
            current_slot(state, window)?;
            return Ok(projection);
        }
    }
    let engine = state
        .messaging_engines
        .get(&session.account_id)?
        .ok_or("deviceLink.identityUnavailable")?;
    if engine.endpoint().ptid != session.actor.ptid {
        return Err("deviceLink.identityConflict".into());
    }
    let (_, signing) = engine
        .device_signing_identity()?
        .ok_or("deviceLink.deviceUnavailable")?;
    *guard = Some(Flow {
        session,
        station_peer_id,
        station_name: station.display_name.unwrap_or_default(),
        station_root: station.pinned_station_root_public_key,
        client: state.station.client().clone(),
        key: crypto::ReceiverKey::generate(),
        signing,
        offer: None,
        qr_link: String::new(),
        status: None,
        approval: None,
        create_request: None,
        cancellation_offer_id: None,
    });
    let result = (|| {
        let flow = guard.as_mut().ok_or("deviceLink.notReady")?;
        if slot.cancelled.load(Ordering::SeqCst)
            || state
                .sessions
                .get(window)
                .is_none_or(|s| s.activation_id != flow.session.activation_id)
        {
            return Err("deviceLink.scopeChanged".into());
        }
        let profile: crate::model::actor::ActorProfile = flow
            .client
            .request_peers_proto_no_body_at_station(
                &flow.station_peer_id,
                Method::GET,
                "/actor/profile",
                &flow.session.jwt,
            )
            .map_err(|_| "deviceLink.profileUnavailable")?;
        if profile.r#ref.as_ref().map(|actor| actor.ptid.as_str())
            != Some(flow.session.actor.ptid.as_str())
            || profile.profile_revision == 0
        {
            return Err("deviceLink.identityConflict".to_string());
        }
        let seed = engine.device_link_identity_seed()?;
        let mut device = generate_device_identity_for_device_from_parts(
            &flow.session.actor.ptid,
            &engine.endpoint().device_id,
            &seed,
            profile.profile_revision,
            Some(&flow.signing.to_bytes()),
        )?;
        let actor = profile
            .r#ref
            .as_ref()
            .ok_or("deviceLink.identityConflict")?;
        device
            .enrollment
            .certificate
            .device
            .as_mut()
            .ok_or("deviceLink.deviceUnavailable")?
            .actor = Some(
            messaging_core::proto::actor::ActorRef::decode(actor.encode_to_vec().as_slice())
                .map_err(|_| "deviceLink.identityConflict")?,
        );
        device.enrollment.actor_cross_signature = SigningKey::from_bytes(&seed)
            .sign(&device.enrollment.certificate.encode_to_vec())
            .to_bytes();
        let mut request = CreateDeviceLinkRequest {
            request_id: ulid::Ulid::new().to_string(),
            desktop_hpke_public_key: flow.key.public().to_vec(),
            desktop_certificate: Some(
                canonical(&device.enrollment.certificate.encode_to_vec())
                    .map_err(|e| e.to_string())?,
            ),
            desktop_actor_cross_signature: device.enrollment.actor_cross_signature.to_vec(),
            ..Default::default()
        };
        request.device_signature = sign(&flow.signing, "create", &request.encode_to_vec());
        if slot.cancelled.load(Ordering::SeqCst) {
            return Err("deviceLink.scopeChanged".into());
        }
        flow.create_request = Some(request);
        recover_create(flow)?;
        projection::project(flow, flow.status.as_ref().unwrap())
    })();
    drop(guard);
    if result.is_err() {
        // The same signed Create/key remains owned for exact retry. Closing the
        // panel retires it and resolves its outcome before allocating another.
        return result;
    }
    if slot.cancelled.load(Ordering::SeqCst) {
        return Err("deviceLink.scopeChanged".into());
    }
    current_slot(state, window)?;
    result
}

pub fn status(state: &AppState, window: &str) -> Result<Projection, String> {
    let slot = current_slot(state, window)?;
    let mut guard = slot.flow.lock().map_err(|_| "deviceLink.runtimeLock")?;
    let flow = guard.as_mut().ok_or("deviceLink.notReady")?;
    let request = GetDeviceLinkStatusRequest {
        offer_id: flow
            .offer
            .as_ref()
            .ok_or("deviceLink.notReady")?
            .statement
            .offer_id
            .clone(),
        ..Default::default()
    };
    let response: GetDeviceLinkStatusResponse = post(&flow, "status", &request)?;
    let status = response.status.ok_or("deviceLink.invalidStatus")?;
    let projection = projection::project(&flow, &status)?;
    flow.status = Some(status);
    drop(guard);
    current_slot(state, window)?;
    Ok(projection)
}

pub fn decide(
    state: &Arc<AppState>,
    window: &str,
    claim_id: &str,
    observed_revision: u64,
    code: &str,
    allow: bool,
) -> Result<Projection, String> {
    let slot = current_slot(state, window)?;
    let mut guard = slot.flow.lock().map_err(|_| "deviceLink.runtimeLock")?;
    let flow = guard.as_mut().ok_or("deviceLink.notReady")?;
    let status = flow.status.as_ref().ok_or("deviceLink.notReady")?;
    if status.revision != observed_revision {
        return Err("deviceLink.revisionConflict".into());
    }
    let claim = status
        .claims
        .iter()
        .find(|claim| claim.claim_id == claim_id)
        .ok_or("deviceLink.claimNotSelected")?;
    let offer = flow.offer.as_ref().ok_or("deviceLink.notReady")?;
    let transcript = transcript::approval(
        offer,
        claim,
        observed_revision
            .checked_add(1)
            .ok_or("deviceLink.invalidRevision")?,
    )
    .map_err(|e| e.to_string())?;
    if transcript::comparison_code(&transcript) != code {
        return Err("deviceLink.revisionConflict".into());
    }
    let next = if allow {
        let engine = state
            .messaging_engines
            .get(&flow.session.account_id)?
            .ok_or("deviceLink.identityUnavailable")?;
        let seed = engine.device_link_identity_seed()?;
        if SigningKey::from_bytes(&seed).verifying_key().as_bytes()
            != offer.statement.actor_identity_public_key.as_slice()
        {
            return Err("deviceLink.identityConflict".into());
        }
        let bytes = transcript.encode_to_vec();
        let material = DeviceLinkIdentityMaterial {
            actor_identity_seed: seed.to_vec(),
            actor_identity_key_fingerprint: offer.statement.actor_identity_key_fingerprint.clone(),
            approval_transcript_digest: digest(&bytes).to_vec(),
        };
        let mut material_bytes = Zeroizing::new(material.encode_to_vec());
        let mut material = material;
        material.actor_identity_seed.zeroize();
        let request = flow
            .approval
            .as_ref()
            .filter(|previous| {
                previous.claim_id == claim_id && previous.observed_revision == observed_revision
            })
            .cloned()
            .map(Ok)
            .unwrap_or_else(|| -> Result<_, String> {
                Ok(ApproveDeviceLinkRequest {
                    offer_id: offer.statement.offer_id.clone(),
                    claim_id: claim_id.into(),
                    observed_revision,
                    identity_material: Some(
                        crypto::seal(&transcript.mobile_hpke_public_key, &bytes, &material_bytes)
                            .map_err(|e| e.to_string())?,
                    ),
                    desktop_transcript_signature: sign(&flow.signing, "approval", &bytes),
                })
            })?;
        material_bytes.zeroize();
        flow.approval = Some(request);
        if slot.cancelled.load(Ordering::SeqCst) {
            return Err("deviceLink.scopeChanged".into());
        }
        let response: ApproveDeviceLinkResponse =
            post(&flow, "approve", flow.approval.as_ref().unwrap())?;
        response.status
    } else {
        let mut request = DenyDeviceLinkRequest {
            offer_id: offer.statement.offer_id.clone(),
            claim_id: claim_id.into(),
            observed_revision,
            ..Default::default()
        };
        request.device_signature = sign(&flow.signing, "deny", &request.encode_to_vec());
        let response: DenyDeviceLinkResponse = post(&flow, "deny", &request)?;
        response.status
    }
    .ok_or("deviceLink.invalidStatus")?;
    let projection = projection::project(&flow, &next)?;
    flow.status = Some(next);
    drop(guard);
    current_slot(state, window)?;
    Ok(projection)
}
