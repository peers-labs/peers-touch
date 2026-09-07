use super::EngineEndpoint;
use crate::infrastructure::station_client;
use crate::model::chat::{
    ConversationMembershipAction, MemberRole, MessagingMembershipAction,
    PrepareConversationMembershipRequest, PrepareConversationMembershipResponse,
};
use messaging_core::mls::membership_transition::MembershipTransitionIntentInput;
use messaging_core::proto::{actor_device_ref, actor_ref};
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
    ) -> Result<PrepareConversationMembershipResponse, String> {
        station_client::request_proto_for_device::<
            PrepareConversationMembershipRequest,
            PrepareConversationMembershipResponse,
        >(
            Method::POST,
            "/conversation/membership/prepare",
            &self.token,
            None,
            Some(&PrepareConversationMembershipRequest {
                conversation_id: input.conversation_id.clone(),
                sender: Some(actor_device_ref(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
                action: canonical_action(input.action) as i32,
                target_actor: Some(actor_ref(input.target_ptid.clone())),
                target_device_id: input.target_device_id.clone(),
                role: canonical_role(&input.role)? as i32,
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())
    }
}

fn canonical_action(action: MessagingMembershipAction) -> ConversationMembershipAction {
    match action {
        MessagingMembershipAction::AddActor => ConversationMembershipAction::AddActor,
        MessagingMembershipAction::RemoveActor => ConversationMembershipAction::RemoveActor,
        MessagingMembershipAction::Leave => ConversationMembershipAction::Leave,
        MessagingMembershipAction::ChangeRole => ConversationMembershipAction::ChangeRole,
        MessagingMembershipAction::AddDevice => ConversationMembershipAction::AddDevice,
        MessagingMembershipAction::RemoveDevice => ConversationMembershipAction::RemoveDevice,
        MessagingMembershipAction::Unspecified => ConversationMembershipAction::Unspecified,
    }
}

fn canonical_role(role: &str) -> Result<MemberRole, String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "" => Ok(MemberRole::Unspecified),
        "member" => Ok(MemberRole::Member),
        "admin" => Ok(MemberRole::Admin),
        "owner" => Ok(MemberRole::Owner),
        _ => Err("messaging membership role is invalid".to_string()),
    }
}
