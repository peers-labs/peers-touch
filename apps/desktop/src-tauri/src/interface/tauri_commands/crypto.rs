use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::json;
use tauri::{State, Window};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::domain::crypto;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

fn actor_ptid_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Option<String> {
    session_resolver::ptid_for_window(state.inner(), window)
}

pub(crate) fn to_stub(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

#[tauri::command]
pub fn crypto_ratchet_telemetry_snapshot() -> AppResult<StubPayload> {
    let snap = crate::domain::crypto::telemetry::snapshot();
    to_stub(
        "crypto_ratchet_telemetry_snapshot",
        json!({
            "dr_decrypts": snap.dr_decrypts,
            "since_unix_ms": snap.since_unix_ms,
        }),
    )
}

// WebRTC signaling uses a stateless authenticated sealed box, not the
// Messaging Engine's ordered chat ratchet.
fn local_identity_x25519(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(StaticSecret, PublicKey), AppResult<StubPayload>> {
    let actor_ptid = match actor_ptid_from_state(state, window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            ));
        }
    };
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor_ptid(actor_ptid.as_str())
            .identity_key_ref();
    let ik = match crypto::load_identity_key(identity_key_ref.as_str()) {
        Ok(Some(k)) => k,
        Ok(None) => {
            return Err(AppResult::fail(
                ErrorCode::NotFound,
                "No crypto identity found for the active actor",
                None,
            ));
        }
        Err(reason) => {
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity load failed: {reason}"),
                None,
            ));
        }
    };
    let kp = crypto::ed25519_to_x25519(&ik.signing_key);
    Ok((kp.private, kp.public))
}

fn peer_x25519_pub_from_ed25519(
    label: &str,
    ed_pub_b64: &str,
) -> Result<PublicKey, AppResult<StubPayload>> {
    let raw = match B64.decode(ed_pub_b64.trim()) {
        Ok(b) => b,
        Err(error) => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for {label}: {error}"),
                None,
            ));
        }
    };
    if raw.len() != 32 {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("{label} must decode to 32 bytes, got {}", raw.len()),
            None,
        ));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&raw);
    let verifying = match ed25519_dalek::VerifyingKey::from_bytes(&bytes) {
        Ok(value) => value,
        Err(error) => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("{label} is not a valid Ed25519 public key: {error}"),
                None,
            ));
        }
    };
    crypto::ed25519_verifying_to_x25519_public(&verifying).map_err(|reason| {
        AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("{label}: Ed25519 to X25519 conversion failed: {reason}"),
            None,
        )
    })
}

#[tauri::command]
pub fn signaling_envelope_seal(
    peer_ik_pub: String,
    session_ulid: String,
    kind: String,
    plaintext: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if session_ulid.trim().is_empty() || kind.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "session_ulid and kind are required",
            None,
        );
    }
    let (self_priv, self_pub) = match local_identity_x25519(&state, &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let peer_pub = match peer_x25519_pub_from_ed25519("peer_ik_pub", &peer_ik_pub) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let sealed = match crypto::signaling_envelope::seal(
        &self_priv,
        &self_pub,
        &peer_pub,
        session_ulid.as_str(),
        kind.as_str(),
        plaintext.as_bytes(),
    ) {
        Ok(bytes) => bytes,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Signaling envelope seal failed: {reason}"),
                None,
            );
        }
    };
    to_stub(
        "signaling_envelope_seal",
        json!({ "payload_b64": B64.encode(&sealed) }),
    )
}

#[tauri::command]
pub fn signaling_envelope_open(
    sender_ik_pub: String,
    session_ulid: String,
    kind: String,
    payload_b64: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if session_ulid.trim().is_empty() || kind.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "session_ulid and kind are required",
            None,
        );
    }
    let (self_priv, _) = match local_identity_x25519(&state, &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let sender_pub = match peer_x25519_pub_from_ed25519("sender_ik_pub", &sender_ik_pub) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let sealed = match B64.decode(payload_b64.trim()) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for payload_b64: {error}"),
                None,
            );
        }
    };
    let plaintext = match crypto::signaling_envelope::open(
        &self_priv,
        &sender_pub,
        session_ulid.as_str(),
        kind.as_str(),
        &sealed,
    ) {
        Ok(bytes) => bytes,
        Err(reason) => {
            tracing::warn!(reason = %reason, "signaling_envelope_open: AEAD failed");
            return AppResult::fail(
                ErrorCode::InternalError,
                "Signaling envelope failed to authenticate",
                None,
            );
        }
    };
    let text = match String::from_utf8(plaintext) {
        Ok(value) => value,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Decrypted signaling plaintext is not valid UTF-8: {error}"),
                None,
            );
        }
    };
    to_stub("signaling_envelope_open", json!({ "plaintext": text }))
}
