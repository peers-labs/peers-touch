//! Surface-aware macOS traffic-light chrome.
//!
//! Two chrome modes track the auth / ready window surface lifecycle:
//! - [`TrafficLightMode::Auth`] reduces the title bar to one red close light
//!   pinned inside the 60px icon rail (WeChat-style minimal login chrome).
//! - [`TrafficLightMode::Ready`] shows the full close / minimize / zoom cluster
//!   at the WeChat-measured compact pitch, translated as a unit so it reads as
//!   a corner cluster inside the 60px icon rail with a right margin instead of
//!   overflowing into or touching the content divider.
//!
//! The close light keeps the same origin in both modes, so a surface transition
//! only fades the two secondary lights in/out without the close light drifting.
//! Pristine AppKit frames are captured once for the vertical baseline only; the
//! horizontal placement is recomputed against the rail boundary while the native
//! frame size is preserved, and the compact 12pt glyph is produced by scaling
//! the button bounds instead of its frame. Every AppKit call runs on the main
//! queue; the boundary math lives in pure functions so it stays testable on
//! every host.

use std::sync::{Arc, Mutex};

/// Platform-independent rectangle mirroring the AppKit `CGRect` fields without
/// taking a macOS-only dependency, so placement math stays unit-testable.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LightRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl LightRect {
    #[cfg(test)]
    fn right(&self) -> f64 {
        self.x + self.width
    }
}

/// Traffic-light chrome matching the auth / ready window surfaces.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum TrafficLightMode {
    /// Single close light; minimize and zoom stay hidden (login surface).
    Auth,
    /// Standard three-light cluster, all visible at native frames (ready shell).
    Ready,
}

/// Button slots in AppKit left-to-right order.
const CLOSE: usize = 0;
const MINIATURIZE: usize = 1;
const ZOOM: usize = 2;
const LIGHT_COUNT: usize = 3;

/// Width of the icon rail the traffic lights must stay inside. Mirrors
/// `.ds-rail { width: 60px }` in northstar.css; the zoom light's right edge may
/// not cross it.
const RAIL_WIDTH: f64 = 60.0;

/// Target visual diameter of each traffic-light glyph, matching the stock
/// macOS / WeChat circle. AppKit's standard window buttons wrap a ~12pt glyph
/// in a 14pt frame, but repositioning them with `setFrame` makes the glyph
/// fill the whole frame (measured 14pt on screen vs 11.5–12pt in WeChat).
/// The frame must stay at the native 14pt — shrinking it does not shrink the
/// drawn glyph — so the compact visual is produced instead by a bounds scale
/// inside [`macos::scaled_glyph_bounds`].
const LIGHT_DIAMETER: f64 = 12.0;

/// Native AppKit frame size of a standard window button; the layout keeps
/// these bounds so window-button auto-layout never fights the geometry.
const NATIVE_LIGHT_FRAME: f64 = 14.0;

/// Spacing between neighboring traffic-light origins. An 18pt pitch keeps a
/// 4pt gap between the 14pt button frames — tighter than the 23pt stock pitch
/// (which cannot fit the 60pt rail) while still reading as three evenly spaced
/// lights, and it matches the WeChat-measured cluster pitch.
const TRAFFIC_LIGHT_PITCH: f64 = 18.0;

/// Left origin of the close light, shared by both chrome modes. With a 14pt
/// frame and 18pt pitch the cluster spans 2×18 + 14 = 50pt, so a 5pt inset
/// centers it with a symmetric 5pt margin off the rail divider instead of
/// crowding either edge.
const CLOSE_LEFT_INSET: f64 = 5.0;

/// With `titleBarStyle: Overlay` the web content fills the title bar. A small
/// downward nudge keeps the lights centered on the slim in-window header band
/// instead of hugging the very top edge.
const TRAFFIC_LIGHT_TOP_SHIFT: f64 = 2.0;

/// Per-slot frame set; a missing native button stays `None`.
type FrameSet = [Option<LightRect>; LIGHT_COUNT];

/// Process-wide traffic-light state. Managed once on the Tauri app and shared
/// between setup and the surface commands.
#[derive(Debug, Default)]
pub(crate) struct TrafficLightState {
    /// Pristine AppKit frames captured before the first mutation. They provide
    /// each light's native vertical baseline; the compact light size and
    /// horizontal placement are recomputed by the rail-bounded layout functions.
    original_frames: Mutex<Option<FrameSet>>,
}

/// Positions the single visible close light at a fixed left inset, preserving
/// the native frame size and only applying the vertical nudge. Minimize /
/// zoom are hidden in auth mode, so there is no multi-button cluster to
/// center. The compact glyph is achieved later via a bounds scale, never by
/// shrinking the frame.
fn position_close_light(frame: LightRect, left_inset: f64, top_shift: f64) -> LightRect {
    LightRect {
        x: left_inset,
        y: frame.y - top_shift,
        width: NATIVE_LIGHT_FRAME,
        height: NATIVE_LIGHT_FRAME,
    }
}

