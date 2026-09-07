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

pub mod social {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/peers_touch.model.social.v1.rs"));
    }
    pub use v1::*;
}

pub fn actor_ref(ptid: impl Into<String>) -> actor::ActorRef {
    actor::ActorRef {
        ptid: ptid.into(),
        ..Default::default()
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
