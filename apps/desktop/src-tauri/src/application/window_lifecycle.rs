//! Main-window close behavior for menu-bar residency (BOT-A30).
//!
//! When a system tray is installed, closing the main window hides it instead
//! of quitting, so the resident app keeps receiving bot and social events and
//! the tray restores the window. When no tray is available the residency flag
//! stays off and closing the window follows the default quit path. Acceptance /
//! WebDriver builds never intercept close so multi-slot window teardown keeps
//! its prior behavior.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, Runtime, Window, WindowEvent};

/// Process-wide switch flipped only after the tray installs successfully.
#[derive(Default)]
pub struct TrayResidency(AtomicBool);

impl TrayResidency {
    pub fn mark_resident(&self) {
        self.0.store(true, Ordering::Release);
    }

    fn is_resident(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Builder-level window event hook. Only the primary window is made resident,
/// and only outside acceptance builds once a tray is confirmed available;
/// every other window (and every non-close event) follows the default path.
pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if cfg!(feature = "acceptance-webdriver") {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != "main" {
        return;
    }
    let Some(residency) = window.try_state::<TrayResidency>() else {
        return;
    };
    if residency.is_resident() {
        api.prevent_close();
        if let Err(error) = window.hide() {
            tracing::warn!(error = %error, "tray: failed to hide main window on close");
        }
    }
}
