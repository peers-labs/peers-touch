//! Native desktop surface integration: dock / taskbar unread badge (BOT-D13).
//!
//! These are side-effect-only wrappers over platform frameworks. The badge
//! value is the number of unread *conversations* (not unread messages); its
//! source of truth and all focus / mute gating live in the UI projection.
//! Platforms without a dock badge degrade to a no-op.

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
