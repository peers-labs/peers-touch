use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_peers_secure_input::{
    NativeSecretInputRequest, NativeSecretInputResult, SecureInput,
};
use ulid::Ulid;
use zeroize::Zeroizing;

use crate::error::{MobileError, MobileResult};

const PRIVATE_SOCIAL_RECOVERY_PURPOSE: &str = "private_social_recovery";
const ACTOR_IDENTITY_RECOVERY_PURPOSE: &str = "actor_identity_recovery";
const PRIVATE_SOCIAL_RECOVERY_DEADLINE_MS: u64 = 120_000;

pub struct PrivateSocialRecoveryScope<'a> {
    pub active_station_peer_id: &'a str,
    pub active_actor_ptid: &'a str,
    pub active_device_id: &'a str,
    pub active_lifecycle_generation: u64,
    pub active_activation_generation: u64,
    pub requested_station_peer_id: &'a str,
    pub requested_actor_ptid: &'a str,
    pub requested_device_id: &'a str,
    pub requested_lifecycle_generation: u64,
    pub requested_activation_generation: u64,
}

pub fn validate_private_social_recovery_scope(
    scope: PrivateSocialRecoveryScope<'_>,
) -> MobileResult<()> {
    if scope.active_station_peer_id != scope.requested_station_peer_id
        || scope.active_actor_ptid != scope.requested_actor_ptid
        || scope.active_device_id != scope.requested_device_id
        || scope.active_lifecycle_generation == 0
        || scope.active_lifecycle_generation != scope.requested_lifecycle_generation
        || scope.active_activation_generation == 0
        || scope.active_activation_generation != scope.requested_activation_generation
    {
        return Err(MobileError::coded(
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_STALE_SCOPE",
            "private Social recovery scope is stale",
        ));
    }
    Ok(())
}

pub fn validate_private_social_recovery_request(
    requested_post_id: &str,
    recovery_epoch: u64,
) -> MobileResult<()> {
    if requested_post_id.trim().is_empty()
        || requested_post_id != requested_post_id.trim()
        || recovery_epoch == 0
    {
        return Err(MobileError::coded(
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_INVALID_INPUT",
            "private Social recovery identity is invalid",
        ));
    }
    Ok(())
}

pub fn validate_private_social_recovery_projection(
    requested_post_id: &str,
    projected_post_id: &str,
    recovery_required: bool,
) -> MobileResult<()> {
    if requested_post_id != projected_post_id || !recovery_required {
        return Err(MobileError::coded(
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_STATE",
            "private Social recovery is not required for this post",
        ));
    }
    Ok(())
}

pub async fn request_private_social_recovery_phrase<R: Runtime>(
    app: &AppHandle<R>,
    lifecycle_generation: u64,
) -> MobileResult<Zeroizing<String>> {
    request_recovery_phrase(app, lifecycle_generation, PRIVATE_SOCIAL_RECOVERY_PURPOSE).await
}

pub async fn request_actor_identity_recovery_phrase<R: Runtime>(
    app: &AppHandle<R>,
    lifecycle_generation: u64,
) -> MobileResult<Zeroizing<String>> {
    request_recovery_phrase(app, lifecycle_generation, ACTOR_IDENTITY_RECOVERY_PURPOSE).await
}

pub async fn confirm_actor_backup_phrase<R: Runtime>(
    app: &AppHandle<R>,
    lifecycle_generation: u64,
    phrase: &str,
) -> MobileResult<()> {
    let result = app
        .state::<SecureInput<R>>()
        .request_secret(NativeSecretInputRequest {
            request_id: &Ulid::new().to_string(),
            purpose: "actor_identity_backup",
            lifecycle_generation,
            deadline_ms: PRIVATE_SOCIAL_RECOVERY_DEADLINE_MS,
            acceptance_autofill_allowed: false,
            initial_secret: Some(phrase),
        })
        .await
        .map_err(|_| {
            MobileError::coded(
                "MOBILE_SECURE_INPUT_PLATFORM_FAILURE",
                "native secure display is unavailable",
            )
        })?;
    let confirmed = map_native_result(result)?;
    if confirmed.as_str() != phrase {
        return Err(MobileError::coded(
            "MOBILE_SECURE_INPUT_STALE_SCOPE",
            "native backup display changed",
        ));
    }
    Ok(())
}

