use crate::attachment::validate_chat_encrypted_object_descriptor;
use crate::proto::chat::{AttachmentPlaintextMetadata, MessagePrivateContent};
use prost::Message;
use secure_content_core::object::OBJECT_MAX_PLAINTEXT_SIZE;
use std::collections::HashSet;

pub const MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION: u32 = 1;
pub const MESSAGE_MAX_ATTACHMENT_COUNT: usize = 10;

pub fn encode_message_private_content(
    text: &str,
    attachments: &[AttachmentPlaintextMetadata],
) -> Result<Vec<u8>, String> {
    let content = MessagePrivateContent {
        format_version: MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
        text: text.to_string(),
        attachments: attachments.to_vec(),
    };
    validate_message_private_content(&content)?;
    Ok(content.encode_to_vec())
}

pub fn decode_message_private_content(bytes: &[u8]) -> Result<MessagePrivateContent, String> {
    let content = MessagePrivateContent::decode(bytes)
        .map_err(|_| "messaging private content protobuf is invalid".to_string())?;
    validate_message_private_content(&content)?;
    if content.encode_to_vec() != bytes {
        return Err("messaging private content protobuf is not canonical".to_string());
    }
    Ok(content)
}

pub fn validate_message_private_content(content: &MessagePrivateContent) -> Result<(), String> {
    if content.format_version != MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION {
        return Err("messaging private content format version is unsupported".to_string());
    }
    if content.text.is_empty() && content.attachments.is_empty() {
        return Err("messaging private content is empty".to_string());
    }
    if content.attachments.len() > MESSAGE_MAX_ATTACHMENT_COUNT {
        return Err("messaging private content attachment count exceeds policy".to_string());
    }

    let mut attachment_ids = HashSet::with_capacity(content.attachments.len());
    let mut previous_attachment_id: Option<&str> = None;
    let mut total_plaintext_size = 0_u64;
    for attachment in &content.attachments {
        validate_attachment_plaintext_metadata(attachment)?;
        if previous_attachment_id
            .is_some_and(|previous| previous >= attachment.attachment_id.as_str())
        {
            return Err(
                "messaging private content attachments are not strictly sorted".to_string(),
            );
        }
        if !attachment_ids.insert(attachment.attachment_id.as_str()) {
            return Err("messaging private content has duplicate attachment ID".to_string());
        }
        previous_attachment_id = Some(attachment.attachment_id.as_str());
        total_plaintext_size = total_plaintext_size
            .checked_add(attachment.plaintext_size)
            .ok_or_else(|| "messaging attachment aggregate size exceeds policy".to_string())?;
    }
    if total_plaintext_size > OBJECT_MAX_PLAINTEXT_SIZE {
        return Err("messaging attachment aggregate size exceeds policy".to_string());
    }
    Ok(())
}

pub fn validate_attachment_plaintext_metadata(
    attachment: &AttachmentPlaintextMetadata,
) -> Result<(), String> {
    let object = attachment
        .object
        .as_ref()
        .ok_or_else(|| "messaging attachment object descriptor is missing".to_string())?;
    if attachment.attachment_id.trim().is_empty()
        || attachment.filename.trim().is_empty()
        || attachment.filename.len() > 1024
        || attachment.mime_type.trim().is_empty()
        || attachment.mime_type.len() > 255
        || attachment.plaintext_size == 0
        || attachment.plaintext_size > OBJECT_MAX_PLAINTEXT_SIZE
        || attachment.plaintext_sha256.len() != 32
        || attachment.object_key.len() != 32
        || attachment.base_nonce.len() != 12
        || attachment.base_nonce[8..] != [0, 0, 0, 0]
    {
        return Err("messaging attachment private metadata is invalid".to_string());
    }
    validate_chat_encrypted_object_descriptor(object)?;
    let expected_chunk_count = attachment
        .plaintext_size
        .div_ceil(u64::from(object.chunk_size));
    if expected_chunk_count != u64::from(object.chunk_count)
        || object.ciphertext_size
            != attachment
                .plaintext_size
                .saturating_add(u64::from(object.tag_size) * u64::from(object.chunk_count))
    {
        return Err("messaging attachment private metadata does not match descriptor".to_string());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn test_attachment_metadata(attachment_id: &str) -> AttachmentPlaintextMetadata {
    use crate::proto::chat::{
        AttachmentEncryptionSuite, AttachmentNonceStrategy, EncryptedObjectDescriptor,
    };
    use secure_content_core::object::{OBJECT_CHUNK_SIZE, OBJECT_TAG_SIZE};
    use sha2::{Digest, Sha256};

    let plaintext_size = 7_u64;
    let ciphertext = vec![3_u8; plaintext_size as usize + OBJECT_TAG_SIZE as usize];
    AttachmentPlaintextMetadata {
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
            media_type: "application/octet-stream".to_string(),
            chunk_size: OBJECT_CHUNK_SIZE,
            chunk_count: 1,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![Sha256::digest(&ciphertext).to_vec()],
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
