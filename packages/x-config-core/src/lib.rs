mod cache;
mod error;
mod projection;
mod signature;

pub mod proto {
    include!(concat!(
        env!("OUT_DIR"),
        "/peers_touch.model.x_config.v1.rs"
    ));
}

pub use cache::{
    AcceptOutcome, SecureWatermark, SecureWatermarkStore, SnapshotCacheKey, SnapshotCacheStore,
    SnapshotCoordinator, SnapshotOrigin,
};
pub use error::XConfigError;
pub use projection::{project_suggestions, select_release, Freshness, StationSuggestion};
pub use signature::{
    verify_snapshot, PublisherKeyring, VerifiedSnapshot, CLOCK_SKEW_MS, MAX_ENDPOINT_SEEDS,
    MAX_ENVELOPE_BYTES, MAX_RELEASES, MAX_SNAPSHOT_LIFETIME_MS, SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_SIGNATURE_DOMAIN,
};
