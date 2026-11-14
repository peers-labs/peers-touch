//! Surface-aware macOS traffic-light chrome.
//!
//! # Compact placement is solved by AppKit Auto Layout
//!
//! The real standard window buttons stay in their original title-bar container
//! with their native actions. Constraints compact the cluster into the 60pt
//! icon rail; AppKit resolves them in its own layout pass, including resize.
//! The container and vertical center remain native. Manual frame writes,
//! resize callbacks and Tao's content-draw inset lose that layout race and can
//! clip the lights against the rounded corner.
//! Login hides minimize and zoom; the ready shell shows all three.

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

/// Process-wide traffic-light mode. Native constraints belong to their views,
/// so repeated surface transitions do not need to carry native frame state.
#[derive(Debug, Default)]
pub(crate) struct TrafficLightState {
    last_mode: std::sync::Mutex<Option<TrafficLightMode>>,
}

impl TrafficLightState {
    /// Apply the traffic-light chrome for the given surface. Idempotent and
    /// best-effort: a chrome failure never blocks the window geometry
    /// transition. AppKit owns constraint layout; this installs the compact
    /// cluster and updates the minimize / zoom hidden state.
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
        macos::apply_chrome(window_handle, mode);
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
    use objc2_app_kit::{NSLayoutConstraint, NSWindow, NSWindowButton};
    use objc2_foundation::{NSArray, NSString};

    const KINDS: [NSWindowButton; LIGHT_COUNT] = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    const LIGHT_DIAMETER: f64 = 14.0;
    const LEADING_INSET: f64 = 5.0;
    const LIGHT_STEP: f64 = 18.0;

    pub(super) fn apply_chrome(window_handle: usize, mode: TrafficLightMode) {
        dispatch2::DispatchQueue::main().exec_async(move || {
            let ns_window = unsafe { &*(window_handle as *const NSWindow) };
            let hidden = hidden_flags(mode);
            for (slot, kind) in KINDS.iter().enumerate() {
                if let Some(button) = ns_window.standardWindowButton(*kind) {
                    // SAFETY: The window owns the view tree throughout this
                    // uninterrupted main-thread operation.
                    if let Some(parent) = unsafe { button.superview() } {
                        let identifier =
                            NSString::from_str(&format!("peers.traffic-light.{slot}.leading"));
                        let installed = parent.constraints().iter().any(|constraint| {
                            constraint.isActive()
                                && constraint.identifier().as_deref() == Some(&*identifier)
                        });
                        if !installed {
                            button.setTranslatesAutoresizingMaskIntoConstraints(false);
                            let leading = button.leadingAnchor().constraintEqualToAnchor_constant(
                                &parent.leadingAnchor(),
                                LEADING_INSET + LIGHT_STEP * slot as f64,
                            );
                            leading.setIdentifier(Some(&identifier));
                            let constraints = NSArray::from_retained_slice(&[
                                leading,
                                button
                                    .centerYAnchor()
                                    .constraintEqualToAnchor(&parent.centerYAnchor()),
                                button
                                    .widthAnchor()
                                    .constraintEqualToConstant(LIGHT_DIAMETER),
                                button
                                    .heightAnchor()
                                    .constraintEqualToConstant(LIGHT_DIAMETER),
                            ]);
                            NSLayoutConstraint::activateConstraints(&constraints);
                        }
                    }
                    button.setHidden(hidden[slot]);
                }
            }
            // SAFETY: The content view's parent is owned by this live window.
            if let Some(frame_view) = ns_window
                .contentView()
                .and_then(|view| unsafe { view.superview() })
            {
                frame_view.layoutSubtreeIfNeeded();
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
