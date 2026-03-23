use std::sync::Mutex;

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

#[derive(Default)]
pub struct AppState {
    pub session: Mutex<SessionState>,
    pub settings: Mutex<SettingsState>,
    pub realtime: Mutex<RealtimeState>,
}
