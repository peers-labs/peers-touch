//! Native owner for claimant-first login approval.
//!
//! The renderer never holds the possession capability or any HPKE private
//! material. Claimant secrets live in a process-scoped, zeroized map and are
//! attached only to unauthenticated Station calls. Approver calls reuse the
//! active window session and seal the Actor identity seed with the same
//! `device-link-core` HPKE primitive as Device Link — there is no second
//! cryptographic implementation.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use device_link_core::approval_proto;
use device_link_core::crypto::ReceiverKey;
use device_link_core::proto::DeviceLinkHpkeEnvelope;
use ed25519_dalek::{Signer, SigningKey};
use prost::Message;
use reqwest::Method;
use serde::Serialize;
use zeroize::Zeroize;

use crate::domain::identity::ActiveSession;
use crate::state::AppState;

const CLAIMANT_PATH: &str = "/auth/login-approval";
const APPROVER_PATH: &str = "/auth/login-approval";
const APPROVAL_PURPOSE: &[u8] = b"peers-touch/login-approval/approval/v1\0";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub approval_id: String,
    pub state: i32,
    pub revision: u64,
    pub expires_at_unix_ms: i64,
    pub comparison_code: String,
    pub reason: i32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub approval_id: String,
    pub claimant_device_id: String,
    pub platform: String,
    pub device_label: String,
    pub comparison_code: String,
    pub expires_at_unix_ms: i64,
    pub revision: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PendingList {
    pub approvals: Vec<Pending>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput {
    pub access_attempt_id: String,
    pub access_decision_revision: u64,
    pub station_peer_id: String,
    pub claimant_device_id: String,
    pub platform: String,
    pub device_label: String,
}

/// Process-scoped claimant secret. The capability is a possession secret; the
/// receiver key decrypts the approved identity material. Neither is serialized.
struct ClaimantSecret {
    capability: [u8; 32],
    // Retained across polls so the post-approval enrollment continuation can
    // open the sealed identity material. The open path lands with the
    // claimant enrollment/ack sequence, not the current command slice.
    #[allow(dead_code)]
    receiver: ReceiverKey,
}

fn vault() -> &'static Mutex<HashMap<String, ClaimantSecret>> {
    static VAULT: OnceLock<Mutex<HashMap<String, ClaimantSecret>>> = OnceLock::new();
    VAULT.get_or_init(|| Mutex::new(HashMap::new()))
}

// Maps a window label to its current claimant approval id. The renderer never
// handles the approval id or capability; the native owner resolves both.
fn current() -> &'static Mutex<HashMap<String, String>> {
    static CURRENT: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CURRENT.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Drop every claimant secret on logout / station / session change.
pub fn invalidate() {
    if let Ok(mut map) = vault().lock() {
        for (_, mut secret) in map.drain() {
            secret.capability.zeroize();
        }
    }
    if let Ok(mut map) = current().lock() {
        map.clear();
    }
}

fn project(status: &approval_proto::LoginApprovalProjection) -> Projection {
    Projection {
        approval_id: status.approval_id.clone(),
        state: status.state,
        revision: status.revision,
        expires_at_unix_ms: status.expires_at_unix_ms,
        comparison_code: status.comparison_code.clone(),
        reason: status.reason,
    }
}

fn fail(message: impl Into<String>) -> String {
    message.into()
}

// --- Claimant (no-session) surface ---------------------------------------

