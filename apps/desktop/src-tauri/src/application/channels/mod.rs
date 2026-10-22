use prost::Message;
use reqwest::Method;
use serde::Deserialize;

use crate::application::station_runtime::client::StationClient;
use crate::error::{AppResult, ErrorCode};
use crate::model::channel;

const CHANNEL_API_PREFIX: &str = "/sub-channel";

fn channel_path(path: &str) -> String {
    format!("{CHANNEL_API_PREFIX}{path}")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedChannelRequestInput {
    #[serde(alias = "request_bytes")]
    pub request_bytes: Vec<u8>,
}

fn forward<Req, Resp>(
    station_client: &StationClient,
    input: EncodedChannelRequestInput,
    token: &str,
    path: &'static str,
    invalid_request_key: &'static str,
    operation_error_key: &'static str,
) -> AppResult<Vec<u8>>
where
    Req: Message + Default,
    Resp: Message + Default,
{
    let endpoint_path = channel_path(path);
    let request = match Req::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(error) => {
            tracing::warn!(path = %endpoint_path, error = %error, "invalid Channel protobuf request");
            return AppResult::fail(ErrorCode::InvalidArgument, invalid_request_key, None);
        }
    };

    match station_client.request_proto::<Req, Resp>(
        Method::POST,
        &endpoint_path,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result(operation_error_key),
    }
}

macro_rules! channel_operation {
    ($name:ident, $request:ty, $response:ty, $path:literal, $invalid:literal, $failed:literal) => {
        pub fn $name(
            station_client: &StationClient,
            input: EncodedChannelRequestInput,
            token: &str,
        ) -> AppResult<Vec<u8>> {
            forward::<$request, $response>(station_client, input, token, $path, $invalid, $failed)
        }
    };
}

