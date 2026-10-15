use std::io::Read;
use std::time::Duration;

use argon2::{Algorithm, Argon2, Params, Version};
use bip39::{Language, Mnemonic};
use messaging_core::proto::recovery::{
    ReadLatestRecoveryRevisionRequest, ReadLatestRecoveryRevisionResponse,
    StoreRecoveryRevisionRequest, StoreRecoveryRevisionResponse,
};
use messaging_core::recovery::RecoveryKdf;
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RECOVERY_REVISION_BYTES: usize = 64 * 1024 * 1024;
const ARGON2_MEMORY_COST_KIB: u32 = 65_536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const BACKUP_KEY_BYTES: usize = 32;
const BACKUP_SALT_BYTES: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MobileRecoveryKdfParameters {
    pub salt: Vec<u8>,
    pub memory_cost_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub output_length: u32,
}

pub(crate) struct MobileRecoveryKdf;

impl RecoveryKdf for MobileRecoveryKdf {
    type Params = MobileRecoveryKdfParameters;

    fn default_params(&self) -> Self::Params {
        let mut salt = vec![0; BACKUP_SALT_BYTES];
        OsRng.fill_bytes(&mut salt);
        MobileRecoveryKdfParameters {
            salt,
            memory_cost_kib: ARGON2_MEMORY_COST_KIB,
            time_cost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
            output_length: BACKUP_KEY_BYTES as u32,
        }
    }

    fn derive_key(&self, passphrase: &[u8], params: &Self::Params) -> Result<[u8; 32], String> {
        if params.salt.len() != BACKUP_SALT_BYTES
            || params.memory_cost_kib != ARGON2_MEMORY_COST_KIB
            || params.time_cost != ARGON2_TIME_COST
            || params.parallelism != ARGON2_PARALLELISM
            || params.output_length != BACKUP_KEY_BYTES as u32
        {
            return Err("unsupported messaging recovery KDF parameters".to_string());
        }
        let parameters = Params::new(
            params.memory_cost_kib,
            params.time_cost,
            params.parallelism,
            Some(params.output_length as usize),
        )
        .map_err(|error| error.to_string())?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
        let mut key = [0; BACKUP_KEY_BYTES];
        argon2
            .hash_password_into(passphrase, &params.salt, &mut key)
            .map_err(|error| error.to_string())?;
        Ok(key)
    }

    fn validate_mnemonic(&self, phrase: &str) -> Result<(), String> {
        let mnemonic = Mnemonic::parse_in(Language::English, phrase)
            .map_err(|_| "messaging recovery phrase is invalid".to_string())?;
        if mnemonic.word_count() != 24 || mnemonic.to_entropy().len() != 32 {
            return Err("messaging recovery phrase must contain 24 words".to_string());
        }
        Ok(())
    }
}

pub(crate) struct RecoveryTransport {
    client: Client,
    origin: String,
    token: Zeroizing<String>,
    device_id: String,
}

