use crate::codec::private_content::encode_message_private_content;
use crate::crypto::double_ratchet::{self, DrCiphertextWire};
use crate::crypto::session::DirectSession;
use crate::proto::chat::{
    AttachmentPlaintextMetadata, CryptoEndpoint as ProtoCryptoEndpoint, DirectCiphertextAad,
    DirectDeviceCiphertext, DirectSessionInit, DoubleRatchetCiphertext, PreparedEndpointPayload,
    PreparedEndpointPayloadKind,
};
use prost::Message;
use sha2::{Digest, Sha256};

pub struct DirectSendIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub client_timestamp_unix_ms: i64,
}

pub struct DirectSessionWithInit {
    pub session: DirectSession,
    pub session_init: Option<DirectSessionInit>,
}

pub struct DirectFanOutResult {
    pub payloads: Vec<PreparedEndpointPayload>,
    pub advanced_sessions: Vec<DirectSession>,
    pub session_inits: Vec<(String, Vec<u8>)>,
    pub private_content_bytes: Vec<u8>,
}

pub fn encrypt_direct_fan_out(
    intent: &DirectSendIntent<'_>,
    local: &ProtoCryptoEndpoint,
    sessions: Vec<DirectSessionWithInit>,
) -> Result<DirectFanOutResult, String> {
    if sessions.is_empty() {
        return Err("messaging Direct fan-out requires at least one peer session".to_string());
    }
    let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
    let mut advanced_sessions = Vec::with_capacity(sessions.len());
    let mut session_inits = Vec::new();
    let mut payloads = Vec::with_capacity(sessions.len());

    for DirectSessionWithInit {
        mut session,
        session_init,
    } in sessions
    {
        if session.key.local.ptid != local.ptid || session.key.local.device_id != local.device_id {
            return Err("messaging Direct session local endpoint mismatch".to_string());
        }
        let recipient = ProtoCryptoEndpoint {
            ptid: session.key.peer.ptid.clone(),
            device_id: session.key.peer.device_id.clone(),
        };
        let mut direct = DirectDeviceCiphertext {
            command_id: intent.command_id.to_string(),
            message_id: intent.message_id.to_string(),
            sender: Some(local.clone()),
            recipient: Some(recipient.clone()),
            session_id: session.session_id.clone(),
            session_generation: session.key.generation,
            protocol_version: session.protocol_version,
            ratchet_ciphertext: None,
            ciphertext_sha256: Vec::new(),
            session_init,
        };
        if let Some(init) = direct.session_init.as_ref() {
            session_inits.push((session.session_id.clone(), init.encode_to_vec()));
        }
        let aad = DirectCiphertextAad {
            command_id: direct.command_id.clone(),
            message_id: direct.message_id.clone(),
            conversation_id: intent.conversation_id.to_string(),
            sender: direct.sender.clone(),
            recipient: direct.recipient.clone(),
            session_id: direct.session_id.clone(),
            session_generation: direct.session_generation,
            protocol_version: direct.protocol_version,
        }
        .encode_to_vec();
        let wire = double_ratchet::encrypt(&mut session.ratchet, &private_content, &aad)
            .map_err(|error| format!("messaging Direct encrypt failed: {error}"))?;
        session.established = true;
        session.updated_at_unix_ms = intent.client_timestamp_unix_ms;
        let ratchet_ciphertext = wire_to_ratchet_proto(&wire);
        direct.ciphertext_sha256 = Sha256::digest(ratchet_ciphertext.encode_to_vec()).to_vec();
        direct.ratchet_ciphertext = Some(ratchet_ciphertext);
        let endpoint_payload = direct.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        payloads.push(PreparedEndpointPayload {
            recipient: Some(recipient),
            kind: PreparedEndpointPayloadKind::DirectCiphertext as i32,
            opaque_payload: endpoint_payload,
            payload_sha256: endpoint_payload_sha256,
        });
        advanced_sessions.push(session);
    }

    Ok(DirectFanOutResult {
        payloads,
        advanced_sessions,
        session_inits,
        private_content_bytes: private_content,
    })
}

fn wire_to_ratchet_proto(wire: &DrCiphertextWire) -> DoubleRatchetCiphertext {
    DoubleRatchetCiphertext {
        wire_version: wire.version,
        sender_ratchet_public_key: wire.sender_dh.to_vec(),
        message_counter: wire.n_send,
        previous_chain_length: wire.n_prev,
        nonce: wire.nonce.to_vec(),
        ciphertext: wire.ciphertext.clone(),
    }
}
