use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{MobileError, MobileResult};

const BUILD_IDENTITY_JSON: &str = env!("PT_MOBILE_BUILD_IDENTITY_JSON");

#[cfg(feature = "acceptance-harness")]
#[used]
#[no_mangle]
pub static PT_MOBILE_ACCEPTANCE_HARNESS_MARKER: [u8; 45] =
    *b"PEERS_TOUCH_MOBILE_ACCEPTANCE_HARNESS_ENABLED";

#[cfg(feature = "acceptance-harness")]
#[used]
#[no_mangle]
pub static PT_MOBILE_BUILD_IDENTITY_JSON: &str = BUILD_IDENTITY_JSON;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct MobileBuildIdentity {
    schema: String,
    build_id: String,
    platform: String,
    configuration: String,
    source_commit: String,
    workspace_state: String,
    workspace_digest: String,
    build_inputs_digest: String,
    allowlisted_environment_digest: String,
    application_id: String,
    harness_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedMobileBuildIdentity {
    identity: MobileBuildIdentity,
    embedded_identity_sha256: String,
}

pub fn read_embedded_build_identity() -> MobileResult<EmbeddedMobileBuildIdentity> {
    if BUILD_IDENTITY_JSON.is_empty() {
        return Err(MobileError::invalid_input(
            "acceptance.mobile.buildIdentityMissing",
        ));
    }
    let identity = parse_embedded_build_identity(BUILD_IDENTITY_JSON)?;
    let digest = Sha256::digest(BUILD_IDENTITY_JSON.as_bytes());
    Ok(EmbeddedMobileBuildIdentity {
        identity,
        embedded_identity_sha256: format!("sha256:{digest:x}"),
    })
}

fn parse_embedded_build_identity(raw: &str) -> MobileResult<MobileBuildIdentity> {
    let raw_value: Value = serde_json::from_str(raw)
        .map_err(|_| MobileError::invalid_input("acceptance.mobile.buildIdentityInvalid"))?;
    let canonical = canonical_json(&raw_value)
        .map_err(|_| MobileError::invalid_input("acceptance.mobile.buildIdentityInvalid"))?;
    if canonical != raw {
        return Err(MobileError::invalid_input(
            "acceptance.mobile.buildIdentityInvalid",
        ));
    }
    let identity: MobileBuildIdentity = serde_json::from_value(raw_value)
        .map_err(|_| MobileError::invalid_input("acceptance.mobile.buildIdentityInvalid"))?;
    if identity.schema != "peers-mobile-build-identity"
        || identity.build_id.is_empty()
        || identity
            .build_id
            .bytes()
            .any(|value| value.is_ascii_whitespace())
        || !matches!(identity.platform.as_str(), "ios" | "android")
        || identity.configuration != "acceptance-debug"
        || identity.source_commit.len() != 40
        || !identity.source_commit.bytes().all(is_lowercase_hex)
        || !matches!(identity.workspace_state.as_str(), "clean" | "dirty")
        || (identity.workspace_state == "clean" && identity.workspace_digest != "clean")
        || (identity.workspace_state == "dirty" && !is_sha256(&identity.workspace_digest))
        || !is_sha256(&identity.build_inputs_digest)
        || !is_sha256(&identity.allowlisted_environment_digest)
        || identity.application_id != "com.peers.touch.mobile"
        || !identity.harness_enabled
    {
        return Err(MobileError::invalid_input(
            "acceptance.mobile.buildIdentityInvalid",
        ));
    }
    Ok(identity)
}

#[tauri::command]
pub fn mobile_build_identity() -> MobileResult<EmbeddedMobileBuildIdentity> {
    read_embedded_build_identity()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71 && value.starts_with("sha256:") && value[7..].bytes().all(is_lowercase_hex)
}

fn is_lowercase_hex(value: u8) -> bool {
    value.is_ascii_digit() || matches!(value, b'a'..=b'f')
}

fn canonical_json(value: &Value) -> Result<String, serde_json::Error> {
    match value {
        Value::Object(entries) => {
            let sorted = entries
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<std::collections::BTreeMap<_, _>>();
            serde_json::to_string(&sorted)
        }
        _ => serde_json::to_string(value),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_embedded_build_identity;

    const VALID: &str = concat!(
        "{\"allowlistedEnvironmentDigest\":\"sha256:",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "\",\"applicationId\":\"com.peers.touch.mobile\",\"buildId\":\"build-ios\",",
        "\"buildInputsDigest\":\"sha256:",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "\",\"configuration\":\"acceptance-debug\",\"harnessEnabled\":true,",
        "\"platform\":\"ios\",\"schema\":\"peers-mobile-build-identity\",",
        "\"sourceCommit\":\"1111111111111111111111111111111111111111\",",
        "\"workspaceDigest\":\"sha256:",
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "\",\"workspaceState\":\"dirty\"}"
    );

    #[test]
    fn accepts_the_canonical_identity() {
        assert!(parse_embedded_build_identity(VALID).is_ok());
    }

    #[test]
    fn rejects_noncanonical_and_semantically_invalid_identities() {
        assert!(parse_embedded_build_identity(&VALID.replace("\",\"", "\", \"")).is_err());
        assert!(
            parse_embedded_build_identity(&VALID.replace("\"build-ios\"", "\"build ios\""))
                .is_err()
        );
        assert!(parse_embedded_build_identity(
            &VALID.replace("\"acceptance-debug\"", "\"release\"")
        )
        .is_err());
        assert!(parse_embedded_build_identity(
            &VALID.replace("\"com.peers.touch.mobile\"", "\"com.example.other\"")
        )
        .is_err());
        assert!(parse_embedded_build_identity(
            &VALID.replace(
                "\"workspaceDigest\":\"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"",
                "\"workspaceDigest\":\"dirty\"",
            )
        )
        .is_err());
    }
}
