use std::fmt;

use serde::{Deserialize, Serialize};
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
            "native platform operation {} failed: {}",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeCapabilityState {
    Available,
    Unavailable,
    Denied,
    Restricted,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilityObservation {
    pub state: NativeCapabilityState,
    pub source: String,
    pub detail: Option<String>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeSystemActionState {
    Completed,
    Cancelled,
    Unavailable,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSystemActionOutcome {
    pub state: NativeSystemActionState,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileActionRequest<'a> {
    pub request_id: &'a str,
    pub kind: &'a str,
    pub local_path: &'a str,
    pub mime_type: &'a str,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileActionOutcome {
    pub request_id: String,
    pub state: NativeSystemActionState,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkObservationResponse {
    pub platform: String,
    pub connected: bool,
    pub network_type: String,
    pub sequence: u64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushArmResponse {
    pub armed: bool,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePushCallback {
    pub kind: String,
    pub platform: String,
    pub sequence: u64,
    pub lifecycle_generation: u64,
    pub environment: Option<String>,
    pub apns_token_base64: Option<String>,
    pub apns_topic: Option<String>,
    pub fcm_token: Option<String>,
    pub unified_endpoint: Option<String>,
    pub unified_p256dh_base64: Option<String>,
    pub unified_auth_base64: Option<String>,
    pub notification_id: Option<String>,
    pub category: Option<i32>,
    pub target_hint: Option<String>,
    pub issued_at_ms: Option<u64>,
    pub expires_at_ms: Option<u64>,
    pub error_code: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePushCallbackBatch {
    pub callbacks: Vec<NativePushCallback>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledReconcileRegistration {
    pub identifier: String,
    pub registered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScheduledCallback {
    pub completion_id: String,
    pub identifier: String,
    pub platform: String,
    pub sequence: u64,
    pub lifecycle_generation: u64,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScheduledCallbackBatch {
    pub callbacks: Vec<NativeScheduledCallback>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaPickRequest<'a> {
    pub request_id: &'a str,
    pub surface_kind: &'a str,
    pub capability: &'a str,
    pub lifecycle_generation: u64,
    pub deadline_ms: u64,
    pub accepted_media_kinds: &'a [String],
    pub max_item_count: u32,
    pub max_total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaPickItem {
    pub local_path: String,
    pub media_kind: String,
    pub mime_type: String,
    pub byte_length: u64,
    pub sha256_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaPickResponse {
    pub request_id: String,
    pub lifecycle_generation: u64,
    pub outcome: String,
    pub items: Vec<NativeMediaPickItem>,
    pub error_code: Option<String>,
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

    pub async fn observe_capability(
        &self,
        capability: &str,
    ) -> Result<NativeCapabilityObservation> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async(
                    "observeCapability",
                    CapabilityObservationArgs { capability },
                )
                .await
                .map_err(|error| Error::invoke("observe capability", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = capability;
            Ok(NativeCapabilityObservation {
                state: NativeCapabilityState::Unsupported,
                source: "unsupported-host".to_string(),
                detail: Some("mobile host is unavailable".to_string()),
                timestamp_ms: 0,
            })
        }
    }

    pub async fn execute_system_action(
        &self,
        kind: &str,
        text: Option<&str>,
        url: Option<&str>,
    ) -> Result<NativeSystemActionOutcome> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async(
                    "executeSystemAction",
                    SystemActionArgs { kind, text, url },
                )
                .await
                .map_err(|error| Error::invoke("execute system action", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = (kind, text, url);
            Ok(NativeSystemActionOutcome {
                state: NativeSystemActionState::Unavailable,
                reason: Some("mobile host is unavailable".to_string()),
            })
        }
    }

    pub async fn start_network_observation(&self) -> Result<NetworkObservationResponse> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async("startNetworkObservation", ())
                .await
                .map_err(|error| Error::invoke("start network observation", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            Ok(NetworkObservationResponse {
                platform: "unsupported".to_string(),
                connected: false,
                network_type: "none".to_string(),
                sequence: 0,
                timestamp_ms: 0,
            })
        }
    }

    pub async fn execute_file_action(
        &self,
        request: NativeFileActionRequest<'_>,
    ) -> Result<NativeFileActionOutcome> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async("executeFileAction", request)
                .await
                .map_err(|error| Error::invoke("file action", error));
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            Ok(NativeFileActionOutcome {
                request_id: request.request_id.into(),
                state: NativeSystemActionState::Unavailable,
                reason: Some("mobile host is unavailable".into()),
            })
        }
    }

    pub async fn cancel_file_action(&self, request_id: &str) -> Result<()> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async(
                    "cancelFileAction",
                    FileActionCancellationArgs { request_id },
                )
                .await
                .map_err(|error| Error::invoke("cancel file action", error));
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = request_id;
            Ok(())
        }
    }

    pub async fn arm_push(
        &self,
        lifecycle_generation: u64,
        environment: &str,
        scope_token: &str,
    ) -> Result<PushArmResponse> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async(
                    "armPush",
                    PushArmArgs {
                        lifecycle_generation,
                        environment,
                        scope_token,
                    },
                )
                .await
                .map_err(|error| Error::invoke("arm push", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = (lifecycle_generation, environment, scope_token);
            Ok(PushArmResponse { armed: false })
        }
    }

    pub async fn drain_push_callbacks(&self) -> Result<Vec<NativePushCallback>> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let batch: NativePushCallbackBatch = self
                .plugin_handle
                .run_mobile_plugin_async("drainPushCallbacks", ())
                .await
                .map_err(|error| Error::invoke("drain push callbacks", error))?;
            return Ok(batch.callbacks);
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            Ok(Vec::new())
        }
    }

    pub async fn disarm_push(&self) -> Result<()> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async("disarmPush", ())
                .await
                .map_err(|error| Error::invoke("disarm push", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            Ok(())
        }
    }

    pub async fn schedule_reconcile(
        &self,
        lifecycle_generation: u64,
        environment: &str,
        scope_token: &str,
    ) -> Result<ScheduledReconcileRegistration> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async(
                    "scheduleReconcile",
                    PushArmArgs {
                        lifecycle_generation,
                        environment,
                        scope_token,
                    },
                )
                .await
                .map_err(|error| Error::invoke("schedule reconcile", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = (lifecycle_generation, environment, scope_token);
            Ok(ScheduledReconcileRegistration {
                identifier: String::new(),
                registered: false,
            })
        }
    }

    pub async fn drain_scheduled_callbacks(&self) -> Result<Vec<NativeScheduledCallback>> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let batch: NativeScheduledCallbackBatch = self
                .plugin_handle
                .run_mobile_plugin_async("drainScheduledCallbacks", ())
                .await
                .map_err(|error| Error::invoke("drain scheduled callbacks", error))?;
            return Ok(batch.callbacks);
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            Ok(Vec::new())
        }
    }

    pub async fn complete_scheduled_callback(
        &self,
        completion_id: &str,
        success: bool,
    ) -> Result<()> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async(
                    "completeScheduledCallback",
                    ScheduledCompletionArgs {
                        completion_id,
                        success,
                    },
                )
                .await
                .map_err(|error| Error::invoke("complete scheduled callback", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = (completion_id, success);
            Ok(())
        }
    }

    pub async fn pick_media(
        &self,
        request: NativeMediaPickRequest<'_>,
    ) -> Result<NativeMediaPickResponse> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            return self
                .plugin_handle
                .run_mobile_plugin_async("pickMedia", request)
                .await
                .map_err(|error| Error::invoke("pick media", error));
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = request;
            Err(Error {
                operation: "pick media",
                detail: "unsupported platform".to_string(),
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

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityObservationArgs<'a> {
    capability: &'a str,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemActionArgs<'a> {
    kind: &'a str,
    text: Option<&'a str>,
    url: Option<&'a str>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileActionCancellationArgs<'a> {
    request_id: &'a str,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushArmArgs<'a> {
    lifecycle_generation: u64,
    environment: &'a str,
    scope_token: &'a str,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledCompletionArgs<'a> {
    completion_id: &'a str,
    success: bool,
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

    #[test]
    fn network_observation_response_requires_a_complete_typed_signal() {
        let response = serde_json::from_str::<NetworkObservationResponse>(
            r#"{"platform":"ios","connected":true,"networkType":"wifi","sequence":1,"timestampMs":2}"#,
        )
        .expect("valid response");
        assert_eq!(response.platform, "ios");
        assert_eq!(response.network_type, "wifi");
        assert!(serde_json::from_str::<NetworkObservationResponse>(
            r#"{"platform":"ios","connected":true,"networkType":"wifi","sequence":0}"#,
        )
        .is_err());
    }

    #[test]
    fn native_push_callback_keeps_provider_material_in_the_rust_boundary() {
        let callback = serde_json::from_str::<NativePushCallback>(
            r#"{
                "kind":"token",
                "platform":"ios",
                "sequence":1,
                "lifecycleGeneration":7,
                "environment":"development",
                "apnsTokenBase64":"AQ==",
                "apnsTopic":"com.peers.touch.mobile"
            }"#,
        )
        .expect("typed push callback");

        assert_eq!(callback.kind, "token");
        assert_eq!(callback.lifecycle_generation, 7);
        assert_eq!(callback.apns_token_base64.as_deref(), Some("AQ=="));
        assert!(callback.fcm_token.is_none());
        assert!(callback.error_code.is_none());
    }

    #[test]
    fn native_host_contract_rejects_unknown_states() {
        assert!(serde_json::from_str::<NativeCapabilityObservation>(
            r#"{"state":"ready","source":"host","timestampMs":1}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<NativeSystemActionOutcome>(
            r#"{"state":"opened","reason":null}"#,
        )
        .is_err());
    }
}
