use super::EngineEndpoint;
use crate::infrastructure::station_client;
use crate::model::chat::{PrepareConversationGroupRequest, PrepareConversationGroupResponse};
use messaging_core::proto::{actor_device_ref, actor_ref};
use reqwest::Method;

pub struct StationGroupGenesisTransport {
    token: String,
    endpoint: EngineEndpoint,
}

impl StationGroupGenesisTransport {
    pub fn new(token: String, endpoint: EngineEndpoint) -> Result<Self, String> {
        if token.trim().is_empty()
            || endpoint.ptid.trim().is_empty()
            || endpoint.device_id.trim().is_empty()
        {
            return Err("messaging group genesis transport is incomplete".to_string());
        }
        Ok(Self { token, endpoint })
    }

    pub fn prepare(
        &self,
        conversation_id: &str,
        name: &str,
        member_ptids: &[String],
        federation_id: &str,
    ) -> Result<PrepareConversationGroupResponse, String> {
        if conversation_id.trim().is_empty()
            || name.trim().is_empty()
            || member_ptids.is_empty()
            || federation_id.trim().is_empty()
        {
            return Err("messaging group genesis input is incomplete".to_string());
        }
        station_client::request_proto_for_device::<
            PrepareConversationGroupRequest,
            PrepareConversationGroupResponse,
        >(
            Method::POST,
            "/conversation/group/prepare",
            &self.token,
            None,
            Some(&PrepareConversationGroupRequest {
                conversation_id: conversation_id.to_string(),
                name: name.to_string(),
                members: member_ptids
                    .iter()
                    .map(|ptid| actor_ref(ptid.clone()))
                    .collect(),
                creator: Some(actor_device_ref(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
                federation_id: federation_id.to_string(),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())
    }
}
