pub mod peers_touch {
    pub mod model {
        #[allow(dead_code)]
        pub mod actor {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
            }
        }

        #[allow(dead_code)]
        pub mod auth {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.auth.v1.rs"));
            }
        }

        #[allow(dead_code)]
        pub mod common {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
            }
        }

        #[allow(dead_code)]
        pub mod access_gate {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/peers_touch.model.access_gate.v1.rs"
                ));
            }
        }

        #[allow(dead_code)]
        pub mod oauth {
            pub mod mobile {
                pub mod v1 {
                    include!(concat!(
                        env!("OUT_DIR"),
                        "/peers_touch.model.oauth.mobile.v1.rs"
                    ));
                }
            }
        }
    }
}

#[allow(unused_imports)]
pub use peers_touch::model::{access_gate, actor, auth, common, oauth};
