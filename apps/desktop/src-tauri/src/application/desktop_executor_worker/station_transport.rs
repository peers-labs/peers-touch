use super::fenced_executor::ReceiptReporter;
use crate::application::station_runtime::client::{
    StationClient, StationClientError, StationClientErrorKind,
};
use crate::model::agent::{
    ClientCapabilityAdvertisement, ClientCapabilityCommandDomain, ClientCapabilityCommandErrorCode,
    ClientCapabilityCommandProof, ClientCapabilityCommandSigningPayload, ClientCapabilityLease,
    ClientCapabilityLeaseRevokeReason, ClientCapabilityReceipt,
    PullClientCapabilityRequestsRequest, PullClientCapabilityRequestsResponse,
    ReachCapabilityAcceptanceExecutorBarrierRequest,
    ReachCapabilityAcceptanceExecutorBarrierResponse, RegisterClientCapabilityLeaseRequest,
    RegisterClientCapabilityLeaseResponse, RenewClientCapabilityLeaseRequest,
    RenewClientCapabilityLeaseResponse, RevokeClientCapabilityLeaseRequest,
    RevokeClientCapabilityLeaseResponse, SubmitClientCapabilityReceiptRequest,
    SubmitClientCapabilityReceiptResponse, SubmitClientCapabilityRecoveryReceiptRequest,
    SubmitClientCapabilityRecoveryReceiptResponse,
};
use prost::Message;
use rand::RngCore;
use reqwest::Method;
use serde::Serialize;
use sha2::{Digest, Sha256};

const PULL_PATH: &str = "/sub-agent/agent/capability/requests/pull";
const REGISTER_PATH: &str = "/sub-agent/agent/capability/lease/register";
const RENEW_PATH: &str = "/sub-agent/agent/capability/lease/renew";
const REVOKE_PATH: &str = "/sub-agent/agent/capability/lease/revoke";
const ACTIVE_RECEIPT_PATH: &str = "/sub-agent/agent/capability/receipt";
const RECOVERY_RECEIPT_PATH: &str = "/sub-agent/agent/capability/receipt/recover";
const ACCEPTANCE_SCENARIO_REACH_PATH: &str =
    "/sub-agent/agent/capability/acceptance/scenario/reach";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityNegativeControl {
    Unauthorized,
    SignatureTamper,
    CrossDevice,
}

impl CapabilityNegativeControl {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::SignatureTamper => "signatureTamper",
            Self::CrossDevice => "crossDevice",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityNegativeControlStationFact {
    pub endpoint: &'static str,
    pub request_sent: bool,
    pub response_received: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_hash: Option<String>,
    pub command_error_code: Option<String>,
    pub http_status: Option<u16>,
    pub transport_error_kind: Option<&'static str>,
    pub station_error_details: Option<serde_json::Value>,
}

pub struct CapabilityStationTransport<'a> {
    station_client: &'a StationClient,
    actor_ptid: &'a str,
    device_id: &'a str,
    token: &'a str,
    signing_key_id: &'a str,
    signing_key: &'a ed25519_dalek::SigningKey,
}

impl<'a> CapabilityStationTransport<'a> {
    pub fn new(
        station_client: &'a StationClient,
        actor_ptid: &'a str,
        device_id: &'a str,
        token: &'a str,
        signing_key_id: &'a str,
        signing_key: &'a ed25519_dalek::SigningKey,
    ) -> Result<Self, String> {
        if !actor_ptid.starts_with("ptid:")
            || device_id.trim().is_empty()
            || token.trim().is_empty()
        {
            return Err(
                "client capability transport requires Station, actor, device, and token"
                    .to_string(),
            );
        }
        Ok(Self {
            station_client,
            actor_ptid,
            device_id,
            token,
            signing_key_id,
            signing_key,
        })
    }