async fn request_recovery_phrase<R: Runtime>(
    app: &AppHandle<R>,
    lifecycle_generation: u64,
    purpose: &'static str,
) -> MobileResult<Zeroizing<String>> {
    if lifecycle_generation == 0 {
        return Err(MobileError::coded(
            "MOBILE_SECURE_INPUT_STALE_SCOPE",
            "native secure input scope is stale",
        ));
    }
    let request_id = Ulid::new().to_string();
    let secure_input = app.state::<SecureInput<R>>();
    let result = secure_input
        .request_secret(NativeSecretInputRequest {
            request_id: &request_id,
            purpose,
            lifecycle_generation,
            deadline_ms: PRIVATE_SOCIAL_RECOVERY_DEADLINE_MS,
            acceptance_autofill_allowed: cfg!(feature = "acceptance-harness"),
            initial_secret: None,
        })
        .await
        .map_err(|_| {
            MobileError::coded(
                "MOBILE_SECURE_INPUT_PLATFORM_FAILURE",
                "native secure input is unavailable",
            )
        })?;
    map_native_result(result)
}

fn map_native_result(result: NativeSecretInputResult) -> MobileResult<Zeroizing<String>> {
    match result {
        NativeSecretInputResult::Submitted(secret) => Ok(secret),
        NativeSecretInputResult::Cancelled => Err(MobileError::coded(
            "MOBILE_SECURE_INPUT_CANCELLED",
            "native secure input was cancelled",
        )),
        NativeSecretInputResult::Expired => Err(MobileError::coded(
            "MOBILE_SECURE_INPUT_EXPIRED",
            "native secure input expired",
        )),
        NativeSecretInputResult::Busy => Err(MobileError::coded(
            "MOBILE_SECURE_INPUT_BUSY",
            "another native secure input request is active",
        )),
        NativeSecretInputResult::PlatformFailure => Err(MobileError::coded(
            "MOBILE_SECURE_INPUT_PLATFORM_FAILURE",
            "native secure input is unavailable",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recovery_scope() -> PrivateSocialRecoveryScope<'static> {
        PrivateSocialRecoveryScope {
            active_station_peer_id: "station-1",
            active_actor_ptid: "ptid:alice",
            active_device_id: "device-1",
            active_lifecycle_generation: 7,
            active_activation_generation: 9,
            requested_station_peer_id: "station-1",
            requested_actor_ptid: "ptid:alice",
            requested_device_id: "device-1",
            requested_lifecycle_generation: 7,
            requested_activation_generation: 9,
        }
    }

    #[test]
    fn private_social_recovery_requires_exact_scope_and_post_state() {
        assert!(validate_private_social_recovery_scope(recovery_scope()).is_ok());
        assert_eq!(
            validate_private_social_recovery_request(" post-1", 1)
                .unwrap_err()
                .code,
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_INVALID_INPUT"
        );

        let mut stale = recovery_scope();
        stale.requested_lifecycle_generation += 1;
        assert_eq!(
            validate_private_social_recovery_scope(stale)
                .unwrap_err()
                .code,
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_STALE_SCOPE"
        );

        assert_eq!(
            validate_private_social_recovery_projection("post-1", "post-2", true)
                .unwrap_err()
                .code,
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_STATE"
        );

        assert_eq!(
            validate_private_social_recovery_projection("post-1", "post-1", false)
                .unwrap_err()
                .code,
            "MOBILE_PRIVATE_SOCIAL_RECOVERY_STATE"
        );
    }

    #[test]
    fn native_terminal_outcomes_are_typed_and_secret_free() {
        let outcomes = [
            (
                NativeSecretInputResult::Cancelled,
                "MOBILE_SECURE_INPUT_CANCELLED",
            ),
            (
                NativeSecretInputResult::Expired,
                "MOBILE_SECURE_INPUT_EXPIRED",
            ),
            (NativeSecretInputResult::Busy, "MOBILE_SECURE_INPUT_BUSY"),
            (
                NativeSecretInputResult::PlatformFailure,
                "MOBILE_SECURE_INPUT_PLATFORM_FAILURE",
            ),
        ];
        for (outcome, expected_code) in outcomes {
            let error = map_native_result(outcome).unwrap_err();
            assert_eq!(error.code, expected_code);
            assert!(!error.message.contains("phrase"));
        }
    }

    #[test]
    fn submitted_secret_stays_in_zeroizing_memory() {
        let secret = map_native_result(NativeSecretInputResult::Submitted(Zeroizing::new(
            "one two three".to_string(),
        )))
        .unwrap();
        assert_eq!(secret.as_str(), "one two three");
    }
}
