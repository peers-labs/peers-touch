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
        focus_main_window_after_menu_tracking(&window);
        if let Err(error) = host_events::emit_tray_open(app, "tray-click") {
            tracing::warn!(error = %error, "tray: failed to emit tray-open host event");
        }
    }
}

#[cfg(target_os = "macos")]
fn focus_main_window_after_menu_tracking<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use dispatch2::DispatchQueue;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};

    let Ok(ns_window) = window.ns_window() else {
        tracing::warn!("tray: native main window is unavailable for deferred focus");
        return;
    };
    let ns_window = ns_window as usize;
    DispatchQueue::main().exec_async(move || {
        let Some(main_thread) = MainThreadMarker::new() else {
            tracing::warn!("tray: deferred focus did not run on the AppKit main thread");
            return;
        };
        let application = NSApplication::sharedApplication(main_thread);
        NSApplication::activate(&application);
        let ns_window = unsafe { &*(ns_window as *mut NSWindow) };
        ns_window.makeKeyAndOrderFront(None);
        ns_window.makeKeyWindow();
    });
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
