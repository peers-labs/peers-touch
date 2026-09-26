pub mod cache;
pub mod retention;

use crate::proto::chat::{
    ChatStorageErrorCode, ChatStorageMeasurementIssue, ChatStorageScope, ChatStorageSnapshot,
    ChatStorageSnapshotStatus, ConversationStorageUsage,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalStorageClass {
    System,
    Media,
    Cache,
    Protected,
}

impl PhysicalStorageClass {
    fn priority(self) -> u8 {
        match self {
            Self::System => 4,
            Self::Protected => 3,
            Self::Media => 2,
            Self::Cache => 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhysicalStoragePath {
    pub path: PathBuf,
    pub class: PhysicalStorageClass,
    pub required: bool,
}

impl PhysicalStoragePath {
    pub fn required(path: impl Into<PathBuf>, class: PhysicalStorageClass) -> Self {
        Self {
            path: path.into(),
            class,
            required: true,
        }
    }

    pub fn optional(path: impl Into<PathBuf>, class: PhysicalStorageClass) -> Self {
        Self {
            path: path.into(),
            class,
            required: false,
        }
    }
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
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum FileIdentity {
    #[cfg(unix)]
    Unix { device: u64, inode: u64 },
    #[cfg(not(unix))]
    Canonical(PathBuf),
}

#[derive(Debug, Clone, Copy)]
struct CountedFile {
    bytes: u64,
    class: PhysicalStorageClass,
}

pub fn measure_storage(
    mut input: StorageAccountingInput,
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

    let mut files = HashMap::<FileIdentity, CountedFile>::new();
    let mut issues = Vec::new();
    for entry in &input.physical_paths {
        collect_path(entry, &mut files, &mut issues);
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
        status: if issues.is_empty() {
            ChatStorageSnapshotStatus::Complete as i32
        } else {
            ChatStorageSnapshotStatus::Partial as i32
        },
        issues,
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

fn collect_path(
    entry: &PhysicalStoragePath,
    files: &mut HashMap<FileIdentity, CountedFile>,
    issues: &mut Vec<ChatStorageMeasurementIssue>,
) {
    let metadata = match fs::symlink_metadata(&entry.path) {
        Ok(metadata) => metadata,
        Err(error) if !entry.required && error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            issues.push(measurement_issue(entry.class, error.to_string()));
            return;
        }
    };
    if metadata.file_type().is_symlink() {
        issues.push(measurement_issue(
            entry.class,
            "symbolic links are outside the managed storage boundary".to_string(),
        ));
        return;
    }
    if metadata.is_file() {
        count_file(&entry.path, &metadata, entry.class, files, issues);
        return;
    }
    if !metadata.is_dir() {
        return;
    }

    let mut pending = vec![entry.path.clone()];
    let mut visited_directories = HashSet::new();
    while let Some(directory) = pending.pop() {
        let canonical = match fs::canonicalize(&directory) {
            Ok(path) => path,
            Err(error) => {
                issues.push(measurement_issue(entry.class, error.to_string()));
                continue;
            }
        };
        if !visited_directories.insert(canonical) {
            continue;
        }
        let children = match fs::read_dir(&directory) {
            Ok(children) => children,
            Err(error) => {
                issues.push(measurement_issue(entry.class, error.to_string()));
                continue;
            }
        };
        for child in children {
            let child = match child {
                Ok(child) => child,
                Err(error) => {
                    issues.push(measurement_issue(entry.class, error.to_string()));
                    continue;
                }
            };
            let path = child.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    issues.push(measurement_issue(entry.class, error.to_string()));
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                issues.push(measurement_issue(
                    entry.class,
                    "symbolic links are outside the managed storage boundary".to_string(),
                ));
            } else if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                count_file(&path, &metadata, entry.class, files, issues);
            }
        }
    }
}

fn count_file(
    path: &Path,
    metadata: &fs::Metadata,
    class: PhysicalStorageClass,
    files: &mut HashMap<FileIdentity, CountedFile>,
    issues: &mut Vec<ChatStorageMeasurementIssue>,
) {
    let identity = match file_identity(path, metadata) {
        Ok(identity) => identity,
        Err(error) => {
            issues.push(measurement_issue(class, error.to_string()));
            return;
        }
    };
    files
        .entry(identity)
        .and_modify(|current| {
            if class.priority() > current.class.priority() {
                current.class = class;
            }
        })
        .or_insert(CountedFile {
            bytes: metadata.len(),
            class,
        });
}

#[cfg(unix)]
fn file_identity(_path: &Path, metadata: &fs::Metadata) -> std::io::Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    Ok(FileIdentity::Unix {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn file_identity(path: &Path, _metadata: &fs::Metadata) -> std::io::Result<FileIdentity> {
    fs::canonicalize(path).map(FileIdentity::Canonical)
}

fn measurement_issue(class: PhysicalStorageClass, detail: String) -> ChatStorageMeasurementIssue {
    ChatStorageMeasurementIssue {
        code: ChatStorageErrorCode::MeasurementPartial as i32,
        source: match class {
            PhysicalStorageClass::System => "system",
            PhysicalStorageClass::Media => "media",
            PhysicalStorageClass::Cache => "cache",
            PhysicalStorageClass::Protected => "protected",
        }
        .to_string(),
        detail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("peers-touch-storage-{name}-{}", ulid::Ulid::new()))
    }

    fn write_bytes(path: &Path, count: usize) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let mut file = File::create(path).expect("create file");
        file.write_all(&vec![7_u8; count]).expect("write file");
    }

    fn input(root: &Path) -> StorageAccountingInput {
        StorageAccountingInput {
            scope: ChatStorageScope {
                station_peer_id: "station-one".to_string(),
                actor_ptid: "ptid:v1:actor:peers:p:alice:fingerprint".to_string(),
                device_id: "device-one".to_string(),
            },
            revision: "scope-7".to_string(),
            measured_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_millis() as i64,
            physical_paths: vec![
                PhysicalStoragePath::required(root.join("chat.db"), PhysicalStorageClass::System),
                PhysicalStoragePath::optional(
                    root.join("chat.db-wal"),
                    PhysicalStorageClass::System,
                ),
                PhysicalStoragePath::required(root.join("cache"), PhysicalStorageClass::Cache),
                PhysicalStoragePath::required(
                    root.join("cache/media-one"),
                    PhysicalStorageClass::Media,
                ),
                PhysicalStoragePath::required(
                    root.join("sources"),
                    PhysicalStorageClass::Protected,
                ),
            ],
            conversations: vec![
                ConversationLogicalUsage {
                    conversation_id: "conversation-small".to_string(),
                    conversation_name: "Small".to_string(),
                    conversation_kind: 1,
                    message_bytes: 8,
                    media_bytes: 2,
                    reclaimable_bytes: 0,
                    last_activity_unix_ms: 10,
                },
                ConversationLogicalUsage {
                    conversation_id: "conversation-large".to_string(),
                    conversation_name: "Large".to_string(),
                    conversation_kind: 2,
                    message_bytes: 12,
                    media_bytes: 30,
                    reclaimable_bytes: 4,
                    last_activity_unix_ms: 20,
                },
            ],
        }
    }

    #[test]
    fn measures_physical_files_once_and_sorts_conversations_by_usage() {
        let root = test_root("complete");
        write_bytes(&root.join("chat.db"), 11);
        write_bytes(&root.join("cache/media-one"), 13);
        write_bytes(&root.join("cache/other"), 17);
        write_bytes(&root.join("sources/draft"), 19);

        let snapshot = measure_storage(input(&root)).expect("measure");

        assert_eq!(snapshot.physical_total_bytes, 60);
        assert_eq!(snapshot.system_bytes, 11);
        assert_eq!(snapshot.media_bytes, 32);
        assert_eq!(snapshot.cache_bytes, 17);
        assert_eq!(snapshot.protected_bytes, 19);
        assert_eq!(snapshot.message_bytes, 20);
        assert_eq!(snapshot.reclaimable_bytes, 21);
        assert_eq!(snapshot.status, ChatStorageSnapshotStatus::Complete as i32);
        assert_eq!(
            snapshot.conversations[0].conversation_id,
            "conversation-large"
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn deduplicates_hard_linked_managed_files_by_inode() {
        let root = test_root("hard-link");
        write_bytes(&root.join("chat.db"), 5);
        write_bytes(&root.join("cache/media-one"), 23);
        fs::create_dir_all(root.join("sources")).expect("create sources");
        fs::hard_link(
            root.join("cache/media-one"),
            root.join("sources/media-one-link"),
        )
        .expect("hard link");

        let snapshot = measure_storage(input(&root)).expect("measure");

        assert_eq!(snapshot.physical_total_bytes, 28);
        assert_eq!(snapshot.protected_bytes, 23);
        assert_eq!(snapshot.cache_bytes, 0);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_partial_instead_of_fabricating_a_zero_snapshot() {
        let root = test_root("partial");
        write_bytes(&root.join("chat.db"), 7);

        let mut input = input(&root);
        input.physical_paths = vec![
            PhysicalStoragePath::required(root.join("chat.db"), PhysicalStorageClass::System),
            PhysicalStoragePath::required(root.join("missing"), PhysicalStorageClass::Cache),
        ];
        let snapshot = measure_storage(input).expect("measure");

        assert_eq!(snapshot.physical_total_bytes, 7);
        assert_eq!(snapshot.status, ChatStorageSnapshotStatus::Partial as i32);
        assert_eq!(snapshot.issues.len(), 1);
        fs::remove_dir_all(root).expect("cleanup");
    }
}
