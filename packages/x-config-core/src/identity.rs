//! Compile-time distribution identity (XCFG-D05).
//!
//! Packaging emits `PT_DIST_*` rustc-env values through each client `build.rs`.
//! The identity is authoritative for directive targeting; the bundle sidecar
//! manifest is diagnostic only.

use std::collections::BTreeMap;

use semver::Version;
use serde::{Deserialize, Serialize};

use crate::error::XConfigError;

const DISTRIBUTION_ENV: &[(&str, &str)] = &[
    ("PT_DIST_PRODUCT", "product"),
    ("PT_DIST_FLAVOR", "flavor"),
    ("PT_DIST_CHANNEL", "channel"),
    ("PT_DIST_VERSION", "version"),
    ("PT_DIST_BUILD_NUMBER", "build_number"),
    ("PT_DIST_COMMIT", "commit"),
    ("PT_DIST_IDENTIFIER", "identifier"),
    ("PT_DIST_REGION", "region"),
    ("PT_DIST_LABELS_JSON", "labels"),
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildIdentity {
    pub product: String,
    pub flavor: String,
    pub channel: String,
    pub version: String,
    pub build_number: u64,
    pub commit: String,
    pub identifier: String,
    pub default_region: String,
    pub labels: BTreeMap<String, String>,
}

impl BuildIdentity {
    /// Parse distribution identity from a variable provider. Returns `Ok(None)`
    /// for an unpackaged development build (no `PT_DIST_FLAVOR` emitted).
    pub fn from_vars<F>(mut get: F) -> Result<Option<Self>, XConfigError>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let values: BTreeMap<&str, String> = DISTRIBUTION_ENV
            .iter()
            .filter_map(|(env, _)| get(env).map(|value| (*env, value.trim().to_string())))
            .collect();
        let flavor = match values.get("PT_DIST_FLAVOR") {
            Some(flavor) if !flavor.is_empty() => flavor.clone(),
            _ => return Ok(None),
        };
        let product = required(&values, "PT_DIST_PRODUCT")?;
        let channel = required(&values, "PT_DIST_CHANNEL")?;
        let version = required(&values, "PT_DIST_VERSION")?;
        let commit = required(&values, "PT_DIST_COMMIT")?;
        let identifier = required(&values, "PT_DIST_IDENTIFIER")?;
        let build_number = required(&values, "PT_DIST_BUILD_NUMBER")?
            .parse::<u64>()
            .map_err(|_| XConfigError::new("dist_build_number_invalid"))?;
        let default_region = values.get("PT_DIST_REGION").cloned().unwrap_or_default();
        if product != "desktop" && product != "mobile" {
            return Err(XConfigError::new("dist_product_invalid"));
        }
        if !is_slug(&flavor, 24)
            || !is_channel(&channel)
            || !is_identifier(&identifier)
            || !region_valid(&default_region)
        {
            return Err(XConfigError::new("dist_identity_invalid"));
        }
        if Version::parse(&version).is_err() {
            return Err(XConfigError::new("dist_version_invalid"));
        }
        if commit.len() != 40 || !commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(XConfigError::new("dist_commit_invalid"));
        }
        let labels = parse_labels(values.get("PT_DIST_LABELS_JSON").map(String::as_str))?;
        Ok(Some(Self {
            product,
            flavor,
            channel,
            version,
            build_number,
            commit,
            identifier,
            default_region,
            labels,
        }))
    }
}

fn required(values: &BTreeMap<&str, String>, key: &str) -> Result<String, XConfigError> {
    values
        .get(key)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| XConfigError::new("dist_identity_incomplete"))
}

fn parse_labels(raw: Option<&str>) -> Result<BTreeMap<String, String>, XConfigError> {
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return Ok(BTreeMap::new());
    };
    let provisional: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| XConfigError::new("dist_labels_invalid"))?;
    let object = provisional
        .as_object()
        .ok_or_else(|| XConfigError::new("dist_labels_invalid"))?;
    let mut labels = BTreeMap::new();
    for (key, value) in object {
        if !label_key_valid(key) {
            return Err(XConfigError::new("dist_label_key_invalid"));
        }
        let text = value
            .as_str()
            .ok_or_else(|| XConfigError::new("dist_label_value_invalid"))?;
        if text.is_empty()
            || text.len() > 32
            || !text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        {
            return Err(XConfigError::new("dist_label_value_invalid"));
        }
        labels.insert(key.clone(), text.to_string());
    }
    Ok(labels)
}