    pub fn register(
        &self,
        advertisement: ClientCapabilityAdvertisement,
    ) -> Result<ClientCapabilityLease, String> {
        if advertisement.device_id != self.device_id {
            return Err("CLIENT_CAPABILITY_ADVERTISEMENT_DEVICE_MISMATCH".to_string());
        }
        let mut request = RegisterClientCapabilityLeaseRequest {
            advertisement: Some(advertisement),
            command_proof: None,
        };
        request.command_proof = Some(self.sign_command(
            ClientCapabilityCommandDomain::RegisterLease,
            &request_without_register_proof(&request),
        )?);
        let response: RegisterClientCapabilityLeaseResponse = self
            .station_client
            .request_proto_for_device(
                Method::POST,
                REGISTER_PATH,
                self.token,
                None,
                Some(&request),
                self.device_id,
            )
            .map_err(|error| format!("register Station client capability lease: {error}"))?;
        validate_command_response(response.error_code, "capability lease registration")?;
        validate_lease(
            response.lease.ok_or_else(|| {
                "Station capability registration response has no lease".to_string()
            })?,
            self.actor_ptid,
            self.device_id,
        )
    }

    pub fn renew(&self, lease: &ClientCapabilityLease) -> Result<ClientCapabilityLease, String> {
        let mut request = RenewClientCapabilityLeaseRequest {
            capability_session_id: lease.capability_session_id.clone(),
            lease_id: lease.lease_id.clone(),
            expected_lease_revision: lease.lease_revision,
            capability_set_hash: lease.capability_set_hash.clone(),
            device_signing_key_id: lease.device_signing_key_id.clone(),
            command_proof: None,
        };
        request.command_proof = Some(self.sign_command(
            ClientCapabilityCommandDomain::RenewLease,
            &request_without_renew_proof(&request),
        )?);
        let response: RenewClientCapabilityLeaseResponse = self
            .station_client
            .request_proto_for_device(
                Method::POST,
                RENEW_PATH,
                self.token,
                None,
                Some(&request),
                self.device_id,
            )
            .map_err(|error| format!("renew Station client capability lease: {error}"))?;
        validate_command_response(response.error_code, "capability lease renewal")?;
        validate_lease(
            response
                .lease
                .ok_or_else(|| "Station capability renewal response has no lease".to_string())?,
            self.actor_ptid,
            self.device_id,
        )
    }

    pub fn revoke(
        &self,
        lease: &ClientCapabilityLease,
        reason: ClientCapabilityLeaseRevokeReason,
    ) -> Result<RevokeClientCapabilityLeaseResponse, String> {
        let mut request = RevokeClientCapabilityLeaseRequest {
            capability_session_id: lease.capability_session_id.clone(),
            lease_id: lease.lease_id.clone(),
            expected_lease_revision: lease.lease_revision,
            reason: reason as i32,
            command_proof: None,
        };
        request.command_proof = Some(self.sign_command(
            ClientCapabilityCommandDomain::RevokeLease,
            &request_without_revoke_proof(&request),
        )?);
        let response: RevokeClientCapabilityLeaseResponse = self
            .station_client
            .request_proto_for_device(
                Method::POST,
                REVOKE_PATH,
                self.token,
                None,
                Some(&request),
                self.device_id,
            )
            .map_err(|error| format!("revoke Station client capability lease: {error}"))?;
        validate_command_response(response.error_code, "capability lease revoke")?;
        if response.capability_session_id != lease.capability_session_id
            || response.lease_id != lease.lease_id
            || response.lease_revision <= lease.lease_revision
            || response.revoked_at.is_none()
        {
            return Err("CLIENT_CAPABILITY_REVOKE_RESPONSE_MISMATCH".to_string());
        }
        Ok(response)
    }

