mod cache;
mod error;
pub mod evaluation;
pub mod failover;
pub mod identity;
pub mod origin;
pub mod origins;
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
pub use failover::{fetch_with_failover, FailoverSuccess, SnapshotFetch};
pub use identity::BuildIdentity;
pub use origins::{
    effective_origins, parse_baked_origins, snapshot_url, validate_baked_origins, BAKED_ENV,
    MAX_EFFECTIVE_ORIGINS,
};
pub use projection::{project_suggestions, select_release, Freshness, StationSuggestion};
pub use signature::{
    verify_snapshot, PublisherKeyring, VerifiedSnapshot, CLOCK_SKEW_MS, MAX_ENDPOINT_SEEDS,
    MAX_ENVELOPE_BYTES, MAX_RELEASES, MAX_SNAPSHOT_LIFETIME_MS, SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_SIGNATURE_DOMAIN,
};
