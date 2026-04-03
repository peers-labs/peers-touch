use std::sync::Mutex;
use crate::infrastructure::storage::StorageLayout;

#[derive(Default)]
pub struct SessionState {
    pub actor_id: Option<String>,
    pub token: Option<String>,
}

#[derive(Default)]
pub struct SettingsState {
    pub locale: Option<String>,
    pub theme: Option<String>,
}

#[derive(Default)]
pub struct RealtimeState {
    pub connected: bool,
    pub transport: Option<String>,
}

pub struct AppState {
    pub session: Mutex<SessionState>,
    pub settings: Mutex<SettingsState>,
    pub realtime: Mutex<RealtimeState>,
    pub storage: StorageLayout,
}

impl AppState {
    pub fn new(layout: StorageLayout) -> Self {
        Self {
            session: Mutex::new(SessionState::default()),
            settings: Mutex::new(SettingsState::default()),
            realtime: Mutex::new(RealtimeState::default()),
            storage: layout,
        }
    }
}
