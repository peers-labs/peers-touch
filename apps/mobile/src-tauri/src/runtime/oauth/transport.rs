use std::time::Duration;

use prost::Message;
use reqwest::header::{ACCEPT, CONTENT_TYPE};

use super::proto::auth::v1::LoginResponse;
use super::proto::common::v1::PeersResponse;
use super::proto::error::v1::ErrorResponse;
use crate::error::{MobileError, MobileResult};
use crate::station_origin::{normalize_station_origin, StationOriginError, StationOriginPolicy};

pub(crate) const PROTOBUF_CONTENT_TYPE: &str = "application/protobuf";
const JSON_CONTENT_TYPE: &str = "application/json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const SESSION_REVOCATION_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const LOGIN_RESPONSE_TYPE: &str = "peers_touch.model.auth.v1.LoginResponse";

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
        if content_type != PROTOBUF_CONTENT_TYPE {
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

    pub(crate) async fn post_enveloped<Req, Resp>(
        &self,
        origin: &str,
        endpoint_path: &'static str,
        request: &Req,
        response_type: &'static str,
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
                MobileError::oauth(format!(
                    "mobile.auth.accessGateTransportUnavailable:{error}"
                ))
            })?;
        let status = response.status();
        if !status.is_success() {
            return Err(access_gate_rejection(response).await);
        }
        validate_protobuf_response(&response)?;
        let body = response.bytes().await.map_err(|error| {
            MobileError::oauth(format!("mobile.auth.accessGateResponseRead:{error}"))
        })?;
        if body.len() > MAX_RESPONSE_BYTES {
            return Err(MobileError::oauth("mobile.auth.accessGateResponseTooLarge"));
        }
        let envelope = PeersResponse::decode(body)
            .map_err(|_| MobileError::oauth("mobile.auth.accessGateInvalidEnvelope"))?;
        if envelope.code != "200" {
            return Err(MobileError::oauth(format!(
                "mobile.auth.accessGateRejected:{}",
                envelope.code
            )));
        }
        let payload = envelope
            .data
            .ok_or_else(|| MobileError::oauth("mobile.auth.accessGateMissingPayload"))?;
        if !payload.type_url.ends_with(response_type) {
            return Err(MobileError::oauth(
                "mobile.auth.accessGateInvalidPayloadType",
            ));
        }
        Resp::decode(payload.value.as_slice())
            .map_err(|_| MobileError::oauth("mobile.auth.accessGateInvalidPayload"))
    }

    pub(crate) async fn rotate_session(
        &self,
        origin: &str,
        access_token: &str,
    ) -> MobileResult<LoginResponse> {
        let body = self
            .post_authenticated_json(
                origin,
                "/actor/session/takeover",
                access_token,
                r#"{"device_type":"mobile"}"#.to_string(),
                REQUEST_TIMEOUT,
            )
            .await?;
        let envelope = PeersResponse::decode(body.as_slice())
            .map_err(|_| MobileError::oauth("mobile.auth.sessionRefreshInvalidResponse"))?;
        if envelope.code != "200" {
            return Err(MobileError::oauth("mobile.auth.sessionRefreshRejected"));
        }
        let payload = envelope
            .data
            .ok_or_else(|| MobileError::oauth("mobile.auth.sessionRefreshMissingCredential"))?;
        if !payload.type_url.ends_with(LOGIN_RESPONSE_TYPE) {
            return Err(MobileError::oauth(
                "mobile.auth.sessionRefreshInvalidCredentialType",
            ));
        }
        LoginResponse::decode(payload.value.as_slice())
            .map_err(|_| MobileError::oauth("mobile.auth.sessionRefreshInvalidCredential"))
    }

    pub(crate) async fn revoke_session(
        &self,
        origin: &str,
        access_token: &str,
        session_id: &str,
    ) -> MobileResult<()> {
        let request = serde_json::json!({ "session_id": session_id }).to_string();
        let body = match self
            .post_authenticated_json(
                origin,
                "/actor/logout",
                access_token,
                request,
                SESSION_REVOCATION_TIMEOUT,
            )
            .await
        {
            Ok(body) => body,
            Err(error) if error.message == "mobile.auth.sessionCredentialRejected:401" => {
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        let envelope = PeersResponse::decode(body.as_slice())
            .map_err(|_| MobileError::oauth("mobile.auth.sessionRevokeInvalidResponse"))?;
        if envelope.code != "200" {
            return Err(MobileError::oauth("mobile.auth.sessionRevokeRejected"));
        }
        Ok(())
    }

    async fn post_authenticated_json(
        &self,
        origin: &str,
        endpoint_path: &'static str,
        access_token: &str,
        body: String,
        timeout: Duration,
    ) -> MobileResult<Vec<u8>> {
        let url = endpoint_url(origin, endpoint_path)?;
        let response = self
            .client
            .post(url)
            .bearer_auth(access_token)
            .header(CONTENT_TYPE, JSON_CONTENT_TYPE)
            .header(ACCEPT, PROTOBUF_CONTENT_TYPE)
            .timeout(timeout)
            .body(body)
            .send()
            .await
            .map_err(|error| {
                MobileError::oauth(format!("mobile.auth.oauthTransportUnavailable:{error}"))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(MobileError::oauth(format!(
                "mobile.auth.sessionCredentialRejected:{}",
                status.as_u16()
            )));
        }
        validate_protobuf_response(&response)?;
        let body = response.bytes().await.map_err(|error| {
            MobileError::oauth(format!("mobile.auth.oauthResponseRead:{error}"))
        })?;
        if body.len() > MAX_RESPONSE_BYTES {
            return Err(MobileError::oauth("mobile.auth.oauthResponseTooLarge"));
        }
        Ok(body.to_vec())
    }
}

fn validate_protobuf_response(response: &reqwest::Response) -> MobileResult<()> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    if content_type != PROTOBUF_CONTENT_TYPE {
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
    Ok(())
}

async fn access_gate_rejection(mut response: reqwest::Response) -> MobileError {
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return MobileError::oauth(format!("mobile.auth.accessGateStationRejected:{status}"));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    let mut body = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return MobileError::oauth(format!("mobile.auth.accessGateStationRejected:{status}"));
        }
        body.extend_from_slice(&chunk);
    }

    let typed = STATION_RESPONSE_CONTENT_TYPES
        .contains(&content_type.as_str())
        .then(|| ErrorResponse::decode(body.as_slice()).ok())
        .flatten();
    let error_code = typed.as_ref().map(|error| error.code);
    let json_message = (content_type == JSON_CONTENT_TYPE)
        .then(|| serde_json::from_slice::<String>(&body).ok())
        .flatten();
    let message = typed
        .as_ref()
        .map(|error| error.message.as_str())
        .or(json_message.as_deref());
    let category = message.and_then(access_gate_rejection_category);

    match (error_code, category) {
        (Some(code), Some(category)) => MobileError::oauth(format!(
            "mobile.auth.accessGateStationRejected:{status}:{code}:{category}"
        )),
        (Some(code), None) => MobileError::oauth(format!(
            "mobile.auth.accessGateStationRejected:{status}:{code}"
        )),
        (None, Some(category)) => MobileError::oauth(format!(
            "mobile.auth.accessGateStationRejected:{status}:{category}"
        )),
        (None, None) => {
            MobileError::oauth(format!("mobile.auth.accessGateStationRejected:{status}"))
        }
    }
}

