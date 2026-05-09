use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::storage::StorageLayout;
use crate::infrastructure::window_session_registry::WindowSessionRegistry;
use std::sync::Mutex;

#[derive(Default, Clone)]
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
    /// **Deprecated** — last authenticated session in-process for the debug
    /// HTTP gateway only (`interface::http_gateway`); Tauri windows use
    /// `WindowSessionRegistry` + per-actor on-disk store (`session_store`).
    pub session: Mutex<SessionState>,
    pub settings: Mutex<SettingsState>,
    pub realtime: Mutex<RealtimeState>,
    pub storage: StorageLayout,
    pub i18n: I18nService,
    /// Per-window `ActiveSession` registry. Coexists with `session` until
    /// PR-3 finishes the migration.
    pub sessions: WindowSessionRegistry,
}

impl AppState {
    pub fn new(layout: StorageLayout, i18n: I18nService) -> Self {
        Self {
            session: Mutex::new(SessionState::default()),
            settings: Mutex::new(SettingsState::default()),
            realtime: Mutex::new(RealtimeState::default()),
            storage: layout,
            i18n,
            sessions: WindowSessionRegistry::new(),
        }
    }
}
