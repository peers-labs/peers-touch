use std::fmt;

use serde::Deserialize;
#[cfg(any(target_os = "android", target_os = "ios"))]
use serde::Serialize;
use tauri::{plugin::Builder, Manager, Runtime};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;

const PLUGIN_NAME: &str = "peers-platform-permissions";
#[cfg(target_os = "android")]
const ANDROID_PLUGIN_IDENTIFIER: &str = "com.peers.touch.mobile.platformpermissions";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_platform_permissions);

#[derive(Debug)]
pub struct Error {
    operation: &'static str,
    detail: String,
}

impl Error {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    fn invoke(operation: &'static str, error: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Self {
            operation,
            detail: error.to_string(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "native platform permission {} failed: {}",
            self.operation, self.detail
        )
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub status: PermissionStatus,
    pub can_request: bool,
}

#[derive(Clone)]
pub struct PlatformPermissions<R: Runtime> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    plugin_handle: PluginHandle<R>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> PlatformPermissions<R> {
    pub async fn check(&self, kind: &str) -> Result<PermissionResponse> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async("check", PermissionArgs { kind })
                .await
                .map_err(|error| Error::invoke("check", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = kind;
            Ok(PermissionResponse {
                status: PermissionStatus::Unsupported,
                can_request: false,
            })
        }
    }

    pub async fn request(&self, kind: &str) -> Result<PermissionResponse> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async("request", PermissionArgs { kind })
                .await
                .map_err(|error| Error::invoke("request", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = kind;
            Ok(PermissionResponse {
                status: PermissionStatus::Unsupported,
                can_request: false,
            })
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionArgs<'a> {
    kind: &'a str,
}

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let platform_permissions = PlatformPermissions {
                plugin_handle: api.register_android_plugin(
                    ANDROID_PLUGIN_IDENTIFIER,
                    "PlatformPermissionsPlugin",
                )?,
            };

            #[cfg(target_os = "ios")]
            let platform_permissions = PlatformPermissions {
                plugin_handle: api.register_ios_plugin(init_plugin_platform_permissions)?,
            };

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let platform_permissions: PlatformPermissions<R> = {
                let _ = api;
                PlatformPermissions {
                    _marker: std::marker::PhantomData,
                }
            };

            app.manage(platform_permissions);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_response_rejects_unknown_native_status() {
        let error = serde_json::from_str::<PermissionResponse>(
            r#"{"status":"partially_granted","canRequest":false}"#,
        )
        .expect_err("unknown native status must fail closed");

        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn permission_response_accepts_every_public_status() {
        let statuses = [
            ("not_determined", PermissionStatus::NotDetermined),
            ("granted", PermissionStatus::Granted),
            ("denied", PermissionStatus::Denied),
            ("restricted", PermissionStatus::Restricted),
            ("unsupported", PermissionStatus::Unsupported),
        ];

        for (wire_status, expected) in statuses {
            let payload = format!(r#"{{"status":"{wire_status}","canRequest":false}}"#);
            let response =
                serde_json::from_str::<PermissionResponse>(&payload).expect("known status");
            assert_eq!(response.status, expected);
        }
    }
}
