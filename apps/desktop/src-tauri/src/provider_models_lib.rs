pub mod error;
#[path = "state/mod.rs"]
pub mod state;

// Minimal model re-export so station_client.rs can resolve `crate::model::common::PeersResponse`
// in the lib crate context. The full model tree lives in the binary crate (main.rs).
pub mod model {
    pub mod common {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
        }
        pub use v1::*;
    }
}

pub(crate) use interface::contracts;

pub mod infrastructure {
    #[path = "i18n/mod.rs"]
    pub mod i18n;
    #[path = "station_client.rs"]
    pub(crate) mod station_client;
    #[path = "storage/mod.rs"]
    pub mod storage;
    // Mirrors the bin crate so `state::AppState` can build under `cargo test
    // --lib`. PR-3 will cull the lib crate down once the registry is wired
    // through every command path.
    #[path = "window_session_registry/mod.rs"]
    pub mod window_session_registry;
}

pub mod domain {
    pub mod storage {
        #[path = "database.rs"]
        pub mod database;
        #[path = "key_management.rs"]
        pub mod key_management;
    }
    #[path = "identity/mod.rs"]
    pub mod identity;
}

pub mod interface {
    #[path = "contracts/mod.rs"]
    pub mod contracts;

    pub mod tauri_commands {
        #[path = "models.rs"]
        pub mod models;
        #[path = "provider.rs"]
        pub mod provider;
    }
}

pub mod application {
    #[path = "models/mod.rs"]
    pub mod models;
    #[path = "provider/mod.rs"]
    pub mod provider;
    #[path = "session_resolver/mod.rs"]
    pub mod session_resolver;
}
