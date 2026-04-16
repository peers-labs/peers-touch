pub mod error;
#[path = "state/mod.rs"]
pub mod state;

pub(crate) use interface::contracts;

/// Minimal proto surface shared with `infrastructure/station_client.rs` (also used by the main binary).
pub mod model {
    pub mod common {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
    }
}

pub mod infrastructure {
    #[path = "i18n/mod.rs"]
    pub mod i18n;
    #[path = "storage/mod.rs"]
    pub mod storage;
    #[path = "station_client.rs"]
    pub(crate) mod station_client;
}

pub mod domain {
    pub mod storage {
        #[path = "database.rs"]
        pub mod database;
        #[path = "key_management.rs"]
        pub mod key_management;
    }
}

pub mod interface {
    #[path = "contracts/mod.rs"]
    pub mod contracts;

    pub mod tauri_commands {
        #[path = "provider.rs"]
        pub mod provider;
        #[path = "models.rs"]
        pub mod models;
    }
}

pub mod application {
    #[path = "provider/mod.rs"]
    pub mod provider;
    #[path = "models/mod.rs"]
    pub mod models;
}
