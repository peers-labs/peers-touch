//! System sleep / screen-lock observer for the idle auto-lock.
//!
//! Tauri 2.12 has no built-in power monitor, so the macOS implementation
//! subscribes to the native notification centers directly (the project
//! already vendors objc2 for the tray and user-notification integrations):
//!
//! - `NSWorkspaceWillSleepNotification` on the workspace notification center
//!   fires when the system is about to sleep.
//! - `com.apple.screenIsLocked` on the distributed notification center fires
//!   when the user (or an automatic policy) locks the screen, including cases
//!   that do not sleep the machine.
//!
//! When either fires and the active account is PIN-protected, the raw session
//! token is purged — the same primitive `auth_restore_session` uses — and a
//! `desktop:locked` event tells the renderer to park on the PIN gate. Accounts
//! without a PIN are reported but left untouched so their restore edge enters
//! the shell directly.
//!
//! The observer is excluded from WebDriver acceptance builds, where native
//! lock/sleep events must never perturb automation. Non-macOS builds and
//! acceptance builds get a no-op so cross-platform contract checks compile.

#[cfg(all(target_os = "macos", not(feature = "acceptance-webdriver")))]
mod imp;

#[cfg(all(target_os = "macos", not(feature = "acceptance-webdriver")))]
pub use imp::init;

#[cfg(any(not(target_os = "macos"), feature = "acceptance-webdriver"))]
#[allow(dead_code)] // Uncalled under acceptance builds, which never install the observer.
pub fn init(_app: tauri::AppHandle<tauri::Wry>) -> Result<(), String> {
    tracing::debug!("idle auto-lock observer is disabled in this build");
    Ok(())
}
