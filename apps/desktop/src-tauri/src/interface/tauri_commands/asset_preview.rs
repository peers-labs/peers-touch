//! Selected-file preview grants for the Tauri asset protocol.
//!
//! Native file pickers return absolute paths outside the configured
//! asset scope, so a picked file is not `<img src>`-readable until the
//! owning command grants exactly that path. The grant is deliberately
//! file-scoped: sibling files in the same directory (or any other
//! picked/adjacent path) stay unreadable. Every consumer that returns a
//! local path for renderer preview MUST route it through this helper so
//! messaging, generic OSS, Profile, and Social pickers share one
//! auditable grant implementation.

use std::path::Path;

use tauri::{Manager, Window};

/// Grant the asset protocol access to exactly one selected file path.
pub(crate) fn allow_selected_file_preview(
    window: &Window,
    path: &Path,
) -> Result<(), String> {
    let scope = window.app_handle().asset_protocol_scope();
    scope
        .allow_file(path)
        .map_err(|error| format!("allow selected file preview: {error}"))?;
    Ok(())
}

/// Grant the asset protocol access to an exact set of selected files.
/// All grants are independent; the first failure is reported after
/// attempting every path so a single bad grant does not leave the rest
/// of a multi-file selection un-previewable silently.
pub(crate) fn allow_selected_file_previews(
    window: &Window,
    paths: impl IntoIterator<Item = impl AsRef<Path>>,
) -> Result<(), String> {
    let mut first_error: Option<String> = None;
    for path in paths {
        if let Err(error) = allow_selected_file_preview(window, path.as_ref()) {
            tracing::warn!(error = %error, "selected file preview grant failed");
            first_error.get_or_insert(error);
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
