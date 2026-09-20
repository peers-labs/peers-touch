use crate::codec::{
    validate_canonical_message, CanonicalMessageEncoder, CanonicalProtobufError, FieldRule,
    WireType,
};
use rand::rngs::OsRng;
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const CONTENT_PREKEY_SIZE: usize = 32;
pub const CONTENT_PREKEY_SIGNING_FORMAT_VERSION: u32 = 1;
pub const CONTENT_PREKEY_SIGNING_DOMAIN: &[u8] = b"peers-touch:secure-content:prekey:v1\0";
pub const MAX_CONTENT_PREKEY_KEY_ID_BYTES: usize = 128;
pub const MAX_CONTENT_PREKEY_ACTOR_PTID_BYTES: usize = 255;
pub const MAX_CONTENT_PREKEY_DEVICE_ID_BYTES: usize = 128;
pub const MAX_CONTENT_PREKEY_SIGNING_KEY_ID_BYTES: usize = 128;
pub const MAX_CONTENT_PREKEY_EPOCH: u64 = i64::MAX as u64;

const CONTENT_PREKEY_PRINCIPAL_ONEOF: u16 = 1;
const ACTOR_REF_RULES: &[FieldRule] = &[
    FieldRule::singular(2, WireType::LengthDelimited),
    FieldRule::singular(3, WireType::LengthDelimited),
    FieldRule::singular(4, WireType::Varint),
];
const ACTOR_DEVICE_REF_RULES: &[FieldRule] = &[
    FieldRule::message(1, ACTOR_REF_RULES),
    FieldRule::singular(2, WireType::LengthDelimited),
];
const CONTENT_PREKEY_SIGNING_INPUT_RULES: &[FieldRule] = &[
    FieldRule::singular(1, WireType::Varint),
    FieldRule::singular(2, WireType::Varint),
    FieldRule::singular(3, WireType::LengthDelimited),
    FieldRule::singular(4, WireType::LengthDelimited),
    FieldRule::oneof_message(5, CONTENT_PREKEY_PRINCIPAL_ONEOF, ACTOR_DEVICE_REF_RULES),
    FieldRule::oneof_message(6, CONTENT_PREKEY_PRINCIPAL_ONEOF, ACTOR_REF_RULES),
    FieldRule::singular(7, WireType::Varint),
    FieldRule::singular(8, WireType::Varint),
    FieldRule::message(9, ACTOR_DEVICE_REF_RULES),
    FieldRule::singular(10, WireType::LengthDelimited),
    FieldRule::singular(11, WireType::Varint),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentPreKeyPublic([u8; CONTENT_PREKEY_SIZE]);

impl ContentPreKeyPublic {
    pub fn from_bytes(bytes: [u8; CONTENT_PREKEY_SIZE]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; CONTENT_PREKEY_SIZE] {
        &self.0
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct ContentPreKeyPrivate([u8; CONTENT_PREKEY_SIZE]);

impl ContentPreKeyPrivate {
    pub fn from_bytes(bytes: [u8; CONTENT_PREKEY_SIZE]) -> Self {
        Self(bytes)
    }

    pub fn public_key(&self) -> ContentPreKeyPublic {
        let secret = StaticSecret::from(self.0);
        ContentPreKeyPublic(PublicKey::from(&secret).to_bytes())
    }

    pub fn to_bytes(&self) -> [u8; CONTENT_PREKEY_SIZE] {
        self.0
    }

    pub(crate) fn as_bytes(&self) -> &[u8; CONTENT_PREKEY_SIZE] {
        &self.0
    }
}

pub struct ContentPreKeyPair {
    private: ContentPreKeyPrivate,
    public: ContentPreKeyPublic,
}

impl ContentPreKeyPair {
    pub fn generate() -> Self {
        let private = ContentPreKeyPrivate(StaticSecret::random_from_rng(OsRng).to_bytes());
        let public = private.public_key();
        Self { private, public }
    }

    pub fn from_private(private: ContentPreKeyPrivate) -> Self {
        let public = private.public_key();
        Self { private, public }
    }

    pub fn public(&self) -> ContentPreKeyPublic {
        self.public
    }

    pub fn private(&self) -> &ContentPreKeyPrivate {
        &self.private
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ContentPreKeyKind {
    Endpoint = 1,
    ActorRecovery = 2,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentPreKeyActorRef {
    pub ptid: String,
}

impl ContentPreKeyActorRef {
    pub fn new(ptid: impl Into<String>) -> Self {
        Self { ptid: ptid.into() }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentPreKeyEndpoint {
    pub actor: ContentPreKeyActorRef,
    pub device_id: String,
}

impl ContentPreKeyEndpoint {
    pub fn new(ptid: impl Into<String>, device_id: impl Into<String>) -> Self {
        Self {
            actor: ContentPreKeyActorRef::new(ptid),
            device_id: device_id.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContentPreKeyPrincipal {
    Endpoint(ContentPreKeyEndpoint),
    RecoveryActor(ContentPreKeyActorRef),
}

impl ContentPreKeyPrincipal {
    pub fn kind(&self) -> ContentPreKeyKind {
        match self {
            Self::Endpoint(_) => ContentPreKeyKind::Endpoint,
            Self::RecoveryActor(_) => ContentPreKeyKind::ActorRecovery,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentPreKeySigningInput {
    pub format_version: u32,
    pub kind: ContentPreKeyKind,
    pub key_id: String,
    pub x25519_public_key: ContentPreKeyPublic,
    pub principal: ContentPreKeyPrincipal,
    pub pool_epoch: u64,
    pub expected_pool_epoch: u64,
    pub publisher: ContentPreKeyEndpoint,
    pub publisher_signing_key_id: String,
    pub publisher_profile_version: u64,
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum ContentPreKeySigningInputError {
    #[error("unsupported Content PreKey signing format version {0}")]
    UnsupportedFormatVersion(u32),
    #[error("Content PreKey signing field {0} is invalid")]
    InvalidField(&'static str),
    #[error("Content PreKey signing field {0} exceeds its byte limit")]
    FieldTooLong(&'static str),
    #[error("Content PreKey kind does not match its principal")]
    KindPrincipalMismatch,
    #[error("endpoint Content PreKey principal does not match its publisher")]
    EndpointPublisherMismatch,
    #[error("recovery Content PreKey actor does not match its publisher")]
    RecoveryPublisherMismatch,
    #[error("endpoint Content PreKey epoch does not match its publisher profile version")]
    EndpointEpochProfileMismatch,
    #[error("expected Content PreKey pool epoch exceeds the new pool epoch")]
    ExpectedEpochAfterPoolEpoch,
    #[error(transparent)]
    CanonicalProtobuf(#[from] CanonicalProtobufError),
}

impl ContentPreKeySigningInput {
    pub fn validate(&self) -> Result<(), ContentPreKeySigningInputError> {
        if self.format_version != CONTENT_PREKEY_SIGNING_FORMAT_VERSION {
            return Err(ContentPreKeySigningInputError::UnsupportedFormatVersion(
                self.format_version,
            ));
        }
        if self.kind != self.principal.kind() {
            return Err(ContentPreKeySigningInputError::KindPrincipalMismatch);
        }
        validate_canonical_string("key_id", &self.key_id, MAX_CONTENT_PREKEY_KEY_ID_BYTES)?;
        if self
            .x25519_public_key
            .as_bytes()
            .iter()
            .all(|byte| *byte == 0)
        {
            return Err(ContentPreKeySigningInputError::InvalidField(
                "x25519_public_key",
            ));
        }
        validate_epoch("pool_epoch", self.pool_epoch, false)?;
        validate_epoch("expected_pool_epoch", self.expected_pool_epoch, true)?;
        if self.expected_pool_epoch > self.pool_epoch {
            return Err(ContentPreKeySigningInputError::ExpectedEpochAfterPoolEpoch);
        }
        validate_endpoint("publisher", &self.publisher)?;
        validate_canonical_string(
            "publisher_signing_key_id",
            &self.publisher_signing_key_id,
            MAX_CONTENT_PREKEY_SIGNING_KEY_ID_BYTES,
        )?;
        validate_epoch(
            "publisher_profile_version",
            self.publisher_profile_version,
            false,
        )?;

        match &self.principal {
            ContentPreKeyPrincipal::Endpoint(endpoint) => {
                validate_endpoint("principal.endpoint", endpoint)?;
                if endpoint != &self.publisher {
                    return Err(ContentPreKeySigningInputError::EndpointPublisherMismatch);
                }
                if self.pool_epoch != self.publisher_profile_version {
                    return Err(ContentPreKeySigningInputError::EndpointEpochProfileMismatch);
                }
            }
            ContentPreKeyPrincipal::RecoveryActor(actor) => {
                validate_actor("principal.recovery_actor", actor)?;
                if actor != &self.publisher.actor {
                    return Err(ContentPreKeySigningInputError::RecoveryPublisherMismatch);
                }
            }
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, ContentPreKeySigningInputError> {
        self.validate()?;
        Ok(self.canonical_bytes_unchecked()?)
    }

    pub fn signing_bytes(&self) -> Result<Vec<u8>, ContentPreKeySigningInputError> {
        let canonical = self.canonical_bytes()?;
        let mut signing = Vec::with_capacity(CONTENT_PREKEY_SIGNING_DOMAIN.len() + canonical.len());
        signing.extend_from_slice(CONTENT_PREKEY_SIGNING_DOMAIN);
        signing.extend_from_slice(&canonical);
        Ok(signing)
    }

    fn canonical_bytes_unchecked(&self) -> Result<Vec<u8>, CanonicalProtobufError> {
        let mut input = CanonicalMessageEncoder::new();
        input.singular_varint(1, u64::from(self.format_version))?;
        input.singular_varint(2, self.kind as u64)?;
        input.singular_bytes(3, self.key_id.as_bytes())?;
        input.singular_bytes(4, self.x25519_public_key.as_bytes())?;
        match &self.principal {
            ContentPreKeyPrincipal::Endpoint(endpoint) => {
                input.oneof_message(
                    5,
                    CONTENT_PREKEY_PRINCIPAL_ONEOF,
                    &canonical_endpoint(endpoint)?,
                )?;
            }
            ContentPreKeyPrincipal::RecoveryActor(actor) => {
                input.oneof_message(6, CONTENT_PREKEY_PRINCIPAL_ONEOF, &canonical_actor(actor)?)?;
            }
        }
        input.singular_varint(7, self.pool_epoch)?;
        input.singular_varint(8, self.expected_pool_epoch)?;
        input.singular_message(9, &canonical_endpoint(&self.publisher)?)?;
        input.singular_bytes(10, self.publisher_signing_key_id.as_bytes())?;
        input.singular_varint(11, self.publisher_profile_version)?;
        Ok(input.finish())
    }
}

pub fn validate_content_prekey_signing_input_canonical_bytes(
    input: &[u8],
) -> Result<(), CanonicalProtobufError> {
    validate_canonical_message(input, CONTENT_PREKEY_SIGNING_INPUT_RULES)
}

fn validate_actor(
    field: &'static str,
    actor: &ContentPreKeyActorRef,
) -> Result<(), ContentPreKeySigningInputError> {
    validate_canonical_string(field, &actor.ptid, MAX_CONTENT_PREKEY_ACTOR_PTID_BYTES)
}

fn validate_endpoint(
    field: &'static str,
    endpoint: &ContentPreKeyEndpoint,
) -> Result<(), ContentPreKeySigningInputError> {
    validate_actor(field, &endpoint.actor)?;
    validate_canonical_string(
        "device_id",
        &endpoint.device_id,
        MAX_CONTENT_PREKEY_DEVICE_ID_BYTES,
    )
}

fn validate_canonical_string(
    field: &'static str,
    value: &str,
    max_bytes: usize,
) -> Result<(), ContentPreKeySigningInputError> {
    if value.is_empty() || value.trim() != value || value.as_bytes().contains(&0) {
        return Err(ContentPreKeySigningInputError::InvalidField(field));
    }
    if value.len() > max_bytes {
        return Err(ContentPreKeySigningInputError::FieldTooLong(field));
    }
    Ok(())
}

fn validate_epoch(
    field: &'static str,
    value: u64,
    allow_zero: bool,
) -> Result<(), ContentPreKeySigningInputError> {
    if (!allow_zero && value == 0) || value > MAX_CONTENT_PREKEY_EPOCH {
        return Err(ContentPreKeySigningInputError::InvalidField(field));
    }
    Ok(())
}

fn canonical_actor(actor: &ContentPreKeyActorRef) -> Result<Vec<u8>, CanonicalProtobufError> {
    let mut encoded = CanonicalMessageEncoder::new();
    encoded.singular_bytes(2, actor.ptid.as_bytes())?;
    Ok(encoded.finish())
}

fn canonical_endpoint(endpoint: &ContentPreKeyEndpoint) -> Result<Vec<u8>, CanonicalProtobufError> {
    let mut encoded = CanonicalMessageEncoder::new();
    encoded.singular_message(1, &canonical_actor(&endpoint.actor)?)?;
    encoded.singular_bytes(2, endpoint.device_id.as_bytes())?;
    Ok(encoded.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    type SigningInputMutation = fn(&mut ContentPreKeySigningInput);

    const ENDPOINT_VECTOR_CANONICAL_HEX: &str = concat!(
        "080110011a17636f6e74656e742d7072656b65792d766563746f722d31",
        "22200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        "2a1c0a0c120a707469643a616c696365120c616c6963652d646576696365",
        "38074006",
        "4a1c0a0c120a707469643a616c696365120c616c6963652d646576696365",
        "5211616c6963652d7369676e696e672d6b65795807"
    );
    const ENDPOINT_VECTOR_SIGNING_HEX: &str = concat!(
        "70656572732d746f7563683a7365637572652d636f6e74656e743a7072656b65793a763100",
        "080110011a17636f6e74656e742d7072656b65792d766563746f722d31",
        "22200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        "2a1c0a0c120a707469643a616c696365120c616c6963652d646576696365",
        "38074006",
        "4a1c0a0c120a707469643a616c696365120c616c6963652d646576696365",
        "5211616c6963652d7369676e696e672d6b65795807"
    );
    const RECOVERY_VECTOR_CANONICAL_HEX: &str = concat!(
        "080110021a17636f6e74656e742d7072656b65792d766563746f722d31",
        "22200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        "320c120a707469643a616c696365",
        "38074006",
        "4a1c0a0c120a707469643a616c696365120c616c6963652d646576696365",
        "5211616c6963652d7369676e696e672d6b65795807"
    );

    #[test]
    fn derives_the_expected_x25519_public_key() {
        let private = ContentPreKeyPrivate::from_bytes([7; 32]);
        assert_eq!(
            private.public_key().as_bytes(),
            &[
                19, 190, 79, 234, 234, 242, 4, 199, 253, 51, 88, 252, 156, 0, 114, 24, 129, 209,
                116, 39, 129, 40, 34, 126, 198, 116, 243, 127, 127, 233, 123, 109,
            ]
        );
    }

    #[test]
    fn endpoint_signing_input_matches_the_shared_static_vector() {
        let input = endpoint_vector();

        assert_eq!(
            hex(&input.canonical_bytes().unwrap()),
            ENDPOINT_VECTOR_CANONICAL_HEX
        );
        assert_eq!(
            hex(&input.signing_bytes().unwrap()),
            ENDPOINT_VECTOR_SIGNING_HEX
        );
        validate_content_prekey_signing_input_canonical_bytes(&input.canonical_bytes().unwrap())
            .unwrap();
    }

    #[test]
    fn recovery_principal_uses_the_actor_oneof_branch() {
        let mut input = endpoint_vector();
        input.kind = ContentPreKeyKind::ActorRecovery;
        input.principal =
            ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new("ptid:alice"));

        assert_eq!(
            hex(&input.canonical_bytes().unwrap()),
            RECOVERY_VECTOR_CANONICAL_HEX
        );
    }

    #[test]
    fn every_signed_field_changes_the_canonical_projection() {
        let input = endpoint_vector();
        let expected = input.canonical_bytes_unchecked().unwrap();
        let mutations: [(&str, SigningInputMutation); 10] = [
            ("format_version", |value| value.format_version = 2),
            ("kind", |value| {
                value.kind = ContentPreKeyKind::ActorRecovery
            }),
            ("key_id", |value| value.key_id.push('x')),
            ("x25519_public_key", |value| {
                value.x25519_public_key = ContentPreKeyPublic::from_bytes([0x7f; 32])
            }),
            ("principal", |value| {
                value.principal =
                    ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new("ptid:alice"))
            }),
            ("pool_epoch", |value| value.pool_epoch = 8),
            ("expected_pool_epoch", |value| value.expected_pool_epoch = 7),
            ("publisher", |value| value.publisher.device_id.push('x')),
            ("publisher_signing_key_id", |value| {
                value.publisher_signing_key_id.push('x')
            }),
            ("publisher_profile_version", |value| {
                value.publisher_profile_version = 8
            }),
        ];

        for (field, mutate) in mutations {
            let mut mutated = input.clone();
            mutate(&mut mutated);
            assert_ne!(
                mutated.canonical_bytes_unchecked().unwrap(),
                expected,
                "{field} was omitted from the canonical signing input"
            );
        }
    }

    #[test]
    fn rejects_invalid_semantic_signing_inputs() {
        let mut input = endpoint_vector();
        input.format_version = 2;
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::UnsupportedFormatVersion(2))
        );

        let mut input = endpoint_vector();
        input.kind = ContentPreKeyKind::ActorRecovery;
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::KindPrincipalMismatch)
        );

        for key_id in [
            "",
            " content-prekey-vector-1",
            "content-prekey-vector-1 ",
            "content\0prekey",
        ] {
            let mut input = endpoint_vector();
            input.key_id = key_id.to_string();
            assert_eq!(
                input.validate(),
                Err(ContentPreKeySigningInputError::InvalidField("key_id"))
            );
        }

        let mut input = endpoint_vector();
        input.key_id = "k".repeat(MAX_CONTENT_PREKEY_KEY_ID_BYTES + 1);
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::FieldTooLong("key_id"))
        );

        let mut input = endpoint_vector();
        input.publisher_signing_key_id = "k".repeat(MAX_CONTENT_PREKEY_SIGNING_KEY_ID_BYTES + 1);
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::FieldTooLong(
                "publisher_signing_key_id"
            ))
        );

        let mut input = endpoint_vector();
        input.x25519_public_key = ContentPreKeyPublic::from_bytes([0; 32]);
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::InvalidField(
                "x25519_public_key"
            ))
        );

        let mut input = endpoint_vector();
        input.publisher.device_id = "other-device".to_string();
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::EndpointPublisherMismatch)
        );

        let mut input = endpoint_vector();
        input.pool_epoch = 8;
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::EndpointEpochProfileMismatch)
        );

        let mut input = endpoint_vector();
        input.kind = ContentPreKeyKind::ActorRecovery;
        input.principal =
            ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new("ptid:bob"));
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::RecoveryPublisherMismatch)
        );
    }

    #[test]
    fn enforces_epoch_and_profile_persistence_bounds() {
        let invalid = [
            ("pool_epoch", 0_u64),
            ("pool_epoch", MAX_CONTENT_PREKEY_EPOCH + 1),
            ("expected_pool_epoch", MAX_CONTENT_PREKEY_EPOCH + 1),
            ("publisher_profile_version", 0),
            ("publisher_profile_version", MAX_CONTENT_PREKEY_EPOCH + 1),
        ];
        for (field, value) in invalid {
            let mut input = endpoint_vector();
            match field {
                "pool_epoch" => input.pool_epoch = value,
                "expected_pool_epoch" => input.expected_pool_epoch = value,
                "publisher_profile_version" => input.publisher_profile_version = value,
                _ => unreachable!(),
            }
            assert_eq!(
                input.validate(),
                Err(ContentPreKeySigningInputError::InvalidField(field))
            );
        }

        let mut input = endpoint_vector();
        input.kind = ContentPreKeyKind::ActorRecovery;
        input.principal =
            ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new("ptid:alice"));
        input.pool_epoch = MAX_CONTENT_PREKEY_EPOCH;
        input.expected_pool_epoch = MAX_CONTENT_PREKEY_EPOCH;
        input.publisher_profile_version = MAX_CONTENT_PREKEY_EPOCH;
        input.validate().unwrap();

        input.expected_pool_epoch = 0;
        input.validate().unwrap();

        input.pool_epoch = 1;
        input.expected_pool_epoch = 2;
        assert_eq!(
            input.validate(),
            Err(ContentPreKeySigningInputError::ExpectedEpochAfterPoolEpoch)
        );
    }

    #[test]
    fn rejects_noncanonical_or_structurally_invalid_wire_inputs() {
        let cases = [
            (vec![0x60, 0x01], CanonicalProtobufError::UnknownField(12)),
            (
                vec![0x2a, 0x04, 0x0a, 0x02, 0x08, 0x01],
                CanonicalProtobufError::UnknownField(1),
            ),
            (vec![0x08, 0x00], CanonicalProtobufError::ExplicitDefault(1)),
            (
                vec![0x2a, 0x00, 0x32, 0x00],
                CanonicalProtobufError::DuplicateOneof(CONTENT_PREKEY_PRINCIPAL_ONEOF),
            ),
            (
                vec![0x10, 0x01, 0x08, 0x01],
                CanonicalProtobufError::NonCanonicalOrder,
            ),
            (
                vec![0x08, 0x81, 0x00],
                CanonicalProtobufError::NonMinimalVarint,
            ),
            (
                vec![0x08, 0x01, 0x08, 0x01],
                CanonicalProtobufError::DuplicateSingularField(1),
            ),
        ];

        for (wire, expected) in cases {
            assert_eq!(
                validate_content_prekey_signing_input_canonical_bytes(&wire),
                Err(expected)
            );
        }
    }

    fn endpoint_vector() -> ContentPreKeySigningInput {
        let endpoint = ContentPreKeyEndpoint::new("ptid:alice", "alice-device");
        ContentPreKeySigningInput {
            format_version: CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
            kind: ContentPreKeyKind::Endpoint,
            key_id: "content-prekey-vector-1".to_string(),
            x25519_public_key: ContentPreKeyPublic::from_bytes(std::array::from_fn(|index| {
                (index + 1) as u8
            })),
            principal: ContentPreKeyPrincipal::Endpoint(endpoint.clone()),
            pool_epoch: 7,
            expected_pool_epoch: 6,
            publisher: endpoint,
            publisher_signing_key_id: "alice-signing-key".to_string(),
            publisher_profile_version: 7,
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
