use std::time::Duration;

use prost::Message;
use reqwest::header::{ACCEPT, CONTENT_TYPE};

use crate::error::{MobileError, MobileResult};
use crate::station_origin::{normalize_station_origin, StationOriginError, StationOriginPolicy};

pub(crate) const PROTOBUF_CONTENT_TYPE: &str = "application/x-protobuf";
const STATION_RESPONSE_CONTENT_TYPES: [&str; 2] =
    ["application/x-protobuf", "application/protobuf"];
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub(crate) struct StationOAuthTransport {
    client: reqwest::Client,
}

impl StationOAuthTransport {
    pub(crate) fn new() -> MobileResult<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| {
                MobileError::oauth(format!("mobile.auth.oauthTransportInit:{error}"))
            })?;
        Ok(Self { client })
    }

    pub(crate) async fn post<Req, Resp>(
        &self,
        origin: &str,
        endpoint_path: &'static str,
        request: &Req,
    ) -> MobileResult<Resp>
    where
        Req: Message,
        Resp: Message + Default,
    {
        let url = endpoint_url(origin, endpoint_path)?;
        let response = self
            .client
            .post(url)
            .header(CONTENT_TYPE, PROTOBUF_CONTENT_TYPE)
            .header(ACCEPT, PROTOBUF_CONTENT_TYPE)
            .body(request.encode_to_vec())
            .send()
            .await
            .map_err(|error| {
                MobileError::oauth(format!("mobile.auth.oauthTransportUnavailable:{error}"))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(MobileError::oauth(format!(
                "mobile.auth.oauthStationRejected:{}",
                status.as_u16()
            )));
        }

        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim)
            .unwrap_or_default();
        if !STATION_RESPONSE_CONTENT_TYPES.contains(&content_type) {
            return Err(MobileError::oauth(
                "mobile.auth.oauthInvalidResponseContentType",
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(MobileError::oauth("mobile.auth.oauthResponseTooLarge"));
        }

        let body = response.bytes().await.map_err(|error| {
            MobileError::oauth(format!("mobile.auth.oauthResponseRead:{error}"))
        })?;
        if body.len() > MAX_RESPONSE_BYTES {
            return Err(MobileError::oauth("mobile.auth.oauthResponseTooLarge"));
        }
        Resp::decode(body).map_err(|_| MobileError::oauth("mobile.auth.oauthInvalidResponse"))
    }
}

pub(crate) fn validate_station_origin(value: &str) -> MobileResult<String> {
    normalize_station_origin(value, StationOriginPolicy::current_build()).map_err(|error| {
        MobileError::invalid_input(match error {
            StationOriginError::Invalid => "stationOrigin is invalid",
            StationOriginError::MissingHost => "stationOrigin must include a host",
            StationOriginError::Insecure | StationOriginError::NonCanonical => {
                "stationOrigin must be an HTTPS origin outside development builds and contain no credentials, path, query, or fragment"
            }
            StationOriginError::InvalidPort => "stationOrigin port is invalid",
        })
    })
}

fn endpoint_url(origin: &str, endpoint_path: &'static str) -> MobileResult<reqwest::Url> {
    if !endpoint_path.starts_with('/') || endpoint_path.contains(['?', '#']) {
        return Err(MobileError::oauth("mobile.auth.oauthInvalidEndpointPath"));
    }
    let origin = validate_station_origin(origin)?;
    let mut url = reqwest::Url::parse(&origin)
        .map_err(|_| MobileError::oauth("mobile.auth.oauthInvalidStationOrigin"))?;
    url.set_path(endpoint_path);
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn station_origin_and_endpoint_are_closed_over_expected_path() {
        let url = endpoint_url("https://Station.Example", "/oauth/mobile/start")
            .expect("valid Station origin");
        assert_eq!(url.as_str(), "https://station.example/oauth/mobile/start");

        assert!(endpoint_url("https://station.example/redirect", "/oauth/mobile/start").is_err());
    }
}