channel_operation!(
    list_bindings,
    channel::ListChannelBindingsRequest,
    channel::ListChannelBindingsResponse,
    "/channel/binding/list",
    "channels.request.invalid",
    "channels.binding.listFailed"
);
channel_operation!(
    create_binding,
    channel::CreateChannelBindingRequest,
    channel::CreateChannelBindingResponse,
    "/channel/binding/create",
    "channels.binding.createRequestInvalid",
    "channels.binding.createFailed"
);
channel_operation!(
    update_binding,
    channel::UpdateChannelBindingRequest,
    channel::UpdateChannelBindingResponse,
    "/channel/binding/update",
    "channels.binding.updateRequestInvalid",
    "channels.binding.updateFailed"
);
channel_operation!(
    delete_binding,
    channel::DeleteChannelBindingRequest,
    channel::DeleteChannelBindingResponse,
    "/channel/binding/delete",
    "channels.binding.deleteRequestInvalid",
    "channels.binding.deleteFailed"
);
channel_operation!(
    start_binding,
    channel::StartChannelBindingRequest,
    channel::StartChannelBindingResponse,
    "/channel/binding/start",
    "channels.binding.startRequestInvalid",
    "channels.binding.startFailed"
);
channel_operation!(
    stop_binding,
    channel::StopChannelBindingRequest,
    channel::StopChannelBindingResponse,
    "/channel/binding/stop",
    "channels.binding.stopRequestInvalid",
    "channels.binding.stopFailed"
);
channel_operation!(
    set_default_binding,
    channel::SetDefaultChannelBindingRequest,
    channel::SetDefaultChannelBindingResponse,
    "/channel/binding/default",
    "channels.binding.defaultRequestInvalid",
    "channels.binding.defaultFailed"
);
channel_operation!(
    validate_app,
    channel::ValidateChannelAppRequest,
    channel::ValidateChannelAppResponse,
    "/channel/app/validate",
    "channels.app.validateRequestInvalid",
    "channels.app.validateFailed"
);
channel_operation!(
    check_health,
    channel::CheckChannelHealthRequest,
    channel::CheckChannelHealthResponse,
    "/channel/health/check",
    "channels.health.requestInvalid",
    "channels.health.checkFailed"
);
channel_operation!(
    start_requester_authorization,
    channel::StartChannelRequesterAuthorizationRequest,
    channel::StartChannelRequesterAuthorizationResponse,
    "/channel/requester-authorization/start",
    "channels.requesterAuthorization.startRequestInvalid",
    "channels.requesterAuthorization.startFailed"
);
channel_operation!(
    get_requester_authorization,
    channel::GetChannelRequesterAuthorizationRequest,
    channel::GetChannelRequesterAuthorizationResponse,
    "/channel/requester-authorization/get",
    "channels.requesterAuthorization.getRequestInvalid",
    "channels.requesterAuthorization.getFailed"
);
channel_operation!(
    refresh_requester_authorization,
    channel::RefreshChannelRequesterAuthorizationRequest,
    channel::RefreshChannelRequesterAuthorizationResponse,
    "/channel/requester-authorization/refresh",
    "channels.requesterAuthorization.refreshRequestInvalid",
    "channels.requesterAuthorization.refreshFailed"
);
channel_operation!(
    revoke_requester_authorization,
    channel::RevokeChannelRequesterAuthorizationRequest,
    channel::RevokeChannelRequesterAuthorizationResponse,
    "/channel/requester-authorization/revoke",
    "channels.requesterAuthorization.revokeRequestInvalid",
    "channels.requesterAuthorization.revokeFailed"
);
channel_operation!(
    cancel_requester_authorization,
    channel::CancelChannelRequesterAuthorizationRequest,
    channel::CancelChannelRequesterAuthorizationResponse,
    "/channel/requester-authorization/cancel",
    "channels.requesterAuthorization.cancelRequestInvalid",
    "channels.requesterAuthorization.cancelFailed"
);
channel_operation!(
    list_routes,
    channel::ListChannelRoutesRequest,
    channel::ListChannelRoutesResponse,
    "/channel/route/list",
    "channels.route.listRequestInvalid",
    "channels.route.listFailed"
);
channel_operation!(
    upsert_route,
    channel::UpsertChannelRouteRequest,
    channel::UpsertChannelRouteResponse,
    "/channel/route/upsert",
    "channels.route.upsertRequestInvalid",
    "channels.route.upsertFailed"
);
channel_operation!(
    delete_route,
    channel::DeleteChannelRouteRequest,
    channel::DeleteChannelRouteResponse,
    "/channel/route/delete",
    "channels.route.deleteRequestInvalid",
    "channels.route.deleteFailed"
);
channel_operation!(
    list_member_access,
    channel::ListChannelMemberAccessRequest,
    channel::ListChannelMemberAccessResponse,
    "/channel/member/list",
    "channels.member.listRequestInvalid",
    "channels.member.listFailed"
);
channel_operation!(
    decide_member_access,
    channel::DecideChannelMemberAccessRequest,
    channel::ChannelMemberAccess,
    "/channel/member/decide",
    "channels.member.decisionRequestInvalid",
    "channels.member.decisionFailed"
);
channel_operation!(
    list_chats,
    channel::ListChannelChatsRequest,
    channel::ListChannelChatsResponse,
    "/channel/chat/list",
    "channels.chat.listRequestInvalid",
    "channels.chat.listFailed"
);
channel_operation!(
    list_automations,
    channel::ListChannelAutomationsRequest,
    channel::ListChannelAutomationsResponse,
    "/channel/automation/list",
    "channels.automation.listRequestInvalid",
    "channels.automation.listFailed"
);
channel_operation!(
    upsert_automation,
    channel::UpsertChannelAutomationRequest,
    channel::UpsertChannelAutomationResponse,
    "/channel/automation/upsert",
    "channels.automation.upsertRequestInvalid",
    "channels.automation.upsertFailed"
);
channel_operation!(
    delete_automation,
    channel::DeleteChannelAutomationRequest,
    channel::DeleteChannelAutomationResponse,
    "/channel/automation/delete",
    "channels.automation.deleteRequestInvalid",
    "channels.automation.deleteFailed"
);
channel_operation!(
    run_automation,
    channel::RunChannelAutomationRequest,
    channel::RunChannelAutomationResponse,
    "/channel/automation/run",
    "channels.automation.runRequestInvalid",
    "channels.automation.runFailed"
);
channel_operation!(
    send_message,
    channel::SendChannelMessageRequest,
    channel::SendChannelMessageResponse,
    "/channel/message/send",
    "channels.message.sendRequestInvalid",
    "channels.message.sendFailed"
);
channel_operation!(
    list_events,
    channel::ListChannelEventsRequest,
    channel::ListChannelEventsResponse,
    "/channel/event/list",
    "channels.event.listRequestInvalid",
    "channels.event.listFailed"
);
channel_operation!(
    get_stats,
    channel::ChannelStatsRequest,
    channel::ChannelStatsResponse,
    "/channel/stats",
    "channels.stats.requestInvalid",
    "channels.stats.loadFailed"
);
channel_operation!(
    retry_delivery,
    channel::RetryChannelDeliveryRequest,
    channel::RetryChannelDeliveryResponse,
    "/channel/delivery/retry",
    "channels.delivery.retryRequestInvalid",
    "channels.delivery.retryFailed"
);
channel_operation!(
    export_diagnostics,
    channel::ExportChannelDiagnosticsRequest,
    channel::ExportChannelDiagnosticsResponse,
    "/channel/diagnostics/export",
    "channels.diagnostics.exportRequestInvalid",
    "channels.diagnostics.exportFailed"
);
channel_operation!(
    start_provisioning,
    channel::StartChannelProvisioningRequest,
    channel::StartChannelProvisioningResponse,
    "/channel/provisioning/start",
    "channels.provisioning.startRequestInvalid",
    "channels.provisioning.startFailed"
);
channel_operation!(
    poll_provisioning,
    channel::PollChannelProvisioningRequest,
    channel::PollChannelProvisioningResponse,
    "/channel/provisioning/poll",
    "channels.provisioning.pollRequestInvalid",
    "channels.provisioning.pollFailed"
);
channel_operation!(
    confirm_provisioning,
    channel::ConfirmChannelProvisioningRequest,
    channel::ConfirmChannelProvisioningResponse,
    "/channel/provisioning/confirm",
    "channels.provisioning.confirmRequestInvalid",
    "channels.provisioning.confirmFailed"
);
channel_operation!(
    cancel_provisioning,
    channel::CancelChannelProvisioningRequest,
    channel::CancelChannelProvisioningResponse,
    "/channel/provisioning/cancel",
    "channels.provisioning.cancelRequestInvalid",
    "channels.provisioning.cancelFailed"
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_routes_are_scoped_to_the_channel_subserver() {
        assert_eq!(
            channel_path("/channel/binding/list"),
            "/sub-channel/channel/binding/list"
        );
    }
}
