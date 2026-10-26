use crate::proto::{schema_action::Action, SchemaAction};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use prost::Message;
use station_trust::proto::{PublicEndpointConnectionMaterial, StationConnectionEnvelope};
use url::Url;

pub const MAX_LINK_BYTES: usize = 32_768;
const DEVICE_PREFIX: &str = "peers-touch://device/link#";
const ACTION_PREFIX: &str = "peers-touch://action/v1#";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemaError {
    InvalidLink,
    UnregisteredAction,
    PayloadTooLarge,
}
impl std::fmt::Display for SchemaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for SchemaError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Navigation {
    pub resource: String,
    pub id: Option<String>,
    pub sub_resource: Option<String>,
    pub sub_id: Option<String>,
}
#[derive(Debug, Clone)]
pub enum Link {
    WebUrl(String),
    Navigation(Navigation),
    Action(SchemaAction),
    OAuthCallback(String),
}

fn decode(value: &str) -> Result<Vec<u8>, SchemaError> {
    if value.is_empty() {
        return Err(SchemaError::InvalidLink);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| SchemaError::InvalidLink)?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(SchemaError::InvalidLink);
    }
    Ok(bytes)
}
fn device_action(action: &SchemaAction) -> bool {
    matches!(
        action.action,
        Some(Action::DeviceLinkOffer(_) | Action::DeviceLinkLocator(_))
    )
}
fn validate(action: &SchemaAction) -> Result<(), SchemaError> {
    if action.protocol_version != 1 || action.action.is_none() {
        return Err(SchemaError::UnregisteredAction);
    }
    if let Some(Action::ConversationId(text) | Action::ActorPtid(text) | Action::InviteCode(text)) =
        &action.action
    {
        if text.is_empty()
            || text.len() > 512
            || text.chars().any(|c| c <= '\u{20}' || c == '\u{7f}')
        {
            return Err(SchemaError::InvalidLink);
        }
    }
    Ok(())
}
pub fn encode_action(action: &SchemaAction) -> Result<String, SchemaError> {
    validate(action)?;
    let prefix = if device_action(action) {
        DEVICE_PREFIX
    } else {
        ACTION_PREFIX
    };
    let value = format!("{prefix}{}", URL_SAFE_NO_PAD.encode(action.encode_to_vec()));
    bounded(&value)?;
    Ok(value)
}
fn bounded(value: &str) -> Result<(), SchemaError> {
    if value.len() > MAX_LINK_BYTES {
        return Err(SchemaError::PayloadTooLarge);
    }
    if value.is_empty()
        || value
            .chars()
            .any(|c| c <= '\u{20}' || c == '\u{7f}' || c == '\\')
    {
        return Err(SchemaError::InvalidLink);
    }
    Ok(())
}
fn segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.~-".contains(&c))
}
fn navigation(value: &str) -> Result<Navigation, SchemaError> {
    let parts: Vec<_> = value.split('/').collect();
    if parts.iter().any(|part| !segment(part)) {
        return Err(SchemaError::InvalidLink);
    }
    let mut result = Navigation {
        resource: parts[0].into(),
        id: None,
        sub_resource: None,
        sub_id: None,
    };
    match parts[0] {
        "cron" if parts.len() == 1 => {}
        "cron"
            if (parts.len() == 3 || parts.len() == 5)
                && parts[1] == "jobs"
                && (parts.len() == 3 || parts[3] == "runs") =>
        {
            result.id = Some(parts[2].into());
            if parts.len() == 5 {
                result.sub_resource = Some("runs".into());
                result.sub_id = Some(parts[4].into());
            }
        }
        "sessions" | "settings" | "channels" if parts.len() <= 2 => {
            result.id = parts.get(1).map(|s| (*s).into());
        }
        "marketplace" | "evaluation" | "documents" | "chat" if parts.len() == 1 => {}
        _ => return Err(SchemaError::InvalidLink),
    }
    Ok(result)
}
pub fn parse(value: &str) -> Result<Link, SchemaError> {
    bounded(value)?;
    if let Some(path) = value.strip_prefix("pt://") {
        return Ok(Link::Navigation(navigation(path)?));
    }
    for prefix in [DEVICE_PREFIX, ACTION_PREFIX] {
        if let Some(encoded) = value.strip_prefix(prefix) {
            let bytes = decode(encoded)?;
            let action =
                SchemaAction::decode(bytes.as_slice()).map_err(|_| SchemaError::InvalidLink)?;
            validate(&action)?;
            if action.encode_to_vec() != bytes
                || device_action(&action) != (prefix == DEVICE_PREFIX)
            {
                return Err(SchemaError::InvalidLink);
            }
            return Ok(Link::Action(action));
        }
    }
    if let Some(encoded) = value.strip_prefix("ptm1:") {
        let bytes = decode(encoded)?;
        let material = PublicEndpointConnectionMaterial::decode(bytes.as_slice())
            .map_err(|_| SchemaError::InvalidLink)?;
        if material.encode_to_vec() != bytes
            || material.schema_version != 1
            || material.canonical_discovery_origin.is_empty()
        {
            return Err(SchemaError::InvalidLink);
        }
        return Ok(Link::Action(SchemaAction {
            protocol_version: 1,
            action: Some(Action::PublicConnection(material)),
        }));
    }
    if let Some(encoded) = value
        .strip_prefix("ptc1:")
        .or_else(|| value.strip_prefix("peers-touch://connect#"))
    {
        let bytes = decode(encoded)?;
        let envelope = StationConnectionEnvelope::decode(bytes.as_slice())
            .map_err(|_| SchemaError::InvalidLink)?;
        if envelope.encode_to_vec() != bytes
            || envelope.protocol_version != 1
            || envelope.relay_origin.is_empty()
            || envelope.connection_grant.is_none()
            || envelope.route_attestation.is_none()
        {
            return Err(SchemaError::InvalidLink);
        }
        return Ok(Link::Action(SchemaAction {
            protocol_version: 1,
            action: Some(Action::CircuitConnection(envelope)),
        }));
    }
    let url = Url::parse(value).map_err(|_| SchemaError::UnregisteredAction)?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(SchemaError::InvalidLink);
    }
    if matches!(url.scheme(), "http" | "https") {
        return Ok(Link::WebUrl(value.into()));
    }
    if value.starts_with("peers-touch://oauth/callback?")
        && url.host_str() == Some("oauth")
        && url.path() == "/callback"
        && url.port().is_none()
        && url.fragment().is_none()
    {
        let pairs: Vec<_> = url.query_pairs().collect();
        let mut keys = std::collections::HashSet::new();
        if pairs.iter().any(|(key, _)| {
            !keys.insert(key.as_ref())
                || !matches!(
                    key.as_ref(),
                    "code" | "state" | "error" | "error_description"
                )
        }) {
            return Err(SchemaError::InvalidLink);
        }
        let has = |name: &str| {
            pairs
                .iter()
                .any(|(key, value)| key == name && !value.is_empty())
        };
        if !has("state") || has("code") == has("error") {
            return Err(SchemaError::InvalidLink);
        }
        return Ok(Link::OAuthCallback(value.into()));
    }
    Err(SchemaError::UnregisteredAction)
}
