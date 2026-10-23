//! Golden tests for directive evaluation against the shared conformance
//! vectors. The Go Station evaluator consumes the same JSON file; semantics
//! must not diverge (XCFG-D04).

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::Value;
use x_config_core::evaluation::{evaluate_directives, EvaluatedValue, TargetingContext};
use x_config_core::proto::{
    ClientArchitecture, ClientPlatform, Directive, DirectiveRule, DirectiveValue,
    TargetClause, VersionConstraint,
};

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("model")
        .join("domain")
        .join("x_config")
        .join("evaluation-vectors")
        .join("directives.json")
}

fn platform(value: &str) -> ClientPlatform {
    match value {
        "macos" => ClientPlatform::Macos,
        "windows" => ClientPlatform::Windows,
        "linux" => ClientPlatform::Linux,
        "ios" => ClientPlatform::Ios,
        "android" => ClientPlatform::Android,
        other => panic!("unknown platform {other}"),
    }
}

fn architecture(value: &str) -> ClientArchitecture {
    match value {
        "arm64" => ClientArchitecture::Arm64,
        "x86_64" => ClientArchitecture::X8664,
        "universal" => ClientArchitecture::Universal,
        other => panic!("unknown architecture {other}"),
    }
}

fn build_value(value: &Value) -> DirectiveValue {
    let object = value.as_object().expect("directive value object");
    assert_eq!(object.len(), 1, "directive value must be a closed oneof");
    let (key, raw) = object.iter().next().unwrap();
    let oneof = match key.as_str() {
        "string_value" => x_config_core::proto::directive_value::Value::StringValue(
            raw.as_str().unwrap().to_string(),
        ),
        "bool_value" => {
            x_config_core::proto::directive_value::Value::BoolValue(raw.as_bool().unwrap())
        }
        "int_value" => {
            x_config_core::proto::directive_value::Value::IntValue(raw.as_i64().unwrap())
        }
        "endpoint_seed_id" => x_config_core::proto::directive_value::Value::EndpointSeedId(
            raw.as_str().unwrap().to_string(),
        ),
        other => panic!("unknown value kind {other}"),
    };
    DirectiveValue { value: Some(oneof) }
}

fn string_list(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| items.iter().map(|item| item.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

fn build_clause(value: &Value) -> Option<TargetClause> {
    value.get("match").map(|raw| {
        let versions = raw
            .get("versions")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| VersionConstraint {
                        comparator: item["comparator"].as_str().unwrap().to_string(),
                        version: item["version"].as_str().unwrap().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let labels = raw
            .get("labels")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| x_config_core::proto::LabelMatcher {
                        key: item["key"].as_str().unwrap().to_string(),
                        value: item["value"].as_str().unwrap().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        TargetClause {
            products: string_list(raw, "products"),
            platforms: raw
                .get("platforms")
                .and_then(Value::as_array)
                .map(|items| items.iter().map(|item| platform(item.as_str().unwrap()) as i32).collect())
                .unwrap_or_default(),
            architectures: raw
                .get("architectures")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| architecture(item.as_str().unwrap()) as i32)
                        .collect()
                })
                .unwrap_or_default(),
            flavors: string_list(raw, "flavors"),
            channels: string_list(raw, "channels"),
            environments: string_list(raw, "environments"),
            regions: string_list(raw, "regions"),
            versions,
            labels,
        }
    })
}

fn build_directives(value: &Value) -> Vec<Directive> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            let rules = entry["rules"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .map(|rule| DirectiveRule {
                            id: rule["id"].as_str().unwrap().to_string(),
                            r#match: build_clause(rule),
                            value: Some(build_value(&rule["value"])),
                            rollout_permille: rule
                                .get("rollout_permille")
                                .and_then(Value::as_u64)
                                .unwrap_or(0) as u32,
                        })
                        .collect()
                })
                .unwrap_or_default();
            Directive {
                key: entry["key"].as_str().unwrap().to_string(),
                rules,
                fallback: Some(build_value(&entry["fallback"])),
            }
        })
        .collect()
}

fn build_context(value: &Value) -> TargetingContext {
    let labels = value
        .get("labels")
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .map(|(key, raw)| (key.clone(), raw.as_str().unwrap().to_string()))
                .collect()
        })
        .unwrap_or_default();
    TargetingContext {
        product: value["product"].as_str().unwrap().to_string(),
        platform: platform(value["platform"].as_str().unwrap()),
        architecture: architecture(value["architecture"].as_str().unwrap()),
        flavor: value["flavor"].as_str().unwrap_or_default().to_string(),
        channel: value["channel"].as_str().unwrap_or_default().to_string(),
        environment: value["environment"].as_str().unwrap_or_default().to_string(),
        region: value["region"].as_str().unwrap_or_default().to_string(),
        version: semver::Version::parse(value["version"].as_str().unwrap()).unwrap(),
        labels,
        device_id: value["device_id"].as_str().unwrap_or_default().to_string(),
    }
}

fn value_json(value: &EvaluatedValue) -> Value {
    match value {
        EvaluatedValue::String(inner) => serde_json::json!({ "string_value": inner }),
        EvaluatedValue::Bool(inner) => serde_json::json!({ "bool_value": inner }),
        EvaluatedValue::Int(inner) => serde_json::json!({ "int_value": inner }),
        EvaluatedValue::EndpointSeedId(inner) => {
            serde_json::json!({ "endpoint_seed_id": inner })
        }
    }
}

#[test]
fn directive_evaluation_matches_conformance_vectors() {
    let document: Value =
        serde_json::from_slice(&std::fs::read(vectors_path()).unwrap()).unwrap();
    assert_eq!(document["schema"], "x-config-directive-vectors/v1");
    for group in document["vectors"].as_array().unwrap() {
        let directives = build_directives(&group["directives"]);
        for case in group["cases"].as_array().unwrap() {
            let context = build_context(&case["context"]);
            let resolved = evaluate_directives(&directives, &context);
            let by_key: BTreeMap<_, _> = resolved
                .iter()
                .map(|entry| (entry.key.as_str(), entry))
                .collect();

            if let Some(expect) = case.get("expect") {
                let key = expect["key"].as_str().unwrap();
                let actual = by_key.get(key).unwrap_or_else(|| panic!("missing resolution for {key}"));
                assert_eq!(
                    value_json(&actual.value),
                    expect["value"],
                    "vector `{}` case value mismatch",
                    group["name"].as_str().unwrap()
                );
                let expected_rule = expect["matched_rule_id"].as_str();
                assert_eq!(
                    actual.matched_rule_id.as_deref(),
                    expected_rule,
                    "vector `{}` matched-rule mismatch",
                    group["name"].as_str().unwrap()
                );
            }
            if let Some(expect_kv) = case.get("expect_kv").and_then(Value::as_object) {
                for (key, expected_value) in expect_kv {
                    let actual = by_key
                        .get(key.as_str())
                        .unwrap_or_else(|| panic!("missing resolution for {key}"));
                    assert_eq!(value_json(&actual.value), *expected_value);
                }
            }
        }
    }
}
