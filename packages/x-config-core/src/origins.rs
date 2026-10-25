//! Effective snapshot origin resolution (XCFG-D06).
//!
//! Three origin classes merge into the ordered fetch list:
//!
//! 1. `override_origin` — development `PEERS_X_CONFIG_URL`, first when present;
//! 2. `advertised` — origins carried by the last signed, accepted snapshot;
//! 3. `baked` — package-time bootstrap anchors, always retained at the tail.
//!
//! Every entry passes the same admission policy as [`crate::origin`]. Invalid
//! entries are dropped rather than downgrading transport; an explicitly
//! invalid override is surfaced by the caller before reaching this merge.

use url::Url;

use crate::origin::valid_snapshot_origin;

/// Maximum origins tried in one refresh round.
pub const MAX_EFFECTIVE_ORIGINS: usize = 8;
/// Comma-separated compile-time list emitted by packaging.
pub const BAKED_ENV: &str = "PT_DIST_X_CONFIG_URLS";

fn admitted(raw: &str) -> Option<String> {
    // Origins are base URLs: accept only an empty path or a single bare
    // root slash, which is stripped so equal origins compare equal and the
    // persisted form matches signed Go-published statements (no path).
    let trimmed = raw.trim();
    let normalized = trimmed.strip_suffix('/').unwrap_or(trimmed);
    let parsed = Url::parse(normalized).ok()?;
    // The url crate renders a missing path as "/" for special schemes; any
    // other path means the entry carried a sub-path and must be rejected.
    (valid_snapshot_origin(&parsed) && parsed.path() == "/").then(|| normalized.to_string())
}

/// Parse the comma-separated baked bootstrap list.
pub fn parse_baked_origins(raw: Option<&str>) -> Vec<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.split(',').filter_map(admitted).collect())
        .unwrap_or_default()
}

/// Strict parse for compile-time packaging input: any non-empty entry that
/// fails admission is a build error rather than a silently dropped anchor.
pub fn validate_baked_origins(raw: &str) -> Result<Vec<String>, ()> {
    let entries: Vec<&str> = raw
        .trim()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let mut origins = Vec::with_capacity(entries.len());
    for entry in entries {
        match admitted(entry) {
            Some(origin) if !origins.contains(&origin) => origins.push(origin),
            Some(_) => {}
            None => return Err(()),
        }
    }
    Ok(origins)
}

/// Build the deduplicated, policy-admitted fetch list preserving first
/// occurrence order: override, advertised, then baked anchors.
pub fn effective_origins(
    override_origin: Option<&str>,
    advertised: &[String],
    baked: &[String],
) -> Vec<String> {
    let mut origins: Vec<String> = Vec::new();
    let mut push = |raw: &str| {
        if origins.len() >= MAX_EFFECTIVE_ORIGINS {
            return;
        }
        if let Some(origin) = admitted(raw) {
            if !origins.contains(&origin) {
                origins.push(origin);
            }
        }
    };
    if let Some(raw) = override_origin.map(str::trim).filter(|raw| !raw.is_empty()) {
        push(raw);
    }
    advertised.iter().for_each(|raw| push(raw));
    baked.iter().for_each(|raw| push(raw));
    origins
}

/// Build the channel-scoped snapshot URL for a validated base origin.
pub fn snapshot_url(base: &str, channel: &str) -> Option<Url> {
    let mut url = Url::parse(base.trim()).ok()?;
    if !valid_snapshot_origin(&url) {
        return None;
    }
    url.set_path(&format!("/channels/{channel}/latest.pb"));
    url.set_query(None);
    url.set_fragment(None);
    Some(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_order_is_override_advertised_baked() {
        let advertised = vec![
            "https://mirror-a.example.test".to_string(),
            "https://mirror-b.example.test".to_string(),
        ];
        let baked = vec![
            "https://bootstrap.example.test".to_string(),
            "http://10.37.221.38:18082".to_string(),
        ];
        let origins = effective_origins(Some("http://127.0.0.1:9000"), &advertised, &baked);
        assert_eq!(
            origins,
            vec![
                "http://127.0.0.1:9000",
                "https://mirror-a.example.test",
                "https://mirror-b.example.test",
                "https://bootstrap.example.test",
                "http://10.37.221.38:18082",
            ]
        );
    }

    #[test]
    fn advertised_precedes_other_classes_but_baked_anchors_survive() {
        let baked = vec!["http://10.0.0.1:8080".to_string()];
        let advertised = vec!["https://new.example.test".to_string()];
        let origins = effective_origins(None, &advertised, &baked);
        assert_eq!(
            origins,
            vec!["https://new.example.test", "http://10.0.0.1:8080"]
        );
    }

    #[test]
    fn dedup_preserves_first_position() {
        let baked = vec!["https://same.example.test".to_string()];
        let advertised = vec!["https://same.example.test".to_string()];
        let origins = effective_origins(Some("https://same.example.test/"), &advertised, &baked);
        assert_eq!(origins, vec!["https://same.example.test"]);
    }

    #[test]
    fn invalid_entries_are_dropped_not_admitted() {
        let advertised = vec![
            "http://corp.internal.example.test".to_string(),
            "https://valid.example.test".to_string(),
            "http://8.8.8.8:8080".to_string(),
        ];
        let baked = vec![
            "not a url".to_string(),
            "https://ok.example.test".to_string(),
        ];
        let origins = effective_origins(Some("http://[fd00::1]:8080"), &advertised, &baked);
        assert_eq!(
            origins,
            vec!["https://valid.example.test", "https://ok.example.test"]
        );
    }

    #[test]
    fn parses_baked_csv() {
        let origins = parse_baked_origins(Some(
            " 10.37.221.38:18082,https://x.example.test , http://127.0.0.1:8080 ",
        ));
        assert_eq!(
            origins,
            vec!["https://x.example.test", "http://127.0.0.1:8080",]
        );
        assert!(parse_baked_origins(None).is_empty());
        assert!(parse_baked_origins(Some("  ")).is_empty());
    }

    #[test]
    fn builds_channel_url_from_validated_origin() {
        let url = snapshot_url("http://10.37.221.38:18082", "corpstable")
            .expect("private IP origin is valid");
        assert_eq!(
            url.as_str(),
            "http://10.37.221.38:18082/channels/corpstable/latest.pb"
        );
        assert!(snapshot_url("http://corp.internal:8080", "stable").is_none());
    }
}