fn is_slug(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn is_channel(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_identifier(value: &str) -> bool {
    let mut segments = value.split('.');
    matches!(segments.next(), Some("com"))
        && matches!(segments.next(), Some("peers"))
        && matches!(segments.next(), Some("touch"))
        && segments
            .next()
            .is_some_and(|product| product == "desktop" || product == "mobile")
        && segments.all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn region_valid(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let mut parts = value.split('-');
    parts
        .next()
        .is_some_and(|country| country.len() == 2 && country.bytes().all(|byte| byte.is_ascii_lowercase()))
        && parts.all(|rest| {
            !rest.is_empty()
                && rest
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn label_key_valid(value: &str) -> bool {
    let mut segments = value.split('.');
    segments.all(|segment| {
        !segment.is_empty()
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    })
}

/// Resolve the distribution identity baked in by the consuming crate's
/// `build.rs`. Expands to `Option<Result<BuildIdentity, XConfigError>>`.
#[macro_export]
macro_rules! compiled_build_identity {
    () => {
        $crate::identity::BuildIdentity::from_vars(|name: &str| match name {
            "PT_DIST_PRODUCT" => option_env!("PT_DIST_PRODUCT").map(str::to_string),
            "PT_DIST_FLAVOR" => option_env!("PT_DIST_FLAVOR").map(str::to_string),
            "PT_DIST_CHANNEL" => option_env!("PT_DIST_CHANNEL").map(str::to_string),
            "PT_DIST_VERSION" => option_env!("PT_DIST_VERSION").map(str::to_string),
            "PT_DIST_BUILD_NUMBER" => {
                option_env!("PT_DIST_BUILD_NUMBER").map(str::to_string)
            }
            "PT_DIST_COMMIT" => option_env!("PT_DIST_COMMIT").map(str::to_string),
            "PT_DIST_IDENTIFIER" => option_env!("PT_DIST_IDENTIFIER").map(str::to_string),
            "PT_DIST_REGION" => option_env!("PT_DIST_REGION").map(str::to_string),
            "PT_DIST_LABELS_JSON" => option_env!("PT_DIST_LABELS_JSON").map(str::to_string),
            _ => None,
        })
        .transpose()
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars<'a>(
        pairs: &'a [(&'a str, &'a str)],
    ) -> impl FnMut(&str) -> Option<String> + 'a {
        |name: &str| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    const COMMIT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const VALID: &[(&str, &str)] = &[
        ("PT_DIST_PRODUCT", "desktop"),
        ("PT_DIST_FLAVOR", "xx"),
        ("PT_DIST_CHANNEL", "stable"),
        ("PT_DIST_VERSION", "0.2.0"),
        ("PT_DIST_BUILD_NUMBER", "4321"),
        ("PT_DIST_COMMIT", COMMIT),
        ("PT_DIST_IDENTIFIER", "com.peers.touch.desktop.xx"),
        ("PT_DIST_REGION", "cn"),
        ("PT_DIST_LABELS_JSON", r#"{"dist.audience":"geek"}"#),
    ];

    #[test]
    fn parses_packaged_identity() {
        let identity = BuildIdentity::from_vars(vars(VALID)).unwrap().unwrap();
        assert_eq!(identity.flavor, "xx");
        assert_eq!(identity.build_number, 4321);
        assert_eq!(identity.default_region, "cn");
        assert_eq!(identity.labels["dist.audience"], "geek");
    }

    #[test]
    fn missing_flavor_is_unpackaged_dev_build() {
        assert!(BuildIdentity::from_vars(vars(&[])).unwrap().is_none());
    }

    #[test]
    fn rejects_invalid_identity_fields() {
        let bad_identifier = [("PT_DIST_IDENTIFIER", "com.example.app")];
        let merged: Vec<(&str, &str)> = VALID
            .iter()
            .map(|(key, value)| {
                if *key == "PT_DIST_IDENTIFIER" {
                    bad_identifier[0]
                } else {
                    (*key, *value)
                }
            })
            .collect();
        assert!(BuildIdentity::from_vars(vars(&merged)).is_err());

        let mut bad_version = VALID
            .iter()
            .map(|(key, value)| (*key, *value))
            .collect::<Vec<(&str, &str)>>();
        if let Some(entry) = bad_version.iter_mut().find(|(key, _)| *key == "PT_DIST_VERSION") {
            entry.1 = "nope";
        }
        assert!(BuildIdentity::from_vars(vars(&bad_version)).is_err());
    }
}
