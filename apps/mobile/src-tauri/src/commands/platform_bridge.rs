// W7 Tauri commands for lifecycle bridge, permission, and network.

use serde::Deserialize;
use tauri::{command, AppHandle, Manager, Runtime, State};
use tauri_plugin_peers_platform_permissions::{
    NativeCapabilityState, NativeSystemActionState, PlatformPermissions,
};

use crate::error::MobileResult;
use crate::platform::background_bridge;
use crate::platform::ios::{
    CapabilityFact, CapabilityFactState, PlatformHostPort, SystemAction, SystemActionOutcome,
    SystemActionState,
};
use crate::platform::lifecycle_bridge::{
    self, LifecycleBridgeResult, NativeLifecycleEvent, NativeLifecyclePlatform,
    NativeLifecycleSignal, NativeLifecycleState, ResumeReconciliationReport,
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
use crate::platform::MobilePlatform;

const HOST_CAPABILITIES: &[&str] = &[
    "background-execution",
    "camera",
    "document-picker",
    "microphone",
    "notifications",
    "photo-library",
    "push",
    "share",
    "system-settings",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityObservationInput {
    capability: String,
}

#[command]
pub async fn capability_observe<R: Runtime>(
    app: AppHandle<R>,
    mobile_platform: State<'_, MobilePlatform>,
    input: CapabilityObservationInput,
) -> MobileResult<CapabilityFact> {
    if !HOST_CAPABILITIES.contains(&input.capability.as_str()) {
        return Err(crate::error::MobileError::invalid_input(
            "host capability is not part of the Mobile contract",
        ));
    }
    let host = app.try_state::<PlatformPermissions<R>>().ok_or_else(|| {
        crate::error::MobileError::coded(
            "MOBILE_PLATFORM_HOST",
            "native platform plugin is not registered",
        )
    })?;
    let observation = host
        .observe_capability(&input.capability)
        .await
        .map_err(|error| {
            crate::error::MobileError::coded(
                "MOBILE_PLATFORM_HOST",
                format!("failed to observe host capability: {error}"),
            )
        })?;
    if observation.timestamp_ms == 0
        || observation.source.trim().is_empty()
        || observation.source.len() > 128
        || observation
            .detail
            .as_deref()
            .is_some_and(|detail| detail.is_empty() || detail.len() > 256)
    {
        return Err(crate::error::MobileError::coded(
            "MOBILE_PLATFORM_HOST",
            "native capability observation is malformed",
        ));
    }
    Ok(CapabilityFact {
        capability: input.capability,
        release_target: mobile_platform.release_target(),
        state: match observation.state {
            NativeCapabilityState::Available => CapabilityFactState::Available,
            NativeCapabilityState::Unavailable => CapabilityFactState::Unavailable,
            NativeCapabilityState::Denied => CapabilityFactState::Denied,
            NativeCapabilityState::Restricted => CapabilityFactState::Restricted,
            NativeCapabilityState::Unsupported => CapabilityFactState::Unsupported,
            NativeCapabilityState::Unknown => CapabilityFactState::Unknown,
        },
        observed_at: format!("unix-ms:{}", observation.timestamp_ms),
        source: observation.source,
        detail: observation.detail,
    })
}

#[command]
pub async fn system_action_execute<R: Runtime>(
    app: AppHandle<R>,
    mobile_platform: State<'_, MobilePlatform>,
    action: SystemAction,
) -> MobileResult<SystemActionOutcome> {
    let host = app.try_state::<PlatformPermissions<R>>().ok_or_else(|| {
        crate::error::MobileError::coded(
            "MOBILE_PLATFORM_HOST",
            "native platform plugin is not registered",
        )
    })?;
    let (kind, text, url) = native_action_fields(&action)?;
    let outcome = host
        .execute_system_action(kind, text, url)
        .await
        .map_err(|error| {
            crate::error::MobileError::coded(
                "MOBILE_PLATFORM_HOST",
                format!("failed to execute host system action: {error}"),
            )
        })?;
    if outcome
        .reason
        .as_deref()
        .is_some_and(|reason| reason.is_empty() || reason.len() > 256)
    {
        return Err(crate::error::MobileError::coded(
            "MOBILE_PLATFORM_HOST",
            "native system action outcome is malformed",
        ));
    }
    Ok(SystemActionOutcome {
        release_target: mobile_platform.release_target(),
        state: match outcome.state {
            NativeSystemActionState::Completed => SystemActionState::Completed,
            NativeSystemActionState::Cancelled => SystemActionState::Cancelled,
            NativeSystemActionState::Unavailable => SystemActionState::Unavailable,
            NativeSystemActionState::Failed => SystemActionState::Failed,
        },
        reason: outcome.reason,
    })
}

fn native_action_fields(
    action: &SystemAction,
) -> MobileResult<(&'static str, Option<&str>, Option<&str>)> {
    match action {
        SystemAction::OpenAppSettings => Ok(("open_app_settings", None, None)),
        SystemAction::OpenExternalUrl { url } => {
            validate_external_url(url)?;
            Ok(("open_external_url", None, Some(url.as_str())))
        }
        SystemAction::Share { text, url } => {
            if text.trim().is_empty() || text.len() > 4096 {
                return Err(crate::error::MobileError::invalid_input(
                    "share text is empty or exceeds the Mobile contract",
                ));
            }
            if let Some(url) = url {
                validate_external_url(url)?;
            }
            Ok(("share", Some(text.as_str()), url.as_deref()))
        }
        SystemAction::ReturnToSystem => Ok(("return_to_system", None, None)),
    }
}

fn validate_external_url(value: &str) -> MobileResult<()> {
    if value.len() > 2048 {
        return Err(crate::error::MobileError::invalid_input(
            "external URL exceeds the Mobile contract",
        ));
    }
    let url = tauri::Url::parse(value).map_err(|_| {
        crate::error::MobileError::invalid_input("external URL is not a canonical URL")
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(crate::error::MobileError::invalid_input(
            "external URL is not an allowed HTTP(S) origin",
        ));
    }
    Ok(())
}

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
pub async fn lifecycle_observe<R: Runtime>(
    app: AppHandle<R>,
) -> MobileResult<LifecycleBridgeResult> {
    let platform = app.try_state::<PlatformPermissions<R>>().ok_or_else(|| {
        crate::error::MobileError::lifecycle("native platform plugin is not registered")
    })?;
    let observation = platform.observe_lifecycle().await.map_err(|error| {
        crate::error::MobileError::lifecycle(format!("failed to observe native lifecycle: {error}"))
    })?;
    let platform = match observation.platform.as_str() {
        "android" => NativeLifecyclePlatform::Android,
        "ios" => NativeLifecyclePlatform::Ios,
        _ => {
            return Err(crate::error::MobileError::lifecycle(
                "invalid lifecycle platform",
            ))
        }
    };
    let state = match observation.state.as_str() {
        "foreground" => NativeLifecycleState::Foreground,
        "background" => NativeLifecycleState::Background,
        _ => {
            return Err(crate::error::MobileError::lifecycle(
                "invalid lifecycle state",
            ))
        }
    };
    // Initial OS observation establishes read admission; it is not a resume
    // transition for an already-running business runtime.
    Ok(
        lifecycle_bridge::process_native_signal(&NativeLifecycleSignal {
            platform,
            state,
            sequence: observation.sequence,
            timestamp_ms: observation.timestamp_ms,
        })?
        .result,
    )
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

#[cfg(test)]
mod tests {
    use super::{native_action_fields, SystemAction};

    #[test]
    fn system_actions_are_narrow_and_validate_external_urls() {
        assert_eq!(
            native_action_fields(&SystemAction::OpenAppSettings).unwrap(),
            ("open_app_settings", None, None)
        );
        assert_eq!(
            native_action_fields(&SystemAction::ReturnToSystem).unwrap(),
            ("return_to_system", None, None)
        );
        assert!(native_action_fields(&SystemAction::OpenExternalUrl {
            url: "file:///tmp/private".to_string(),
        })
        .is_err());
        assert!(native_action_fields(&SystemAction::OpenExternalUrl {
            url: "https://user@example.com".to_string(),
        })
        .is_err());
    }

    #[test]
    fn share_requires_bounded_text_and_optional_canonical_url() {
        assert!(native_action_fields(&SystemAction::Share {
            text: "hello".to_string(),
            url: Some("https://example.com/post/1".to_string()),
        })
        .is_ok());
        assert!(native_action_fields(&SystemAction::Share {
            text: " ".to_string(),
            url: None,
        })
        .is_err());
    }
}
