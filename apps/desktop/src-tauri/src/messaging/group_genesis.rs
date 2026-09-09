use super::{actor_device_ref, actor_ref, EngineEndpoint};
use crate::infrastructure::station_client;
use crate::model::chat::{PrepareConversationGroupRequest, PrepareConversationGroupResponse};
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
    ) -> Result<PrepareConversationGroupResponse, String> {
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
                members: member_ptids.iter().map(|ptid| actor_ref(ptid)).collect(),
                creator: Some(actor_device_ref(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())
    }
}
