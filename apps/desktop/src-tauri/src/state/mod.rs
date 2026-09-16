use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::storage::StorageLayout;
use crate::infrastructure::window_session_registry::WindowSessionRegistry;
use crate::messaging::EngineRegistry;
use crate::secure_content::SecureContentSupervisor;
use std::sync::Mutex;

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
    /// Serializes process-wide identity commits across Tauri and HTTP gateway
    /// entry points so account, window session, and messaging profile cannot
    /// expose different actors.
    pub identity_transition: Mutex<()>,
    pub settings: Mutex<SettingsState>,
    pub realtime: Mutex<RealtimeState>,
    pub storage: StorageLayout,
    pub i18n: I18nService,
    pub messaging_engines: EngineRegistry,
    /// Process-scoped owner for Content PreKey maintenance and private
    /// content session-generation fencing. It is independent from Direct/MLS.
    pub secure_content: SecureContentSupervisor,
    /// Sole in-process authority for authenticated Desktop sessions.
    pub sessions: WindowSessionRegistry,
}

impl AppState {
    pub fn new(layout: StorageLayout, i18n: I18nService) -> Self {
        Self {
            identity_transition: Mutex::new(()),
            settings: Mutex::new(SettingsState::default()),
            realtime: Mutex::new(RealtimeState::default()),
            storage: layout,
            i18n,
            messaging_engines: EngineRegistry::default(),
            secure_content: SecureContentSupervisor::new(),
            sessions: WindowSessionRegistry::new(),
        }
    }
}
