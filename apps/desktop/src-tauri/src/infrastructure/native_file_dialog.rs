//! Non-blocking native file choosers for macOS.
//!
//! rfd 0.15 presents its asynchronous choosers as AppKit *sheets*. On macOS 26
//! a sheet renders as a centered card that AppKit keeps inside the parent
//! window's accessibility tree: no new `AXWindow` is exposed and `AXSheets`
//! stays empty, while the parent remains the accessibility main window. The
//! shared native acceptance driver distinguishes an open chooser from the
//! restored document by a window-count change, so a sheet is indistinguishable
//! from the restored window and the chooser is reported as "did not open".
//!
//! `-[NSSavePanel beginWithCompletionHandler:]` presents a separate, modeless
//! window and returns immediately. Unlike `runModal`, it never blocks the main
//! run loop, so the embedded WebDriver channel keeps servicing JavaScript
//! while the panel is key.

use std::path::PathBuf;

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSModalResponse, NSModalResponseOK, NSOpenPanel, NSSavePanel,
};
use objc2_foundation::NSString;
use tokio::sync::oneshot;

/// Present a standalone, single-selection Open panel without blocking the main
/// thread. Resolves to the chosen file path, or `None` when the user cancels.
pub async fn pick_single_file(title: String) -> Option<PathBuf> {
    present_panel(move |marker| {
        let panel = NSOpenPanel::openPanel(marker);
        panel.setCanChooseFiles(true);
        panel.setCanChooseDirectories(false);
        panel.setAllowsMultipleSelection(false);
        panel.setTitle(Some(&NSString::from_str(&title)));
        panel.into_super()
    })
    .await
    .ok()
    .flatten()
}

/// Present a standalone Save panel seeded with `default_name` without blocking
/// the main thread. Resolves to the chosen destination, or `None` on cancel.
pub async fn save_single_file(default_name: String) -> Option<PathBuf> {
    present_panel(move |marker| {
        let panel = NSSavePanel::savePanel(marker);
        panel.setCanCreateDirectories(true);
        panel.setNameFieldStringValue(&NSString::from_str(&default_name));
        panel
    })
    .await
    .ok()
    .flatten()
}

fn present_panel(
    configure: impl FnOnce(MainThreadMarker) -> objc2::rc::Retained<NSSavePanel> + Send + 'static,
) -> oneshot::Receiver<Option<PathBuf>> {
    let (sender, receiver) = oneshot::channel::<Option<PathBuf>>();

    DispatchQueue::main().exec_async(move || {
        let Some(marker) = MainThreadMarker::new() else {
            // The main dispatch queue is the AppKit thread; absence indicates a
            // broken runtime rather than a user cancellation.
            let _ = sender.send(None);
            return;
        };

        let panel = configure(marker);

        let application = NSApplication::sharedApplication(marker);
        #[allow(deprecated)]
        application.activateIgnoringOtherApps(true);

        // The panel is retained by the completion block and by AppKit while it
        // is on screen, so the modeless presentation stays alive after this
        // closure returns. The handler is an `Fn` that AppKit may invoke more
        // than once, so the one-shot responder is consumed on the first call.
        let responder = std::rc::Rc::new(std::cell::RefCell::new(Some(sender)));
        let handler_responder = responder.clone();
        let handler_panel = panel.clone();
        let handler = RcBlock::new(move |response: NSModalResponse| {
            let selected = if response == NSModalResponseOK {
                handler_panel
                    .URL()
                    .and_then(|url| url.path())
                    .map(|path| PathBuf::from(path.to_string()))
            } else {
                None
            };
            // A modeless panel presented through the system panel service keeps
            // its session registered for the app bundle until ordered out.
            // Without this, a second panel from another instance of the same
            // bundle attaches to the stale session and exposes no controls.
            handler_panel.orderOut(None);
            if let Some(responder) = handler_responder.borrow_mut().take() {
                let _ = responder.send(selected);
            }
        });
        panel.beginWithCompletionHandler(&handler);

        // NSSavePanel makes its filename field the initial first responder.
        // The field editor consumes the first Escape press to discard field
        // edits instead of activating the Cancel button, so automation (and a
        // user pressing Escape once) cannot dismiss the panel. Move focus off
        // the field once presentation is on the run loop; Escape then reaches
        // the panel's Cancel key equivalent.
        let responder_panel = &*panel as *const NSSavePanel as usize;
        DispatchQueue::main().exec_async(move || {
            // AppKit keeps the presented panel alive while it is on screen.
            let responder_panel = unsafe { &*(responder_panel as *const NSSavePanel) };
            responder_panel.makeFirstResponder(None);
        });
    });

    receiver
}
