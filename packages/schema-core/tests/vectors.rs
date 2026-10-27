use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use prost::Message;
use schema_core::proto::device_link::DeviceLinkLocator;
use schema_core::proto::{schema_action::Action, SchemaAction};
use schema_core::{encode_action, parse, Link, SchemaError};
use station_trust::proto::AccessEndpointRole;

#[test]
fn shared_link_vectors_are_identical_to_typescript() {
    let vectors: serde_json::Value =
        serde_json::from_str(include_str!("../../schema/qa/link-vectors.json")).unwrap();
    for vector in vectors.as_array().unwrap() {
        let input = vector["value"].as_str().unwrap();
        let result = parse(input);
        let status = match &result {
            Ok(_) => "recognized",
            Err(SchemaError::UnregisteredAction) => "unsupported",
            Err(_) => "malformed",
        };
        assert_eq!(status, vector["status"].as_str().unwrap(), "{input}");
        if let Ok(link) = result {
            let kind = match link {
                Link::Action(_) => "action",
                Link::Navigation(_) => "navigation",
                Link::WebUrl(_) => "url",
                Link::OAuthCallback(_) => "oauth-callback",
            };
            assert_eq!(kind, vector["kind"].as_str().unwrap(), "{input}");
        }
    }
}

#[test]
fn generated_action_roundtrips_and_rejects_unknown_fields() {
    let action = SchemaAction {
        protocol_version: 1,
        action: Some(Action::ConversationId("abc".into())),
    };
    let encoded = encode_action(&action).unwrap();
    assert_eq!(encoded, "peers-touch://action/v1#CAEyA2FiYw");
    assert!(matches!(parse(&encoded).unwrap(), Link::Action(parsed) if parsed == action));
}

#[test]
fn compact_device_link_reference_uses_base32_and_rejects_legacy_locator_encoding() {
    let locator = DeviceLinkLocator {
        protocol_version: 1,
        offer_digest: vec![1; 32],
        expires_at_unix_ms: 1_800_000_300_000,
        station_root_ed25519: vec![2; 32],
        bootstrap_secret: vec![3; 32],
        canonical_discovery_origin: "https://station.example".into(),
        endpoint_role: AccessEndpointRole::DirectStation as i32,
        relay_ed25519: Vec::new(),
        endpoint_tls_trust: None,
    };
    let action = SchemaAction {
        protocol_version: 1,
        action: Some(Action::DeviceLinkLocator(locator.clone())),
    };
    let encoded = encode_action(&action).unwrap();
    assert!(encoded.starts_with("peers-touch://device/link#B32:"));
    assert!(encoded
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b":/.#-".contains(&byte)));
    assert!(matches!(parse(&encoded).unwrap(), Link::Action(parsed) if parsed == action));

    let legacy = format!(
        "peers-touch://device/link#{}",
        URL_SAFE_NO_PAD.encode(locator.encode_to_vec())
    );
    assert!(parse(&legacy).is_err());

    let reused_root = DeviceLinkLocator {
        endpoint_role: AccessEndpointRole::Relay as i32,
        relay_ed25519: locator.station_root_ed25519.clone(),
        ..locator
    };
    assert!(encode_action(&SchemaAction {
        protocol_version: 1,
        action: Some(Action::DeviceLinkLocator(reused_root)),
    })
    .is_err());
}
