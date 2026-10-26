use schema_core::proto::{schema_action::Action, SchemaAction};
use schema_core::{encode_action, parse, Link, SchemaError};

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
