use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_peers_platform_permissions::{NativePushCallback, PlatformPermissions};
use ulid::Ulid;
use zeroize::Zeroizing;

use crate::error::{MobileError, MobileResult};
use crate::platform::background_bridge;
use crate::platform::lifecycle_bridge::{self, NativeLifecycleSource};
use crate::platform::native_events;
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::{authenticated_native_session, AuthenticatedNativeSession};
use crate::runtime::station_transport;

const PUSH_INSTALL_EPOCH_KEY: &str = "peers-touch.mobile.push-install-epoch.v1";
const MAX_PROVIDER_TOKEN_BYTES: usize = 4096;
const MAX_PUSH_CALLBACKS_PER_DRAIN: usize = 64;
const MAX_PUSH_PAYLOAD_LIFETIME_MS: u64 = 5 * 60 * 1_000;
const MAX_PUSH_REGISTRATION_ATTEMPTS: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushEnvironment {
    Development,
    Production,
}

impl PushEnvironment {
    fn wire_name(self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Production => "production",
        }
    }

    fn proto_value(self) -> i32 {
        match self {
            Self::Development => 1,
            Self::Production => 2,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushScopeInput {
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    environment: PushEnvironment,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushActivationProjection {
    armed: bool,
    lifecycle_generation: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushDrainProjection {
    accepted_callbacks: u32,
    discarded_callbacks: u32,
    registration_updates: u32,
    reconcile_events: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushDeactivationProjection {
    locally_fenced: bool,
    unregister_attempted: u32,
    unregister_failed: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledDrainProjection {
    accepted_callbacks: u32,
    discarded_callbacks: u32,
    failed_callbacks: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RegistrationKey {
    channel: &'static str,
    environment: PushEnvironment,
}

#[derive(Debug, Clone)]
struct RegisteredBinding {
    registration_id: String,
    app_install_epoch_sha256: [u8; 32],
}

#[derive(Clone)]
struct ActivePushScope {
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    device_id: String,
    lifecycle_generation: u64,
    environment: PushEnvironment,
    app_install_epoch_sha256: [u8; 32],
    last_native_sequence: HashMap<String, u64>,
    last_scheduled_sequence: HashMap<String, u64>,
    pending_registration: Option<PushTokenBinding>,
    registrations: HashMap<RegistrationKey, RegisteredBinding>,
}

#[derive(Default)]
pub struct PushBridgeRuntime {
    active: Mutex<Option<ActivePushScope>>,
    drain_lock: AsyncMutex<()>,
    scheduled_drain_lock: AsyncMutex<()>,
}

enum AcceptedPushCallback {
    Token(PushTokenBinding),
    Wakeup(PushWakeup),
}

#[derive(Clone, PartialEq, Eq)]
struct PushTokenBinding {
    request_id: String,
    lifecycle_generation: u64,
    attempts: u8,
    channel: &'static str,
    body: serde_json::Value,
}

#[derive(Debug)]
struct PushWakeup {
    tapped: bool,
    sequence: u64,
    generation: u64,
    notification_id: String,
    category: i32,
    target_hint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterPushResponse {
    request_id: String,
    registration: PushRegistrationResponse,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushRegistrationResponse {
    registration_id: String,
}

pub async fn activate<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    runtime: &PushBridgeRuntime,
    input: PushScopeInput,
) -> MobileResult<PushActivationProjection> {
    let session = authenticated_native_session(
        storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let lifecycle_generation = lifecycle_bridge::current_generation();
    if lifecycle_generation == 0 {
        return Err(push_error("lifecycle generation is not active"));
    }
    let app_install_epoch_sha256 = load_or_create_install_epoch(storage)?;
    let (retained_registrations, pending_registration) = {
        let active = lock_active(runtime)?;
        if let Some(scope) = active.as_ref() {
            if scope.station_peer_id == input.station_peer_id
                && scope.actor_ptid == input.actor_ptid
                && scope.session_id == input.session_id
                && scope.device_id == session.device_id()
                && scope.environment == input.environment
                && scope.app_install_epoch_sha256 == app_install_epoch_sha256
            {
                if scope.lifecycle_generation == lifecycle_generation {
                    return Ok(PushActivationProjection {
                        armed: true,
                        lifecycle_generation,
                    });
                }
                (
                    scope.registrations.clone(),
                    scope.pending_registration.clone(),
                )
            } else {
                return Err(push_error(
                    "push runtime must be deactivated before changing scope",
                ));
            }
        } else {
            (HashMap::new(), None)
        }
    };
    let platform = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| push_error("native platform plugin is not registered"))?;
    let response = platform
        .arm_push(lifecycle_generation, input.environment.wire_name())
        .await
        .map_err(|error| push_error(format!("arm native push: {error}")))?;
    if !response.armed {
        return Err(push_error("native push is unavailable on this platform"));
    }
    let scheduled = match platform
        .schedule_reconcile(lifecycle_generation, input.environment.wire_name())
        .await
    {
        Ok(scheduled) => scheduled,
        Err(error) => {
            let _ = platform.disarm_push().await;
            return Err(push_error(format!("schedule native reconcile: {error}")));
        }
    };
    if !scheduled.registered || scheduled.identifier != schedule_identifier(input.environment) {
        let _ = platform.disarm_push().await;
        return Err(push_error("native scheduled reconcile identity mismatch"));
    }

    *lock_active(runtime)? = Some(ActivePushScope {
        station_peer_id: input.station_peer_id,
        actor_ptid: input.actor_ptid,
        session_id: input.session_id,
        device_id: session.device_id().to_string(),
        lifecycle_generation,
        environment: input.environment,
        app_install_epoch_sha256,
        last_native_sequence: HashMap::new(),
        last_scheduled_sequence: HashMap::new(),
        pending_registration,
        registrations: retained_registrations,
    });
    Ok(PushActivationProjection {
        armed: true,
        lifecycle_generation,
    })
}

pub async fn drain_scheduled<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    runtime: &PushBridgeRuntime,
    input: PushScopeInput,
) -> MobileResult<ScheduledDrainProjection> {
    let _drain_guard = runtime.scheduled_drain_lock.lock().await;
    let session = authenticated_native_session(
        storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    validate_active_scope(runtime, &session, input.environment)?;
    let platform = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| push_error("native platform plugin is not registered"))?;
    let callbacks = platform
        .drain_scheduled_callbacks()
        .await
        .map_err(|error| push_error(format!("drain scheduled callbacks: {error}")))?;
    if callbacks.len() > MAX_PUSH_CALLBACKS_PER_DRAIN {
        return Err(push_error("native scheduled callback batch exceeds limit"));
    }

    let mut projection = ScheduledDrainProjection::default();
    let mut first_failure: Option<MobileError> = None;
    for callback in callbacks {
        let completion_id = callback.completion_id.clone();
        let accepted = admit_scheduled_callback(
            runtime,
            &callback,
            current_time_ms()?,
            lifecycle_bridge::current_generation(),
        )?;
        let success = if accepted {
            background_bridge::handle_native_wakeup(
                app,
                match callback.platform.as_str() {
                    "android" => NativeLifecycleSource::WorkManagerWakeup,
                    _ => NativeLifecycleSource::BgTaskWakeup,
                },
            );
            match background_bridge::perform_reconciliation(app, true) {
                Ok(_) => {
                    projection.accepted_callbacks += 1;
                    true
                }
                Err(error) => {
                    projection.failed_callbacks += 1;
                    if first_failure.is_none() {
                        first_failure = Some(error);
                    }
                    false
                }
            }
        } else {
            projection.discarded_callbacks += 1;
            true
        };
        if let Err(error) = platform
            .complete_scheduled_callback(&completion_id, success)
            .await
        {
            projection.failed_callbacks += 1;
            if first_failure.is_none() {
                first_failure = Some(push_error(format!("complete scheduled callback: {error}")));
            }
        }
    }
    if let Some(error) = first_failure {
        return Err(error);
    }
    Ok(projection)
}

pub async fn drain<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    runtime: &PushBridgeRuntime,
    input: PushScopeInput,
) -> MobileResult<PushDrainProjection> {
    let _drain_guard = runtime.drain_lock.lock().await;
    let session = authenticated_native_session(
        storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    validate_active_scope(runtime, &session, input.environment)?;
    let platform = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| push_error("native platform plugin is not registered"))?;
    let mut projection = PushDrainProjection::default();
    let mut first_failure: Option<MobileError> = None;
    if let Some(binding) = pending_registration(runtime)? {
        match register_binding(runtime, &session, binding).await {
            Ok(()) => projection.registration_updates += 1,
            Err(error) => first_failure = Some(error),
        }
    }
    let callbacks = platform
        .drain_push_callbacks()
        .await
        .map_err(|error| push_error(format!("drain native push callbacks: {error}")))?;
    if callbacks.len() > MAX_PUSH_CALLBACKS_PER_DRAIN {
        return Err(push_error("native push callback batch exceeds limit"));
    }

    for callback in callbacks {
        let accepted = admit_callback(
            runtime,
            callback,
            current_time_ms()?,
            lifecycle_bridge::current_generation(),
        )?;
        let Some(accepted) = accepted else {
            projection.discarded_callbacks += 1;
            continue;
        };
        projection.accepted_callbacks += 1;
        match accepted {
            AcceptedPushCallback::Token(binding) => {
                set_pending_registration(runtime, binding.clone())?;
                match register_binding(runtime, &session, binding).await {
                    Ok(()) => projection.registration_updates += 1,
                    Err(error) => {
                        if first_failure.is_none() {
                            first_failure = Some(error);
                        }
                    }
                }
            }
            AcceptedPushCallback::Wakeup(wakeup) => {
                background_bridge::handle_native_wakeup(app, NativeLifecycleSource::PushWakeup);
                let emitted = if wakeup.tapped {
                    native_events::emit_notification_tap_reconcile(
                        app,
                        wakeup.notification_id,
                        wakeup.category,
                        wakeup.target_hint,
                        wakeup.generation,
                        wakeup.sequence,
                    )
                } else {
                    native_events::emit_push_reconcile(
                        app,
                        wakeup.notification_id,
                        wakeup.category,
                        wakeup.target_hint,
                        wakeup.generation,
                        wakeup.sequence,
                    )
                };
                match emitted {
                    Ok(()) => projection.reconcile_events += 1,
                    Err(error) => {
                        if first_failure.is_none() {
                            first_failure =
                                Some(push_error(format!("emit push reconcile intent: {error}")));
                        }
                    }
                }
            }
        }
    }
    if let Some(error) = first_failure {
        return Err(error);
    }
    Ok(projection)
}

pub async fn deactivate<R: Runtime>(
    app: &AppHandle<R>,
    storage: &SecureStorage,
    runtime: &PushBridgeRuntime,
) -> MobileResult<PushDeactivationProjection> {
    let scope = lock_active(runtime)?.take();
    let platform = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| push_error("native platform plugin is not registered"))?;
    platform
        .disarm_push()
        .await
        .map_err(|error| push_error(format!("disarm native push: {error}")))?;

    let mut projection = PushDeactivationProjection {
        locally_fenced: true,
        ..PushDeactivationProjection::default()
    };
    let Some(scope) = scope else {
        return Ok(projection);
    };
    let session = match authenticated_native_session(
        storage,
        &scope.station_peer_id,
        &scope.actor_ptid,
        &scope.session_id,
    ) {
        Ok(session) => session,
        Err(_) => return Ok(projection),
    };
    for registration in scope.registrations.values() {
        projection.unregister_attempted += 1;
        if unregister_binding(&session, &scope, registration)
            .await
            .is_err()
        {
            projection.unregister_failed += 1;
        }
    }
    Ok(projection)
}

fn validate_active_scope(
    runtime: &PushBridgeRuntime,
    session: &AuthenticatedNativeSession,
    environment: PushEnvironment,
) -> MobileResult<()> {
    let active = lock_active(runtime)?;
    let scope = active
        .as_ref()
        .ok_or_else(|| push_error("push runtime is not active"))?;
    if scope.station_peer_id != session.station_peer_id()
        || scope.actor_ptid != session.actor_ptid()
        || scope.session_id != session.session_id()
        || scope.device_id != session.device_id()
        || scope.environment != environment
        || scope.lifecycle_generation != lifecycle_bridge::current_generation()
    {
        return Err(push_error("push runtime scope is stale"));
    }
    Ok(())
}

fn pending_registration(runtime: &PushBridgeRuntime) -> MobileResult<Option<PushTokenBinding>> {
    Ok(lock_active(runtime)?
        .as_ref()
        .and_then(|scope| scope.pending_registration.clone()))
}

fn set_pending_registration(
    runtime: &PushBridgeRuntime,
    binding: PushTokenBinding,
) -> MobileResult<()> {
    lock_active(runtime)?
        .as_mut()
        .ok_or_else(|| push_error("push runtime is not active"))?
        .pending_registration = Some(binding);
    Ok(())
}

fn clear_pending_registration_if_matches(scope: &mut ActivePushScope, binding: &PushTokenBinding) {
    if scope
        .pending_registration
        .as_ref()
        .is_some_and(|pending| pending == binding)
    {
        scope.pending_registration = None;
    }
}

fn record_registration_failure(
    runtime: &PushBridgeRuntime,
    binding: &PushTokenBinding,
) -> MobileResult<()> {
    let mut active = lock_active(runtime)?;
    let Some(scope) = active.as_mut() else {
        return Ok(());
    };
    if scope
        .pending_registration
        .as_ref()
        .is_some_and(|pending| pending == binding)
    {
        if binding.attempts.saturating_add(1) >= MAX_PUSH_REGISTRATION_ATTEMPTS {
            scope.pending_registration = None;
        } else {
            let mut retry = binding.clone();
            retry.attempts += 1;
            scope.pending_registration = Some(retry);
        }
    }
    Ok(())
}

fn admit_callback(
    runtime: &PushBridgeRuntime,
    callback: NativePushCallback,
    now_ms: u64,
    current_generation: u64,
) -> MobileResult<Option<AcceptedPushCallback>> {
    let mut active = lock_active(runtime)?;
    let scope = active
        .as_mut()
        .ok_or_else(|| push_error("push runtime is not active"))?;
    if callback.sequence == 0
        || callback.lifecycle_generation != scope.lifecycle_generation
        || callback.lifecycle_generation != current_generation
        || !platform_matches(&callback.platform)
    {
        return Ok(None);
    }
    let last = *scope
        .last_native_sequence
        .entry(callback.platform.clone())
        .or_insert(0);
    if callback.sequence <= last {
        return Ok(None);
    }

    let accepted = match callback.kind.as_str() {
        "token" => AcceptedPushCallback::Token(parse_token_callback(&callback, scope.environment)?),
        "receipt" | "tap" => {
            AcceptedPushCallback::Wakeup(parse_wakeup_callback(&callback, now_ms)?)
        }
        _ => return Ok(None),
    };
    scope
        .last_native_sequence
        .insert(callback.platform.clone(), callback.sequence);
    Ok(Some(accepted))
}

fn admit_scheduled_callback(
    runtime: &PushBridgeRuntime,
    callback: &tauri_plugin_peers_platform_permissions::NativeScheduledCallback,
    now_ms: u64,
    current_generation: u64,
) -> MobileResult<bool> {
    let mut active = lock_active(runtime)?;
    let scope = active
        .as_mut()
        .ok_or_else(|| push_error("push runtime is not active"))?;
    if callback.completion_id.trim().is_empty()
        || callback.identifier != schedule_identifier(scope.environment)
        || callback.lifecycle_generation != scope.lifecycle_generation
        || callback.lifecycle_generation != current_generation
        || callback.deadline_ms <= now_ms
        || callback.deadline_ms > now_ms.saturating_add(25_000)
        || callback.sequence == 0
        || !platform_matches(&callback.platform)
    {
        return Ok(false);
    }
    let last = scope
        .last_scheduled_sequence
        .entry(callback.platform.clone())
        .or_insert(0);
    if callback.sequence <= *last {
        return Ok(false);
    }
    *last = callback.sequence;
    Ok(true)
}

fn parse_token_callback(
    callback: &NativePushCallback,
    expected_environment: PushEnvironment,
) -> MobileResult<PushTokenBinding> {
    if callback.environment.as_deref() != Some(expected_environment.wire_name()) {
        return Err(push_error("native push environment mismatch"));
    }
    let provider_count = usize::from(callback.apns_token_base64.is_some())
        + usize::from(callback.fcm_token.is_some())
        + usize::from(callback.unified_endpoint.is_some());
    if provider_count != 1 {
        return Err(push_error("native push callback must contain one provider"));
    }
    if let Some(encoded) = callback.apns_token_base64.as_deref() {
        let token = decode_canonical_base64(encoded, 32, 32, "APNs token")?;
        let topic = clean_text(callback.apns_topic.as_deref(), 255, "APNs topic")?;
        return Ok(PushTokenBinding {
            request_id: Ulid::new().to_string(),
            lifecycle_generation: callback.lifecycle_generation,
            attempts: 0,
            channel: "apns",
            body: json!({
                "apns": {
                    "token": STANDARD.encode(token),
                    "topic": topic,
                }
            }),
        });
    }
    if let Some(token) = callback.fcm_token.as_deref() {
        let token = clean_text(Some(token), MAX_PROVIDER_TOKEN_BYTES, "FCM token")?;
        return Ok(PushTokenBinding {
            request_id: Ulid::new().to_string(),
            lifecycle_generation: callback.lifecycle_generation,
            attempts: 0,
            channel: "fcm",
            body: json!({"fcm": {"token": token}}),
        });
    }
    let endpoint = clean_text(
        callback.unified_endpoint.as_deref(),
        MAX_PROVIDER_TOKEN_BYTES,
        "UnifiedPush endpoint",
    )?;
    if !endpoint.starts_with("https://") {
        return Err(push_error("UnifiedPush endpoint must use HTTPS"));
    }
    let p256dh = decode_canonical_base64(
        callback
            .unified_p256dh_base64
            .as_deref()
            .unwrap_or_default(),
        65,
        65,
        "UnifiedPush p256dh",
    )?;
    let auth = decode_canonical_base64(
        callback.unified_auth_base64.as_deref().unwrap_or_default(),
        16,
        16,
        "UnifiedPush auth",
    )?;
    Ok(PushTokenBinding {
        request_id: Ulid::new().to_string(),
        lifecycle_generation: callback.lifecycle_generation,
        attempts: 0,
        channel: "unified_push",
        body: json!({
            "unified_push": {
                "endpoint": endpoint,
                "p256dh_key": STANDARD.encode(p256dh),
                "auth_secret": STANDARD.encode(auth),
            }
        }),
    })
}

fn parse_wakeup_callback(callback: &NativePushCallback, now_ms: u64) -> MobileResult<PushWakeup> {
    let notification_id = clean_text(callback.notification_id.as_deref(), 128, "notification id")?;
    let category = callback
        .category
        .filter(|value| (1..=4).contains(value))
        .ok_or_else(|| push_error("push category is invalid"))?;
    let target_hint = clean_text(callback.target_hint.as_deref(), 64, "target hint")?;
    if !matches!(
        target_hint.as_str(),
        "conversation" | "moment" | "profile" | "none"
    ) {
        return Err(push_error("push target hint is invalid"));
    }
    let issued_at_ms = callback
        .issued_at_ms
        .ok_or_else(|| push_error("push issue time is missing"))?;
    let expires_at_ms = callback
        .expires_at_ms
        .ok_or_else(|| push_error("push expiry is missing"))?;
    if issued_at_ms > now_ms.saturating_add(60_000)
        || expires_at_ms <= now_ms
        || expires_at_ms.saturating_sub(issued_at_ms) > MAX_PUSH_PAYLOAD_LIFETIME_MS
    {
        return Err(push_error("push timing is invalid or expired"));
    }
    Ok(PushWakeup {
        tapped: callback.kind == "tap",
        sequence: callback.sequence,
        generation: callback.lifecycle_generation,
        notification_id,
        category,
        target_hint,
    })
}

async fn register_binding(
    runtime: &PushBridgeRuntime,
    session: &AuthenticatedNativeSession,
    binding: PushTokenBinding,
) -> MobileResult<()> {
    let scope = lock_active(runtime)?
        .clone()
        .ok_or_else(|| push_error("push runtime is not active"))?;
    let request_id = binding.request_id.clone();
    let mut body = json!({
        "request_id": request_id,
        "device_id": scope.device_id,
        "lifecycle_generation": binding.lifecycle_generation,
        "app_install_epoch_sha256": STANDARD.encode(scope.app_install_epoch_sha256),
        "environment": scope.environment.proto_value(),
    });
    let binding_value = binding.body.clone();
    let object = body
        .as_object_mut()
        .ok_or_else(|| push_error("push registration body is invalid"))?;
    let provider = binding_value
        .as_object()
        .ok_or_else(|| push_error("push provider binding is invalid"))?;
    for (key, value) in provider {
        object.insert(key.clone(), value.clone());
    }
    let encoded =
        serde_json::to_vec(&body).map_err(|_| push_error("encode push registration request"))?;
    let (status, response) = match station_transport::execute_native_json(
        session,
        "notification_push_register",
        "/notification/push/register",
        encoded,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            record_registration_failure(runtime, &binding)?;
            return Err(error);
        }
    };
    if !(200..300).contains(&status) {
        if status == 408 || status == 429 || status >= 500 {
            record_registration_failure(runtime, &binding)?;
        } else {
            let mut active = lock_active(runtime)?;
            if let Some(current) = active.as_mut() {
                clear_pending_registration_if_matches(current, &binding);
            }
        }
        return Err(push_error(format!(
            "push registration failed with http_{status}"
        )));
    }
    let response: RegisterPushResponse = match serde_json::from_slice(&response) {
        Ok(response) => response,
        Err(_) => {
            let mut active = lock_active(runtime)?;
            if let Some(current) = active.as_mut() {
                clear_pending_registration_if_matches(current, &binding);
            }
            return Err(push_error("push registration response is invalid"));
        }
    };
    if response.request_id != request_id || response.registration.registration_id.trim().is_empty()
    {
        let mut active = lock_active(runtime)?;
        if let Some(current) = active.as_mut() {
            clear_pending_registration_if_matches(current, &binding);
        }
        return Err(push_error("push registration response binding mismatch"));
    }
    let registration = RegisteredBinding {
        registration_id: response.registration.registration_id,
        app_install_epoch_sha256: scope.app_install_epoch_sha256,
    };
    let scope_is_current = {
        let mut active = lock_active(runtime)?;
        match active.as_mut() {
            Some(current)
                if current.station_peer_id == scope.station_peer_id
                    && current.actor_ptid == scope.actor_ptid
                    && current.session_id == scope.session_id
                    && current.device_id == scope.device_id
                    && current.lifecycle_generation == scope.lifecycle_generation
                    && current.environment == scope.environment
                    && current.app_install_epoch_sha256 == scope.app_install_epoch_sha256 =>
            {
                current.registrations.insert(
                    RegistrationKey {
                        channel: binding.channel,
                        environment: scope.environment,
                    },
                    registration.clone(),
                );
                clear_pending_registration_if_matches(current, &binding);
                true
            }
            _ => false,
        }
    };
    if !scope_is_current {
        let _ = unregister_binding(session, &scope, &registration).await;
        return Err(push_error("push runtime was fenced during registration"));
    }
    Ok(())
}

async fn unregister_binding(
    session: &AuthenticatedNativeSession,
    scope: &ActivePushScope,
    registration: &RegisteredBinding,
) -> MobileResult<()> {
    let body = serde_json::to_vec(&json!({
        "request_id": Ulid::new().to_string(),
        "device_id": scope.device_id,
        "lifecycle_generation": scope.lifecycle_generation,
        "registration_id": registration.registration_id,
        "app_install_epoch_sha256": STANDARD.encode(registration.app_install_epoch_sha256),
    }))
    .map_err(|_| push_error("encode push unregister request"))?;
    let (status, _) = station_transport::execute_native_json(
        session,
        "notification_push_unregister",
        "/notification/push/unregister",
        body,
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(push_error(format!(
            "push unregister failed with http_{status}"
        )));
    }
    Ok(())
}

fn load_or_create_install_epoch(storage: &SecureStorage) -> MobileResult<[u8; 32]> {
    if let Some(encoded) = storage.get(PUSH_INSTALL_EPOCH_KEY)? {
        let decoded = decode_canonical_base64(&encoded, 32, 32, "push install epoch")?;
        return Ok(Sha256::digest(decoded).into());
    }
    let mut epoch = Zeroizing::new([0_u8; 32]);
    rand::thread_rng().fill_bytes(epoch.as_mut());
    storage.set(PUSH_INSTALL_EPOCH_KEY, &STANDARD.encode(epoch.as_ref()))?;
    Ok(Sha256::digest(epoch.as_ref()).into())
}

fn decode_canonical_base64(
    encoded: &str,
    min: usize,
    max: usize,
    field: &str,
) -> MobileResult<Vec<u8>> {
    let decoded = STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| push_error(format!("{field} is not base64")))?;
    if decoded.len() < min || decoded.len() > max || STANDARD.encode(&decoded) != encoded {
        return Err(push_error(format!("{field} is invalid")));
    }
    Ok(decoded)
}

fn clean_text(value: Option<&str>, max: usize, field: &str) -> MobileResult<String> {
    let value = value.ok_or_else(|| push_error(format!("{field} is missing")))?;
    if value.is_empty() || value.len() > max || value.trim() != value {
        return Err(push_error(format!("{field} is invalid")));
    }
    Ok(value.to_string())
}

fn platform_matches(platform: &str) -> bool {
    #[cfg(target_os = "android")]
    {
        return platform == "android";
    }
    #[cfg(target_os = "ios")]
    {
        return platform == "ios";
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        matches!(platform, "android" | "ios")
    }
}

fn schedule_identifier(environment: PushEnvironment) -> &'static str {
    match environment {
        PushEnvironment::Development => "com.peers.touch.mobile.reconcile.v1.development",
        PushEnvironment::Production => "com.peers.touch.mobile.reconcile.v1.production",
    }
}

fn current_time_ms() -> MobileResult<u64> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| push_error("system clock is before unix epoch"))?;
    u64::try_from(elapsed.as_millis()).map_err(|_| push_error("system clock exceeds u64"))
}

