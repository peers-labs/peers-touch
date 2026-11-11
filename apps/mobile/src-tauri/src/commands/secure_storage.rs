use tauri::State;

use crate::error::MobileResult;
use crate::platform::secure_storage::SecureStorage;

#[tauri::command]
pub fn secure_storage_set(
    storage: State<'_, SecureStorage>,
    key: String,
    value: String,
) -> MobileResult<()> {
    validate_key(&key)?;
    storage.set(&key, &value).map_err(Into::into)
}

#[tauri::command]
pub fn secure_storage_get(
    storage: State<'_, SecureStorage>,
    key: String,
) -> MobileResult<Option<String>> {
    validate_key(&key)?;
    storage.get(&key).map_err(Into::into)
}

#[tauri::command]
pub fn secure_storage_remove(storage: State<'_, SecureStorage>, key: String) -> MobileResult<()> {
    validate_key(&key)?;
    storage.remove(&key).map_err(Into::into)
}

/// Acceptance-only bridge for parent-owned preset actor identities. The web
/// acceptance harness holds no live Session scope, so it addresses the
/// Rust-owned identity namespace by its scoped key; the crypto domain owns
/// key/seed validation and read-back verification. The generic web storage
/// fence above stays intact and production builds never register this
/// command.
#[cfg(feature = "acceptance-harness")]
#[tauri::command]
pub fn secure_storage_acceptance_seed_identity(
    storage: State<'_, SecureStorage>,
    key: String,
    seed_base64: String,
) -> MobileResult<()> {
    crate::domain::crypto::identity_keys::acceptance_replace_identity_seed(
        &storage,
        &key,
        &seed_base64,
    )
}

fn validate_key(key: &str) -> MobileResult<()> {
    if key.trim().is_empty() {
        return Err(crate::error::MobileError::invalid_input(
            "secure storage key must not be empty",
        ));
    }

    if !key
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
    {
        return Err(crate::error::MobileError::invalid_input(
            "secure storage key may only contain ASCII letters, digits, dash, underscore, and dot",
        ));
    }
    if key.starts_with("oauth.")
        || key.starts_with("peers-touch.mobile.auth-session.")
        || key == "peers-touch.mobile.auth-active-scope.v1"
        || key.starts_with("peers-touch.mobile.reliability.")
        || key.starts_with("peers-touch.mobile.station-route-source.v1.")
        || key.starts_with("peers-touch.mobile.station-transport.v1.")
        || key.starts_with("peers-touch.mobile.x-config.")
        || key.starts_with("peers-touch.mobile.device-link.")
        || key.starts_with("mobile-crypto-identity.")
        || key.starts_with("messaging.v1.device-signing-seed.")
    {
        return Err(crate::error::MobileError::invalid_input(
            "secure storage key belongs to a Rust-owned namespace",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_storage_commands_cannot_address_native_oauth_records() {
        assert!(validate_key("mobile.storage.smoke").is_ok());
        assert!(validate_key("oauth.active.index").is_err());
        assert!(validate_key("oauth.session.scope").is_err());
        assert!(validate_key("peers-touch.mobile.auth-session.v1").is_err());
        assert!(validate_key("peers-touch.mobile.auth-session.v1.station.actor").is_err());
        assert!(validate_key("peers-touch.mobile.auth-active-scope.v1").is_err());
        assert!(validate_key("peers-touch.mobile.reliability.install-kek.v1").is_err());
        assert!(validate_key("peers-touch.mobile.reliability.scope-key-inventory.v1").is_err());
        assert!(validate_key("peers-touch.mobile.station-route-source.v1.deadbeef").is_err());
        assert!(validate_key("peers-touch.mobile.x-config.watermark.v1.stable").is_err());
        assert!(validate_key(
            "mobile-crypto-identity.v1.identity.0123456789abcdef0123456789abcdef"
        )
        .is_err());
        assert!(validate_key("messaging.v1.device-signing-seed.deadbeef").is_err());
    }

    #[test]
    fn web_storage_cannot_read_write_or_remove_scoped_transport_identity() {
        use station_trust::transport_identity::TransportIdentityScope;
        for scope in [
            TransportIdentityScope::DirectStation("station".into()),
            TransportIdentityScope::Relay("relay".into()),
            TransportIdentityScope::ProvisionalEndpointOrigin("https://relay.example".into()),
        ] {
            let key = crate::platform::transport_identity::storage_key(&scope);
            let error = validate_key(&key).unwrap_err();
            assert_eq!(
                error.message,
                "secure storage key belongs to a Rust-owned namespace"
            );
        }
    }
}
