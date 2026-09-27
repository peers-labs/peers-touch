use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalCleanupResult {
    pub records_absent: bool,
    pub paths_absent: bool,
    pub keys_absent: bool,
    pub secure_physical_deletion_proven: bool,
}

impl LogicalCleanupResult {
    pub(crate) fn logical(records_absent: bool, paths_absent: bool, keys_absent: bool) -> Self {
        Self {
            records_absent,
            paths_absent,
            keys_absent,
            // Flash wear-leveling, snapshots, backups, and WAL copies are
            // outside the proof available to this runtime.
            secure_physical_deletion_proven: false,
        }
    }
}
