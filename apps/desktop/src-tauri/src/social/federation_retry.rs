//! Bounded retry for the asynchronous cross-station private content flow.
//!
//! A remote (cross-station) private comment, reaction or poll operation is
//! resolved by an asynchronous federation round-trip. On the first call the
//! home station durably enqueues the interaction and answers
//! `SOCIAL_PRIVATE_DEPENDENCY_FAILURE` until the source station produces the
//! encryption plan / result. The stable command id makes every repeated call
//! an idempotent exact replay, so polling the pending condition is safe.

use std::time::Duration;

use crate::secure_content::adapter::NativeTransportError;

/// Station domain code carried in the error response's
/// `private_content_code` detail while a federated interaction is still
/// pending its durable cross-station resolution.
pub(crate) const FEDERATION_DEPENDENCY_PENDING_CODE: &str =
    "SOCIAL_PRIVATE_DEPENDENCY_FAILURE";

/// Upper bound on prepare/submit polls. The observed round-trip resolves in
/// ~1s; this window tolerates a slow or briefly contended federation link
/// without turning a genuine outage into an unbounded wait.
pub(crate) const FEDERATION_PREPARE_MAX_ATTEMPTS: u32 = 10;
pub(crate) const FEDERATION_PREPARE_BACKOFF: Duration = Duration::from_millis(700);

pub(crate) fn is_federation_dependency_pending(error: &NativeTransportError) -> bool {
    error.message == FEDERATION_DEPENDENCY_PENDING_CODE
}

/// Retry an idempotent federation call while the station reports the expected
/// asynchronous dependency-pending condition. The sleep hook is injectable so
/// the bounded backoff stays deterministic in tests.
pub(crate) fn with_federation_dependency_retry<T, F, S>(
    mut attempt_call: F,
    sleep: S,
) -> Result<T, NativeTransportError>
where
    F: FnMut(u32) -> Result<T, NativeTransportError>,
    S: Fn(Duration),
{
    let mut attempts = 0u32;
    loop {
        match attempt_call(attempts) {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !is_federation_dependency_pending(&error)
                    || attempts + 1 >= FEDERATION_PREPARE_MAX_ATTEMPTS
                {
                    return Err(error);
                }
                attempts += 1;
                sleep(FEDERATION_PREPARE_BACKOFF);
            }
        }
    }
}
