pub const ACTOR_HIDE_SCOPE_KIND: &str = "actor_hide";
pub const RETRACT_SCOPE_KIND: &str = "retract";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRedactionKind {
    HiddenForActor,
    Retracted,
}

impl MessageRedactionKind {
    pub fn tombstone_name(self) -> &'static str {
        match self {
            Self::HiddenForActor => "hidden_for_actor",
            Self::Retracted => "retracted",
        }
    }

    pub fn cleanup_scope_kind(self) -> &'static str {
        match self {
            Self::HiddenForActor => ACTOR_HIDE_SCOPE_KIND,
            Self::Retracted => RETRACT_SCOPE_KIND,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MessageRedactionInput<'a> {
    pub event_id: &'a str,
    pub conversation_id: &'a str,
    pub message_id: &'a str,
    pub kind: MessageRedactionKind,
    pub authority_sequence: i64,
    pub authority_event_hash: &'a [u8],
    pub applied_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageRedactionPlan {
    pub operation_id: String,
    pub scope_revision: String,
    pub conversation_id: String,
    pub message_id: String,
    pub kind: MessageRedactionKind,
    pub authority_sequence: i64,
    pub authority_event_hash: [u8; 32],
    pub applied_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MessageRedactionError {
    #[error("message redaction identity is incomplete")]
    IdentityIncomplete,
    #[error("message redaction authority sequence is invalid")]
    InvalidAuthoritySequence,
    #[error("message redaction authority hash is invalid")]
    InvalidAuthorityHash,
    #[error("message redaction timestamp is invalid")]
    InvalidTimestamp,
}

pub fn prepare_message_redaction(
    input: MessageRedactionInput<'_>,
) -> Result<MessageRedactionPlan, MessageRedactionError> {
    if input.event_id.trim().is_empty()
        || input.conversation_id.trim().is_empty()
        || input.message_id.trim().is_empty()
    {
        return Err(MessageRedactionError::IdentityIncomplete);
    }
    if input.authority_sequence <= 0 {
        return Err(MessageRedactionError::InvalidAuthoritySequence);
    }
    let authority_event_hash: [u8; 32] = input
        .authority_event_hash
        .try_into()
        .map_err(|_| MessageRedactionError::InvalidAuthorityHash)?;
    if authority_event_hash.iter().all(|byte| *byte == 0) {
        return Err(MessageRedactionError::InvalidAuthorityHash);
    }
    if input.applied_at_unix_ms <= 0 {
        return Err(MessageRedactionError::InvalidTimestamp);
    }

    Ok(MessageRedactionPlan {
        operation_id: format!(
            "{}:{}",
            input.kind.cleanup_scope_kind(),
            input.event_id.trim()
        ),
        scope_revision: format!(
            "authority:{}:{}",
            input.authority_sequence,
            hex::encode(authority_event_hash)
        ),
        conversation_id: input.conversation_id.trim().to_string(),
        message_id: input.message_id.trim().to_string(),
        kind: input.kind,
        authority_sequence: input.authority_sequence,
        authority_event_hash,
        applied_at_unix_ms: input.applied_at_unix_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: MessageRedactionKind) -> MessageRedactionInput<'static> {
        MessageRedactionInput {
            event_id: "event-redaction",
            conversation_id: "conversation-1",
            message_id: "message-1",
            kind,
            authority_sequence: 7,
            authority_event_hash: &[7; 32],
            applied_at_unix_ms: 100,
        }
    }

    #[test]
    fn actor_hide_plan_uses_canonical_names_and_authority_revision() {
        let plan = prepare_message_redaction(input(MessageRedactionKind::HiddenForActor)).unwrap();

        assert_eq!(plan.kind.tombstone_name(), "hidden_for_actor");
        assert_eq!(plan.kind.cleanup_scope_kind(), ACTOR_HIDE_SCOPE_KIND);
        assert_eq!(plan.operation_id, "actor_hide:event-redaction");
        assert_eq!(
            plan.scope_revision,
            format!("authority:7:{}", hex::encode([7; 32]))
        );
    }

    #[test]
    fn retract_plan_uses_distinct_tombstone_and_cleanup_scope() {
        let plan = prepare_message_redaction(input(MessageRedactionKind::Retracted)).unwrap();

        assert_eq!(plan.kind.tombstone_name(), "retracted");
        assert_eq!(plan.kind.cleanup_scope_kind(), RETRACT_SCOPE_KIND);
        assert_eq!(plan.operation_id, "retract:event-redaction");
    }

    #[test]
    fn rejects_incomplete_identity() {
        let mut invalid = input(MessageRedactionKind::Retracted);
        invalid.message_id = " ";

        assert_eq!(
            prepare_message_redaction(invalid),
            Err(MessageRedactionError::IdentityIncomplete)
        );
    }

    #[test]
    fn rejects_non_positive_authority_sequence() {
        let mut invalid = input(MessageRedactionKind::Retracted);
        invalid.authority_sequence = 0;

        assert_eq!(
            prepare_message_redaction(invalid),
            Err(MessageRedactionError::InvalidAuthoritySequence)
        );
    }

    #[test]
    fn rejects_invalid_or_zero_authority_hash() {
        let mut invalid_length = input(MessageRedactionKind::Retracted);
        invalid_length.authority_event_hash = &[1; 31];
        assert_eq!(
            prepare_message_redaction(invalid_length),
            Err(MessageRedactionError::InvalidAuthorityHash)
        );

        let mut zero = input(MessageRedactionKind::Retracted);
        zero.authority_event_hash = &[0; 32];
        assert_eq!(
            prepare_message_redaction(zero),
            Err(MessageRedactionError::InvalidAuthorityHash)
        );
    }

    #[test]
    fn rejects_non_positive_timestamp() {
        let mut invalid = input(MessageRedactionKind::Retracted);
        invalid.applied_at_unix_ms = 0;

        assert_eq!(
            prepare_message_redaction(invalid),
            Err(MessageRedactionError::InvalidTimestamp)
        );
    }
}
