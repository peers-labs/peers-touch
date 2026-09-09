// Permission Bridge — W7 native permission request abstraction.
//
// The Rust capability kernel owns the Web-facing contract. The native plugin
// performs only OS permission checks and prompts, returning a closed status
// enum that is mapped here before crossing the Tauri command boundary.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_peers_platform_permissions::{
    PermissionResponse as NativePermissionResponse, PermissionStatus as NativePermissionStatus,
    PlatformPermissions,
};

use crate::error::{MobileError, MobileResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    Camera,
    Microphone,
    Storage,
    Notifications,
}

impl PermissionKind {
    fn wire_name(self) -> &'static str {
        match self {
            Self::Camera => "camera",
            Self::Microphone => "microphone",
            Self::Storage => "storage",
            Self::Notifications => "notifications",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckResult {
    pub kind: PermissionKind,
    pub status: PermissionStatus,
    pub can_request: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestResult {
    pub kind: PermissionKind,
    pub status: PermissionStatus,
    pub was_already_granted: bool,
}

pub async fn check_permission<R: Runtime>(
    app: &AppHandle<R>,
    kind: PermissionKind,
) -> MobileResult<PermissionCheckResult> {
    let permissions = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| MobileError::permission("native permission plugin is not registered"))?;
    let response = permissions.check(kind.wire_name()).await.map_err(|error| {
        MobileError::permission(format!(
            "failed to check {} permission: {error}",
            kind.wire_name()
        ))
    })?;

    Ok(map_check_result(kind, response))
}

pub async fn request_permission<R: Runtime>(
    app: &AppHandle<R>,
    kind: PermissionKind,
) -> MobileResult<PermissionRequestResult> {
    let current = check_permission(app, kind).await?;

    if current.status == PermissionStatus::Granted {
        return Ok(PermissionRequestResult {
            kind,
            status: PermissionStatus::Granted,
            was_already_granted: true,
        });
    }

    if current.status == PermissionStatus::Unsupported {
        return Err(MobileError::permission(format!(
            "{} permission is not supported on this platform",
            kind.wire_name()
        )));
    }

    let permissions = app
        .try_state::<PlatformPermissions<R>>()
        .ok_or_else(|| MobileError::permission("native permission plugin is not registered"))?;
    let response = permissions
        .request(kind.wire_name())
        .await
        .map_err(|error| {
            MobileError::permission(format!(
                "failed to request {} permission: {error}",
                kind.wire_name()
            ))
        })?;

    Ok(PermissionRequestResult {
        kind,
        status: response.status.into(),
        was_already_granted: false,
    })
}

pub async fn check_all_permissions<R: Runtime>(
    app: &AppHandle<R>,
) -> MobileResult<Vec<PermissionCheckResult>> {
    let mut results = Vec::with_capacity(4);
    for kind in [
        PermissionKind::Camera,
        PermissionKind::Microphone,
        PermissionKind::Storage,
        PermissionKind::Notifications,
    ] {
        results.push(check_permission(app, kind).await?);
    }
    Ok(results)
}

fn map_check_result(
    kind: PermissionKind,
    response: NativePermissionResponse,
) -> PermissionCheckResult {
    PermissionCheckResult {
        kind,
        status: response.status.into(),
        can_request: response.can_request,
    }
}

impl From<NativePermissionStatus> for PermissionStatus {
    fn from(status: NativePermissionStatus) -> Self {
        match status {
            NativePermissionStatus::NotDetermined => Self::NotDetermined,
            NativePermissionStatus::Granted => Self::Granted,
            NativePermissionStatus::Denied => Self::Denied,
            NativePermissionStatus::Restricted => Self::Restricted,
            NativePermissionStatus::Unsupported => Self::Unsupported,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_permission_status_mapping_is_closed_and_preserves_requestability() {
        let cases = [
            (
                NativePermissionStatus::NotDetermined,
                PermissionStatus::NotDetermined,
                true,
            ),
            (
                NativePermissionStatus::Granted,
                PermissionStatus::Granted,
                false,
            ),
            (
                NativePermissionStatus::Denied,
                PermissionStatus::Denied,
                true,
            ),
            (
                NativePermissionStatus::Restricted,
                PermissionStatus::Restricted,
                false,
            ),
            (
                NativePermissionStatus::Unsupported,
                PermissionStatus::Unsupported,
                false,
            ),
        ];

        for (native_status, expected_status, can_request) in cases {
            let result = map_check_result(
                PermissionKind::Camera,
                NativePermissionResponse {
                    status: native_status,
                    can_request,
                },
            );
            assert_eq!(result.status, expected_status);
            assert_eq!(result.can_request, can_request);
        }
    }

    #[test]
    fn permission_kind_wire_names_match_native_contract() {
        assert_eq!(PermissionKind::Camera.wire_name(), "camera");
        assert_eq!(PermissionKind::Microphone.wire_name(), "microphone");
        assert_eq!(PermissionKind::Storage.wire_name(), "storage");
        assert_eq!(PermissionKind::Notifications.wire_name(), "notifications");
    }
}
