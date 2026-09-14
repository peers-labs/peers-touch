pub use messaging_core::codec::private_content::{
    decode_message_private_content, encode_message_private_content,
    validate_attachment_plaintext_metadata, validate_message_private_content,
    MESSAGE_MAX_ATTACHMENT_COUNT, MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
};

#[cfg(test)]
pub(super) fn test_attachment_metadata(
    attachment_id: &str,
) -> crate::model::chat::AttachmentPlaintextMetadata {
    use crate::model::chat::{
        AttachmentEncryptionSuite, AttachmentNonceStrategy, EncryptedObjectDescriptor,
    };
    use secure_content_core::object::{
        OBJECT_CHUNK_SIZE as ATTACHMENT_CHUNK_SIZE, OBJECT_TAG_SIZE as ATTACHMENT_TAG_SIZE,
    };
    use sha2::{Digest, Sha256};

    let plaintext_size = 7_u64;
    let ciphertext = vec![3_u8; plaintext_size as usize + ATTACHMENT_TAG_SIZE as usize];
    crate::model::chat::AttachmentPlaintextMetadata {
        attachment_id: attachment_id.to_string(),
        filename: "report.txt".to_string(),
        mime_type: "text/plain".to_string(),
        plaintext_size,
        plaintext_sha256: Sha256::digest(b"content").to_vec(),
        object_key: vec![5; 32],
        base_nonce: vec![0; 12],
        object: Some(EncryptedObjectDescriptor {
            object_id: format!("object-{attachment_id}"),
            storage_ref: format!("opaque/{attachment_id}"),
            ciphertext_size: ciphertext.len() as u64,
            ciphertext_sha256: Sha256::digest(&ciphertext).to_vec(),
            media_type: "text/plain".to_string(),
            chunk_size: ATTACHMENT_CHUNK_SIZE,
            chunk_count: 1,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: ATTACHMENT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![Sha256::digest(&ciphertext).to_vec()],
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::chat::MessagePrivateContent;

    #[test]
    fn private_content_round_trips_canonical_protobuf() {
        let expected = MessagePrivateContent {
            format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
            text: "exact plaintext".to_string(),
            attachments: vec![test_attachment_metadata("attachment-1")],
        };
        let encoded =
            encode_message_private_content(&expected.text, &expected.attachments).unwrap();
        assert_eq!(decode_message_private_content(&encoded).unwrap(), expected);
    }

    #[test]
    fn private_content_rejects_raw_text_and_invalid_metadata() {
        assert!(decode_message_private_content(b"raw plaintext").is_err());

        let mut duplicate = MessagePrivateContent {
            format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
            text: String::new(),
            attachments: vec![
                test_attachment_metadata("attachment-1"),
                test_attachment_metadata("attachment-1"),
            ],
        };
        assert!(validate_message_private_content(&duplicate).is_err());

        duplicate.attachments.pop();
        duplicate.attachments[0].base_nonce[11] = 1;
        assert!(validate_message_private_content(&duplicate).is_err());
    }
}
