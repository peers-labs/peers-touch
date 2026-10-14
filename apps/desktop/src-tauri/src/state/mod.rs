use crate::application::station_runtime::StationRuntime;
use crate::infrastructure::event_stream::EventStreamRuntime;
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

pub struct AppState {
    /// Serializes process-wide identity commits across Tauri and HTTP gateway
    /// entry points so account, window session, and messaging profile cannot
    /// expose different actors.
    pub identity_transition: Mutex<()>,
    pub settings: Mutex<SettingsState>,
    pub event_streams: EventStreamRuntime,
    pub storage: StorageLayout,
    pub i18n: I18nService,
    /// App-scoped owner for Station binding, typed requests, resources, and
    /// Direct/Circuit transport lifecycle.
    pub station: StationRuntime,
    pub messaging_engines: EngineRegistry,
    /// Process-scoped owner for Content PreKey maintenance and private
    /// content session-generation fencing. It is independent from Direct/MLS.
    pub secure_content: SecureContentSupervisor,
    /// Sole in-process authority for authenticated Desktop sessions.
    pub sessions: WindowSessionRegistry,
}

impl AppState {
    pub fn new(layout: StorageLayout, i18n: I18nService, station: StationRuntime) -> Self {
        let messaging_engines = EngineRegistry::new(station.client().clone());
        Self {
            identity_transition: Mutex::new(()),
            settings: Mutex::new(SettingsState::default()),
            event_streams: EventStreamRuntime::new(),
            storage: layout,
            i18n,
            station,
            messaging_engines,
            secure_content: SecureContentSupervisor::new(),
            sessions: WindowSessionRegistry::new(),
        }
    }
}
