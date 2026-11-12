//! Auth/ready native window geometry.
//!
//! The login surface is a compact 460x720 window; once the user reaches the
//! ready shell the window expands to the last user-adjusted size (falling back
//! to 1200x800). User resizes performed while in the ready surface are
//! debounced and persisted in logical pixels, so the next launch restores them
//! independently of display scaling.
//!
//! Programmatic resizes are flagged and never persisted, and the whole feature
//! is inert under the `acceptance-webdriver` build so harness window placement
//! stays the single authority for acceptance geometry.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Window, WindowEvent};
#[cfg(not(target_os = "macos"))]
use tauri::LogicalSize;

use crate::infrastructure::storage::{self, StorageKind};

/// Compact login surface — narrow and tall, phone-like. Matches the initial
/// size declared in `tauri.conf.json` so first paint already opens compact.
/// The 360px width hugs the 336px auth content (~12px each side) so the header
/// controls sit close to the window edges instead of floating in wide gutters.
pub(crate) const AUTH_WINDOW_WIDTH: f64 = 360.0;
pub(crate) const AUTH_WINDOW_HEIGHT: f64 = 640.0;

/// Ready-shell fallback used before the user has ever resized the window.
pub(crate) const DEFAULT_READY_WIDTH: f64 = 1200.0;
pub(crate) const DEFAULT_READY_HEIGHT: f64 = 800.0;

// Mirror the hard minimums in `tauri.conf.json`; a persisted geometry below
// these would produce an unusable window and is discarded instead.
const MIN_WINDOW_WIDTH: f64 = 320.0;
const MIN_WINDOW_HEIGHT: f64 = 440.0;
// Reject implausible persisted values (corrupt file / removed monitor) rather
// than restoring a window that cannot be brought back on screen.
const MAX_WINDOW_WIDTH: f64 = 10_000.0;
const MAX_WINDOW_HEIGHT: f64 = 10_000.0;

/// Let a drag settle before writing; only the final size lands on disk.
const PERSIST_DEBOUNCE_MS: u64 = 350;

const SURFACE_AUTH: u8 = 0;
const SURFACE_READY: u8 = 1;

/// Logical (DPI-independent) window dimensions persisted across launches.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct WindowGeometry {
    width: f64,
    height: f64,
}

impl WindowGeometry {
    fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }

    pub(crate) fn width(&self) -> f64 {
        self.width
    }

    pub(crate) fn height(&self) -> f64 {
        self.height
    }

    /// A geometry is restorable only when finite and inside the supported
    /// window bounds.
    fn is_usable(&self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && self.width >= MIN_WINDOW_WIDTH
            && self.height >= MIN_WINDOW_HEIGHT
            && self.width <= MAX_WINDOW_WIDTH
            && self.height <= MAX_WINDOW_HEIGHT
    }
}

/// Parse and validate persisted geometry. Any corrupt or out-of-band payload
/// resolves to `None` so callers fall back to the default ready size.
fn parse_geometry(raw: &str) -> Option<WindowGeometry> {
    serde_json::from_str::<WindowGeometry>(raw)
        .ok()
        .filter(WindowGeometry::is_usable)
}

fn geometry_path() -> Result<std::path::PathBuf, String> {
    storage::app_file_path(
        "desktop",
        StorageKind::Config,
        &["window", "geometry.json"],
    )
    .map_err(|error| format!("resolve window geometry path: {error:?}"))
}

fn load_geometry() -> Option<WindowGeometry> {
    let path = geometry_path().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    parse_geometry(&raw)
}

/// Best-effort write: a persistence failure must never block a resize.
fn save_geometry(geometry: WindowGeometry) {
    let Ok(path) = geometry_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            tracing::warn!(error = %error, "window sizing: create geometry dir failed");
            return;
        }
    }
    let Ok(bytes) = serde_json::to_vec(&geometry) else {
        return;
    };
    if let Err(error) = std::fs::write(path, bytes) {
        tracing::warn!(error = %error, "window sizing: persist geometry failed");
    }
}

/// Process-wide window surface state. Managed once on the Tauri app and shared
/// between the command layer and the window-event hook.
#[derive(Debug, Default)]
pub(crate) struct WindowSizingState {
    /// Current surface (`SURFACE_AUTH` / `SURFACE_READY`); opens in auth.
    surface: AtomicU8,
    /// Set while a programmatic `set_size` is in flight so its Resized event
    /// is not mistaken for a user drag.
    applying_programmatic: AtomicBool,
    /// Monotonic token used to coalesce a drag storm into one final write.
    persist_generation: AtomicU64,
}

impl WindowSizingState {
    /// Shrink to the compact login surface.
    pub(crate) fn apply_auth_surface(
        window: &Window<tauri::Wry>,
        state: &WindowSizingState,
    ) -> Result<WindowGeometry, String> {
        if cfg!(feature = "acceptance-webdriver") {
            return Ok(WindowGeometry::new(
                AUTH_WINDOW_WIDTH,
                AUTH_WINDOW_HEIGHT,
            ));
        }
        state.surface.store(SURFACE_AUTH, Ordering::Release);
        let geometry = WindowGeometry::new(AUTH_WINDOW_WIDTH, AUTH_WINDOW_HEIGHT);
        state.apply_geometry(window, geometry)?;
        Ok(geometry)
    }

