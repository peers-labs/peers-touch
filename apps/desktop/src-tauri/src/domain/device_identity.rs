use std::thread;
use std::time::Duration;

use crate::state::AppState;

const MAX_ENROLLMENT_ATTEMPTS: u32 = 15;
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(500);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(4);

#[derive(Debug)]
pub enum DeviceEnrollmentError {
    RegistryAccess(String),
    NoEngine,
    ExhaustedRetries { attempts: u32, last_error: String },
}

impl std::fmt::Display for DeviceEnrollmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RegistryAccess(e) => write!(f, "device enrollment registry access failed: {e}"),
            Self::NoEngine => write!(f, "device enrollment requires an active messaging engine"),
            Self::ExhaustedRetries {
                attempts,
                last_error,
            } => {
                write!(
                    f,
                    "device enrollment failed after {attempts} attempts: {last_error}"
                )
            }
        }
    }
}

/// Attempt device enrollment exactly once without retries. Returns immediately
/// regardless of outcome, suitable for the auth login hot path where the
/// lifecycle worker handles subsequent retries.
pub fn try_enroll_device_once(
    state: &AppState,
    account_id: &str,
    token: &str,
) -> Result<(), DeviceEnrollmentError> {
    let engine = state
        .messaging_engines
        .get(account_id)
        .map_err(|e| DeviceEnrollmentError::RegistryAccess(e))?
        .ok_or(DeviceEnrollmentError::NoEngine)?;

    match engine.enroll_pending_device(token, "Desktop".to_string()) {
        Ok(None) => Ok(()),
        Ok(Some(device)) => {
            tracing::info!(
                device_id = %device.r#ref.as_ref().map(|reference| reference.device_id.as_str()).unwrap_or("?"),
                signing_key_id = %device.signing_key_id,
                "device identity enrolled successfully"
            );
            Ok(())
        }
        Err(error) => Err(DeviceEnrollmentError::ExhaustedRetries {
            attempts: 1,
            last_error: error,
        }),
    }
}

/// Attempt device enrollment with exponential-backoff retries. This blocks the
/// calling thread for up to ~30s in the worst case; prefer `try_enroll_device_once`
/// on latency-sensitive paths.
pub fn ensure_device_enrolled(
    state: &AppState,
    account_id: &str,
    token: &str,
) -> Result<(), DeviceEnrollmentError> {
    let engine = state
        .messaging_engines
        .get(account_id)
        .map_err(|e| DeviceEnrollmentError::RegistryAccess(e))?
        .ok_or(DeviceEnrollmentError::NoEngine)?;

    for attempt in 0..MAX_ENROLLMENT_ATTEMPTS {
        match engine.enroll_pending_device(token, "Desktop".to_string()) {
            Ok(None) => {
                return Ok(());
            }
            Ok(Some(device)) => {
                tracing::info!(
                    device_id = %device.r#ref.as_ref().map(|reference| reference.device_id.as_str()).unwrap_or("?"),
                    signing_key_id = %device.signing_key_id,
                    "device identity enrolled successfully"
                );
                return Ok(());
            }
            Err(error) => {
                if attempt + 1 >= MAX_ENROLLMENT_ATTEMPTS {
                    return Err(DeviceEnrollmentError::ExhaustedRetries {
                        attempts: MAX_ENROLLMENT_ATTEMPTS,
                        last_error: error,
                    });
                }
                let delay = INITIAL_RETRY_DELAY
                    .mul_f64(1.5_f64.powi(attempt as i32))
                    .min(MAX_RETRY_DELAY);
                tracing::info!(
                    attempt = attempt + 1,
                    delay_ms = delay.as_millis() as u64,
                    error = %error,
                    "device enrollment attempt failed, retrying"
                );
                thread::sleep(delay);
            }
        }
    }
    unreachable!()
}
