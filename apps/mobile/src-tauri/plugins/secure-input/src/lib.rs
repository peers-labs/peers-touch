use std::fmt;

#[cfg(any(target_os = "android", target_os = "ios", test))]
use serde::Deserialize;
use serde::Serialize;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;
use tauri::{plugin::Builder, Manager, Runtime};
use zeroize::Zeroizing;

const PLUGIN_NAME: &str = "peers-secure-input";
#[cfg(target_os = "android")]
const ANDROID_PLUGIN_IDENTIFIER: &str = "com.peers.touch.mobile.secureinput";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_secure_input);

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

    #[cfg(any(target_os = "android", target_os = "ios", test))]
    fn invalid_response(detail: impl Into<String>) -> Self {
        Self {
            operation: "request secret",
            detail: detail.into(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "native secure input {} failed: {}",
            self.operation, self.detail
        )
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(any(target_os = "android", target_os = "ios", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WireOutcome {
    Submitted,
    Cancelled,
    Expired,
    Busy,
    PlatformFailure,
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireResponse {
    request_id: String,
    lifecycle_generation: u64,
    outcome: WireOutcome,
    secret: Option<String>,
    error_code: Option<String>,
}

pub enum NativeSecretInputResult {
    Submitted(Zeroizing<String>),
    Cancelled,
    Expired,
    Busy,
    PlatformFailure,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSecretInputRequest<'a> {
    pub request_id: &'a str,
    pub purpose: &'a str,
    pub lifecycle_generation: u64,
    pub deadline_ms: u64,
    pub acceptance_autofill_allowed: bool,
    /// Native-to-native display material; never comes from the WebView.
    pub initial_secret: Option<&'a str>,
}

#[derive(Clone)]
pub struct SecureInput<R: Runtime> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    plugin_handle: PluginHandle<R>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> SecureInput<R> {
    pub async fn request_secret(
        &self,
        request: NativeSecretInputRequest<'_>,
    ) -> Result<NativeSecretInputResult> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let expected_request_id = request.request_id.to_string();
            let expected_generation = request.lifecycle_generation;
            let response = self
                .plugin_handle
                .run_mobile_plugin_async::<WireResponse>("requestSecret", request)
                .await
                .map_err(|error| Error::invoke("request secret", error))?;
            return decode_response(response, &expected_request_id, expected_generation);
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = request;
            Ok(NativeSecretInputResult::PlatformFailure)
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn decode_response(
    response: WireResponse,
    expected_request_id: &str,
    expected_generation: u64,
) -> Result<NativeSecretInputResult> {
    if response.request_id != expected_request_id
        || response.lifecycle_generation != expected_generation
    {
        return Err(Error::invalid_response("response identity mismatch"));
    }
    let has_error_code = response
        .error_code
        .as_deref()
        .is_some_and(|code| !code.trim().is_empty());
    match response.outcome {
        WireOutcome::Submitted => {
            if has_error_code {
                return Err(Error::invalid_response(
                    "submitted response included an error code",
                ));
            }
            let secret = response
                .secret
                .ok_or_else(|| Error::invalid_response("submitted response omitted its secret"))?;
            Ok(NativeSecretInputResult::Submitted(Zeroizing::new(secret)))
        }
        WireOutcome::Cancelled => {
            require_secret_absent(response.secret)?;
            Ok(NativeSecretInputResult::Cancelled)
        }
        WireOutcome::Expired => {
            require_secret_absent(response.secret)?;
            Ok(NativeSecretInputResult::Expired)
        }
        WireOutcome::Busy => {
            require_secret_absent(response.secret)?;
            Ok(NativeSecretInputResult::Busy)
        }
        WireOutcome::PlatformFailure => {
            require_secret_absent(response.secret)?;
            Ok(NativeSecretInputResult::PlatformFailure)
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn require_secret_absent(secret: Option<String>) -> Result<()> {
    if secret.is_some() {
        Err(Error::invalid_response(
            "non-submitted response included secret material",
        ))
    } else {
        Ok(())
    }
}

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let secure_input = SecureInput {
                plugin_handle: api
                    .register_android_plugin(ANDROID_PLUGIN_IDENTIFIER, "SecureInputPlugin")?,
            };

            #[cfg(target_os = "ios")]
            let secure_input = SecureInput {
                plugin_handle: api.register_ios_plugin(init_plugin_secure_input)?,
            };

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let secure_input: SecureInput<R> = {
                let _ = api;
                SecureInput {
                    _marker: std::marker::PhantomData,
                }
            };

            app.manage(secure_input);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(outcome: WireOutcome, secret: Option<&str>) -> WireResponse {
        WireResponse {
            request_id: "request-1".to_string(),
            lifecycle_generation: 7,
            outcome,
            secret: secret.map(str::to_string),
            error_code: None,
        }
    }

    #[test]
    fn submitted_secret_is_immediately_zeroizing() {
        let result = decode_response(
            response(WireOutcome::Submitted, Some("one two three")),
            "request-1",
            7,
        )
        .unwrap();
        match result {
            NativeSecretInputResult::Submitted(secret) => {
                assert_eq!(secret.as_str(), "one two three")
            }
            _ => panic!("submitted response must contain the one-shot secret"),
        }
    }

    #[test]
    fn secret_material_is_rejected_for_every_non_submitted_outcome() {
        for outcome in [
            WireOutcome::Cancelled,
            WireOutcome::Expired,
            WireOutcome::Busy,
            WireOutcome::PlatformFailure,
        ] {
            assert!(
                decode_response(response(outcome, Some("must-not-cross")), "request-1", 7,)
                    .is_err()
            );
        }
    }

    #[test]
    fn response_identity_is_generation_fenced() {
        assert!(decode_response(response(WireOutcome::Cancelled, None), "request-2", 7,).is_err());
        assert!(decode_response(response(WireOutcome::Cancelled, None), "request-1", 8,).is_err());
    }
}
