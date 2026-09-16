pub mod peers_touch {
    pub mod model {
        #[allow(dead_code)]
        pub mod activity {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/peers_touch.model.activity.v1.rs"
                ));
            }
        }

        #[allow(dead_code)]
        pub mod actor {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.actor.v1.rs"));
            }
        }

        #[allow(dead_code)]
        pub mod common {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.common.v1.rs"));
            }
        }

        #[allow(dead_code)]
        pub mod error {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.error.v1.rs"));
            }
        }

        #[allow(dead_code)]
        pub mod secure_content {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/peers_touch.model.secure_content.v1.rs"
                ));
            }
        }

        #[allow(dead_code)]
        pub mod social {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/peers_touch.model.social.v1.rs"));
            }
        }
    }
}

#[allow(unused_imports)]
pub use peers_touch::model::{activity, actor, common, error, secure_content, social};

#[cfg(test)]
mod tests {
    use super::secure_content::v1::{
        viewer_content_key_envelope, EncryptedObjectDescriptor, EncryptedPayload,
        ObjectEncryptionSuite, ObjectNonceStrategy, PayloadEncryptionSuite,
        SecureContentOwnerDomain, ViewerContentKeyEnvelope,
    };
    use prost::Message;

    const ENCRYPTED_PAYLOAD_VECTOR: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../model/domain/secure_content/testdata/encrypted_payload.hex"
    ));
    const VIEWER_ENVELOPE_VECTOR: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../model/domain/secure_content/testdata/viewer_content_key_envelope.hex"
    ));
    const OBJECT_DESCRIPTOR_VECTOR: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../model/domain/secure_content/testdata/encrypted_object_descriptor.hex"
    ));

    fn decode_vector<MessageType>(encoded: &str) -> (MessageType, Vec<u8>)
    where
        MessageType: Message + Default,
    {
        let encoded = encoded.trim();
        assert_eq!(encoded.len() % 2, 0, "canonical vector must be valid hex");
        let bytes = (0..encoded.len())
            .step_by(2)
            .map(|index| {
                u8::from_str_radix(&encoded[index..index + 2], 16)
                    .expect("canonical vector must be valid hex")
            })
            .collect::<Vec<_>>();
        let message = MessageType::decode(bytes.as_slice()).expect("canonical vector must decode");
        (message, bytes)
    }

    #[test]
    fn decodes_canonical_encrypted_payload_vector() {
        let (payload, encoded) = decode_vector::<EncryptedPayload>(ENCRYPTED_PAYLOAD_VECTOR);
        let resource = payload.resource.as_ref().expect("resource must be present");

        assert_eq!(payload.format_version, 1);
        assert_eq!(
            resource.owner_domain,
            SecureContentOwnerDomain::Social as i32
        );
        assert_eq!(resource.content_id, "01HX");
        assert_eq!(resource.generation, 7);
        assert_eq!(payload.suite, PayloadEncryptionSuite::Aes256Gcm as i32);
        assert_eq!(payload.encode_to_vec(), encoded);
    }

    #[test]
    fn decodes_canonical_viewer_envelope_vector() {
        let (envelope, _) = decode_vector::<ViewerContentKeyEnvelope>(VIEWER_ENVELOPE_VECTOR);
        let binding = envelope.binding.as_ref().expect("binding must be present");

        assert_eq!(binding.format_version, 1);
        assert_eq!(binding.plan_id, "plan-1");
        assert_eq!(binding.resource.as_ref().unwrap().content_id, "01HX");
        assert_eq!(envelope.principal_epoch, 9);
        match envelope.recipient.as_ref() {
            Some(viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => {
                assert_eq!(endpoint.actor.as_ref().unwrap().ptid, "did:plc:bob");
                assert_eq!(endpoint.device_id, "device-b");
            }
            _ => panic!("canonical envelope must target an endpoint"),
        }
        let reencoded = envelope.encode_to_vec();
        let round_trip = ViewerContentKeyEnvelope::decode(reencoded.as_slice())
            .expect("re-encoded envelope must decode");
        assert_eq!(round_trip, envelope);
        assert_eq!(round_trip.encode_to_vec(), reencoded);
    }

    #[test]
    fn decodes_canonical_object_descriptor_vector() {
        let (descriptor, encoded) =
            decode_vector::<EncryptedObjectDescriptor>(OBJECT_DESCRIPTOR_VECTOR);
        let commitment = descriptor
            .commitment
            .as_ref()
            .expect("commitment must be present");

        assert_eq!(descriptor.object_id, "obj-1");
        assert_eq!(descriptor.storage_ref, "secure://obj-1");
        assert_eq!(commitment.ciphertext_size, 42);
        assert_eq!(commitment.chunk_size, 1_048_576);
        assert_eq!(
            commitment.encryption_suite,
            ObjectEncryptionSuite::Aes256GcmChunked as i32
        );
        assert_eq!(
            commitment.nonce_strategy,
            ObjectNonceStrategy::Counter32Be as i32
        );
        assert_eq!(descriptor.encode_to_vec(), encoded);
    }
}
