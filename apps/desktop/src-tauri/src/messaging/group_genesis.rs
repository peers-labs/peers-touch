use super::EngineEndpoint;
use crate::infrastructure::station_client;
use crate::model::chat::{
    CryptoEndpoint, PrepareMessagingGroupGenesisRequest, PrepareMessagingGroupGenesisResponse,
};
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
    ) -> Result<PrepareMessagingGroupGenesisResponse, String> {
        station_client::request_proto_for_device::<
            PrepareMessagingGroupGenesisRequest,
            PrepareMessagingGroupGenesisResponse,
        >(
            Method::POST,
            "/conversation/group/prepare",
            &self.token,
            None,
            Some(&PrepareMessagingGroupGenesisRequest {
                conversation_id: conversation_id.to_string(),
                name: name.to_string(),
                member_ptids: member_ptids.to_vec(),
                creator: Some(model_endpoint(&self.endpoint)),
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
