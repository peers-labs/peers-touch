use crate::infrastructure::station_client;
use crate::model::chat::{
    ListPendingMlsLeaveIntentsResponse, MlsLeaveIntent, SubmitMlsLeaveIntentRequest,
    SubmitMlsLeaveIntentResponse,
};
use messaging_core::mls::leave_intent::MlsLeaveIntentTransport;
use reqwest::Method;

pub struct StationMlsLeaveIntentTransport {
    token: String,
    device_id: String,
}

impl StationMlsLeaveIntentTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err("messaging leave intent transport requires token".to_string());
        }
        if device_id.trim().is_empty() {
            return Err("messaging leave intent transport requires device ID".to_string());
        }
        Ok(Self { token, device_id })
    }
}

impl MlsLeaveIntentTransport for StationMlsLeaveIntentTransport {
    fn submit_leave_intent(&self, intent: &MlsLeaveIntent) -> Result<MlsLeaveIntent, String> {
        let response = station_client::request_proto_for_device::<
            SubmitMlsLeaveIntentRequest,
            SubmitMlsLeaveIntentResponse,
        >(
            Method::POST,
            "/conversation/mls/leave-intent",
            &self.token,
            None,
            Some(&SubmitMlsLeaveIntentRequest {
                intent: Some(intent.clone()),
            }),
            &self.device_id,
        )
        .map_err(|error| error.to_string())?;
        response
            .intent
            .ok_or_else(|| "Station returned no MLS leave intent".to_string())
    }

    fn list_leave_intents(&self, conversation_id: &str) -> Result<Vec<MlsLeaveIntent>, String> {
        let query = [("conversation_id", conversation_id.to_string())];
        station_client::request_proto_for_device::<(), ListPendingMlsLeaveIntentsResponse>(
            Method::GET,
            "/conversation/mls/leave-intents",
            &self.token,
            Some(&query),
            None,
            &self.device_id,
        )
        .map(|response| response.intents)
        .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::StationMlsLeaveIntentTransport;

    #[test]
    fn transport_requires_profile_scoped_device_id() {
        assert!(StationMlsLeaveIntentTransport::new("token".to_string(), String::new(),).is_err());
    }

    #[test]
    fn transport_retains_profile_scoped_device_id() {
        let transport =
            StationMlsLeaveIntentTransport::new("token".to_string(), "alice-device".to_string())
                .expect("transport");

        assert_eq!(transport.device_id, "alice-device");
    }
}