/// Lays out the full three-light cluster for the ready shell. The close light
/// anchors the same left inset as auth mode (no drift between surfaces), and
/// the secondary lights follow at the compact pitch on a shared vertical
/// baseline. The captured frames only donate the vertical baseline; their
/// default AppKit origins are discarded so the cluster can be translated into
/// the rail without touching the native frame size.
fn position_ready_cluster(
    originals: FrameSet,
    close_current: LightRect,
) -> FrameSet {
    let baseline_y = close_current.y - TRAFFIC_LIGHT_TOP_SHIFT;
    std::array::from_fn(|index| {
        let _ = originals[index];
        Some(LightRect {
            x: CLOSE_LEFT_INSET + index as f64 * TRAFFIC_LIGHT_PITCH,
            y: baseline_y,
            width: NATIVE_LIGHT_FRAME,
            height: NATIVE_LIGHT_FRAME,
        })
    })
}

/// Bounds rect that renders the glyph at [`LIGHT_DIAMETER`] inside an
/// unchanged native frame. NSView draws its content relative to `bounds`:
/// enlarging the bounds while keeping the frame identical scales the drawn
/// content down, centered, so the circle shrinks without AppKit's window-
/// button layout resetting a smaller frame. The returned rect is in the
/// button's own coordinate space, which is why the origin is negative.
fn scaled_glyph_bounds(frame: LightRect) -> LightRect {
    let bounds_size = frame.width * frame.width / LIGHT_DIAMETER;
    let half_delta = (bounds_size - frame.width) / 2.0;
    LightRect {
        x: -half_delta,
        y: -half_delta,
        width: bounds_size,
        height: bounds_size,
    }
}

/// Per-light hidden flags for a mode. The close light is always visible.
fn hidden_flags(mode: TrafficLightMode) -> [bool; LIGHT_COUNT] {
    match mode {
        TrafficLightMode::Auth => [false, true, true],
        TrafficLightMode::Ready => [false, false, false],
    }
}

/// Resolves the target frame for every light. Auth mode repositions only the
/// close light and leaves the hidden lights' frames untouched; ready mode
/// re-lays the whole cluster out at the rail-bounded geometry.
fn resolve_frames(
    mode: TrafficLightMode,
    originals: FrameSet,
    close_current: LightRect,
) -> FrameSet {
    match mode {
        TrafficLightMode::Auth => [
            Some(position_close_light(
                close_current,
                CLOSE_LEFT_INSET,
                TRAFFIC_LIGHT_TOP_SHIFT,
            )),
            originals[MINIATURIZE],
            originals[ZOOM],
        ],
        TrafficLightMode::Ready => position_ready_cluster(originals, close_current),
    }
}

impl TrafficLightState {
    /// Apply the traffic-light chrome for the given surface. Idempotent and
    /// safe to call on every auth / ready transition; best-effort, so a chrome
    /// failure never blocks the window geometry transition.
    #[cfg(target_os = "macos")]
    pub(crate) fn apply<W: NativeWindowHandle>(
        window: &W,
        state: Arc<TrafficLightState>,
        mode: TrafficLightMode,
    ) {
        macos::apply(window, state, mode);
    }

    /// Non-macOS hosts keep their native title bar; nothing to reconfigure.
    #[cfg(not(target_os = "macos"))]
    pub(crate) fn apply<W>(
        _window: &W,
        _state: Arc<TrafficLightState>,
        _mode: TrafficLightMode,
    ) {
    }
}

