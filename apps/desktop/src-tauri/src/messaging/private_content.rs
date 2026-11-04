pub use messaging_core::codec::private_content::{
    decode_message_private_content, encode_message_private_content,
    encode_message_private_content_with_mentions,
    validate_attachment_plaintext_metadata, validate_message_private_content, MessageMentions,
    MESSAGE_MAX_ATTACHMENT_COUNT, MESSAGE_MAX_MENTIONS, MESSAGE_PRIVATE_CONTENT_FORMAT_VERSION,
};

pub use crate::model::chat::MessageMention;

/// Serialize the in-ciphertext mention set for the additive `mentions_json`
/// store column. Compact wire form: `{"all":bool,"m":[[ptid,offset,length,display]]}`.
/// Empty mention sets map to "" so existing/mention-free rows stay byte-clean.
pub fn encode_mentions_json(mentions: &MessageMentions) -> String {
    if mentions.mentions.is_empty() && !mentions.mention_all {
        return String::new();
    }
    let rows: Vec<serde_json::Value> = mentions
        .mentions
        .iter()
        .map(|m| serde_json::json!([
            m.actor_ptid,
            m.offset,
            m.length,
            m.display,
        ]))
        .collect();
    serde_json::json!({ "all": mentions.mention_all, "m": rows }).to_string()
}

/// Parse a `mentions_json` column value. Missing/empty/invalid => no mentions;
/// an invalid row must never block reading a message, so it degrades to empty.
pub fn decode_mentions_json(raw: &str) -> MessageMentions {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return MessageMentions::empty();
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return MessageMentions::empty();
    };
    let mention_all = value.get("all").and_then(|v| v.as_bool()).unwrap_or(false);
    let mentions = value
        .get("m")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let tuple = row.as_array()?;
                    Some(MessageMention {
                        actor_ptid: tuple.first()?.as_str()?.to_string(),
                        offset: tuple.get(1)?.as_u64()? as u32,
                        length: tuple.get(2)?.as_u64()? as u32,
                        display: tuple.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    MessageMentions { mentions, mention_all }
}

#[cfg(test)]
pub(super) fn test_attachment_metadata(
    attachment_id: &str,
) -> crate::model::chat::AttachmentPlaintextMetadata {
    use crate::model::chat::{
        AttachmentContentKind, AttachmentEncryptionSuite, AttachmentNonceStrategy,
        EncryptedObjectDescriptor,
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
            media_type: "application/octet-stream".to_string(),
            chunk_size: ATTACHMENT_CHUNK_SIZE,
            chunk_count: 1,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: ATTACHMENT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![Sha256::digest(&ciphertext).to_vec()],
        }),
        content_kind: AttachmentContentKind::File as i32,
        duration_ms: 0,
        voice_note: None,
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
            mentions: vec![],
            mention_all: false,
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
            mentions: vec![],
            mention_all: false,
        };
        assert!(validate_message_private_content(&duplicate).is_err());

        duplicate.attachments.pop();
        duplicate.attachments[0].base_nonce[11] = 1;
        assert!(validate_message_private_content(&duplicate).is_err());
    }
}
