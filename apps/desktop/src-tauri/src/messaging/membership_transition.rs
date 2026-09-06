use super::EngineEndpoint;
use crate::infrastructure::station_client;
use crate::model::chat::{
    CryptoEndpoint, PrepareMessagingMembershipTransitionRequest,
    PrepareMessagingMembershipTransitionResponse,
};
use messaging_core::mls::membership_transition::MembershipTransitionIntentInput;
use reqwest::Method;

pub struct StationMembershipTransitionTransport {
    token: String,
    endpoint: EngineEndpoint,
}

impl StationMembershipTransitionTransport {
    pub fn new(token: String, endpoint: EngineEndpoint) -> Result<Self, String> {
        if token.trim().is_empty()
            || endpoint.ptid.trim().is_empty()
            || endpoint.device_id.trim().is_empty()
        {
            return Err("messaging membership transition transport is incomplete".to_string());
        }
        Ok(Self { token, endpoint })
    }

    pub fn prepare(
        &self,
        input: &MembershipTransitionIntentInput,
    ) -> Result<PrepareMessagingMembershipTransitionResponse, String> {
        station_client::request_proto_for_device::<
            PrepareMessagingMembershipTransitionRequest,
            PrepareMessagingMembershipTransitionResponse,
        >(
            Method::POST,
            "/conversation/membership/prepare",
            &self.token,
            None,
            Some(&PrepareMessagingMembershipTransitionRequest {
                conversation_id: input.conversation_id.clone(),
                sender: Some(model_endpoint(&self.endpoint)),
                action: input.action as i32,
                target_ptid: input.target_ptid.clone(),
                target_device_id: input.target_device_id.clone(),
                role: input.role.clone(),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())
    }
}

fn model_endpoint(endpoint: &EngineEndpoint) -> CryptoEndpoint {
    CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    }
}
