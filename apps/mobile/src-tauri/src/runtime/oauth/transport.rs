use std::net::IpAddr;
use std::time::Duration;

use prost::Message;
use reqwest::header::{ACCEPT, CONTENT_TYPE};

use crate::error::{MobileError, MobileResult};

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
        allow_insecure_loopback: bool,
        endpoint_path: &'static str,
        request: &Req,
    ) -> MobileResult<Resp>
    where
        Req: Message,
        Resp: Message + Default,
    {
        let url = endpoint_url(origin, allow_insecure_loopback, endpoint_path)?;
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

pub(crate) fn validate_station_origin(
    value: &str,
    allow_insecure_loopback: bool,
) -> MobileResult<String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| MobileError::invalid_input("stationOrigin is invalid"))?;
    let host = url
        .host_str()
        .ok_or_else(|| MobileError::invalid_input("stationOrigin must include a host"))?;
    let secure = url.scheme() == "https";
    let allowed_loopback =
        allow_insecure_loopback && url.scheme() == "http" && is_loopback_host(host);
    if (!secure && !allowed_loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(MobileError::invalid_input(
            "stationOrigin must be an HTTPS origin without credentials, path, query, or fragment",
        ));
    }

    let port = url
        .port_or_known_default()
        .ok_or_else(|| MobileError::invalid_input("stationOrigin port is invalid"))?;
    let authority = if host.contains(':') {
        format!("[{}]:{port}", host.to_ascii_lowercase())
    } else {
        format!("{}:{port}", host.to_ascii_lowercase())
    };
    Ok(format!("{}://{authority}", url.scheme()))
}

fn endpoint_url(
    origin: &str,
    allow_insecure_loopback: bool,
    endpoint_path: &'static str,
) -> MobileResult<reqwest::Url> {
    if !endpoint_path.starts_with('/') || endpoint_path.contains(['?', '#']) {
        return Err(MobileError::oauth("mobile.auth.oauthInvalidEndpointPath"));
    }
    let origin = validate_station_origin(origin, allow_insecure_loopback)?;
    let mut url = reqwest::Url::parse(&origin)
        .map_err(|_| MobileError::oauth("mobile.auth.oauthInvalidStationOrigin"))?;
    url.set_path(endpoint_path);
    Ok(url)
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn station_origin_and_endpoint_are_closed_over_expected_path() {
        let url = endpoint_url("https://Station.Example", false, "/oauth/mobile/start")
            .expect("valid Station origin");
        assert_eq!(url.as_str(), "https://station.example/oauth/mobile/start");

        assert!(endpoint_url(
            "https://station.example/redirect",
            false,
            "/oauth/mobile/start"
        )
        .is_err());
        assert!(endpoint_url("http://station.example", true, "/oauth/mobile/start").is_err());
        assert!(endpoint_url("http://127.0.0.1:8080", true, "/oauth/mobile/start").is_ok());
    }
}
