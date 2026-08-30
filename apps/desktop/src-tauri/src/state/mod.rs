use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::storage::StorageLayout;
use crate::infrastructure::window_session_registry::WindowSessionRegistry;
use crate::messaging::EngineRegistry;
use std::sync::{Arc, Mutex};

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
    pub identity_transition: Arc<Mutex<()>>,
    pub settings: Mutex<SettingsState>,
    pub realtime: Mutex<RealtimeState>,
    pub storage: StorageLayout,
    pub i18n: I18nService,
    pub messaging_engines: EngineRegistry,
    /// Sole in-process authority for authenticated Desktop sessions.
    pub sessions: WindowSessionRegistry,
}

impl AppState {
    pub fn new(layout: StorageLayout, i18n: I18nService) -> Self {
        Self {
            identity_transition: Arc::new(Mutex::new(())),
            settings: Mutex::new(SettingsState::default()),
            realtime: Mutex::new(RealtimeState::default()),
            storage: layout,
            i18n,
            messaging_engines: EngineRegistry::default(),
            sessions: WindowSessionRegistry::new(),
        }
    }
}
