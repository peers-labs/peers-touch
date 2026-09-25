// W7 Tauri commands for lifecycle bridge, permission, and network.

use serde::Deserialize;
use tauri::{command, AppHandle, Manager, Runtime, State};
use tauri_plugin_peers_platform_permissions::PlatformPermissions;

use crate::error::MobileResult;
use crate::platform::background_bridge;
use crate::platform::lifecycle_bridge::{
    self, LifecycleBridgeResult, NativeLifecycleEvent, NativeLifecycleSignal,
    ResumeReconciliationReport,
};
use crate::platform::media_picker::{
    self, MediaPickInput, MediaPickProjection, StagedMomentMediaInput,
};
use crate::platform::network_bridge::{
    self, NativeNetworkIngestResult, NativeNetworkPlatform, NativeNetworkSignal, NetworkState,
    NetworkType,
};
use crate::platform::permission_bridge::{
    self, PermissionCheckResult, PermissionKind, PermissionRequestResult,
};
use crate::platform::push_bridge::{
    self, PushActivationProjection, PushBridgeRuntime, PushDeactivationProjection,
    PushDrainProjection, PushScopeInput, ScheduledDrainProjection,
};
use crate::platform::secure_storage::SecureStorage;

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

#[command]
pub fn lifecycle_generation() -> u64 {
    lifecycle_bridge::current_generation()
}

#[command]
pub fn lifecycle_advance_generation() -> u64 {
    lifecycle_bridge::advance_generation()
}

#[command]
pub fn lifecycle_process_event(input: NativeLifecycleEvent) -> MobileResult<LifecycleBridgeResult> {
    lifecycle_bridge::process_lifecycle_event(&input)
}

#[command]
pub fn lifecycle_ingest_native_signal<R: Runtime>(
    app: AppHandle<R>,
    input: NativeLifecycleSignal,
) -> MobileResult<LifecycleBridgeResult> {
    background_bridge::ingest_native_lifecycle_signal(&app, input)
}

#[command]
pub fn lifecycle_reconcile<R: Runtime>(
    app: AppHandle<R>,
    input: ReconciliationReportInput,
) -> MobileResult<ResumeReconciliationReport> {
    background_bridge::perform_reconciliation(&app, input.session_valid)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationReportInput {
    pub session_valid: bool,
}

// ---------------------------------------------------------------------------
// Permission commands
// ---------------------------------------------------------------------------

#[command]
pub async fn permission_check<R: Runtime>(
    app: AppHandle<R>,
    kind: PermissionKind,
) -> MobileResult<PermissionCheckResult> {
    permission_bridge::check_permission(&app, kind).await
}

#[command]
pub async fn permission_request<R: Runtime>(
    app: AppHandle<R>,
    kind: PermissionKind,
) -> MobileResult<PermissionRequestResult> {
    permission_bridge::request_permission(&app, kind).await
}

#[command]
pub async fn permission_check_all<R: Runtime>(
    app: AppHandle<R>,
) -> MobileResult<Vec<PermissionCheckResult>> {
    permission_bridge::check_all_permissions(&app).await
}

// ---------------------------------------------------------------------------
// Network commands
// ---------------------------------------------------------------------------

#[command]
pub fn network_state() -> NetworkState {
    network_bridge::get_network_state()
}

#[command]
pub async fn network_start_observation<R: Runtime>(
    app: AppHandle<R>,
) -> MobileResult<NativeNetworkIngestResult> {
    let platform = app.try_state::<PlatformPermissions<R>>().ok_or_else(|| {
        crate::error::MobileError::network("native platform plugin is not registered")
    })?;
    let response = platform
        .start_network_observation()
        .await
        .map_err(|error| {
            crate::error::MobileError::network(format!(
                "failed to start native network observation: {error}"
            ))
        })?;
    let platform = match response.platform.as_str() {
        "android" => NativeNetworkPlatform::Android,
        "ios" => NativeNetworkPlatform::Ios,
        _ => {
            return Err(crate::error::MobileError::network(
                "native network observation returned an invalid platform",
            ))
        }
    };
    let network_type = match response.network_type.as_str() {
        "none" => NetworkType::None,
        "wifi" => NetworkType::Wifi,
        "cellular" => NetworkType::Cellular,
        "ethernet" => NetworkType::Ethernet,
        "unknown" => NetworkType::Unknown,
        _ => {
            return Err(crate::error::MobileError::network(
                "native network observation returned an invalid network type",
            ))
        }
    };
    network_bridge::ingest_native_signal(NativeNetworkSignal {
        platform,
        connected: response.connected,
        network_type,
        sequence: response.sequence,
        timestamp_ms: response.timestamp_ms,
    })
}

#[command]
pub fn network_ingest_native_signal(
    input: NativeNetworkSignal,
) -> MobileResult<NativeNetworkIngestResult> {
    network_bridge::ingest_native_signal(input)
}

#[command]
pub fn network_is_connected() -> bool {
    network_bridge::is_connected()
}

// ---------------------------------------------------------------------------
// Push commands
// ---------------------------------------------------------------------------

#[command]
pub async fn push_activate<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    runtime: State<'_, PushBridgeRuntime>,
    input: PushScopeInput,
) -> MobileResult<PushActivationProjection> {
    push_bridge::activate(&app, &storage, &runtime, input).await
}

#[command]
pub async fn push_drain<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    runtime: State<'_, PushBridgeRuntime>,
    input: PushScopeInput,
) -> MobileResult<PushDrainProjection> {
    push_bridge::drain(&app, &storage, &runtime, input).await
}

#[command]
pub async fn push_deactivate<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    runtime: State<'_, PushBridgeRuntime>,
) -> MobileResult<PushDeactivationProjection> {
    push_bridge::deactivate(&app, &storage, &runtime).await
}

#[command]
pub async fn scheduled_reconcile_drain<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    runtime: State<'_, PushBridgeRuntime>,
    input: PushScopeInput,
) -> MobileResult<ScheduledDrainProjection> {
    push_bridge::drain_scheduled(&app, &storage, &runtime, input).await
}

#[command]
pub async fn media_pick<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    input: MediaPickInput,
) -> MobileResult<MediaPickProjection> {
    media_picker::pick(&app, &storage, input).await
}

#[command]
pub async fn moment_media_upload<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    input: StagedMomentMediaInput,
) -> MobileResult<Vec<u8>> {
    media_picker::upload_moment_media(&app, &storage, input).await
}

#[command]
pub fn moment_media_discard<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    input: StagedMomentMediaInput,
) -> MobileResult<()> {
    media_picker::discard_moment_media(&app, &storage, input)
}
