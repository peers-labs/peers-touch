pub mod error;

// Minimal model re-export so station_client.rs can resolve `crate::model::common::PeersResponse`
// in the lib crate context. The full model tree lives in the binary crate (main.rs).
pub mod model {
    pub mod chat {
        pub use messaging_core::proto::chat::*;

        pub mod v1 {
            pub use messaging_core::proto::chat::*;
        }
    }

    pub mod common {
        pub use messaging_core::proto::common::*;

        pub mod v1 {
            pub use messaging_core::proto::common::*;
        }
    }
}

pub(crate) use interface::contracts;

pub mod infrastructure {
    #[path = "attachment_blob.rs"]
    pub mod attachment_blob;
    #[path = "i18n/mod.rs"]
    pub mod i18n;
    #[path = "station_client.rs"]
    pub(crate) mod station_client;
    #[path = "station_registry.rs"]
    pub(crate) mod station_registry;
    #[path = "storage/mod.rs"]
    pub mod storage;
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
}

pub mod application {
    #[path = "provider/mod.rs"]
    pub mod provider;
}
