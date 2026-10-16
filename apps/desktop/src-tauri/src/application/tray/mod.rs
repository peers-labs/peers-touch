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

#[cfg(target_os = "macos")]
const MACOS_TRAY_ICON_PNG: &[u8] = include_bytes!("../../../icons/tray-icon-macos.png");
#[cfg(target_os = "macos")]
const MACOS_MENU_TRACKING_DELAY_MS: u64 = 750;
#[cfg(target_os = "macos")]
const MACOS_FOCUS_RETRY_DELAY_MS: u64 = 100;
#[cfg(target_os = "macos")]
const MACOS_FOCUS_RETRY_LIMIT: u8 = 10;

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

    #[cfg(target_os = "macos")]
    {
        let icon = tauri::image::Image::from_bytes(MACOS_TRAY_ICON_PNG)
            .map_err(|e| format!("decode macOS tray icon: {e}"))?;
        builder = builder.icon(icon).icon_as_template(true);
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Other desktop trays keep the packaged application icon.
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
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
        #[cfg(target_os = "macos")]
        focus_main_window_after_menu_tracking(app);
        if let Err(error) = host_events::emit_tray_open(app, "tray-click") {
            tracing::warn!(error = %error, "tray: failed to emit tray-open host event");
        }
    }
}

#[cfg(target_os = "macos")]
fn focus_main_window_after_menu_tracking<R: Runtime>(app: &AppHandle<R>) {
    use dispatch2::{DispatchQueue, DispatchTime};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};
    use std::time::Duration;

    let app = app.clone();
    let when = DispatchTime::try_from(Duration::from_millis(MACOS_MENU_TRACKING_DELAY_MS))
        .expect("tray focus delay must fit dispatch time");
    if let Err(error) = DispatchQueue::main().after(when, move || {
        let Some(window) = app.get_webview_window("main") else {
            tracing::warn!("tray: main window is unavailable for deferred focus");
            return;
        };
        if let Err(error) = window.show() {
            tracing::warn!(error = %error, "tray: deferred main-window show failed");
        }
        if let Err(error) = window.unminimize() {
            tracing::warn!(error = %error, "tray: deferred main-window unminimize failed");
        }
        let Some(main_thread) = MainThreadMarker::new() else {
            tracing::warn!("tray: deferred focus did not run on the AppKit main thread");
            return;
        };
        let Ok(ns_window) = window.ns_window() else {
            tracing::warn!("tray: native main window is unavailable for deferred focus");
            return;
        };
        let application = NSApplication::sharedApplication(main_thread);
        let ns_window = unsafe { &*(ns_window as *mut NSWindow) };
        ns_window.orderFrontRegardless();
        application.unhide(None);
        #[allow(deprecated)]
        application.activateIgnoringOtherApps(true);
        schedule_macos_key_window(app, MACOS_FOCUS_RETRY_LIMIT);
    }) {
        tracing::warn!(error = ?error, "tray: failed to schedule deferred AppKit focus");
    }
}

#[cfg(target_os = "macos")]
fn schedule_macos_key_window<R: Runtime>(app: AppHandle<R>, attempts_remaining: u8) {
    use dispatch2::{DispatchQueue, DispatchTime};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAccessibility, NSApplication, NSWindow};
    use std::time::Duration;

    let when = DispatchTime::try_from(Duration::from_millis(MACOS_FOCUS_RETRY_DELAY_MS))
        .expect("tray focus retry delay must fit dispatch time");
    if let Err(error) = DispatchQueue::main().after(when, move || {
        let Some(window) = app.get_webview_window("main") else {
            tracing::warn!("tray: main window is unavailable for key-window focus");
            return;
        };
        let Some(main_thread) = MainThreadMarker::new() else {
            tracing::warn!("tray: key-window focus did not run on the AppKit main thread");
            return;
        };
        let Ok(ns_window) = window.ns_window() else {
            tracing::warn!("tray: native main window is unavailable for key-window focus");
            return;
        };
        let application = NSApplication::sharedApplication(main_thread);
        let ns_window = unsafe { &*(ns_window as *mut NSWindow) };
        ns_window.orderFrontRegardless();
        if !application.isActive() {
            #[allow(deprecated)]
            application.activateIgnoringOtherApps(true);
        }
        ns_window.makeMainWindow();
        ns_window.makeKeyAndOrderFront(None);
        ns_window.makeKeyWindow();
        ns_window.setAccessibilityFocused(true);

        let active = application.isActive();
        let visible = ns_window.isVisible();
        let main = ns_window.isMainWindow();
        let key = ns_window.isKeyWindow();
        let accessibility_focused = ns_window.isAccessibilityFocused();
        if active && visible && main && key && accessibility_focused {
            tracing::info!("tray: restored main window with AppKit focus");
            return;
        }
        if attempts_remaining > 0 {
            schedule_macos_key_window(app.clone(), attempts_remaining - 1);
            return;
        }
        tracing::warn!(
            active,
            visible,
            main,
            key,
            accessibility_focused,
            can_become_key = ns_window.canBecomeKeyWindow(),
            "tray: AppKit focus retries exhausted"
        );
    }) {
        tracing::warn!(error = ?error, "tray: failed to schedule AppKit focus retry");
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::MACOS_TRAY_ICON_PNG;

    #[test]
    fn macos_tray_icon_is_retina_template_artwork() {
        let icon = tauri::image::Image::from_bytes(MACOS_TRAY_ICON_PNG).expect("decode tray icon");

        assert_eq!((icon.width(), icon.height()), (88, 36));

        let mut alpha = icon.rgba().chunks_exact(4).map(|pixel| pixel[3]);
        assert!(alpha.clone().any(|value| value == 0));
        assert!(alpha.clone().any(|value| value == u8::MAX));
        assert!(alpha.any(|value| value > 0 && value < u8::MAX));
    }
}
