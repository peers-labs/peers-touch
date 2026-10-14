pub mod error;

// Minimal model re-export for provider-model tests. The full model tree and all
// runtime composition live in the binary crate.
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
    pub mod provider {
        #[path = "remote.rs"]
        pub mod remote;
    }
}
