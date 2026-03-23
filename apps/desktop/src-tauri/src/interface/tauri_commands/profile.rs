use crate::error::AppResult;
use crate::interface::contracts::{FileUploadInput, ProfilePrivacyInput, ProfileUpdateInput, StubPayload};

#[path = "../../domain/profile/mod.rs"]
mod domain_profile;
#[path = "../../application/profile/mod.rs"]
mod application_profile;

#[tauri::command]
pub fn profile_get() -> AppResult<StubPayload> {
    application_profile::profile_get()
}

#[tauri::command]
pub fn profile_update(input: ProfileUpdateInput) -> AppResult<StubPayload> {
    application_profile::profile_update(input)
}

#[tauri::command]
pub fn profile_upload_avatar(input: FileUploadInput) -> AppResult<StubPayload> {
    application_profile::profile_upload_avatar(input)
}

#[tauri::command]
pub fn profile_upload_header(input: FileUploadInput) -> AppResult<StubPayload> {
    application_profile::profile_upload_header(input)
}

#[tauri::command]
pub fn profile_update_privacy(input: ProfilePrivacyInput) -> AppResult<StubPayload> {
    application_profile::profile_update_privacy(input)
}
