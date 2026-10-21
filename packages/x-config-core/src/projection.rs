use crate::proto::{ClientArchitecture, ClientPlatform, EndpointSeedKind, ReleaseDescriptor};
use crate::signature::{timestamp_millis, VerifiedSnapshot};
use prost::Message;
use semver::Version;
use station_trust::proto::{
    PublicEndpointConnectionMaterial, PublicStationAdvertisementStatement,
    SignedPublicStationAdvertisement,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Freshness {
    Current,
    Stale,
    Embedded,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StationSuggestion {
    pub seed_id: String,
    pub kind: EndpointSeedKind,
    pub display_name: String,
    pub connection_material: PublicEndpointConnectionMaterial,
    pub station_advertisement: Option<SignedPublicStationAdvertisement>,
    pub regions: Vec<String>,
    pub freshness: Freshness,
    pub actionable: bool,
    pub source_sequence: u64,
}

pub fn project_suggestions(
    snapshot: &VerifiedSnapshot,
    now_unix_ms: i64,
    source_freshness: Freshness,
) -> Vec<StationSuggestion> {
    snapshot
        .statement
        .endpoint_seeds
        .iter()
        .filter_map(|seed| {
            let kind = EndpointSeedKind::try_from(seed.kind).ok()?;
            let material = seed.connection_material.clone()?;
            let available_from = seed
                .available_from
                .as_ref()
                .and_then(|value| timestamp_millis(Some(value)).ok())
                .unwrap_or(material.issued_at_unix_ms);
            let available_until = seed
                .available_until
                .as_ref()
                .and_then(|value| timestamp_millis(Some(value)).ok())
                .unwrap_or(material.expires_at_unix_ms);
            let consent_expires_at =
                seed.station_advertisement
                    .as_ref()
                    .and_then(|advertisement| {
                        PublicStationAdvertisementStatement::decode(
                            advertisement.statement_bytes.as_slice(),
                        )
                        .ok()
                        .map(|statement| statement.expires_at_unix_ms)
                    });
            let actionable = source_freshness != Freshness::Stale
                && now_unix_ms < snapshot.expires_at_unix_ms
                && now_unix_ms >= available_from
                && now_unix_ms < available_until
                && now_unix_ms < material.expires_at_unix_ms
                && consent_expires_at.is_none_or(|expires| now_unix_ms < expires);
            Some(StationSuggestion {
                seed_id: seed.seed_id.clone(),
                kind,
                display_name: seed.display_name.clone(),
                connection_material: material,
                station_advertisement: seed.station_advertisement.clone(),
                regions: seed.regions.clone(),
                freshness: if now_unix_ms >= snapshot.expires_at_unix_ms {
                    Freshness::Stale
                } else {
                    source_freshness
                },
                actionable,
                source_sequence: snapshot.statement.sequence,
            })
        })
        .collect()
}

pub fn select_release(
    snapshot: &VerifiedSnapshot,
    platform: ClientPlatform,
    architecture: ClientArchitecture,
    current_version: &str,
    now_unix_ms: i64,
) -> Option<ReleaseDescriptor> {
    if now_unix_ms >= snapshot.expires_at_unix_ms {
        return None;
    }
    let current = Version::parse(current_version).ok()?;
    snapshot
        .statement
        .releases
        .iter()
        .filter(|release| {
            let release_platform = ClientPlatform::try_from(release.platform).ok();
            let release_architecture = ClientArchitecture::try_from(release.architecture).ok();
            release_platform == Some(platform)
                && matches!(
                    release_architecture,
                    Some(value)
                        if value == architecture
                            || value == ClientArchitecture::Universal
                )
                && Version::parse(&release.minimum_supported_version)
                    .is_ok_and(|minimum| current >= minimum)
                && Version::parse(&release.version).is_ok_and(|version| version > current)
        })
        .max_by(|left, right| {
            let left_version = Version::parse(&left.version).expect("validated release");
            let right_version = Version::parse(&right.version).expect("validated release");
            left_version.cmp(&right_version)
        })
        .cloned()
}
