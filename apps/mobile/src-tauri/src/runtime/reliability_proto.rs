pub mod peers_touch {
    pub mod model {
        pub mod activity {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/peers_touch.model.activity.v1.rs"
                ));
            }
        }

        pub mod actor {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
            }
        }

        pub mod common {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
            }
        }

        pub mod secure_content {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/peers_touch.model.secure_content.v1.rs"
                ));
            }
        }

        pub mod social {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.social.v1.rs"));
            }
        }

        pub mod mobile {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.mobile.v1.rs"));
            }
        }
    }
}
