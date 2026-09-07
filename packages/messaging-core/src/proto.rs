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

pub(crate) fn actor_ref_from_ptid(ptid: &str) -> actor::ActorRef {
    actor::ActorRef {
        ptid: ptid.to_string(),
        ..Default::default()
    }
}

pub(crate) fn actor_device_ref_from_parts(ptid: &str, device_id: &str) -> actor::ActorDeviceRef {
    actor::ActorDeviceRef {
        actor: Some(actor_ref_from_ptid(ptid)),
        device_id: device_id.to_string(),
    }
}

#[cfg(test)]
pub(crate) fn actor_device_ref_from_crypto_endpoint(
    endpoint: &chat::CryptoEndpoint,
) -> actor::ActorDeviceRef {
    actor_device_ref_from_parts(&endpoint.ptid, &endpoint.device_id)
}

pub(crate) fn crypto_endpoint_from_actor_device_ref(
    device: &actor::ActorDeviceRef,
) -> Option<chat::CryptoEndpoint> {
    let actor = device.actor.as_ref()?;
    if actor.ptid.trim().is_empty() || device.device_id.trim().is_empty() {
        return None;
    }
    Some(chat::CryptoEndpoint {
        ptid: actor.ptid.clone(),
        device_id: device.device_id.clone(),
    })
}

pub(crate) fn crypto_endpoints_from_actor_device_refs(
    devices: &[actor::ActorDeviceRef],
) -> Option<Vec<chat::CryptoEndpoint>> {
    devices
        .iter()
        .map(crypto_endpoint_from_actor_device_ref)
        .collect()
}
