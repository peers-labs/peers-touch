pub mod peers_touch {
    pub mod model {
        pub mod actor {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
            }
        }
        pub mod auth {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.auth.v1.rs"));
            }
            pub mod device_link {
                pub mod v1 {
                    include!(concat!(
                        env!("OUT_DIR"),
                        "/peers_touch.model.auth.device_link.v1.rs"
                    ));
                }
            }
        }
        pub mod access_gate {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/peers_touch.model.access_gate.v1.rs"
                ));
            }
        }
        pub mod schema {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.schema.v1.rs"));
            }
        }
    }
}
pub use peers_touch::model::auth::device_link::v1 as device_link;
pub use peers_touch::model::schema::v1::*;