/// Uniform native handle access for the two Tauri window types this module
/// receives: [`tauri::WebviewWindow`] during setup (the stable manager only
/// exposes webview windows there) and [`tauri::Window`] inside Tauri commands.
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
    use dispatch2::DispatchQueue;
    use objc2_app_kit::{NSButton, NSWindow, NSWindowButton};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};

    fn light_rect(frame: CGRect) -> LightRect {
        LightRect {
            x: frame.origin.x,
            y: frame.origin.y,
            width: frame.size.width,
            height: frame.size.height,
        }
    }

    const KINDS: [NSWindowButton; LIGHT_COUNT] = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    /// Apply hidden state + target frames to the three standard window
    /// buttons, then re-assert the compact glyph bounds (setFrame resets the
    /// bounds to match the frame). Returns the frames read back from AppKit.
    /// Re-fetches the buttons from the window so it can run again on a later
    /// run-loop pass without borrowing local button handles across a
    /// `'static` dispatch.
    fn layout_buttons(
        ns_window: &NSWindow,
        frames: FrameSet,
        hidden: [bool; LIGHT_COUNT],
    ) -> FrameSet {
        let buttons: [Option<objc2::rc::Retained<NSButton>>; LIGHT_COUNT] =
            KINDS.map(|kind| ns_window.standardWindowButton(kind));
        for index in 0..LIGHT_COUNT {
            let Some(button) = buttons[index].as_ref() else {
                continue;
            };
            button.setHidden(hidden[index]);
            if let Some(frame) = frames[index] {
                button.setFrame(CGRect::new(
                    CGPoint::new(frame.x, frame.y),
                    CGSize::new(frame.width, frame.height),
                ));
                // setFrame resets the view bounds, so re-apply the glyph
                // scale immediately afterwards to keep the compact visual.
                let bounds = scaled_glyph_bounds(frame);
                button.setBounds(CGRect::new(
                    CGPoint::new(bounds.x, bounds.y),
                    CGSize::new(bounds.width, bounds.height),
                ));
            }
        }
        std::array::from_fn(|index| {
            buttons[index]
                .as_ref()
                .map(|button| light_rect(button.frame()))
        })
    }

    pub(super) fn apply<W: NativeWindowHandle>(
        window: &W,
        state: Arc<TrafficLightState>,
        mode: TrafficLightMode,
    ) {
        let Some(window_handle) = window.ns_handle() else {
            tracing::warn!("traffic lights: native window handle unavailable");
            return;
        };
        // Snapshot any previously captured frames so the queued main-thread
        // work owns its inputs and never blocks on the mutex inside AppKit.
        let captured = state
            .original_frames
            .lock()
            .map(|guard| *guard)
            .unwrap_or(None);

        DispatchQueue::main().exec_async(move || {
            let ns_window = unsafe { &*(window_handle as *const NSWindow) };
            let current_frames: FrameSet =
                std::array::from_fn(|index| {
                    ns_window
                        .standardWindowButton(KINDS[index])
                        .map(|button| light_rect(button.frame()))
                });
            // Capture pristine AppKit frames once, before any mutation.
            let originals = match captured {
                Some(frames) => frames,
                None => {
                    if let Ok(mut guard) = state.original_frames.lock() {
                        *guard = Some(current_frames);
                    }
                    current_frames
                }
            };

            let Some(close) = ns_window.standardWindowButton(KINDS[CLOSE]) else {
                return;
            };
            let target_frames =
                resolve_frames(mode, originals, light_rect(close.frame()));
            let hidden = hidden_flags(mode);

            // AppKit re-lays the standard window buttons out when the window
            // resizes (the ready surface grows from the 400pt auth frame), and
            // that layout pass can silently discard setFrame on the close /
            // minimize buttons. Assert once now, then again on the next run-loop
            // iteration after AppKit's pending layout has run, so the final
            // layout converges on our geometry regardless of ordering.
            layout_buttons(ns_window, target_frames, hidden);
            DispatchQueue::main().exec_async(move || {
                let ns_window = unsafe { &*(window_handle as *const NSWindow) };
                layout_buttons(ns_window, target_frames, hidden);
            });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close_frame() -> LightRect {
        // AppKit close button geometry observed at runtime (14pt light).
        LightRect {
            x: 9.0,
            y: 10.0,
            width: 14.0,
            height: 14.0,
        }
    }

    fn cluster_frames() -> FrameSet {
        // Real standard-window frames: 23pt stock pitch, 14pt lights.
        [
            Some(LightRect {
                x: 9.0,
                y: 10.0,
                width: 14.0,
                height: 14.0,
            }),
            Some(LightRect {
                x: 32.0,
                y: 10.0,
                width: 14.0,
                height: 14.0,
            }),
            Some(LightRect {
                x: 55.0,
                y: 10.0,
                width: 14.0,
                height: 14.0,
            }),
        ]
    }

    #[test]
    fn pins_close_light_to_the_fixed_left_inset() {
        let target = position_close_light(close_frame(), CLOSE_LEFT_INSET, 2.0);
        // The original AppKit x is discarded; the single close light sits at
        // the fixed inset regardless of the OS default origin.
        assert_eq!(target.x, CLOSE_LEFT_INSET);
        assert!(target.right() <= RAIL_WIDTH);
    }

    #[test]
    fn keeps_close_light_frame_size_and_only_nudges_vertically() {
        let original = close_frame();
        let target = position_close_light(original, CLOSE_LEFT_INSET, 2.0);
        // The native 14pt frame is preserved; compact visuals come from the
        // bounds scale, not a smaller frame that AppKit would ignore.
        assert_eq!(target.width, NATIVE_LIGHT_FRAME);
        assert_eq!(target.height, NATIVE_LIGHT_FRAME);
        assert!((target.y - 8.0).abs() < f64::EPSILON);
    }

    #[test]
    fn supports_a_zero_vertical_nudge() {
        let target = position_close_light(close_frame(), CLOSE_LEFT_INSET, 0.0);
        assert!((target.y - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn bounds_scale_shrinks_the_glyph_without_moving_its_center() {
        let frame = LightRect {
            x: 5.0,
            y: 8.0,
            width: NATIVE_LIGHT_FRAME,
            height: NATIVE_LIGHT_FRAME,
        };
        let bounds = scaled_glyph_bounds(frame);
        // 14pt frame hosting a 12pt glyph -> bounds size 196/12 = 16.333...
        let expected_size = NATIVE_LIGHT_FRAME * NATIVE_LIGHT_FRAME / LIGHT_DIAMETER;
        assert!((bounds.width - expected_size).abs() < 1e-9);
        assert!((bounds.height - expected_size).abs() < 1e-9);
        // Negative inset keeps the scaled content centered on the same point.
        let half_delta = (expected_size - NATIVE_LIGHT_FRAME) / 2.0;
        assert!((bounds.x + half_delta).abs() < 1e-9);
        assert!((bounds.y + half_delta).abs() < 1e-9);
        // Rendered glyph diameter inside the frame equals the target.
        assert!((frame.width * frame.width / bounds.width - LIGHT_DIAMETER).abs() < 1e-9);
    }

    #[test]
    fn auth_mode_hides_only_minimize_and_zoom() {
        assert_eq!(
            hidden_flags(TrafficLightMode::Auth),
            [false, true, true]
        );
    }

    #[test]
    fn ready_mode_shows_every_light() {
        assert_eq!(
            hidden_flags(TrafficLightMode::Ready),
            [false, false, false]
        );
    }

    #[test]
    fn auth_mode_repositions_close_and_preserves_hidden_light_frames() {
        let originals = cluster_frames();
        let frames = resolve_frames(TrafficLightMode::Auth, originals, close_frame());
        assert_eq!(frames[CLOSE].expect("close light frame").x, CLOSE_LEFT_INSET);
        // Hidden lights keep their pristine frames untouched.
        assert_eq!(frames[MINIATURIZE], originals[MINIATURIZE]);
        assert_eq!(frames[ZOOM], originals[ZOOM]);
        // The single light stays inside the icon rail.
        assert!(frames[CLOSE].expect("close light frame").right() <= RAIL_WIDTH);
    }

    #[test]
    fn ready_cluster_fits_entirely_inside_the_rail_with_a_margin() {
        let frames = resolve_frames(
            TrafficLightMode::Ready,
            cluster_frames(),
            close_frame(),
        );
        let zoom = frames[ZOOM].expect("zoom light frame");
        let close = frames[CLOSE].expect("close light frame");
        // Evenly distributed: the left inset and the right margin off the rail
        // divider are equal, and the rightmost light never crosses the rail.
        let left_margin = close.x;
        let right_margin = RAIL_WIDTH - zoom.right();
        assert!(zoom.right() <= RAIL_WIDTH);
        assert!((right_margin - 5.0).abs() < f64::EPSILON);
        assert!((left_margin - right_margin).abs() < f64::EPSILON);
        // Frames keep the native size; glyph compactness is a bounds concern.
        for frame in frames.iter().flatten() {
            assert!((frame.width - NATIVE_LIGHT_FRAME).abs() < f64::EPSILON);
            assert!((frame.height - NATIVE_LIGHT_FRAME).abs() < f64::EPSILON);
        }
    }

    #[test]
    fn ready_cluster_keeps_the_measured_pitch_and_shared_baseline() {
        let frames = resolve_frames(
            TrafficLightMode::Ready,
            cluster_frames(),
            close_frame(),
        );
        let close = frames[CLOSE].expect("close frame");
        let mini = frames[MINIATURIZE].expect("miniaturize frame");
        let zoom = frames[ZOOM].expect("zoom frame");
        assert!((mini.x - close.x - TRAFFIC_LIGHT_PITCH).abs() < f64::EPSILON);
        assert!((zoom.x - mini.x - TRAFFIC_LIGHT_PITCH).abs() < f64::EPSILON);
        // One vertical baseline after the shared top nudge.
        assert!((close.y - 8.0).abs() < f64::EPSILON);
        assert!((mini.y - close.y).abs() < f64::EPSILON);
        assert!((zoom.y - close.y).abs() < f64::EPSILON);
    }

    #[test]
    fn close_light_origin_is_stable_across_surface_modes() {
        // The close light must not jump when secondary lights fade in/out.
        let auth = resolve_frames(
            TrafficLightMode::Auth,
            cluster_frames(),
            close_frame(),
        );
        let ready = resolve_frames(
            TrafficLightMode::Ready,
            cluster_frames(),
            close_frame(),
        );
        assert_eq!(
            auth[CLOSE].expect("auth close frame"),
            ready[CLOSE].expect("ready close frame"),
        );
    }
}