impl RecoveryTransport {
    pub fn new(origin: &str, token: &str, device_id: &str) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            client,
            origin: origin.trim_end_matches('/').into(),
            token: Zeroizing::new(token.into()),
            device_id: device_id.into(),
        })
    }

    fn read<Reply: Message + Default>(
        &self,
        request: RequestBuilder,
    ) -> Result<Option<Reply>, String> {
        let response = request
            .header(AUTHORIZATION, format!("Bearer {}", self.token.as_str()))
            .header("X-Device-ID", &self.device_id)
            .header(ACCEPT, "application/protobuf")
            .header(CONTENT_TYPE, "application/protobuf")
            .send()
            .map_err(|e| e.to_string())?;
        let status = response.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!(
                "messaging recovery Station returned HTTP {}",
                status.as_u16()
            ));
        }
        let mut body = Vec::new();
        response
            .take((MAX_RECOVERY_REVISION_BYTES + 1) as u64)
            .read_to_end(&mut body)
            .map_err(|e| e.to_string())?;
        if body.len() > MAX_RECOVERY_REVISION_BYTES {
            return Err("messaging recovery response exceeds the client limit".into());
        }
        Reply::decode(body.as_slice())
            .map(Some)
            .map_err(|_| "messaging recovery response invalid".into())
    }

    pub fn latest(&self) -> Result<Option<ReadLatestRecoveryRevisionResponse>, String> {
        self.read(
            self.client
                .get(format!("{}/recovery/latest", self.origin))
                .body(ReadLatestRecoveryRevisionRequest {}.encode_to_vec()),
        )
    }

    fn query_url(&self, path: &str, pairs: &[(&str, String)]) -> Result<reqwest::Url, String> {
        let mut url =
            reqwest::Url::parse(&format!("{}{path}", self.origin)).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .extend_pairs(pairs.iter().map(|(key, value)| (*key, value.as_str())));
        Ok(url)
    }

    pub fn store(
        &self,
        request: &StoreRecoveryRevisionRequest,
    ) -> Result<StoreRecoveryRevisionResponse, String> {
        self.read(
            self.client
                .post(format!("{}/recovery/revision", self.origin))
                .header(CONTENT_TYPE, "application/protobuf")
                .body(request.encode_to_vec()),
        )?
        .ok_or_else(|| "messaging recovery endpoint unavailable".into())
    }

    pub fn reconcile(
        &self,
        archive: &messaging_core::recovery::MessagingRecoveryArchive,
    ) -> Result<messaging_core::recovery::RecoveryReconciliation, String> {
        use messaging_core::proto::chat::{
            ConversationPublicHeadSource, GetConversationPublicHeadResponse,
            ListConversationEventsResponse,
        };
        use messaging_core::recovery::reconciliation::{
            fetch_recovery_events_to_target, reconcile_archive_authority_events,
        };
        let mut result = messaging_core::recovery::RecoveryReconciliation::default();
        for conversation in &archive.conversations {
            let response: GetConversationPublicHeadResponse = self
                .read(self.client.get(self.query_url(
                    "/conversation/public-head",
                    &[("conversation_id", conversation.conversation_id.clone())],
                )?))?
                .ok_or("messaging recovery authority head unavailable")?;
            let head = response
                .head
                .ok_or("messaging recovery authority head missing")?;
            if head.source != ConversationPublicHeadSource::Authority as i32
                || head.conversation_id != conversation.conversation_id
                || head.authority_station_peer_id != conversation.authority_station_id
                || head.federation_id != conversation.federation_id
            {
                return Err("messaging recovery authority binding invalid".into());
            }
            let old = archive
                .authority_heads
                .iter()
                .find(|h| h.conversation_id == conversation.conversation_id)
                .ok_or("messaging recovery archived head missing")?;
            let events = fetch_recovery_events_to_target(
                old.event_sequence,
                head.group_seq,
                500,
                1_000,
                |after, limit| {
                    let response: ListConversationEventsResponse = self
                        .read(self.client.get(self.query_url(
                            "/conversation/events",
                            &[
                                ("conversation_id", conversation.conversation_id.clone()),
                                ("after_seq", after.to_string()),
                                ("limit", limit.to_string()),
                            ],
                        )?))?
                        .ok_or("messaging recovery authority events missing")?;
                    Ok(response.events)
                },
            )?;
            result.redactions.extend(reconcile_archive_authority_events(
                archive,
                &conversation.conversation_id,
                head.group_seq,
                &head.event_hash,
                &events,
            )?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use messaging_core::recovery::MessagingRecoveryArchive;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon abandon art";

    #[test]
    fn rejects_noncanonical_kdf_parameters() {
        let parameters = MobileRecoveryKdfParameters {
            salt: vec![1; BACKUP_SALT_BYTES],
            memory_cost_kib: ARGON2_MEMORY_COST_KIB,
            time_cost: ARGON2_TIME_COST + 1,
            parallelism: ARGON2_PARALLELISM,
            output_length: BACKUP_KEY_BYTES as u32,
        };
        assert!(MobileRecoveryKdf
            .derive_key(b"recovery phrase", &parameters)
            .is_err());
    }

    #[test]
    fn decodes_the_canonical_messaging_recovery_archive() {
        let archive = MessagingRecoveryArchive {
            ptid: "ptid:alice".to_string(),
            actor_identity_seed: [7; 32],
            actor_profile_version: 3,
            conversations: Vec::new(),
            messages: Vec::new(),
            retention_floors: Vec::new(),
            authority_heads: Vec::new(),
            redaction_tombstones: Vec::new(),
            attachments: Vec::new(),
            trust: Vec::new(),
        };
        let encoded = messaging_core::recovery::encode_recovery_revision(
            &MobileRecoveryKdf,
            PHRASE,
            "revision-1",
            "device-1",
            1,
            1,
            &archive,
        )
        .unwrap();

        let decoded = messaging_core::recovery::decode_recovery_revision(
            &MobileRecoveryKdf,
            PHRASE,
            "ptid:alice",
            "revision-1",
            &encoded.bytes,
            &encoded.sha256,
        )
        .unwrap();

        assert_eq!(decoded.archive, archive);
    }
}
