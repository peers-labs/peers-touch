// Proto types — generated at build time by prost-build (see build.rs).
// Source definitions live in model/domain/**/*.proto (single source of truth).
//
// Chat proto types are generated and owned by messaging-core; Desktop re-exports them.
// Non-chat protos remain Desktop-generated.

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

pub mod notification {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.notification.v1.rs"
        ));
    }
    pub use v1::*;
}

pub mod ai_chat {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.ai_chat.v1.rs"));
    }
    pub use v1::*;
}

pub mod actor {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
    }
    pub use v1::*;
}

pub mod auth {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.auth.v1.rs"));
    }
    pub use v1::*;
}

pub mod core {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.core.v1.rs"));
    }
    pub use v1::*;
}

pub mod error {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.error.v1.rs"));
    }
    pub use v1::*;
}

pub mod realtime {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.realtime.v1.rs"
        ));
    }
    pub use v1::*;
}

pub mod social {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.social.v1.rs"));
    }
    pub use v1::*;
}

pub mod activity {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.activity.v1.rs"
        ));
    }
    pub use v1::*;
}

pub mod message {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.message.v1.rs"));
    }
    pub use v1::*;
}

pub mod oauth {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.oauth.v1.rs"));
    }
    pub use v1::*;
}

pub mod oss {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.oss.v1.rs"));
    }
    pub use v1::*;
}

pub mod peer {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
    }
    pub use v1::*;
}

pub mod presence {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.presence.v1.rs"
        ));
    }
    pub use v1::*;
}

pub mod manage {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.manage.v1.rs"));
    }
    pub use v1::*;
}

pub mod agent {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.agent.v1.rs"));
    }
    pub use v1::*;
}

pub mod key_exchange {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.key_exchange.v1.rs"
        ));
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

pub mod applet {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.domain.applet.rs"));
}

pub mod launcher {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.domain.launcher.rs"));
}

pub mod peers_actor {
    include!(concat!(env!("OUT_DIR"), "/peers.actor.rs"));
}
