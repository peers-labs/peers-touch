use super::{actor_device_ref, actor_ref, EngineEndpoint};
use crate::infrastructure::station_client;
use crate::model::chat::{
    ConversationMembershipAction, MemberRole, MessagingMembershipAction,
    PrepareConversationMembershipRequest, PrepareConversationMembershipResponse,
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
    ) -> Result<PrepareConversationMembershipResponse, String> {
        let action = canonical_action(input.action);
        let role = canonical_role(&input.role)?;
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
                action: i32::from(action),
                target_actor: (!input.target_ptid.trim().is_empty())
                    .then(|| actor_ref(&input.target_ptid)),
                target_device_id: input.target_device_id.clone(),
                role: i32::from(role),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())
    }
}

fn canonical_action(action: MessagingMembershipAction) -> ConversationMembershipAction {
    match action {
        MessagingMembershipAction::Unspecified => ConversationMembershipAction::Unspecified,
        MessagingMembershipAction::AddActor => ConversationMembershipAction::AddActor,
        MessagingMembershipAction::RemoveActor => ConversationMembershipAction::RemoveActor,
        MessagingMembershipAction::Leave => ConversationMembershipAction::Leave,
        MessagingMembershipAction::ChangeRole => ConversationMembershipAction::ChangeRole,
        MessagingMembershipAction::AddDevice => ConversationMembershipAction::AddDevice,
        MessagingMembershipAction::RemoveDevice => ConversationMembershipAction::RemoveDevice,
    }
}

fn canonical_role(role: &str) -> Result<MemberRole, String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "" | "unspecified" | "member_role_unspecified" => Ok(MemberRole::Unspecified),
        "member" | "member_role_member" => Ok(MemberRole::Member),
        "admin" | "member_role_admin" => Ok(MemberRole::Admin),
        "owner" | "member_role_owner" => Ok(MemberRole::Owner),
        _ => Err("messaging membership role is invalid".to_string()),
    }
}
