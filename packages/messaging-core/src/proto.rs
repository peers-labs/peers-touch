pub mod actor {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
    }
    pub use v1::*;
}

pub mod chat {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.chat.v1.rs"));
}

pub mod common {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
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

pub mod recovery {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.recovery.v1.rs"
        ));
    }
    pub use v1::*;
}

pub mod secure_content {
    pub mod v1 {
        include!(concat!(
            env!("OUT_DIR"),
            "/peers_touch.model.secure_content.v1.rs"
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

pub fn actor_ref(ptid: impl Into<String>) -> actor::ActorRef {
    let ptid = ptid.into();
    actor::ActorRef {
        kind: actor_kind_from_ptid(&ptid) as i32,
        ptid,
        ..Default::default()
    }
}

fn actor_kind_from_ptid(ptid: &str) -> actor::ActorKind {
    match ptid.split(':').nth(4) {
        Some("p") => actor::ActorKind::Person,
        Some("g") => actor::ActorKind::Group,
        Some("o") => actor::ActorKind::Organization,
        Some("s") => actor::ActorKind::Service,
        Some("a") => actor::ActorKind::Application,
        Some("n") => actor::ActorKind::Node,
        _ => actor::ActorKind::Unspecified,
    }
}

pub fn actor_device_ref(
    ptid: impl Into<String>,
    device_id: impl Into<String>,
) -> actor::ActorDeviceRef {
    actor::ActorDeviceRef {
        actor: Some(actor_ref(ptid)),
        device_id: device_id.into(),
    }
}

pub fn actor_device_ptid(device: &actor::ActorDeviceRef) -> Result<&str, String> {
    device
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .filter(|ptid| !ptid.trim().is_empty())
        .ok_or_else(|| "actor device reference requires PTID".to_string())
}

pub fn chat_endpoint(device: &actor::ActorDeviceRef) -> Result<chat::CryptoEndpoint, String> {
    if device.device_id.trim().is_empty() {
        return Err("actor device reference requires device ID".to_string());
    }
    Ok(chat::CryptoEndpoint {
        ptid: actor_device_ptid(device)?.to_string(),
        device_id: device.device_id.clone(),
    })
}

pub fn actor_device_from_chat_endpoint(endpoint: &chat::CryptoEndpoint) -> actor::ActorDeviceRef {
    actor_device_ref(endpoint.ptid.clone(), endpoint.device_id.clone())
}

#[cfg(test)]
mod tests {
    use super::{actor, actor_ref};

    #[test]
    fn actor_ref_derives_kind_from_canonical_ptid() {
        let cases = [
            ("p", actor::ActorKind::Person),
            ("g", actor::ActorKind::Group),
            ("o", actor::ActorKind::Organization),
            ("s", actor::ActorKind::Service),
            ("a", actor::ActorKind::Application),
            ("n", actor::ActorKind::Node),
        ];

        for (kind, expected) in cases {
            let ptid = format!("ptid:v1:actor:peers:{kind}:alice:fingerprint");
            assert_eq!(actor_ref(ptid).kind, expected as i32);
        }
        assert_eq!(
            actor_ref("ptid:invalid").kind,
            actor::ActorKind::Unspecified as i32
        );
    }
}
