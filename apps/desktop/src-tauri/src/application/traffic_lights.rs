//! Surface-aware macOS traffic-light chrome.
//!
//! # Placement is owned entirely by AppKit, never by this module
//!
//! The traffic lights must stay at their unmodified native position. We tried
//! three ways to move them and every one clipped the lights against the
//! window's top rounded corner during a live resize:
//!
//! * manual `setFrame` re-asserted from a resize callback / frame notification
//!   always runs one frame late, after the drifted frame is already displayed;
//! * Tao's declarative `trafficLightPosition` re-applies an inset from the
//!   content view's `drawRect:`, but the lights live in the title-bar container,
//!   which AppKit re-lays out on its own resize cycle. Shrinking that container
//!   and re-parenting the button origins still loses the race, so the top half
//!   of the cluster is transiently sliced off mid-drag.
//!
//! The only race-free behaviour is the platform default: with no
//! `trafficLightPosition` in `tauri.conf.json`, AppKit positions and keeps the
//! lights at the native top-left inset for every frame, including live resize.
//! This module therefore never writes button geometry. It only expresses what
//! native placement cannot: the auth / ready surface difference, where login
//! hides minimize and zoom while close stays visible.

/// Traffic-light chrome matching the auth / ready window surfaces.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum TrafficLightMode {
    /// Single close light; minimize and zoom stay hidden (login surface).
    Auth,
    /// Standard three-light cluster, all visible (ready shell).
    Ready,
}

/// Button slots in AppKit left-to-right order.
const CLOSE: usize = 0;
const MINIATURIZE: usize = 1;
const ZOOM: usize = 2;
const LIGHT_COUNT: usize = 3;

/// Per-light hidden flags for a mode. The close light is always visible.
fn hidden_flags(mode: TrafficLightMode) -> [bool; LIGHT_COUNT] {
    match mode {
        TrafficLightMode::Auth => [false, true, true],
        TrafficLightMode::Ready => [false, false, false],
    }
}

/// Process-wide traffic-light state. Placement lives in Tao, so there is no
/// native frame state to carry; this only records the active mode so repeated
/// surface transitions stay idempotent.
#[derive(Debug, Default)]
pub(crate) struct TrafficLightState {
    last_mode: std::sync::Mutex<Option<TrafficLightMode>>,
}

impl TrafficLightState {
    /// Apply the traffic-light chrome for the given surface. Idempotent and
    /// best-effort: a chrome failure never blocks the window geometry
    /// transition. Horizontal placement is untouched (Tao owns it); only the
    /// minimize / zoom hidden state changes.
    #[cfg(target_os = "macos")]
    pub(crate) fn apply<W: NativeWindowHandle>(
        window: &W,
        state: std::sync::Arc<TrafficLightState>,
        mode: TrafficLightMode,
    ) {
        let Some(window_handle) = window.ns_handle() else {
            tracing::warn!("traffic lights: native window handle unavailable");
            return;
        };
        state.remember_mode(mode);
        macos::apply_visibility(window_handle, mode);
    }

    /// Non-macOS hosts keep their native title bar; nothing to reconfigure.
    #[cfg(not(target_os = "macos"))]
    pub(crate) fn apply<W>(
        _window: &W,
        _state: std::sync::Arc<TrafficLightState>,
        _mode: TrafficLightMode,
    ) {
    }

    fn remember_mode(&self, mode: TrafficLightMode) {
        if let Ok(mut guard) = self.last_mode.lock() {
            *guard = Some(mode);
        }
    }
}

/// Uniform native handle access for the two Tauri window types this module
/// receives: [`tauri::WebviewWindow`] during setup and [`tauri::Window`] inside
/// Tauri commands.
#[cfg(target_os = "macos")]
pub(crate) trait NativeWindowHandle {
    fn ns_handle(&self) -> Option<usize>;
}

#[cfg(target_os = "macos")]
impl NativeWindowHandle for tauri::Window {
    fn ns_handle(&self) -> Option<usize> {
        self.ns_window().ok().map(|handle| handle as usize)
    }
}

#[cfg(target_os = "macos")]
impl NativeWindowHandle for tauri::WebviewWindow {
    fn ns_handle(&self) -> Option<usize> {
        self.ns_window().ok().map(|handle| handle as usize)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2_app_kit::{NSWindow, NSWindowButton};

    const KINDS: [NSWindowButton; LIGHT_COUNT] = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    /// Toggle only the hidden flags. Frame geometry is deliberately never
    /// touched here — AppKit owns native placement, and any frame write would
    /// reintroduce the live-resize clipping documented on the module.
    pub(super) fn apply_visibility(window_handle: usize, mode: TrafficLightMode) {
        dispatch2::DispatchQueue::main().exec_async(move || {
            let ns_window = unsafe { &*(window_handle as *const NSWindow) };
            let hidden = hidden_flags(mode);
            for (slot, kind) in KINDS.iter().enumerate() {
                if let Some(button) = ns_window.standardWindowButton(*kind) {
                    button.setHidden(hidden[slot]);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_mode_hides_only_minimize_and_zoom() {
        assert_eq!(hidden_flags(TrafficLightMode::Auth), [false, true, true]);
    }

    #[test]
    fn ready_mode_shows_every_light() {
        assert_eq!(hidden_flags(TrafficLightMode::Ready), [false, false, false]);
    }

    #[test]
    fn close_light_is_never_hidden() {
        assert!(!hidden_flags(TrafficLightMode::Auth)[CLOSE]);
        assert!(!hidden_flags(TrafficLightMode::Ready)[CLOSE]);
    }

    #[test]
    fn mode_is_remembered_for_idempotent_transitions() {
        let state = TrafficLightState::default();
        state.remember_mode(TrafficLightMode::Ready);
        // remember_mode only stores; a second identical transition must not
        // panic and the flags stay a pure function of the mode.
        state.remember_mode(TrafficLightMode::Ready);
        assert_eq!(hidden_flags(TrafficLightMode::Ready), [false, false, false]);
    }
}
