//! Noninteractive access to the existing login-keychain generic password.
//! An inaccessible item is an error, never an absent rollback watermark.
use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFRetained, CFString, CFType};
#[allow(deprecated)]
use objc2_security::{
    errSecItemNotFound, errSecSuccess, kSecAttrAccount, kSecAttrService, kSecClass,
    kSecClassGenericPassword, kSecReturnData, kSecUseAuthenticationUI, kSecUseAuthenticationUIFail,
    kSecValueData, SecItemAdd, SecItemCopyMatching, SecItemUpdate,
};
use std::ptr::{self, NonNull};
use x_config_core::XConfigError;

// This per-operation policy also covers the legacy login keychain used by
// keyring::apple_native; do not change the process-wide interaction policy.
#[allow(deprecated)]
fn query(
    service: &str,
    account: &str,
    extra: Option<(&CFString, &CFType)>,
) -> CFRetained<CFDictionary<CFType, CFType>> {
    let service = CFString::from_str(service);
    let account = CFString::from_str(account);
    // SAFETY: Security exports immutable CFString constants. The typed SDK
    // dictionary retains every key/value for the lifetime of the query.
    unsafe {
        let mut keys: Vec<&CFType> = vec![
            kSecClass.as_ref(),
            kSecAttrService.as_ref(),
            kSecAttrAccount.as_ref(),
            kSecUseAuthenticationUI.as_ref(),
        ];
        let mut values: Vec<&CFType> = vec![
            kSecClassGenericPassword.as_ref(),
            service.as_ref(),
            account.as_ref(),
            kSecUseAuthenticationUIFail.as_ref(),
        ];
        if let Some((key, value)) = extra {
            keys.push(key.as_ref());
            values.push(value);
        }
        CFDictionary::from_slices(&keys, &values)
    }
}

pub(super) fn load(service: &str, account: &str) -> Result<Option<Vec<u8>>, XConfigError> {
    let mut result = ptr::null();
    // SAFETY: Query requests only data; result is a valid out pointer. On
    // success CopyMatching transfers one owned CFType reference to us.
    let status = unsafe {
        let query = query(
            service,
            account,
            Some((kSecReturnData, CFBoolean::new(true).as_ref())),
        );
        SecItemCopyMatching(query.as_opaque(), &mut result)
    };
    if status == errSecItemNotFound {
        return Ok(None);
    }
    check_status(status)?;
    let pointer =
        NonNull::new(result.cast_mut()).ok_or_else(|| XConfigError::new("watermark_keyring"))?;
    let value = unsafe { CFRetained::<CFType>::from_raw(pointer) };
    let data = value
        .downcast::<CFData>()
        .map_err(|_| XConfigError::new("watermark_decode"))?;
    Ok(Some(data.to_vec()))
}

pub(super) fn save(service: &str, account: &str, bytes: &[u8]) -> Result<(), XConfigError> {
    let data = CFData::from_bytes(bytes);
    // SAFETY: Update contains only kSecValueData. All queries forbid UI.
    // Only genuine item-not-found permits Add; access errors never do.
    let status = unsafe {
        let update = CFDictionary::<CFType, CFType>::from_slices(
            &[kSecValueData.as_ref()],
            &[data.as_ref()],
        );
        let status = SecItemUpdate(
            query(service, account, None).as_opaque(),
            update.as_opaque(),
        );
        if status == errSecItemNotFound {
            SecItemAdd(
                query(service, account, Some((kSecValueData, data.as_ref()))).as_opaque(),
                ptr::null_mut(),
            )
        } else {
            status
        }
    };
    check_status(status)
}

fn check_status(status: i32) -> Result<(), XConfigError> {
    if status == errSecSuccess {
        Ok(())
    } else {
        Err(XConfigError::new("watermark_keyring"))
    }
}
