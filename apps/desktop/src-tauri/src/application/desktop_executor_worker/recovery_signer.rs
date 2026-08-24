use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::model::agent::{
    ClientCapabilityReceipt, ClientCapabilityRequest, ReceiptRecoveryProof,
    ReceiptRecoverySigningPayload,
};
use prost::Message;
use sha2::{Digest, Sha256};

pub const RECEIPT_RECOVERY_DOMAIN: &str = "peers-touch/agent/tool-receipt-recovery/v1";

pub fn sign_terminal_recovery(
    identity: &ActorDeviceIdentity,
    envelope: &ClientCapabilityRequest,
    receipt: &mut ClientCapabilityReceipt,
) -> Result<(), String> {
    if !matches!(
        crate::model::agent::ClientCapabilityReceiptStatus::try_from(receipt.status),
        Ok(crate::model::agent::ClientCapabilityReceiptStatus::Applied)
            | Ok(crate::model::agent::ClientCapabilityReceiptStatus::Failed)
            | Ok(crate::model::agent::ClientCapabilityReceiptStatus::ReconciledUnknown)
    ) {
        return Err("CLIENT_CAPABILITY_RECOVERY_TERMINAL_ONLY".to_string());
    }
    let credential = envelope
        .recovery_credential
        .as_ref()
        .ok_or_else(|| "CLIENT_CAPABILITY_RECOVERY_CREDENTIAL_REQUIRED".to_string())?;
    let (signing_key_id, _) = identity.signing_identity()?;
    if signing_key_id != credential.device_signing_key_id {
        return Err("CLIENT_CAPABILITY_RECOVERY_SIGNING_KEY_MISMATCH".to_string());
    }

    receipt.recovery_proof = None;
    let receipt_digest = Sha256::digest(receipt.encode_to_vec()).to_vec();
    let signing_payload = ReceiptRecoverySigningPayload {
        domain: RECEIPT_RECOVERY_DOMAIN.to_string(),
        credential_id: credential.credential_id.clone(),
        nonce: credential.nonce.clone(),
        device_signing_key_id: credential.device_signing_key_id.clone(),
        scope_hash: credential.scope_hash.clone(),
        receipt_digest,
    };
    receipt.recovery_proof = Some(ReceiptRecoveryProof {
        credential_id: credential.credential_id.clone(),
        nonce: credential.nonce.clone(),
        device_signing_key_id: credential.device_signing_key_id.clone(),
        signature: identity.sign(&signing_payload.encode_to_vec())?,
    });
    Ok(())
}

pub fn receipt_digest(receipt: &ClientCapabilityReceipt) -> Vec<u8> {
    let mut canonical = receipt.clone();
    canonical.recovery_proof = None;
    Sha256::digest(canonical.encode_to_vec()).to_vec()
}