fn lock_active(
    runtime: &PushBridgeRuntime,
) -> MobileResult<MutexGuard<'_, Option<ActivePushScope>>> {
    runtime
        .active
        .lock()
        .map_err(|_| push_error("push runtime lock poisoned"))
}

fn push_error(message: impl Into<String>) -> MobileError {
    MobileError::coded("MOBILE_PUSH", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(generation: u64) -> PushBridgeRuntime {
        let install = Sha256::digest(b"install").into();
        PushBridgeRuntime {
            active: Mutex::new(Some(ActivePushScope {
                station_peer_id: "station".to_string(),
                actor_ptid: "ptid:alice".to_string(),
                session_id: "session".to_string(),
                device_id: "device".to_string(),
                lifecycle_generation: generation,
                environment: PushEnvironment::Development,
                app_install_epoch_sha256: install,
                last_native_sequence: HashMap::new(),
                last_scheduled_sequence: HashMap::new(),
                pending_registration: None,
                registrations: HashMap::new(),
            })),
            ..PushBridgeRuntime::default()
        }
    }

    fn token_callback(generation: u64, sequence: u64) -> NativePushCallback {
        NativePushCallback {
            kind: "token".to_string(),
            platform: "ios".to_string(),
            sequence,
            lifecycle_generation: generation,
            environment: Some("development".to_string()),
            apns_token_base64: Some(STANDARD.encode([7_u8; 32])),
            apns_topic: Some("com.peers.touch.mobile".to_string()),
            fcm_token: None,
            unified_endpoint: None,
            unified_p256dh_base64: None,
            unified_auth_base64: None,
            notification_id: None,
            category: None,
            target_hint: None,
            issued_at_ms: None,
            expires_at_ms: None,
        }
    }

    #[test]
    fn stale_and_duplicate_native_push_callbacks_are_discarded() {
        let current = 42;
        let runtime = runtime(current);
        assert!(
            admit_callback(&runtime, token_callback(current - 1, 1), 10, current)
                .unwrap()
                .is_none()
        );
        assert!(
            admit_callback(&runtime, token_callback(current, 2), 10, current)
                .unwrap()
                .is_some()
        );
        assert!(
            admit_callback(&runtime, token_callback(current, 2), 10, current)
                .unwrap()
                .is_none()
        );
        assert!(
            admit_callback(&runtime, token_callback(current, 1), 10, current)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn push_wakeup_rejects_private_or_expired_shapes() {
        let current = 42;
        let runtime = runtime(current);
        let mut callback = token_callback(current, 1);
        callback.kind = "tap".to_string();
        callback.apns_token_base64 = None;
        callback.apns_topic = None;
        callback.environment = None;
        callback.notification_id = Some("notification-1".to_string());
        callback.category = Some(2);
        callback.target_hint = Some("conversation".to_string());
        callback.issued_at_ms = Some(1_000);
        callback.expires_at_ms = Some(2_000);

        assert!(admit_callback(&runtime, callback.clone(), 1_500, current)
            .unwrap()
            .is_some());
        callback.sequence = 2;
        assert!(admit_callback(&runtime, callback, 2_001, current).is_err());
    }

    #[test]
    fn scheduled_callbacks_use_one_identifier_and_monotonic_sequence() {
        let current = 42;
        let runtime = runtime(current);
        let callback = tauri_plugin_peers_platform_permissions::NativeScheduledCallback {
            completion_id: "com.peers.touch.mobile.reconcile.v1.development:1".to_string(),
            identifier: "com.peers.touch.mobile.reconcile.v1.development".to_string(),
            platform: "ios".to_string(),
            sequence: 1,
            lifecycle_generation: current,
            deadline_ms: 20_000,
        };
        assert!(admit_scheduled_callback(&runtime, &callback, 1_000, current).unwrap());
        assert!(!admit_scheduled_callback(&runtime, &callback, 1_000, current).unwrap());

        let mut wrong = callback;
        wrong.sequence = 2;
        wrong.identifier = "com.peers.touch.mobile.other".to_string();
        assert!(!admit_scheduled_callback(&runtime, &wrong, 1_000, current).unwrap());
    }

    #[test]
    fn older_registration_response_does_not_clear_a_newer_same_channel_token() {
        let runtime = runtime(42);
        let older = PushTokenBinding {
            request_id: Ulid::new().to_string(),
            lifecycle_generation: 41,
            attempts: 0,
            channel: "fcm",
            body: json!({"fcm": {"token": "older"}}),
        };
        let newer = PushTokenBinding {
            request_id: Ulid::new().to_string(),
            lifecycle_generation: 42,
            attempts: 0,
            channel: "fcm",
            body: json!({"fcm": {"token": "newer"}}),
        };

        set_pending_registration(&runtime, newer.clone()).unwrap();
        clear_pending_registration_if_matches(
            runtime.active.lock().unwrap().as_mut().unwrap(),
            &older,
        );
        let retained = pending_registration(&runtime).unwrap().unwrap();
        assert!(retained == newer);
        assert_eq!(retained.request_id, newer.request_id);
        assert_eq!(retained.lifecycle_generation, 42);

        clear_pending_registration_if_matches(
            runtime.active.lock().unwrap().as_mut().unwrap(),
            &newer,
        );
        assert!(pending_registration(&runtime).unwrap().is_none());
    }

    #[test]
    fn registration_retry_budget_preserves_identity_and_stops() {
        let runtime = runtime(42);
        set_pending_registration(
            &runtime,
            PushTokenBinding {
                request_id: Ulid::new().to_string(),
                lifecycle_generation: 42,
                attempts: 0,
                channel: "fcm",
                body: json!({"fcm": {"token": "provider-token"}}),
            },
        )
        .unwrap();

        for expected_attempts in 1..MAX_PUSH_REGISTRATION_ATTEMPTS {
            let pending = pending_registration(&runtime).unwrap().unwrap();
            let request_id = pending.request_id.clone();
            record_registration_failure(&runtime, &pending).unwrap();
            let retained = pending_registration(&runtime).unwrap().unwrap();
            assert_eq!(retained.request_id, request_id);
            assert_eq!(retained.lifecycle_generation, 42);
            assert_eq!(retained.attempts, expected_attempts);
        }

        let pending = pending_registration(&runtime).unwrap().unwrap();
        record_registration_failure(&runtime, &pending).unwrap();
        assert!(pending_registration(&runtime).unwrap().is_none());
    }
}
