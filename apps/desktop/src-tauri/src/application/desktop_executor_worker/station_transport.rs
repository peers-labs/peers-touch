use super::fenced_executor::ReceiptReporter;
use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::infrastructure::station_client;
use crate::model::agent::{
    ClientCapabilityAdvertisement, ClientCapabilityCommandDomain, ClientCapabilityCommandProof,
    ClientCapabilityCommandSigningPayload, ClientCapabilityLease,
    ClientCapabilityLeaseRevokeReason, ClientCapabilityReceipt,
    PullClientCapabilityRequestsRequest, PullClientCapabilityRequestsResponse,
    RegisterClientCapabilityLeaseRequest, RegisterClientCapabilityLeaseResponse,
    RenewClientCapabilityLeaseRequest, RenewClientCapabilityLeaseResponse,
    RevokeClientCapabilityLeaseRequest, RevokeClientCapabilityLeaseResponse,
    SubmitClientCapabilityReceiptRequest, SubmitClientCapabilityReceiptResponse,
    SubmitClientCapabilityRecoveryReceiptRequest, SubmitClientCapabilityRecoveryReceiptResponse,
};
use prost::Message;
use rand::RngCore;
use reqwest::Method;
use sha2::{Digest, Sha256};

const PULL_PATH: &str = "/agent/capability/requests/pull";
const REGISTER_PATH: &str = "/agent/capability/lease/register";
const RENEW_PATH: &str = "/agent/capability/lease/renew";
const REVOKE_PATH: &str = "/agent/capability/lease/revoke";
const ACTIVE_RECEIPT_PATH: &str = "/agent/capability/receipt";
const RECOVERY_RECEIPT_PATH: &str = "/agent/capability/receipt/recover";

pub struct CapabilityStationTransport<'a> {
    station_url: &'a str,
    actor_ptid: &'a str,
    device_id: &'a str,
    token: &'a str,
    identity: &'a ActorDeviceIdentity,
}

impl<'a> CapabilityStationTransport<'a> {
    pub fn new(
        station_url: &'a str,
        actor_ptid: &'a str,
        device_id: &'a str,
        token: &'a str,
        identity: &'a ActorDeviceIdentity,
    ) -> Result<Self, String> {
        if station_url.trim().is_empty()
            || !actor_ptid.starts_with("ptid:")
            || device_id.trim().is_empty()
            || token.trim().is_empty()
        {
            return Err(
                "client capability transport requires Station, actor, device, and token"
                    .to_string(),
            );
        }
        Ok(Self {
            station_url,
            actor_ptid,
            device_id,
            token,
            identity,
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
        let response: RegisterClientCapabilityLeaseResponse =
            station_client::request_proto_for_device_at(
                self.station_url,
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
        let response: RenewClientCapabilityLeaseResponse =
            station_client::request_proto_for_device_at(
                self.station_url,
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
        let response: RevokeClientCapabilityLeaseResponse =
            station_client::request_proto_for_device_at(
                self.station_url,
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
        let response: PullClientCapabilityRequestsResponse =
            station_client::request_proto_for_device_at::<_, PullClientCapabilityRequestsResponse>(
                self.station_url,
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
        let response = station_client::request_proto_for_device_at::<_, _>(
            self.station_url,
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

    fn submit_recovery(
        &self,
        receipt: &ClientCapabilityReceipt,
    ) -> Result<SubmitClientCapabilityReceiptResponse, String> {
        let request = SubmitClientCapabilityRecoveryReceiptRequest {
            receipt: Some(receipt.clone()),
        };
        let response = station_client::request_proto_no_auth_at::<
            _,
            SubmitClientCapabilityRecoveryReceiptResponse,
        >(
            self.station_url,
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
        let (signing_key_id, _) = self.identity.signing_identity()?;
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
        Ok(ClientCapabilityCommandProof {
            command_id: payload.command_id.clone(),
            device_signing_key_id: signing_key_id,
            nonce,
            issued_at: Some(issued_at),
            signature: self.identity.sign(&payload.encode_to_vec())?,
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
