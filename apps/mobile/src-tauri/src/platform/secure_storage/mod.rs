#[cfg(target_os = "android")]
mod android;

#[cfg(target_os = "ios")]
mod ios_keychain;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod unsupported;

#[cfg(target_os = "android")]
pub use android::SecureStorage;

#[cfg(target_os = "ios")]
pub use ios_keychain::SecureStorage;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use unsupported::SecureStorage;
