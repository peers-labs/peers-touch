use messaging_core::mls::leave_intent::MlsLeaveIntentTransport;
use messaging_core::proto::chat::{
    Conversation, GetConversationRequest, GetConversationResponse,
    ListPendingMlsLeaveIntentsRequest, ListPendingMlsLeaveIntentsResponse, MlsLeaveIntent,
    SubmitMlsLeaveIntentRequest, SubmitMlsLeaveIntentResponse,
};
use zeroize::Zeroizing;

use super::transport::{get_proto, post_proto, validate_transport_scope};

pub struct StationMlsLeaveIntentTransport {
    station_origin: String,
    access_token: Zeroizing<String>,
    device_id: String,
}

impl StationMlsLeaveIntentTransport {
    pub fn new(
        station_origin: String,
        access_token: String,
        device_id: String,
    ) -> Result<Self, String> {
        validate_transport_scope(&station_origin, &access_token, &device_id)?;
        Ok(Self {
            station_origin,
            access_token: Zeroizing::new(access_token),
            device_id,
        })
    }

    pub fn get_conversation(&self, conversation_id: &str) -> Result<Conversation, String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging leave intent requires conversation ID".to_string());
        }
        let response: GetConversationResponse = get_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/get",
            &GetConversationRequest {
                conversation_id: conversation_id.to_string(),
            },
        )
        .map_err(|error| error.to_string())?;
        let conversation = response
            .conversation
            .ok_or_else(|| "Station returned no Conversation for MLS leave intent".to_string())?;
        if conversation.conversation_id != conversation_id {
            return Err("Station returned another Conversation for MLS leave intent".to_string());
        }
        Ok(conversation)
    }
}

impl MlsLeaveIntentTransport for StationMlsLeaveIntentTransport {
    fn submit_leave_intent(&self, intent: &MlsLeaveIntent) -> Result<MlsLeaveIntent, String> {
        let response: SubmitMlsLeaveIntentResponse = post_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/mls/leave-intent",
            &SubmitMlsLeaveIntentRequest {
                intent: Some(intent.clone()),
            },
        )
        .map_err(|error| error.to_string())?;
        response
            .intent
            .ok_or_else(|| "Station returned no MLS leave intent".to_string())
    }

    fn list_leave_intents(&self, conversation_id: &str) -> Result<Vec<MlsLeaveIntent>, String> {
        let response: ListPendingMlsLeaveIntentsResponse = get_proto(
            &self.station_origin,
            self.access_token.as_str(),
            &self.device_id,
            "/conversation/mls/leave-intents",
            &ListPendingMlsLeaveIntentsRequest {
                conversation_id: conversation_id.to_string(),
            },
        )
        .map_err(|error| error.to_string())?;
        Ok(response.intents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_requires_complete_station_scope() {
        assert!(StationMlsLeaveIntentTransport::new(
            "https://station.example".to_string(),
            String::new(),
            "device-1".to_string(),
        )
        .is_err());
        assert!(StationMlsLeaveIntentTransport::new(
            "https://station.example".to_string(),
            "token".to_string(),
            "device-1".to_string(),
        )
        .is_ok());
    }
}
