//! Native resume watchdog for blank-webview recovery.
//!
//! The renderer acks every `RunEvent::Resumed` through `desktop_wake_ack`.
//! If no ack lands within [`WATCHDOG_BUDGET_MS`], the JS event loop or the
//! WKWebView content process is dead (a sleep-killed compositing surface that
//! never repainted), so the main webview is reloaded to force a clean boot.
//! The renderer-side watchdog in `kernel/wakeRecovery.ts` owns the softer
//! "JS alive but unpainted" case and must always ack before this deadline.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, Wry};

/// Generous budget: the renderer acks synchronously on resume before any paint
/// probe, so only a genuinely wedged content process can miss this window.
const WATCHDOG_BUDGET_MS: u64 = 3_000;
const MAIN_WINDOW_LABEL: &str = "main";

static ACKED: AtomicBool = AtomicBool::new(true);

/// Begin a new resume observation window. Called from `RunEvent::Resumed`.
pub fn arm(app: &AppHandle<Wry>) {
    ACKED.store(false, Ordering::Release);
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(WATCHDOG_BUDGET_MS));
        if ACKED.load(Ordering::Acquire) {
            return;
        }
        tracing::warn!(
            "resume watchdog: no renderer liveness ack within {WATCHDOG_BUDGET_MS}ms; reloading webview"
        );
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            tracing::error!("resume watchdog: main webview window is missing");
            return;
        };
        if let Err(error) = window.reload() {
            tracing::error!(error = %error, "resume watchdog: webview reload failed");
        }
    });
}

/// Record the renderer liveness ack. Invoked by the `desktop_wake_ack` command.
pub fn acknowledge() {
    ACKED.store(true, Ordering::Release);
}
