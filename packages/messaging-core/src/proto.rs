pub mod chat {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.chat.v1.rs"));
}

pub mod common {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
    }
    pub use v1::*;
}
