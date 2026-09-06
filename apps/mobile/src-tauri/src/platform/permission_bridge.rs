// Permission Bridge — W7 native permission request abstraction.
//
// Provides a unified interface for requesting and checking platform
// permissions (camera, microphone, storage, notifications). Each
// platform implements the actual permission check through its native
// APIs; this module provides the common types and Tauri command layer.

use serde::{Deserialize, Serialize};

use crate::error::{MobileError, MobileResult};

// ---------------------------------------------------------------------------
// Permission types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    Camera,
    Microphone,
    Storage,
    Notifications,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    /// Permission has not been requested yet.
    NotDetermined,
    /// Permission was granted.
    Granted,
    /// Permission was denied by the user.
    Denied,
    /// Permission is restricted by system policy (parental controls, MDM).
    Restricted,
    /// Permission check is not supported on this platform.
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckResult {
    pub kind: PermissionKind,
    pub status: PermissionStatus,
    pub can_request: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestResult {
    pub kind: PermissionKind,
    pub status: PermissionStatus,
    pub was_already_granted: bool,
}

// ---------------------------------------------------------------------------
// Platform-agnostic permission operations
// ---------------------------------------------------------------------------

/// Check the current status of a permission without prompting.
///
/// On unsupported platforms, returns `PermissionStatus::Unsupported`.
pub fn check_permission(kind: PermissionKind) -> MobileResult<PermissionCheckResult> {
    let status = platform_check_permission(kind);
    let can_request = matches!(status, PermissionStatus::NotDetermined);

    Ok(PermissionCheckResult {
        kind,
        status,
        can_request,
    })
}

/// Request a permission from the user.
///
/// If already granted, returns immediately with `was_already_granted: true`.
/// On unsupported platforms, returns `PermissionStatus::Unsupported`.
pub fn request_permission(kind: PermissionKind) -> MobileResult<PermissionRequestResult> {
    let current = platform_check_permission(kind);

    if current == PermissionStatus::Granted {
        return Ok(PermissionRequestResult {
            kind,
            status: PermissionStatus::Granted,
            was_already_granted: true,
        });
    }

    if current == PermissionStatus::Unsupported {
        return Err(MobileError::permission(format!(
            "permission {:?} is not supported on this platform",
            kind
        )));
    }

    // Trigger the native permission prompt
    let result_status = platform_request_permission(kind);

    Ok(PermissionRequestResult {
        kind,
        status: result_status,
        was_already_granted: false,
    })
}

/// Check all permissions and return their statuses.
pub fn check_all_permissions() -> MobileResult<Vec<PermissionCheckResult>> {
    let kinds = [
        PermissionKind::Camera,
        PermissionKind::Microphone,
        PermissionKind::Storage,
        PermissionKind::Notifications,
    ];

    kinds.iter().map(|kind| check_permission(*kind)).collect()
}

// ---------------------------------------------------------------------------
// Platform-specific implementations
// ---------------------------------------------------------------------------

#[cfg(target_os = "ios")]
fn platform_check_permission(kind: PermissionKind) -> PermissionStatus {
    // iOS permission checks are done through AVFoundation / UserNotifications
    // frameworks. For now, return NotDetermined as the base implementation;
    // actual native bridging will be added when the iOS plugin surface is ready.
    match kind {
        PermissionKind::Camera | PermissionKind::Microphone | PermissionKind::Notifications => {
            PermissionStatus::NotDetermined
        }
        // iOS does not have a separate storage permission for photos library
        // access — it uses PHPhotoLibrary which has its own authorization.
        PermissionKind::Storage => PermissionStatus::NotDetermined,
    }
}

#[cfg(target_os = "ios")]
fn platform_request_permission(kind: PermissionKind) -> PermissionStatus {
    // iOS permission requests are async and require native bridging.
    // Return NotDetermined as a placeholder; the actual implementation
    // will use the Tauri plugin system for native iOS calls.
    match kind {
        PermissionKind::Camera
        | PermissionKind::Microphone
        | PermissionKind::Storage
        | PermissionKind::Notifications => PermissionStatus::NotDetermined,
    }
}

#[cfg(target_os = "android")]
fn platform_check_permission(kind: PermissionKind) -> PermissionStatus {
    // Android permission checks go through the Android permission system.
    // Placeholder implementation — actual bridging via JNI or Tauri plugin.
    match kind {
        PermissionKind::Camera
        | PermissionKind::Microphone
        | PermissionKind::Storage
        | PermissionKind::Notifications => PermissionStatus::NotDetermined,
    }
}

#[cfg(target_os = "android")]
fn platform_request_permission(kind: PermissionKind) -> PermissionStatus {
    match kind {
        PermissionKind::Camera
        | PermissionKind::Microphone
        | PermissionKind::Storage
        | PermissionKind::Notifications => PermissionStatus::NotDetermined,
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn platform_check_permission(_kind: PermissionKind) -> PermissionStatus {
    PermissionStatus::Unsupported
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn platform_request_permission(_kind: PermissionKind) -> PermissionStatus {
    PermissionStatus::Unsupported
}
