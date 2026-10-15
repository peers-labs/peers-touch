use std::io::Read;
use std::time::Duration;

use argon2::{Algorithm, Argon2, Params, Version};
use bip39::{Language, Mnemonic};
use messaging_core::proto::recovery::{
    ReadLatestRecoveryRevisionRequest, ReadLatestRecoveryRevisionResponse,
};
use messaging_core::recovery::{DecodedRecoveryRevision, RecoveryKdf};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION};
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

struct MobileRecoveryKdf;

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

pub fn fetch_and_decode_latest(
    station_origin: &str,
    access_token: &str,
    actor_ptid: &str,
    recovery_phrase: &str,
) -> Result<DecodedRecoveryRevision, String> {
    if station_origin.trim().is_empty()
        || access_token.trim().is_empty()
        || actor_ptid.trim().is_empty()
    {
        return Err("messaging recovery scope is incomplete".to_string());
    }
    let request = ReadLatestRecoveryRevisionRequest {};
    let client = Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("build messaging recovery transport: {error}"))?;
    let response = client
        .get(format!(
            "{}/recovery/latest",
            station_origin.trim_end_matches('/')
        ))
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(|error| format!("fetch messaging recovery revision: {error}"))?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RECOVERY_REVISION_BYTES as u64)
    {
        return Err("messaging recovery revision exceeds the client limit".to_string());
    }
    let mut body = Vec::new();
    response
        .take((MAX_RECOVERY_REVISION_BYTES + 1) as u64)
        .read_to_end(&mut body)
        .map_err(|error| format!("read messaging recovery revision: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "messaging recovery Station returned HTTP {}",
            status.as_u16()
        ));
    }
    if body.len() > MAX_RECOVERY_REVISION_BYTES {
        return Err("messaging recovery revision exceeds the client limit".to_string());
    }
    let revision = ReadLatestRecoveryRevisionResponse::decode(body.as_slice())
        .map_err(|_| "messaging recovery Station response is invalid".to_string())?;
    if revision.revision_id.trim().is_empty()
        || revision.encrypted_archive.is_empty()
        || revision.encrypted_archive_sha256.len() != 32
    {
        return Err("messaging recovery revision is incomplete".to_string());
    }
    let phrase = Zeroizing::new(recovery_phrase.trim().to_string());
    messaging_core::recovery::decode_recovery_revision(
        &MobileRecoveryKdf,
        phrase.as_str(),
        actor_ptid,
        &revision.revision_id,
        &revision.encrypted_archive,
        &revision.encrypted_archive_sha256,
    )
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
