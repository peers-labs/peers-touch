use crate::infrastructure::station_client;
use crate::model::chat::{
    ListPendingMlsLeaveIntentsResponse, MlsLeaveIntent, SubmitMlsLeaveIntentRequest,
    SubmitMlsLeaveIntentResponse,
};
use messaging_core::mls::leave_intent::MlsLeaveIntentTransport;
use reqwest::Method;

pub struct StationMlsLeaveIntentTransport {
    token: String,
}

impl StationMlsLeaveIntentTransport {
    pub fn new(token: String) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err("messaging leave intent transport requires token".to_string());
        }
        Ok(Self { token })
    }
}

impl MlsLeaveIntentTransport for StationMlsLeaveIntentTransport {
    fn submit_leave_intent(&self, intent: &MlsLeaveIntent) -> Result<MlsLeaveIntent, String> {
        let response = station_client::request_proto::<
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
        )
        .map_err(|error| error.to_string())?;
        response
            .intent
            .ok_or_else(|| "Station returned no MLS leave intent".to_string())
    }

    fn list_leave_intents(&self, conversation_id: &str) -> Result<Vec<MlsLeaveIntent>, String> {
        let query = [("conversation_id", conversation_id.to_string())];
        station_client::request_proto::<(), ListPendingMlsLeaveIntentsResponse>(
            Method::GET,
            "/conversation/mls/leave-intents",
            &self.token,
            Some(&query),
            None,
        )
        .map(|response| response.intents)
        .map_err(|error| error.to_string())
    }
}
