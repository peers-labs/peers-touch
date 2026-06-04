#[cfg(target_os = "ios")]
mod ios_keychain;

#[cfg(not(target_os = "ios"))]
mod unsupported;

#[cfg(target_os = "ios")]
pub use ios_keychain::SecureStorage;

#[cfg(not(target_os = "ios"))]
pub use unsupported::SecureStorage;
