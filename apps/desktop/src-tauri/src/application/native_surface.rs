//! Native desktop surface integration: user notifications and dock / taskbar
//! unread badge (BOT-A31/A33/A35, BOT-D13).
//!
//! These are side-effect-only wrappers over platform frameworks. Routing and
//! focus / mute gating live in the UI projection; this layer turns an already
//! decided intent into OS effects. Platforms without an implementation return
//! an error the UI can ignore.

/// Routing payload for one native user notification.
#[derive(Debug, Clone)]
pub(crate) struct NativeNotificationRoute {
    /// Stable id; reusing it replaces the previous notification (one per event
    /// per device, BOT-A35).
    pub notification_id: String,
    pub title: String,
    pub body: String,
    /// Conversation ULID to open when the notification is tapped.
    pub session_ulid: Option<String>,
    /// Whitelisted in-app navigation target (defense in depth; final routing
    /// is owned by the UI).
    pub target: Option<String>,
    /// Notification center thread identifier for grouping / collapse.
    pub group_key: Option<String>,
    /// Whether to play the default sound (false for muted conversations).
    pub play_sound: bool,
}

/// Install native notification delivery and tap handling. Best effort: on
/// platforms without an implementation this is a successful no-op.
pub fn init_notifications(app: &tauri::AppHandle<tauri::Wry>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::application::macos_user_notifications::init(app.clone())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Show one native user notification. Returns an error on platforms without a
/// backend so callers can degrade silently.
pub fn post_notification(route: NativeNotificationRoute) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::application::macos_user_notifications::post(route)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = route;
        Err("native user notifications are only implemented on macOS".to_string())
    }
}

/// Map an unread-conversation count to a dock badge label. A zero count
/// clears the badge; any positive count renders as its decimal form.
pub(crate) fn dock_badge_label(count: u64) -> Option<String> {
    (count > 0).then(|| count.to_string())
}

/// Set the dock badge to the unread-conversation count (zero clears it).
#[cfg(target_os = "macos")]
pub fn set_dock_badge(count: u64) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSString;

    let label = dock_badge_label(count);
    // AppKit dock-tile mutation is required on the main thread; the caller
    // (a Tauri command worker) is not guaranteed to be running there. Only the
    // plain `String` crosses the thread boundary — AppKit objects are created
    // and touched exclusively on the main thread.
    dispatch2::DispatchQueue::main().exec_async(move || {
        let Some(marker) = MainThreadMarker::new() else {
            tracing::warn!("dock badge: main thread marker unavailable");
            return;
        };
        let ns_label = label.as_deref().map(NSString::from_str);
        let tile = NSApplication::sharedApplication(marker).dockTile();
        tile.setBadgeLabel(ns_label.as_deref());
    });
}

/// Taskbar / dock badge is macOS-only for now; other platforms ignore it.
#[cfg(not(target_os = "macos"))]
pub fn set_dock_badge(_count: u64) {}

#[cfg(test)]
mod tests {
    use super::dock_badge_label;

    #[test]
    fn zero_clears_the_badge() {
        assert_eq!(dock_badge_label(0), None);
    }

    #[test]
    fn positive_count_renders_decimal_label() {
        assert_eq!(dock_badge_label(1), Some("1".to_string()));
        assert_eq!(dock_badge_label(42), Some("42".to_string()));
    }
}
