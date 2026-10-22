pub mod cache;
pub mod conversation_clear;
pub mod redaction;
pub mod retention;

use crate::proto::chat::{
    ChatStorageMeasurementIssue, ChatStorageScope, ChatStorageSnapshot, ChatStorageSnapshotStatus,
    ConversationStorageUsage,
};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalStorageClass {
    System,
    Media,
    Cache,
    Protected,
}

impl PhysicalStorageClass {
    pub fn priority(self) -> u8 {
        match self {
            Self::System => 4,
            Self::Protected => 3,
            Self::Media => 2,
            Self::Cache => 1,
        }
    }

    pub fn source(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Media => "media",
            Self::Cache => "cache",
            Self::Protected => "protected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhysicalStoragePath {
    pub path_ref: String,
    pub class: PhysicalStorageClass,
    pub required: bool,
}

impl PhysicalStoragePath {
    pub fn required(path_ref: impl Into<String>, class: PhysicalStorageClass) -> Self {
        Self {
            path_ref: path_ref.into(),
            class,
            required: true,
        }
    }

    pub fn optional(path_ref: impl Into<String>, class: PhysicalStorageClass) -> Self {
        Self {
            path_ref: path_ref.into(),
            class,
            required: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhysicalStorageFile {
    pub physical_identity: String,
    pub bytes: u64,
    pub class: PhysicalStorageClass,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PhysicalStorageMeasurement {
    pub files: Vec<PhysicalStorageFile>,
    pub issues: Vec<ChatStorageMeasurementIssue>,
}

pub trait StorageMeasurementPort: Send + Sync {
    fn measure(&self, paths: &[PhysicalStoragePath]) -> Result<PhysicalStorageMeasurement, String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationLogicalUsage {
    pub conversation_id: String,
    pub conversation_name: String,
    pub conversation_kind: i32,
    pub message_bytes: u64,
    pub media_bytes: u64,
    pub reclaimable_bytes: u64,
    pub last_activity_unix_ms: i64,
}

#[derive(Debug, Clone)]
pub struct StorageAccountingInput {
    pub scope: ChatStorageScope,
    pub revision: String,
    pub measured_at_unix_ms: i64,
    pub physical_paths: Vec<PhysicalStoragePath>,
    pub conversations: Vec<ConversationLogicalUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StorageAccountingError {
    #[error("chat storage scope is incomplete")]
    ScopeIncomplete,
    #[error("chat storage scope revision is empty")]
    RevisionEmpty,
    #[error("chat storage measurement timestamp is invalid")]
    InvalidTimestamp,
    #[error("chat storage measurement port failed: {0}")]
    Measurement(String),
}

#[derive(Debug, Clone, Copy)]
struct CountedFile {
    bytes: u64,
    class: PhysicalStorageClass,
}

pub fn measure_storage(
    mut input: StorageAccountingInput,
    measurement_port: &dyn StorageMeasurementPort,
) -> Result<ChatStorageSnapshot, StorageAccountingError> {
    validate_input(&input)?;

    input.conversations.sort_by(|left, right| {
        right
            .message_bytes
            .saturating_add(right.media_bytes)
            .cmp(&left.message_bytes.saturating_add(left.media_bytes))
            .then_with(|| right.last_activity_unix_ms.cmp(&left.last_activity_unix_ms))
            .then_with(|| left.conversation_id.cmp(&right.conversation_id))
    });

    let measurement = measurement_port
        .measure(&input.physical_paths)
        .map_err(StorageAccountingError::Measurement)?;
    let mut files = HashMap::<String, CountedFile>::new();
    for file in measurement.files {
        files
            .entry(file.physical_identity)
            .and_modify(|current| {
                if file.class.priority() > current.class.priority() {
                    current.class = file.class;
                }
            })
            .or_insert(CountedFile {
                bytes: file.bytes,
                class: file.class,
            });
    }

    let mut physical_total_bytes = 0_u64;
    let mut media_physical_bytes = 0_u64;
    let mut cache_bytes = 0_u64;
    let mut system_bytes = 0_u64;
    let mut protected_bytes = 0_u64;
    for counted in files.values() {
        physical_total_bytes = physical_total_bytes.saturating_add(counted.bytes);
        match counted.class {
            PhysicalStorageClass::System => {
                system_bytes = system_bytes.saturating_add(counted.bytes)
            }
            PhysicalStorageClass::Media => {
                media_physical_bytes = media_physical_bytes.saturating_add(counted.bytes)
            }
            PhysicalStorageClass::Cache => cache_bytes = cache_bytes.saturating_add(counted.bytes),
            PhysicalStorageClass::Protected => {
                protected_bytes = protected_bytes.saturating_add(counted.bytes)
            }
        }
    }

    let conversations = input
        .conversations
        .into_iter()
        .map(|usage| ConversationStorageUsage {
            conversation_id: usage.conversation_id,
            message_bytes: usage.message_bytes,
            media_bytes: usage.media_bytes,
            reclaimable_bytes: usage.reclaimable_bytes,
            last_activity_unix_ms: usage.last_activity_unix_ms,
            conversation_name: usage.conversation_name,
            conversation_kind: usage.conversation_kind,
        })
        .collect::<Vec<_>>();
    let message_bytes = conversations.iter().fold(0_u64, |total, usage| {
        total.saturating_add(usage.message_bytes)
    });
    let logical_media_bytes = conversations.iter().fold(0_u64, |total, usage| {
        total.saturating_add(usage.media_bytes)
    });
    let conversation_reclaimable_bytes = conversations.iter().fold(0_u64, |total, usage| {
        total.saturating_add(usage.reclaimable_bytes)
    });

    Ok(ChatStorageSnapshot {
        scope: Some(input.scope),
        revision: input.revision,
        measured_at_unix_ms: input.measured_at_unix_ms,
        physical_total_bytes,
        message_bytes,
        media_bytes: logical_media_bytes.max(media_physical_bytes),
        cache_bytes,
        system_bytes,
        reclaimable_bytes: cache_bytes.saturating_add(conversation_reclaimable_bytes),
        conversations,
        protected_bytes,
        status: if measurement.issues.is_empty() {
            ChatStorageSnapshotStatus::Complete as i32
        } else {
            ChatStorageSnapshotStatus::Partial as i32
        },
        issues: measurement.issues,
        retention_policy: None,
    })
}

fn validate_input(input: &StorageAccountingInput) -> Result<(), StorageAccountingError> {
    if input.scope.station_peer_id.trim().is_empty()
        || input.scope.actor_ptid.trim().is_empty()
        || input.scope.device_id.trim().is_empty()
    {
        return Err(StorageAccountingError::ScopeIncomplete);
    }
    if input.revision.trim().is_empty() {
        return Err(StorageAccountingError::RevisionEmpty);
    }
    if input.measured_at_unix_ms <= 0 {
        return Err(StorageAccountingError::InvalidTimestamp);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::chat::{ChatStorageErrorCode, ChatStorageMeasurementIssue};

    struct Measurement;

    impl StorageMeasurementPort for Measurement {
        fn measure(
            &self,
            _paths: &[PhysicalStoragePath],
        ) -> Result<PhysicalStorageMeasurement, String> {
            Ok(PhysicalStorageMeasurement {
                files: vec![
                    PhysicalStorageFile {
                        physical_identity: "db".to_string(),
                        bytes: 11,
                        class: PhysicalStorageClass::System,
                    },
                    PhysicalStorageFile {
                        physical_identity: "media".to_string(),
                        bytes: 13,
                        class: PhysicalStorageClass::Cache,
                    },
                    PhysicalStorageFile {
                        physical_identity: "media".to_string(),
                        bytes: 13,
                        class: PhysicalStorageClass::Protected,
                    },
                ],
                issues: Vec::new(),
            })
        }
    }

    fn input() -> StorageAccountingInput {
        StorageAccountingInput {
            scope: ChatStorageScope {
                station_peer_id: "station-one".to_string(),
                actor_ptid: "ptid:alice".to_string(),
                device_id: "device-one".to_string(),
            },
            revision: "scope-7".to_string(),
            measured_at_unix_ms: 10,
            physical_paths: vec![PhysicalStoragePath::required(
                "chat.db",
                PhysicalStorageClass::System,
            )],
            conversations: vec![ConversationLogicalUsage {
                conversation_id: "conversation-1".to_string(),
                conversation_name: "Conversation".to_string(),
                conversation_kind: 1,
                message_bytes: 8,
                media_bytes: 2,
                reclaimable_bytes: 3,
                last_activity_unix_ms: 9,
            }],
        }
    }

    #[test]
    fn accounting_deduplicates_host_facts_and_applies_class_priority() {
        let snapshot = measure_storage(input(), &Measurement).unwrap();

        assert_eq!(snapshot.physical_total_bytes, 24);
        assert_eq!(snapshot.system_bytes, 11);
        assert_eq!(snapshot.protected_bytes, 13);
        assert_eq!(snapshot.cache_bytes, 0);
        assert_eq!(snapshot.message_bytes, 8);
        assert_eq!(snapshot.reclaimable_bytes, 3);
        assert_eq!(snapshot.status, ChatStorageSnapshotStatus::Complete as i32);
    }

    #[test]
    fn host_measurement_issues_produce_a_partial_snapshot() {
        struct Partial;
        impl StorageMeasurementPort for Partial {
            fn measure(
                &self,
                _paths: &[PhysicalStoragePath],
            ) -> Result<PhysicalStorageMeasurement, String> {
                Ok(PhysicalStorageMeasurement {
                    files: Vec::new(),
                    issues: vec![ChatStorageMeasurementIssue {
                        code: ChatStorageErrorCode::MeasurementPartial as i32,
                        source: "cache".to_string(),
                        detail: "unavailable".to_string(),
                    }],
                })
            }
        }

        let snapshot = measure_storage(input(), &Partial).unwrap();
        assert_eq!(snapshot.status, ChatStorageSnapshotStatus::Partial as i32);
        assert_eq!(snapshot.issues.len(), 1);
    }
}
