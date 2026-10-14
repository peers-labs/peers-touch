//! Menu-bar residency.
//!
//! On supported desktops the app keeps running with its window hidden and a
//! tray icon present. Closing the window hides it instead of quitting; the
//! tray menu (or icon click) restores it. This module owns native tray state;
//! the hide-on-close wiring lives in `window_lifecycle`.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::application::host_events;

const SHOW_ID: &str = "tray-show";
const QUIT_ID: &str = "tray-quit";

/// Build and install the system tray icon. Returns Err on platforms/builds
/// where a tray is unavailable so the caller can degrade to close-to-quit.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let show = MenuItem::with_id(app, SHOW_ID, "Show Peers Touch", true, None::<&str>)
        .map_err(|e| format!("tray show item: {e}"))?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|e| format!("tray separator: {e}"))?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)
        .map_err(|e| format!("tray quit item: {e}"))?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])
        .map_err(|e| format!("tray menu: {e}"))?;

    let mut builder = TrayIconBuilder::with_id("peers-touch-main")
        .tooltip("Peers Touch")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => restore_main_window(app),
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                restore_main_window(tray.app_handle());
            }
        });

    // Reuse the build-time embedded window icon (raw RGBA), so the tray icon
    // is present in packaged builds without a runtime PNG decoder feature.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app).map_err(|e| format!("build tray: {e}"))?;
    Ok(())
}

/// Show + focus the main window and emit the host event the UI uses to deep
/// navigate to the intended surface. Safe to call before the window exists.
pub fn restore_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if let Err(error) = host_events::emit_tray_open(app, "tray-click") {
            tracing::warn!(error = %error, "tray: failed to emit tray-open host event");
        }
    }
}