    pub fn pull(
        &self,
        capability_session_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<PullClientCapabilityRequestsResponse, String> {
        let mut request = PullClientCapabilityRequestsRequest {
            capability_session_id: capability_session_id.to_string(),
            device_id: self.device_id.to_string(),
            after_sequence,
            limit,
            command_proof: None,
        };
        request.command_proof = Some(self.sign_command(
            ClientCapabilityCommandDomain::PullRequests,
            &request_without_pull_proof(&request),
        )?);
        let response: PullClientCapabilityRequestsResponse = self
            .station_client
            .request_proto_for_device::<_, PullClientCapabilityRequestsResponse>(
                Method::POST,
                PULL_PATH,
                self.token,
                None,
                Some(&request),
                self.device_id,
            )
            .map_err(|error| format!("pull Station client capability requests: {error}"))?;
        if response.error_code != 0 {
            return Err(format!(
                "Station rejected capability pull with command error {}",
                response.error_code
            ));
        }
        if response
            .requests
            .iter()
            .any(|request| request.target_device_id != self.device_id)
        {
            return Err("Station returned an untargeted capability envelope".to_string());
        }
        Ok(response)
    }

    pub fn emit_negative_control(
        &self,
        control: CapabilityNegativeControl,
        capability_session_id: &str,
        cross_device_session_id: Option<&str>,
    ) -> Result<CapabilityNegativeControlStationFact, String> {
        let target_session_id = match control {
            CapabilityNegativeControl::CrossDevice => cross_device_session_id
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "AS_F10_CROSS_DEVICE_SESSION_UNAVAILABLE".to_string())?,
            _ => capability_session_id,
        };
        let mut request = self.signed_pull_request(target_session_id, 0, 1)?;
        match control {
            CapabilityNegativeControl::Unauthorized => {
                let result = self
                    .station_client
                    .request_proto_no_auth::<_, PullClientCapabilityRequestsResponse>(
                        Method::POST,
                        PULL_PATH,
                        &request,
                    );
                Ok(negative_control_station_fact(result, None))
            }
            CapabilityNegativeControl::SignatureTamper => {
                let proof = request
                    .command_proof
                    .as_mut()
                    .ok_or_else(|| "AS_F10_COMMAND_PROOF_UNAVAILABLE".to_string())?;
                let first = proof
                    .signature
                    .first_mut()
                    .ok_or_else(|| "AS_F10_COMMAND_SIGNATURE_UNAVAILABLE".to_string())?;
                *first ^= 0x01;
                Ok(negative_control_station_fact(
                    self.station_client
                        .request_proto_for_device::<_, PullClientCapabilityRequestsResponse>(
                            Method::POST,
                            PULL_PATH,
                            self.token,
                            None,
                            Some(&request),
                            self.device_id,
                        ),
                    None,
                ))
            }
            CapabilityNegativeControl::CrossDevice => Ok(negative_control_station_fact(
                self.send_signed_pull_request(&request),
                None,
            )),
        }
    }

