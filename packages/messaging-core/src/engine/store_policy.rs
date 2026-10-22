use thiserror::Error;

pub const MESSAGING_STORE_SCHEMA_ID: &str = "messaging-store-v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessagingStoreMigrationSource {
    DesktopLegacy,
    MobileLegacy,
    PortableV1,
}

impl MessagingStoreMigrationSource {
    pub fn schema_id(self) -> &'static str {
        match self {
            Self::DesktopLegacy => "desktop-messaging-legacy",
            Self::MobileLegacy => "mobile-messaging-legacy",
            Self::PortableV1 => MESSAGING_STORE_SCHEMA_ID,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessagingStoreCutoverStep {
    NormalizeInFlightAsUnknownOutcome,
    ValidateAndMigrateRows,
    CommitMigrationMarker,
    ActivatePortableOwner,
    DeleteLegacyOwner,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessagingStoreMigrationMarker {
    pub source_schema_id: String,
    pub target_schema_id: String,
    pub migrated_row_count: u64,
    pub source_content_sha256: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessagingStoreCutoverPlan {
    pub marker: MessagingStoreMigrationMarker,
    pub steps: [MessagingStoreCutoverStep; 5],
}

impl MessagingStoreCutoverPlan {
    pub fn allows_dual_write(&self) -> bool {
        false
    }
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("{0}")]
pub struct MessagingStorePolicyError(pub String);

pub fn plan_store_cutover(
    source: MessagingStoreMigrationSource,
    admission_closed: bool,
    in_flight_row_count: u64,
    migrated_row_count: u64,
    source_content_sha256: [u8; 32],
) -> Result<MessagingStoreCutoverPlan, MessagingStorePolicyError> {
    if !admission_closed {
        return Err(policy_error(
            "messaging store migration requires closed command admission",
        ));
    }
    if source_content_sha256.iter().all(|byte| *byte == 0) {
        return Err(policy_error(
            "messaging store migration source digest is invalid",
        ));
    }
    if in_flight_row_count > migrated_row_count {
        return Err(policy_error(
            "messaging store migration in-flight count exceeds source rows",
        ));
    }

    Ok(MessagingStoreCutoverPlan {
        marker: MessagingStoreMigrationMarker {
            source_schema_id: source.schema_id().to_string(),
            target_schema_id: MESSAGING_STORE_SCHEMA_ID.to_string(),
            migrated_row_count,
            source_content_sha256,
        },
        steps: [
            MessagingStoreCutoverStep::NormalizeInFlightAsUnknownOutcome,
            MessagingStoreCutoverStep::ValidateAndMigrateRows,
            MessagingStoreCutoverStep::CommitMigrationMarker,
            MessagingStoreCutoverStep::ActivatePortableOwner,
            MessagingStoreCutoverStep::DeleteLegacyOwner,
        ],
    })
}

fn policy_error(detail: impl Into<String>) -> MessagingStorePolicyError {
    MessagingStorePolicyError(detail.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutover_is_single_transaction_owner_activation_without_dual_write() {
        let plan = plan_store_cutover(
            MessagingStoreMigrationSource::DesktopLegacy,
            true,
            3,
            17,
            [7; 32],
        )
        .unwrap();

        assert_eq!(plan.marker.target_schema_id, MESSAGING_STORE_SCHEMA_ID);
        assert_eq!(
            plan.steps,
            [
                MessagingStoreCutoverStep::NormalizeInFlightAsUnknownOutcome,
                MessagingStoreCutoverStep::ValidateAndMigrateRows,
                MessagingStoreCutoverStep::CommitMigrationMarker,
                MessagingStoreCutoverStep::ActivatePortableOwner,
                MessagingStoreCutoverStep::DeleteLegacyOwner,
            ]
        );
        assert!(!plan.allows_dual_write());
    }

    #[test]
    fn cutover_fails_while_legacy_admission_is_open() {
        assert!(plan_store_cutover(
            MessagingStoreMigrationSource::MobileLegacy,
            false,
            0,
            1,
            [1; 32],
        )
        .is_err());
    }

    #[test]
    fn cutover_rejects_invalid_digest_or_impossible_counts() {
        assert!(plan_store_cutover(
            MessagingStoreMigrationSource::MobileLegacy,
            true,
            0,
            1,
            [0; 32],
        )
        .is_err());
        assert!(plan_store_cutover(
            MessagingStoreMigrationSource::MobileLegacy,
            true,
            2,
            1,
            [1; 32],
        )
        .is_err());
    }
}