pub fn create(
    state: &AppState,
    window: &str,
    input: CreateInput,
) -> Result<Projection, String> {
    let receiver = ReceiverKey::generate();
    let mut csprng = rand::rngs::OsRng;
    let ephemeral = SigningKey::generate(&mut csprng);
    let verifying = ephemeral.verifying_key();

    let mut request = approval_proto::CreateLoginApprovalRequest {
        request_id: ulid::Ulid::new().to_string(),
        access_attempt_id: input.access_attempt_id,
        access_decision_revision: input.access_decision_revision,
        station_peer_id: input.station_peer_id.clone(),
        claimant_device_id: input.claimant_device_id,
        platform: input.platform,
        device_label: input.device_label,
        claimant_hpke_public_key: receiver.public().to_vec(),
        claimant_device_signing_public_key: verifying.to_bytes().to_vec(),
        device_signature: Vec::new(),
    };
    let canonical = request.encode_to_vec();
    request.device_signature = ephemeral
        .sign(&[APPROVAL_PURPOSE, canonical.as_slice()].concat())
        .to_bytes()
        .to_vec();

    let response: approval_proto::CreateLoginApprovalResponse = state
        .station
        .client()
        .request_proto_no_auth(Method::POST, &format!("{CLAIMANT_PATH}/create"), &request)
        .map_err(|error| fail(format!("loginApproval.createRejected: {error}")))?;

    let mut capability = [0u8; 32];
    if response.claimant_capability.len() != 32 {
        return Err(fail("loginApproval.invalidCapability"));
    }
    capability.copy_from_slice(&response.claimant_capability);
    if let Ok(mut map) = vault().lock() {
        map.insert(
            response.approval_id.clone(),
            ClaimantSecret {
                capability,
                receiver,
            },
        );
    }
    if let Ok(mut map) = current().lock() {
        map.insert(window.to_string(), response.approval_id.clone());
    }
    Ok(Projection {
        approval_id: response.approval_id,
        state: approval_proto::LoginApprovalState::Pending as i32,
        revision: response.revision,
        expires_at_unix_ms: response.expires_at_unix_ms,
        comparison_code: response.comparison_code,
        reason: 0,
    })
}

fn resolve_approval(window: &str) -> Result<String, String> {
    let map = current()
        .lock()
        .map_err(|_| fail("loginApproval.runtimeLock"))?;
    map.get(window)
        .cloned()
        .ok_or_else(|| fail("loginApproval.notStarted"))
}

fn take_capability(approval_id: &str) -> Result<[u8; 32], String> {
    let map = vault().lock().map_err(|_| fail("loginApproval.runtimeLock"))?;
    let secret = map
        .get(approval_id)
        .ok_or_else(|| fail("loginApproval.capabilityMissing"))?;
    Ok(secret.capability)
}

pub fn status(
    state: &AppState,
    window: &str,
    observed_revision: u64,
) -> Result<Projection, String> {
    let approval_id = resolve_approval(window)?;
    let capability = take_capability(&approval_id)?;
    let request = approval_proto::LoginApprovalStatusRequest {
        approval_id: approval_id.to_string(),
        claimant_capability: capability.to_vec(),
        observed_revision,
    };
    let response: approval_proto::LoginApprovalStatusResponse = state
        .station
        .client()
        .request_proto_no_auth(Method::POST, &format!("{CLAIMANT_PATH}/status"), &request)
        .map_err(|error| fail(format!("loginApproval.statusRejected: {error}")))?;
    let status = response
        .status
        .ok_or_else(|| fail("loginApproval.invalidStatus"))?;
    Ok(project(&status))
}

pub fn cancel(
    state: &AppState,
    window: &str,
    observed_revision: u64,
) -> Result<Projection, String> {
    let approval_id = resolve_approval(window)?;
    let capability = take_capability(&approval_id)?;
    let request = approval_proto::CancelLoginApprovalRequest {
        approval_id: approval_id.to_string(),
        claimant_capability: capability.to_vec(),
        observed_revision,
    };
    let response: approval_proto::CancelLoginApprovalResponse = state
        .station
        .client()
        .request_proto_no_auth(Method::POST, &format!("{CLAIMANT_PATH}/cancel"), &request)
        .map_err(|error| fail(format!("loginApproval.cancelRejected: {error}")))?;
    let status = response
        .status
        .ok_or_else(|| fail("loginApproval.invalidStatus"))?;
    Ok(project(&status))
}

// --- Approver (authenticated) surface ------------------------------------

fn active_session(state: &AppState, window: &str) -> Result<ActiveSession, String> {
    state
        .sessions
        .get(window)
        .ok_or_else(|| fail("loginApproval.authenticationRequired"))
}

fn station_peer(state: &AppState) -> Result<String, String> {
    state
        .station
        .active_station_peer_id()
        .ok_or_else(|| fail("loginApproval.stationUnavailable"))
}

pub fn list_pending(
    state: &AppState,
    window: &str,
    observed_revision: u64,
) -> Result<PendingList, String> {
    let session = active_session(state, window)?;
    let station_peer_id = station_peer(state)?;
    let request = approval_proto::ListPendingLoginApprovalsRequest { observed_revision };
    let response: approval_proto::ListPendingLoginApprovalsResponse = state
        .station
        .client()
        .request_proto_for_actor_at_station(
            &station_peer_id,
            Method::POST,
            &format!("{APPROVER_PATH}/list-pending"),
            &session.jwt,
            None,
            Some(&request),
        )
        .map_err(|error| fail(format!("loginApproval.listRejected: {error}")))?;
    Ok(PendingList {
        approvals: response
            .approvals
            .into_iter()
            .map(|item| Pending {
                approval_id: item.approval_id,
                claimant_device_id: item.claimant_device_id,
                platform: item.platform,
                device_label: item.device_label,
                comparison_code: item.comparison_code,
                expires_at_unix_ms: item.expires_at_unix_ms,
                revision: item.revision,
            })
            .collect(),
    })
}