    pub fn emit_expired_lease_pull_replay(
        &self,
        capability_session_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<
        (
            CapabilityNegativeControlStationFact,
            CapabilityNegativeControlStationFact,
        ),
        String,
    > {
        let request = self.signed_pull_request(capability_session_id, after_sequence, limit)?;
        let request_hash = encoded_message_hash(&request);
        let source = negative_control_station_fact(
            self.send_signed_pull_request(&request),
            Some(request_hash.clone()),
        );
        let replay = negative_control_station_fact(
            self.send_signed_pull_request(&request),
            Some(request_hash),
        );
        Ok((source, replay))
    }

    fn signed_pull_request(
        &self,
        capability_session_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<PullClientCapabilityRequestsRequest, String> {
        let mut request = PullClientCapabilityRequestsRequest {
            capability_session_id: capability_session_id.to_string(),
            device_id: self.device_id.to_string(),
            after_sequence,
            limit,
            command_proof: None,
        };
        request.command_proof = Some(self.sign_command(
            ClientCapabilityCommandDomain::PullRequests,
            &request_without_pull_proof(&request),
        )?);
        Ok(request)
    }

    fn send_signed_pull_request(
        &self,
        request: &PullClientCapabilityRequestsRequest,
    ) -> Result<PullClientCapabilityRequestsResponse, StationClientError> {
        self.station_client.request_proto_for_device(
            Method::POST,
            PULL_PATH,
            self.token,
            None,
            Some(request),
            self.device_id,
        )
    }

    fn submit_active(
        &self,
        receipt: &ClientCapabilityReceipt,
    ) -> Result<SubmitClientCapabilityReceiptResponse, String> {
        let mut request = SubmitClientCapabilityReceiptRequest {
            receipt: Some(receipt.clone()),
            command_proof: None,
        };
        request.command_proof = Some(self.sign_command(
            ClientCapabilityCommandDomain::SubmitActiveReceipt,
            &request_without_receipt_proof(&request),
        )?);
        let response = self
            .station_client
            .request_proto_for_device::<_, _>(
                Method::POST,
                ACTIVE_RECEIPT_PATH,
                self.token,
                None,
                Some(&request),
                self.device_id,
            )
            .map_err(|error| format!("submit active client capability receipt: {error}"))?;
        validate_receipt_response(response)
    }

    pub fn reach_acceptance_scenario_barrier(
        &self,
        scenario_handle: &str,
        barrier: &str,
    ) -> Result<ReachCapabilityAcceptanceExecutorBarrierResponse, String> {
        self.station_client
            .request_proto_for_device(
                Method::POST,
                ACCEPTANCE_SCENARIO_REACH_PATH,
                self.token,
                None,
                Some(&ReachCapabilityAcceptanceExecutorBarrierRequest {
                    scenario_handle: scenario_handle.to_string(),
                    barrier: barrier.to_string(),
                }),
                self.device_id,
            )
            .map_err(|error| format!("reach Station capability acceptance barrier: {error}"))
    }

    fn submit_recovery(
        &self,
        receipt: &ClientCapabilityReceipt,
    ) -> Result<SubmitClientCapabilityReceiptResponse, String> {
        let request = SubmitClientCapabilityRecoveryReceiptRequest {
            receipt: Some(receipt.clone()),
        };
        let response = self
            .station_client
            .request_proto_no_auth::<_, SubmitClientCapabilityRecoveryReceiptResponse>(
                Method::POST,
                RECOVERY_RECEIPT_PATH,
                &request,
            )
            .map_err(|error| format!("submit recovery client capability receipt: {error}"))?;
        validate_receipt_response(
            response
                .result
                .ok_or_else(|| "Station recovery response is missing result".to_string())?,
        )
    }

    fn sign_command<M: Message>(
        &self,
        domain: ClientCapabilityCommandDomain,
        body: &M,
    ) -> Result<ClientCapabilityCommandProof, String> {
        use ed25519_dalek::Signer;
        let mut nonce = vec![0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let issued_at = now_timestamp();
        let payload = ClientCapabilityCommandSigningPayload {
            domain: domain as i32,
            actor_ptid: self.actor_ptid.to_string(),
            device_id: self.device_id.to_string(),
            command_id: format!("capability_command_{}", ulid::Ulid::new()),
            body_hash: Sha256::digest(body.encode_to_vec()).to_vec(),
            nonce: nonce.clone(),
            issued_at: Some(issued_at.clone()),
        };
        let signature = self.signing_key.sign(&payload.encode_to_vec());
        Ok(ClientCapabilityCommandProof {
            command_id: payload.command_id.clone(),
            device_signing_key_id: self.signing_key_id.to_string(),
            nonce,
            issued_at: Some(issued_at),
            signature: signature.to_bytes().to_vec(),
        })
    }
}

fn request_without_register_proof(
    request: &RegisterClientCapabilityLeaseRequest,
) -> RegisterClientCapabilityLeaseRequest {
    let mut canonical = request.clone();
    canonical.command_proof = None;
    canonical
}

fn request_without_renew_proof(
    request: &RenewClientCapabilityLeaseRequest,
) -> RenewClientCapabilityLeaseRequest {
    let mut canonical = request.clone();
    canonical.command_proof = None;
    canonical
}

fn request_without_revoke_proof(
    request: &RevokeClientCapabilityLeaseRequest,
) -> RevokeClientCapabilityLeaseRequest {
    let mut canonical = request.clone();
    canonical.command_proof = None;
    canonical
}

impl ReceiptReporter for CapabilityStationTransport<'_> {
    fn submit(&self, receipt: &ClientCapabilityReceipt) -> Result<(), String> {
        if receipt.recovery_proof.is_some() {
            self.submit_recovery(receipt)?;
        } else {
            self.submit_active(receipt)?;
        }
        Ok(())
    }
}

fn request_without_pull_proof(
    request: &PullClientCapabilityRequestsRequest,
) -> PullClientCapabilityRequestsRequest {
    let mut canonical = request.clone();
    canonical.command_proof = None;
    canonical
}

fn request_without_receipt_proof(
    request: &SubmitClientCapabilityReceiptRequest,
) -> SubmitClientCapabilityReceiptRequest {
    let mut canonical = request.clone();
    canonical.command_proof = None;
    canonical
}

fn validate_receipt_response(
    response: SubmitClientCapabilityReceiptResponse,
) -> Result<SubmitClientCapabilityReceiptResponse, String> {
    if response.command_error_code != 0 || response.error_code != 0 || !response.accepted {
        return Err(format!(
            "Station rejected client capability receipt: command_error={}, receipt_error={}",
            response.command_error_code, response.error_code
        ));
    }
    Ok(response)
}

fn validate_command_response(error_code: i32, operation: &str) -> Result<(), String> {
    if error_code != 0 {
        return Err(format!(
            "Station rejected {operation} with command error {error_code}"
        ));
    }
    Ok(())
}

fn negative_control_station_fact(
    result: Result<PullClientCapabilityRequestsResponse, StationClientError>,
    request_hash: Option<String>,
) -> CapabilityNegativeControlStationFact {
    match result {
        Ok(response) => CapabilityNegativeControlStationFact {
            endpoint: PULL_PATH,
            request_sent: true,
            response_received: true,
            request_hash,
            command_error_code: Some(command_error_code_name(response.error_code)),
            http_status: Some(200),
            transport_error_kind: None,
            station_error_details: None,
        },
        Err(error) => CapabilityNegativeControlStationFact {
            endpoint: PULL_PATH,
            request_sent: true,
            response_received: matches!(error.kind, StationClientErrorKind::HttpStatus(_)),
            request_hash,
            command_error_code: None,
            http_status: match error.kind {
                StationClientErrorKind::HttpStatus(status) => Some(status),
                _ => None,
            },
            transport_error_kind: Some(station_error_kind_name(&error.kind)),
            station_error_details: error.details,
        },
    }
}

fn encoded_message_hash(message: &impl Message) -> String {
    hex::encode(Sha256::digest(message.encode_to_vec()))
}

fn command_error_code_name(value: i32) -> String {
    ClientCapabilityCommandErrorCode::try_from(value)
        .unwrap_or(ClientCapabilityCommandErrorCode::Unspecified)
        .as_str_name()
        .to_string()
}

fn station_error_kind_name(value: &StationClientErrorKind) -> &'static str {
    match value {
        StationClientErrorKind::SessionRevoked => "sessionRevoked",
        StationClientErrorKind::HttpStatus(_) => "httpStatus",
        StationClientErrorKind::Network => "network",
        StationClientErrorKind::Decode => "decode",
        StationClientErrorKind::InvalidResponse => "invalidResponse",
        StationClientErrorKind::Overloaded => "overloaded",
        StationClientErrorKind::AmbiguousOutcome => "ambiguousOutcome",
        StationClientErrorKind::Cancelled => "cancelled",
        StationClientErrorKind::StaleRoute => "staleRoute",
    }
}

fn validate_lease(
    lease: ClientCapabilityLease,
    actor_ptid: &str,
    device_id: &str,
) -> Result<ClientCapabilityLease, String> {
    if lease.ptid != actor_ptid
        || lease.device_id != device_id
        || lease.capability_session_id.trim().is_empty()
        || lease.lease_id.trim().is_empty()
        || lease.lease_revision == 0
        || lease.capability_set_hash.trim().is_empty()
        || lease.device_signing_key_id.trim().is_empty()
        || lease.expires_at.is_none()
    {
        return Err("CLIENT_CAPABILITY_LEASE_RESPONSE_MISMATCH".to_string());
    }
    Ok(lease)
}

fn now_timestamp() -> prost_types::Timestamp {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    prost_types::Timestamp {
        seconds: duration.as_secs().min(i64::MAX as u64) as i64,
        nanos: duration.subsec_nanos() as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_lease_replay_reuses_the_exact_signed_pull_request() {
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&[7_u8; 32]);
        let station_client = StationClient::testing_unavailable();
        let transport = CapabilityStationTransport::new(
            &station_client,
            "ptid:test",
            "device-1",
            "token",
            "signing-key-1",
            &signing_key,
        )
        .unwrap();

        let request = transport
            .signed_pull_request("expired-session", 17, 32)
            .unwrap();
        let replay = request.clone();

        assert_eq!(request.capability_session_id, "expired-session");
        assert_eq!(request.after_sequence, 17);
        assert_eq!(request.limit, 32);
        assert_eq!(request.encode_to_vec(), replay.encode_to_vec());
        assert_eq!(
            encoded_message_hash(&request),
            encoded_message_hash(&replay)
        );
        assert_eq!(encoded_message_hash(&request).len(), 64);
    }
}
