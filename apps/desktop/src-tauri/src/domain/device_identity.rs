use std::thread;
use std::time::Duration;

use crate::state::AppState;

const MAX_ENROLLMENT_ATTEMPTS: u32 = 15;
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(500);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(4);

pub fn ensure_device_enrolled(state: &AppState, account_id: &str, token: &str) -> Result<(), String> {
    let engine = state
        .messaging_engines
        .get(account_id)
        .map_err(|e| format!("device enrollment registry access failed: {e}"))?
        .ok_or_else(|| "device enrollment requires an active messaging engine".to_string())?;

    for attempt in 0..MAX_ENROLLMENT_ATTEMPTS {
        match engine.enroll_pending_device(token, "Desktop".to_string()) {
            Ok(None) => {
                return Ok(());
            }
            Ok(Some(device)) => {
                tracing::info!(
                    device_id = %device.endpoint.as_ref().map(|e| e.device_id.as_str()).unwrap_or("?"),
                    signing_key_id = %device.signing_key_id,
                    "device identity enrolled successfully"
                );
                return Ok(());
            }
            Err(error) => {
                if attempt + 1 >= MAX_ENROLLMENT_ATTEMPTS {
                    return Err(format!(
                        "device enrollment failed after {} attempts: {}",
                        MAX_ENROLLMENT_ATTEMPTS, error
                    ));
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
