mod commands;
pub mod error;
mod platform;

use platform::MobilePlatform;
use platform::secure_storage::SecureStorage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    context.set_default_window_icon(Some(tauri::image::Image::new_owned(
        vec![0; 64 * 64 * 4],
        64,
        64,
    )));

    tauri::Builder::default()
        .manage(MobilePlatform::ios_first())
        .manage(SecureStorage::new())
        .invoke_handler(commands::handlers())
        .run(context)
        .expect("failed to run Peers Touch Mobile");
}
