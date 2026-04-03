pub mod error;
#[path = "state/mod.rs"]
pub mod state;
pub mod model;

pub(crate) use interface::contracts;

pub mod infrastructure {
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
