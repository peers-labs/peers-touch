mod cache;
mod error;
pub mod evaluation;
pub mod identity;
pub mod origin;
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
pub use semver;

pub use error::XConfigError;
pub use evaluation::{
    directive_value_payload, evaluate_directives, registered_directive_key, EvaluatedValue,
    ResolvedDirective, TargetingContext,
};
pub use identity::BuildIdentity;
pub use projection::{project_suggestions, select_release, Freshness, StationSuggestion};
pub use signature::{
    verify_snapshot, PublisherKeyring, VerifiedSnapshot, CLOCK_SKEW_MS, MAX_ENDPOINT_SEEDS,
    MAX_ENVELOPE_BYTES, MAX_RELEASES, MAX_SNAPSHOT_LIFETIME_MS, SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_SIGNATURE_DOMAIN,
};