pub fn deny(
    state: &AppState,
    window: &str,
    approval_id: &str,
    observed_revision: u64,
) -> Result<Projection, String> {
    let session = active_session(state, window)?;
    let station_peer_id = station_peer(state)?;
    let request = approval_proto::DenyLoginApprovalRequest {
        approval_id: approval_id.to_string(),
        observed_revision,
        device_signature: Vec::new(),
    };
    let response: approval_proto::DenyLoginApprovalResponse = state
        .station
        .client()
        .request_proto_for_actor_at_station(
            &station_peer_id,
            Method::POST,
            &format!("{APPROVER_PATH}/deny"),
            &session.jwt,
            None,
            Some(&request),
        )
        .map_err(|error| fail(format!("loginApproval.denyRejected: {error}")))?;
    Ok(project(
        &response
            .status
            .ok_or_else(|| fail("loginApproval.invalidStatus"))?,
    ))
}

pub fn approve(
    state: &AppState,
    window: &str,
    approval_id: &str,
    observed_revision: u64,
) -> Result<Projection, String> {
    let session = active_session(state, window)?;
    let station_peer_id = station_peer(state)?;
    let client = state.station.client().clone();

    // Resolve the claimant's HPKE key from the authenticated pending list.
    let pending: approval_proto::ListPendingLoginApprovalsResponse = client
        .request_proto_for_actor_at_station(
            &station_peer_id,
            Method::POST,
            &format!("{APPROVER_PATH}/list-pending"),
            &session.jwt,
            None,
            Some(&approval_proto::ListPendingLoginApprovalsRequest {
                observed_revision: 0,
            }),
        )
        .map_err(|error| fail(format!("loginApproval.listRejected: {error}")))?;
    let target = pending
        .approvals
        .into_iter()
        .find(|item| item.approval_id == approval_id && item.revision == observed_revision)
        .ok_or_else(|| fail("loginApproval.claimNotSelected"))?;

    let engine = state
        .messaging_engines
        .get(&session.account_id)
        .map_err(|_| fail("loginApproval.identityUnavailable"))?
        .ok_or_else(|| fail("loginApproval.identityUnavailable"))?;
    let seed = engine
        .device_link_identity_seed()
        .map_err(|_| fail("loginApproval.identityUnavailable"))?;
    let (_, signing) = engine
        .device_signing_identity()
        .map_err(|_| fail("loginApproval.deviceUnavailable"))?
        .ok_or_else(|| fail("loginApproval.deviceUnavailable"))?;

    let transcript = approval_proto::ApproveLoginApprovalRequest {
        approval_id: approval_id.to_string(),
        observed_revision,
        identity_material: None,
        approver_transcript_signature: Vec::new(),
        device_signature: Vec::new(),
    }
    .encode_to_vec();
    let envelope: DeviceLinkHpkeEnvelope = device_link_core::crypto::seal(
        &target.claimant_hpke_public_key,
        &transcript,
        seed.as_slice(),
    )
    .map_err(|error| fail(format!("loginApproval.sealFailed: {error}")))?;
    let signature = signing
        .sign(&[APPROVAL_PURPOSE, transcript.as_slice()].concat())
        .to_bytes()
        .to_vec();

    let request = approval_proto::ApproveLoginApprovalRequest {
        approval_id: approval_id.to_string(),
        observed_revision,
        identity_material: Some(envelope),
        approver_transcript_signature: signature,
        device_signature: Vec::new(),
    };
    let response: approval_proto::ApproveLoginApprovalResponse = client
        .request_proto_for_actor_at_station(
            &station_peer_id,
            Method::POST,
            &format!("{APPROVER_PATH}/approve"),
            &session.jwt,
            None,
            Some(&request),
        )
        .map_err(|error| fail(format!("loginApproval.approveRejected: {error}")))?;
    Ok(project(
        &response
            .status
            .ok_or_else(|| fail("loginApproval.invalidStatus"))?,
    ))
}
