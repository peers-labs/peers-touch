use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::{secure_content as wire, social};

const DESCRIPTOR_SHA256_BYTES: usize = 32;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum PrivateMediaAccessPath {
    #[default]
    HomeStationLocalObject,
    HomeStationRemotePeerStream,
}

impl PrivateMediaAccessPath {
    pub(super) fn from_response(
        response: &social::GetMomentResourceResponse,
        home_station_peer_id: &str,
    ) -> Result<Self, String> {
        if home_station_peer_id.trim().is_empty() {
            return Err("private media Home Station identity is unavailable".to_string());
        }
        let Some(source) = response
            .explanation
            .as_ref()
            .and_then(|explanation| explanation.source.as_ref())
        else {
            return Ok(Self::HomeStationLocalObject);
        };
        let source_kind = social::activity_source::Kind::try_from(source.kind)
            .unwrap_or(social::activity_source::Kind::ActivitySourceUnspecified);
        match source_kind {
            social::activity_source::Kind::ActivitySourceLocal => {
                if !source.station_peer_id.is_empty()
                    && source.station_peer_id != home_station_peer_id
                {
                    return Err("private media local source identity is inconsistent".to_string());
                }
                Ok(Self::HomeStationLocalObject)
            }
            social::activity_source::Kind::ActivitySourceRemote => {
                if source.station_peer_id.trim().is_empty()
                    || source.station_peer_id == home_station_peer_id
                {
                    return Err("private media remote source identity is inconsistent".to_string());
                }
                Ok(Self::HomeStationRemotePeerStream)
            }
            _ if source.station_peer_id.is_empty()
                || source.station_peer_id == home_station_peer_id =>
            {
                Ok(Self::HomeStationLocalObject)
            }
            _ => Err("private media source identity is unresolved".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PrivateMediaOpenFailureKind {
    AccessDenied,
    Integrity,
    Dependency,
    Cancelled,
}

#[derive(Debug)]
pub(super) struct PrivateMediaOpenError {
    pub(super) kind: PrivateMediaOpenFailureKind,
    pub(super) code: &'static str,
    pub(super) retry_after_seconds: Option<u64>,
    pub(super) message: String,
}

impl PrivateMediaOpenError {
    pub(super) fn access_denied(message: impl Into<String>) -> Self {
        Self {
            kind: PrivateMediaOpenFailureKind::AccessDenied,
            code: "MEDIA_ACCESS_DENIED",
            retry_after_seconds: None,
            message: message.into(),
        }
    }

    pub(super) fn integrity(message: impl Into<String>) -> Self {
        Self {
            kind: PrivateMediaOpenFailureKind::Integrity,
            code: "MEDIA_INTEGRITY_FAILURE",
            retry_after_seconds: None,
            message: message.into(),
        }
    }

    pub(super) fn dependency(
        message: impl Into<String>,
        retry_after_seconds: Option<u64>,
    ) -> Self {
        Self {
            kind: PrivateMediaOpenFailureKind::Dependency,
            code: "MEDIA_DEPENDENCY_UNAVAILABLE",
            retry_after_seconds,
            message: message.into(),
        }
    }

    pub(super) fn cancelled(message: impl Into<String>) -> Self {
        Self {
            kind: PrivateMediaOpenFailureKind::Cancelled,
            code: "MEDIA_CANCELLED",
            retry_after_seconds: None,
            message: message.into(),
        }
    }

    pub(super) fn state(&self) -> &'static str {
        match self.kind {
            PrivateMediaOpenFailureKind::AccessDenied => "MEDIA_ACCESS_DENIED",
            PrivateMediaOpenFailureKind::Integrity => "MEDIA_INTEGRITY_FAILURE",
            PrivateMediaOpenFailureKind::Dependency | PrivateMediaOpenFailureKind::Cancelled => {
                "MEDIA_OFFLINE_RETRYABLE"
            }
        }
    }

    pub(super) fn retryable(&self) -> bool {
        matches!(
            self.kind,
            PrivateMediaOpenFailureKind::Dependency | PrivateMediaOpenFailureKind::Cancelled
        )
    }
}

impl From<String> for PrivateMediaOpenError {
    fn from(message: String) -> Self {
        Self::integrity(message)
    }
}

pub(super) fn verify_descriptor_binding(
    descriptor: &wire::EncryptedObjectDescriptor,
    expected_sha256: &[u8],
) -> Result<(), PrivateMediaOpenError> {
    if expected_sha256.len() != DESCRIPTOR_SHA256_BYTES
        || Sha256::digest(descriptor.encode_to_vec()).as_slice() != expected_sha256
    {
        return Err(PrivateMediaOpenError::integrity(
            "private media descriptor commitment changed",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use prost::Message;
    use secure_content_core::object::OBJECT_TAG_SIZE;
    use serde::Deserialize;
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::secure_content::worker::new_download_record;

    const GRANT_BINDING_VECTOR: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tooling/acceptance/fixtures/social/",
        "federated-private-object-grant-binding-v1.json"
    ));
    const MAX_METADATA_DECODED_BYTES: usize = 69;
    const MAX_METADATA_ENCODED_BYTES: usize = 92;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GrantBindingVector {
        binding: GrantBindingInput,
        canonical_bytes_hex: String,
        sha256_hex: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GrantBindingInput {
        format_version: u32,
        federation_id: String,
        delivery_id: String,
        source_station_peer_id: String,
        target_station_peer_id: String,
        target_actor_ptid: String,
        resource: GrantResourceInput,
        lifecycle_revision: u64,
        object_id: String,
        descriptor_sha256_hex: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GrantResourceInput {
        owner_domain: String,
        content_id: String,
        generation: u64,
    }

    fn object_fixture(
        storage_ref: &str,
    ) -> (
        wire::SecureResourceRef,
        wire::EncryptedObjectDescriptor,
        social::PrivateAttachmentMetadata,
    ) {
        let resource = wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            generation: 7,
        };
        let commitment = wire::EncryptedObjectUploadSpec {
            resource: Some(resource.clone()),
            object_id: "object-01".to_string(),
            ciphertext_size: 32,
            ciphertext_sha256: vec![3; 32],
            chunk_size: 16,
            chunk_count: 1,
            encryption_suite: wire::ObjectEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: wire::ObjectNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![vec![4; 32]],
        };
        let descriptor = wire::EncryptedObjectDescriptor {
            resource: Some(resource.clone()),
            object_id: "object-01".to_string(),
            storage_ref: storage_ref.to_string(),
            commitment: Some(commitment),
        };
        let attachment = social::PrivateAttachmentMetadata {
            object: Some(descriptor.clone()),
            object_key: vec![6; 32],
            base_nonce: vec![7, 7, 7, 7, 7, 7, 7, 7, 0, 0, 0, 0],
            plaintext_sha256: vec![8; 32],
            plaintext_size: 16,
            mime_type: "image/jpeg".to_string(),
            width: 320,
            height: 240,
            alt_text: String::new(),
            ..Default::default()
        };
        (resource, descriptor, attachment)
    }

    fn decode_metadata_header(
        value: &str,
    ) -> Result<social::ReadFederatedPrivateObjectResponse, String> {
        if value.is_empty()
            || value.len() > MAX_METADATA_ENCODED_BYTES
            || value.contains('=')
            || !value.is_ascii()
        {
            return Err("metadata header encoding is invalid".to_string());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| "metadata header encoding is invalid".to_string())?;
        if bytes.len() > MAX_METADATA_DECODED_BYTES
            || URL_SAFE_NO_PAD.encode(&bytes) != value
        {
            return Err("metadata header is not canonical base64url".to_string());
        }
        let metadata = social::ReadFederatedPrivateObjectResponse::decode(bytes.as_slice())
            .map_err(|_| "metadata protobuf is malformed".to_string())?;
        let range = metadata
            .range
            .as_ref()
            .ok_or_else(|| "metadata range is missing".to_string())?;
        if metadata.encode_to_vec() != bytes
            || metadata.descriptor_sha256.len() != DESCRIPTOR_SHA256_BYTES
            || range.start >= range.end_exclusive
            || range.end_exclusive > metadata.total_ciphertext_size
        {
            return Err("metadata protobuf is not canonical".to_string());
        }
        Ok(metadata)
    }

    #[test]
    fn federated_private_object_grant_binding_known_answer() {
        let vector: GrantBindingVector =
            serde_json::from_str(GRANT_BINDING_VECTOR).expect("known-answer fixture must parse");
        assert_eq!(
            vector.binding.resource.owner_domain,
            "SECURE_CONTENT_OWNER_DOMAIN_SOCIAL"
        );
        let binding = social::FederatedPrivateObjectGrantBinding {
            format_version: vector.binding.format_version,
            federation_id: vector.binding.federation_id,
            delivery_id: vector.binding.delivery_id,
            source_station_peer_id: vector.binding.source_station_peer_id,
            target_station_peer_id: vector.binding.target_station_peer_id,
            target_actor_ptid: vector.binding.target_actor_ptid,
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: vector.binding.resource.content_id,
                generation: vector.binding.resource.generation,
            }),
            lifecycle_revision: vector.binding.lifecycle_revision,
            object_id: vector.binding.object_id,
            descriptor_sha256: hex::decode(vector.binding.descriptor_sha256_hex)
                .expect("descriptor digest must be hex"),
        };
        let canonical = binding.encode_to_vec();

        assert_eq!(hex::encode(&canonical), vector.canonical_bytes_hex);
        assert_eq!(hex::encode(Sha256::digest(canonical)), vector.sha256_hex);
    }

    #[test]
    fn federated_private_object_metadata_rejects_noncanonical_base64url() {
        let metadata = social::ReadFederatedPrivateObjectResponse {
            descriptor_sha256: vec![9; 32],
            range: Some(social::FederatedPrivateObjectRange {
                start: 4,
                end_exclusive: 20,
            }),
            total_ciphertext_size: 32,
        };
        let encoded = URL_SAFE_NO_PAD.encode(metadata.encode_to_vec());

        assert_eq!(decode_metadata_header(&encoded).unwrap(), metadata);
        assert!(decode_metadata_header(&format!("{encoded}=")).is_err());
        assert!(decode_metadata_header(&"a".repeat(MAX_METADATA_ENCODED_BYTES + 1)).is_err());
    }

    #[test]
    fn remote_private_media_resume_preserves_object_identity() {
        let (resource, _descriptor, attachment) = object_fixture("social/object-01");
        let first =
            new_download_record("ptid:bob", 9, "post-01", &resource, &attachment).unwrap();
        let resumed =
            new_download_record("ptid:bob", 9, "post-01", &resource, &attachment).unwrap();
        let response = social::GetMomentResourceResponse {
            explanation: Some(social::FeedObjectExplanation {
                source: Some(social::ActivitySource {
                    kind: social::activity_source::Kind::ActivitySourceRemote as i32,
                    station_peer_id: "station-source".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert_eq!(
            PrivateMediaAccessPath::from_response(&response, "station-target").unwrap(),
            PrivateMediaAccessPath::HomeStationRemotePeerStream
        );
        assert_eq!(first.0.transfer_id, resumed.0.transfer_id);
        assert_eq!(first.0.operation_id, resumed.0.operation_id);
        assert_eq!(first.0.descriptor_sha256, resumed.0.descriptor_sha256);
        assert_eq!(first.0.partial_local_ref, resumed.0.partial_local_ref);
    }

    #[test]
    fn remote_private_media_rejects_descriptor_mismatch() {
        let (_resource, descriptor, _attachment) = object_fixture("social/object-01");
        let expected = Sha256::digest(descriptor.encode_to_vec()).to_vec();
        let mut substituted = descriptor.clone();
        substituted.storage_ref = "social/attacker-object".to_string();

        assert!(verify_descriptor_binding(&descriptor, &expected).is_ok());
        assert!(verify_descriptor_binding(&substituted, &expected).is_err());
    }
}
