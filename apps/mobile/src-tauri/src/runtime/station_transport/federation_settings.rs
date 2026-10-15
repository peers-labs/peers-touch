use prost::Message;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{Client, Method, RequestBuilder};
use serde::Deserialize;

use crate::error::MobileResult;
use crate::runtime::oauth::session::AuthenticatedNativeSession;
use crate::secure_content::proto::federation::v1::{
    DeleteFederationRequest, LeaveFederationRequest,
};

use super::{
    authenticated_request, clean_id, fixed_url, transport_error, url_with_segments,
    MAX_JSON_REQUEST_BYTES,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum FederationSettingsRpc {
    List,
    Create,
    Join,
    Leave,
    Delete,
}

pub(super) fn request(
    client: &Client,
    session: &AuthenticatedNativeSession,
    rpc: FederationSettingsRpc,
    body: Vec<u8>,
) -> MobileResult<RequestBuilder> {
    if body.len() > MAX_JSON_REQUEST_BYTES {
        return Err(transport_error(
            "federation_settings_execute",
            "body_size_invalid",
        ));
    }
    let list = matches!(rpc, FederationSettingsRpc::List);
    let url = match rpc {
        FederationSettingsRpc::List => fixed_url(session, "/sub-federation/federations")?,
        FederationSettingsRpc::Create => fixed_url(session, "/sub-federation/federations")?,
        FederationSettingsRpc::Join => fixed_url(session, "/sub-federation/federations/join")?,
        FederationSettingsRpc::Leave => {
            let input = LeaveFederationRequest::decode(body.as_slice())
                .map_err(|_| transport_error("federation_settings_execute", "decode"))?;
            url_with_segments(
                session,
                &["sub-federation", "federations"],
                &[
                    clean_id(input.federation_id, "federation_id")?,
                    "leave".to_string(),
                ],
            )?
        }
        FederationSettingsRpc::Delete => {
            let input = DeleteFederationRequest::decode(body.as_slice())
                .map_err(|_| transport_error("federation_settings_execute", "decode"))?;
            url_with_segments(
                session,
                &["sub-federation", "federations"],
                &[
                    clean_id(input.federation_id, "federation_id")?,
                    "delete".to_string(),
                ],
            )?
        }
    };
    let request = authenticated_request(
        client,
        session,
        if list { Method::GET } else { Method::POST },
        url,
    )
    .header(ACCEPT, "application/protobuf");
    Ok(if list {
        request
    } else {
        request
            .header(CONTENT_TYPE, "application/protobuf")
            .body(body)
    })
}
