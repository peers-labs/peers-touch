use tauri::State;

use crate::platform::{ios::MobileHealth, MobilePlatform};

#[tauri::command]
pub fn mobile_health(platform: State<'_, MobilePlatform>) -> MobileHealth {
    platform.health()
}