fn access_gate_rejection_category(message: &str) -> Option<&'static str> {
    let message = message.trim();
    match message {
        "access gate requires application/protobuf request and response" => {
            Some("protobuf-media-type")
        }
        "access attempt expired or not found" => Some("attempt-not-found"),
        "access gate submission Station identity mismatch" => Some("station-identity-mismatch"),
        "access gate submission device mismatch" => Some("device-mismatch"),
        "access gate submission lifecycle generation mismatch" => Some("lifecycle-mismatch"),
        "access gate submission descriptor is stale or mismatched" => Some("descriptor-mismatch"),
        "access gate submission attempt does not match the current decision" => {
            Some("attempt-decision-mismatch")
        }
        "access gate submission does not match the current gate" => Some("current-gate-mismatch"),
        "access gate is not actionable" => Some("gate-not-actionable"),
        "current access gate descriptor is unavailable" => Some("descriptor-unavailable"),
        "login gate requires typed credentials" => Some("typed-credentials-required"),
        _ => None,
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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use super::super::proto::access_gate::v1::{
        StartAccessAttemptRequest, StartAccessAttemptResponse,
    };
    use super::super::proto::actor::v1::ActorRef;
    use super::super::proto::auth::v1::AuthTokens;
    use prost_types::Any;

    use super::*;

    fn spawn_response(
        response: PeersResponse,
        content_type: &'static str,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test Station");
        let origin = format!(
            "http://{}",
            listener.local_addr().expect("test Station address")
        );
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept session request");
            let mut request = vec![0_u8; 8_192];
            let read = stream.read(&mut request).expect("read session request");
            request.truncate(read);

            let body = response.encode_to_vec();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .expect("write response headers");
            stream.write_all(&body).expect("write response body");
            String::from_utf8(request).expect("request is HTTP text")
        });
        (origin, handle)
    }

    fn spawn_protobuf_response(response: PeersResponse) -> (String, thread::JoinHandle<String>) {
        spawn_response(response, PROTOBUF_CONTENT_TYPE)
    }

    fn spawn_status_response(status: &str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test Station");
        let origin = format!(
            "http://{}",
            listener.local_addr().expect("test Station address")
        );
        let status = status.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept session request");
            let mut request = vec![0_u8; 8_192];
            let read = stream.read(&mut request).expect("read session request");
            request.truncate(read);
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .expect("write response");
            String::from_utf8(request).expect("request is HTTP text")
        });
        (origin, handle)
    }

    fn spawn_error_response(
        status: &str,
        content_type: &str,
        body: Vec<u8>,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test Station");
        let origin = format!(
            "http://{}",
            listener.local_addr().expect("test Station address")
        );
        let status = status.to_string();
        let content_type = content_type.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept session request");
            let mut request = vec![0_u8; 8_192];
            let read = stream.read(&mut request).expect("read session request");
            request.truncate(read);
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .expect("write response headers");
            stream.write_all(&body).expect("write response body");
            String::from_utf8(request).expect("request is HTTP text")
        });
        (origin, handle)
    }

    #[test]
    fn station_origin_and_endpoint_are_closed_over_expected_path() {
        let url = endpoint_url("https://Station.Example", "/oauth/mobile/start")
            .expect("valid Station origin");
        assert_eq!(url.as_str(), "https://station.example/oauth/mobile/start");

        assert!(endpoint_url("https://station.example/redirect", "/oauth/mobile/start").is_err());
    }

    #[test]
    fn access_gate_transport_uses_canonical_protobuf_media_type() {
        const RESPONSE_TYPE: &str = "peers_touch.model.access_gate.v1.StartAccessAttemptResponse";
        let response = StartAccessAttemptResponse::default();
        let (origin, server) = spawn_protobuf_response(PeersResponse {
            code: "200".to_string(),
            msg: "started".to_string(),
            data: Some(Any {
                type_url: format!("type.googleapis.com/{RESPONSE_TYPE}"),
                value: response.encode_to_vec(),
            }),
        });
        let transport = StationOAuthTransport::new().expect("transport");

        let _: StartAccessAttemptResponse =
            tauri::async_runtime::block_on(transport.post_enveloped(
                &origin,
                "/actor/access/start",
                &StartAccessAttemptRequest::default(),
                RESPONSE_TYPE,
            ))
            .expect("access start");

        let request = server.join().expect("access server");
        let headers = request.to_ascii_lowercase();
        assert!(headers.contains("content-type: application/protobuf"));
        assert!(headers.contains("accept: application/protobuf"));
        assert!(!headers.contains("application/x-protobuf"));
    }

    #[test]
    fn station_transport_rejects_legacy_protobuf_media_type() {
        const RESPONSE_TYPE: &str = "peers_touch.model.access_gate.v1.StartAccessAttemptResponse";
        let response = StartAccessAttemptResponse::default();
        let (origin, server) = spawn_response(
            PeersResponse {
                code: "200".to_string(),
                msg: "started".to_string(),
                data: Some(Any {
                    type_url: format!("type.googleapis.com/{RESPONSE_TYPE}"),
                    value: response.encode_to_vec(),
                }),
            },
            "application/x-protobuf",
        );
        let transport = StationOAuthTransport::new().expect("transport");

        let error = tauri::async_runtime::block_on(
            transport.post_enveloped::<_, StartAccessAttemptResponse>(
                &origin,
                "/actor/access/start",
                &StartAccessAttemptRequest::default(),
                RESPONSE_TYPE,
            ),
        )
        .expect_err("legacy protobuf media type must be rejected");
        server.join().expect("access server");

        assert!(error
            .to_string()
            .contains("mobile.auth.oauthInvalidResponseContentType"));
    }

    #[test]
    fn session_rotation_and_revocation_keep_bearer_material_native() {
        let login = LoginResponse {
            tokens: Some(AuthTokens {
                token: "rotated-access".to_string(),
                access_token: "rotated-access".to_string(),
                refresh_token: "rotated-refresh".to_string(),
                token_type: "Bearer".to_string(),
                expires_at: "2030-01-02T03:04:05Z".to_string(),
            }),
            session_id: "session-rotated".to_string(),
            actor_ref: Some(ActorRef {
                ptid: "ptid:alice".to_string(),
                ..ActorRef::default()
            }),
        };
        let (origin, rotation_server) = spawn_protobuf_response(PeersResponse {
            code: "200".to_string(),
            msg: "rotated".to_string(),
            data: Some(Any {
                type_url: format!("type.googleapis.com/{LOGIN_RESPONSE_TYPE}"),
                value: login.encode_to_vec(),
            }),
        });
        let transport = StationOAuthTransport::new().expect("transport");
        let rotated =
            tauri::async_runtime::block_on(transport.rotate_session(&origin, "current-access"))
                .expect("rotate session");
        let rotation_request = rotation_server.join().expect("rotation server");
        assert!(rotation_request.starts_with("POST /actor/session/takeover HTTP/1.1"));
        assert!(rotation_request
            .to_ascii_lowercase()
            .contains("authorization: bearer current-access"));
        assert_eq!(rotated.session_id, "session-rotated");

        let (origin, revoke_server) = spawn_protobuf_response(PeersResponse {
            code: "200".to_string(),
            msg: "revoked".to_string(),
            data: None,
        });
        tauri::async_runtime::block_on(transport.revoke_session(
            &origin,
            "rotated-access",
            "session-rotated",
        ))
        .expect("revoke session");
        let revoke_request = revoke_server.join().expect("revoke server");
        assert!(revoke_request.starts_with("POST /actor/logout HTTP/1.1"));
        assert!(revoke_request
            .to_ascii_lowercase()
            .contains("authorization: bearer rotated-access"));
        assert!(revoke_request.contains(r#""session_id":"session-rotated""#));
    }

    #[test]
    fn revoked_session_is_an_idempotent_logout_success() {
        let (origin, server) = spawn_status_response("401 Unauthorized");
        let transport = StationOAuthTransport::new().expect("transport");

        tauri::async_runtime::block_on(transport.revoke_session(
            &origin,
            "revoked-access",
            "revoked-session",
        ))
        .expect("already-revoked session is absent");

        let request = server.join().expect("revoke server");
        assert!(request.starts_with("POST /actor/logout HTTP/1.1"));
    }

    #[test]
    fn access_gate_rejection_exposes_only_a_safe_typed_category() {
        let body = ErrorResponse {
            code: 1,
            message: "access gate submission device mismatch".to_string(),
            details: [("internal".to_string(), "must-not-leak".to_string())]
                .into_iter()
                .collect(),
        }
        .encode_to_vec();
        let (origin, server) = spawn_error_response("400 Bad Request", PROTOBUF_CONTENT_TYPE, body);
        let transport = StationOAuthTransport::new().expect("transport");

        let error = tauri::async_runtime::block_on(transport.post_enveloped::<Any, Any>(
            &origin,
            "/actor/access/submit",
            &Any::default(),
            "unused",
        ))
        .expect_err("Station rejection");

        assert_eq!(
            error.message,
            "mobile.auth.accessGateStationRejected:400:1:device-mismatch"
        );
        assert!(!error.message.contains("must-not-leak"));
        let request = server.join().expect("access gate server");
        assert!(request
            .to_ascii_lowercase()
            .contains("content-type: application/protobuf"));
    }

    #[test]
    fn access_gate_media_type_rejection_is_categorized_without_raw_body() {
        let body =
            serde_json::to_vec("access gate requires application/protobuf request and response")
                .expect("JSON error");
        let (origin, server) = spawn_error_response("400 Bad Request", JSON_CONTENT_TYPE, body);
        let transport = StationOAuthTransport::new().expect("transport");

        let error = tauri::async_runtime::block_on(transport.post_enveloped::<Any, Any>(
            &origin,
            "/actor/access/start",
            &Any::default(),
            "unused",
        ))
        .expect_err("Station rejection");

        assert_eq!(
            error.message,
            "mobile.auth.accessGateStationRejected:400:protobuf-media-type"
        );
        let _request = server.join().expect("access gate server");
    }
}
