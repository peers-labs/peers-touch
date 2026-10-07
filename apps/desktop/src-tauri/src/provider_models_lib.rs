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

    pub mod actor {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
        }
        pub use v1::*;
    }

    pub mod peer {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
        }
        pub use v1::*;
    }

    pub mod federation {
        pub mod v1 {
            include!(concat!(
                env!("OUT_DIR"),
                "/peers_touch.model.federation.v1.rs"
            ));
        }
        pub use v1::*;
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
    #[path = "station_discovery.rs"]
    pub(crate) mod station_discovery;
    #[path = "station_registry.rs"]
    pub(crate) mod station_registry;
    #[path = "station_transport.rs"]
    pub(crate) mod station_transport;
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