    /// Expand to the remembered ready size, or the default when no usable
    /// geometry has been persisted yet.
    pub(crate) fn apply_ready_surface(
        window: &Window<tauri::Wry>,
        state: &WindowSizingState,
    ) -> Result<WindowGeometry, String> {
        if cfg!(feature = "acceptance-webdriver") {
            return Ok(WindowGeometry::new(
                DEFAULT_READY_WIDTH,
                DEFAULT_READY_HEIGHT,
            ));
        }
        state.surface.store(SURFACE_READY, Ordering::Release);
        let geometry = load_geometry().unwrap_or_else(|| {
            WindowGeometry::new(DEFAULT_READY_WIDTH, DEFAULT_READY_HEIGHT)
        });
        state.apply_geometry(window, geometry)?;
        Ok(geometry)
    }

    fn apply_geometry(
        &self,
        window: &Window<tauri::Wry>,
        geometry: WindowGeometry,
    ) -> Result<(), String> {
        // Mark before resizing so the resulting Resized event cannot overwrite
        // the persisted ready geometry with a programmatic size.
        self.applying_programmatic
            .store(true, Ordering::Release);
        if let Err(error) = apply_window_frame(window, geometry) {
            self.applying_programmatic
                .store(false, Ordering::Release);
            return Err(error);
        }
        Ok(())
    }
}

/// Apply the target content size and recenter the window. On macOS both frame
/// mutations run inside one synchronous main-queue block; AppKit coalesces the
/// frame change into a single flush at the end of the run-loop iteration, so
/// the display only ever sees the final centered frame instead of a
/// grow-then-jump sequence. The cross-platform fallback issues the two Tauri
/// calls separately because no equivalent main-queue gate exists there.
#[cfg(target_os = "macos")]
fn apply_window_frame(
    window: &Window<tauri::Wry>,
    geometry: WindowGeometry,
) -> Result<(), String> {
    use dispatch2::DispatchQueue;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSWindow;
    use objc2_foundation::NSSize;

    let raw_window = window
        .ns_window()
        .map_err(|error| format!("native window lookup failed for frame: {error}"))?
        as usize;

    let apply = move || {
        let ns_window = unsafe { &*(raw_window as *mut NSWindow) };
        ns_window.setContentSize(NSSize::new(geometry.width(), geometry.height()));
        ns_window.center();
    };

    if MainThreadMarker::new().is_some() {
        apply();
    } else {
        DispatchQueue::main().exec_sync(apply);
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply_window_frame(
    window: &Window<tauri::Wry>,
    geometry: WindowGeometry,
) -> Result<(), String> {
    if let Err(error) =
        window.set_size(LogicalSize::new(geometry.width(), geometry.height()))
    {
        return Err(format!("window set_size failed: {error}"));
    }
    if let Err(error) = window.center() {
        return Err(format!("window center failed: {error}"));
    }
    Ok(())
}

/// Builder-level window event hook. Only user-driven resizes in the ready
/// surface are remembered; auth/compact and programmatic resizes are ignored.
pub(crate) fn handle_window_event(
    window: &Window<tauri::Wry>,
    event: &WindowEvent,
    state: &Arc<WindowSizingState>,
) {
    if cfg!(feature = "acceptance-webdriver") {
        return;
    }
    let WindowEvent::Resized(physical_size) = event else {
        return;
    };
    // Every Resized clears the programmatic marker; the marker only has to
    // survive until the first event generated by `apply_geometry`.
    if state.applying_programmatic.swap(false, Ordering::AcqRel) {
        return;
    }
    if state.surface.load(Ordering::Acquire) != SURFACE_READY {
        return;
    }
    let Ok(scale_factor) = window.scale_factor() else {
        tracing::warn!("window sizing: scale factor unavailable; skip persist");
        return;
    };
    let logical = physical_size.to_logical::<f64>(scale_factor);
    let geometry = WindowGeometry::new(logical.width, logical.height);
    if !geometry.is_usable() {
        return;
    }
    schedule_persist(state, geometry);
}

/// Debounce a resize stream: each event arms a generation token and only the
/// waiter for the latest token writes, so a continuous drag yields one write
/// of the final resting size.
fn schedule_persist(state: &Arc<WindowSizingState>, geometry: WindowGeometry) {
    let generation = state.persist_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let state = Arc::clone(state);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(PERSIST_DEBOUNCE_MS));
        if state.persist_generation.load(Ordering::Acquire) != generation {
            return;
        }
        save_geometry(geometry);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_geometry() {
        let geometry = parse_geometry(r#"{"width":1280.0,"height":820.0}"#)
            .expect("valid geometry must parse");
        assert_eq!(geometry, WindowGeometry::new(1280.0, 820.0));
    }

    #[test]
    fn rejects_corrupt_json() {
        assert!(parse_geometry("not-json").is_none());
    }

    #[test]
    fn rejects_missing_fields() {
        assert!(parse_geometry(r#"{"width":800.0}"#).is_none());
    }

    #[test]
    fn rejects_geometry_below_minimum() {
        assert!(parse_geometry(r#"{"width":300.0,"height":800.0}"#).is_none());
        assert!(parse_geometry(r#"{"width":800.0,"height":400.0}"#).is_none());
    }

    #[test]
    fn rejects_implausibly_large_geometry() {
        assert!(parse_geometry(r#"{"width":20000.0,"height":800.0}"#).is_none());
    }

    #[test]
    fn surface_constants_are_restorable() {
        assert!(WindowGeometry::new(AUTH_WINDOW_WIDTH, AUTH_WINDOW_HEIGHT).is_usable());
        assert!(WindowGeometry::new(DEFAULT_READY_WIDTH, DEFAULT_READY_HEIGHT).is_usable());
    }
}
