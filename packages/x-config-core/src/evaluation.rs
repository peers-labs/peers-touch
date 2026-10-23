//! Client-side directive evaluation (XCFG-D04).
//!
//! The signed snapshot is broadcast to every subscriber; targeting is
//! evaluated locally against a context assembled from build identity and
//! runtime context. This module contains pure matching logic shared by every
//! client; Rust and Go semantics are locked by the JSON conformance vectors.

use std::collections::BTreeMap;

use hmac::{Hmac, Mac};
use semver::Version;
use sha2::Sha256;

use crate::proto::{
    ClientArchitecture, ClientPlatform, Directive, DirectiveRule, DirectiveValue,
    EndpointSeedKind, LabelMatcher, TargetClause, VersionConstraint,
};

pub const MAX_DIRECTIVES: usize = 32;
pub const MAX_DIRECTIVE_RULES: usize = 16;
pub const MAX_TARGET_VALUES: usize = 8;
pub const MAX_ROLLOUT_PERMILLE: u32 = 1000;
pub const REGION_UNKNOWN: &str = "unknown";

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub struct TargetingContext {
    pub product: String,
    pub platform: ClientPlatform,
    pub architecture: ClientArchitecture,
    pub flavor: String,
    pub channel: String,
    pub environment: String,
    pub region: String,
    pub version: Version,
    pub labels: BTreeMap<String, String>,
    /// Persistent device identifier (DID); empty disables partial rollout.
    pub device_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvaluatedValue {
    String(String),
    Bool(bool),
    Int(i64),
    EndpointSeedId(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedDirective {
    pub key: String,
    pub value: EvaluatedValue,
    pub matched_rule_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectiveValueKind {
    String,
    Bool,
    Int,
    EndpointSeed,
}

#[derive(Clone, Copy, Debug)]
pub struct DirectiveKeySpec {
    pub value_kind: DirectiveValueKind,
    pub endpoint_kind: Option<EndpointSeedKind>,
}

/// Curated key registry — the server holds the identical registry. Adding a
/// key is an explicit contract change, not a remote-config free-for-all.
pub fn registered_directive_key(key: &str) -> Option<DirectiveKeySpec> {
    match key {
        "network.default_relay" => Some(DirectiveKeySpec {
            value_kind: DirectiveValueKind::EndpointSeed,
            endpoint_kind: Some(EndpointSeedKind::Relay),
        }),
        "network.default_station" => Some(DirectiveKeySpec {
            value_kind: DirectiveValueKind::EndpointSeed,
            endpoint_kind: Some(EndpointSeedKind::DirectStation),
        }),
        _ => None,
    }
}

pub(crate) fn directive_value_kind_pub(
    value: &DirectiveValue,
) -> Option<DirectiveValueKind> {
    directive_value_kind(value)
}

fn directive_value_kind(value: &DirectiveValue) -> Option<DirectiveValueKind> {
    match value.value.as_ref()? {
        crate::proto::directive_value::Value::StringValue(_) => {
            Some(DirectiveValueKind::String)
        }
        crate::proto::directive_value::Value::BoolValue(_) => Some(DirectiveValueKind::Bool),
        crate::proto::directive_value::Value::IntValue(_) => Some(DirectiveValueKind::Int),
        crate::proto::directive_value::Value::EndpointSeedId(_) => {
            Some(DirectiveValueKind::EndpointSeed)
        }
    }
}

pub fn directive_value_payload(value: &DirectiveValue) -> Option<EvaluatedValue> {
    match value.value.as_ref()? {
        crate::proto::directive_value::Value::StringValue(v) => {
            Some(EvaluatedValue::String(v.clone()))
        }
        crate::proto::directive_value::Value::BoolValue(v) => Some(EvaluatedValue::Bool(*v)),
        crate::proto::directive_value::Value::IntValue(v) => Some(EvaluatedValue::Int(*v)),
        crate::proto::directive_value::Value::EndpointSeedId(v) => {
            Some(EvaluatedValue::EndpointSeedId(v.clone()))
        }
    }
}

/// Evaluate every directive in snapshot order. Snapshot validation rejects
/// duplicate keys, so the result contains at most one resolution per key.
pub fn evaluate_directives(
    directives: &[Directive],
    context: &TargetingContext,
) -> Vec<ResolvedDirective> {
    let mut resolved = Vec::with_capacity(directives.len());
    for directive in directives {
        let matched = directive
            .rules
            .iter()
            .find(|rule| rule_matches(rule, context));
        let (value, matched_rule_id) = match matched {
            Some(rule) => (rule.value.as_ref(), Some(rule.id.clone())),
            None => (directive.fallback.as_ref(), None),
        };
        let Some(value) = value else { continue };
        if let Some(payload) = directive_value_payload(value) {
            resolved.push(ResolvedDirective {
                key: directive.key.clone(),
                value: payload,
                matched_rule_id,
            });
        }
    }
    resolved
}

fn rule_matches(rule: &DirectiveRule, context: &TargetingContext) -> bool {
    let clause = match rule.r#match.as_ref() {
        Some(clause) => clause,
        None => return false,
    };
    if !clause_matches(clause, context) {
        return false;
    }
    let permille = if rule.rollout_permille == 0 {
        MAX_ROLLOUT_PERMILLE
    } else {
        rule.rollout_permille
    };
    if permille >= MAX_ROLLOUT_PERMILLE {
        return true;
    }
    if context.device_id.is_empty() {
        return false;
    }
    rollout_bucket(&rule.id, &context.device_id) < permille
}

/// `HMAC-SHA256(key = rule id, msg = device id)` first 8 bytes as big-endian
/// u64, modulo 1000. Identical implementation is required in Go.
pub fn rollout_bucket(rule_id: &str, device_id: &str) -> u32 {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(rule_id.as_bytes())
        .expect("HMAC accepts keys of any size");
    mac.update(device_id.as_bytes());
    let digest = mac.finalize().into_bytes();
    let value = u64::from_be_bytes(digest[..8].try_into().expect("digest is 32 bytes"));
    (value % 1000) as u32
}

fn clause_matches(clause: &TargetClause, context: &TargetingContext) -> bool {
    any_or_wildcard(&clause.products, |product| {
        product == &context.product
    }) && any_or_wildcard_enum(&clause.platforms, context.platform as i32)
        && any_or_wildcard_enum(&clause.architectures, context.architecture as i32)
        && any_or_wildcard(&clause.flavors, |flavor| flavor == &context.flavor)
        && any_or_wildcard(&clause.channels, |channel| channel == &context.channel)
        && any_or_wildcard(&clause.environments, |value| {
            value == &context.environment
        })
        && region_matches(&clause.regions, &context.region)
        && clause
            .versions
            .iter()
            .all(|constraint| version_satisfies(constraint, &context.version))
        && clause
            .labels
            .iter()
            .all(|matcher| label_matches(matcher, &context.labels))
}

fn any_or_wildcard<F>(values: &[String], predicate: F) -> bool
where
    F: Fn(&String) -> bool,
{
    values.is_empty() || values.iter().any(predicate)
}

fn any_or_wildcard_enum(values: &[i32], actual: i32) -> bool {
    values.is_empty() || values.iter().any(|value| *value == actual)
}

fn region_matches(values: &[String], region: &str) -> bool {
    if values.is_empty() {
        return true;
    }
    !region.is_empty() && region != REGION_UNKNOWN && values.iter().any(|value| value == region)
}

fn label_matches(matcher: &LabelMatcher, labels: &BTreeMap<String, String>) -> bool {
    labels
        .get(&matcher.key)
        .is_some_and(|value| value == &matcher.value)
}

fn version_satisfies(constraint: &VersionConstraint, version: &Version) -> bool {
    let base = match Version::parse(&constraint.version) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    match constraint.comparator.as_str() {
        ">=" => version >= &base,
        "<" => version < &base,
        "^" => {
            if version < &base {
                return false;
            }
            let ceiling = if base.major > 0 {
                Version::new(base.major + 1, 0, 0)
            } else if base.minor > 0 {
                Version::new(0, base.minor + 1, 0)
            } else {
                Version::new(0, 0, base.patch + 1)
            };
            version < &ceiling
        }
        _ => false,
    }
}
