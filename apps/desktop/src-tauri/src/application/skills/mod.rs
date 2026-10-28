use crate::application::station_runtime::client::{self as station_client, StationClient};
use crate::contracts::{
    BuiltinSkillIdInput, SkillCreateInput, SkillIdInput, SkillRollbackInput, SkillToggleInput,
    SkillUpdateInput, SkillVersionsInput, SkillsListInput, SkillsSearchInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::model;
use reqwest::Method;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const DEFAULT_AGENT_ID: &str = "assistant";
pub(crate) const SKILL_LIST_PATH: &str = "/sub-agent/agent/skill/list";
const SKILL_GET_PATH: &str = "/sub-agent/agent/skill/get";
pub(crate) const SKILL_INSTALL_PATH: &str = "/sub-agent/agent/skill/install";
const SKILL_UPDATE_PATH: &str = "/sub-agent/agent/skill/update";
pub(crate) const SKILL_DELETE_PATH: &str = "/sub-agent/agent/skill/delete";
const SKILL_VERSIONS_PATH: &str = "/sub-agent/agent/growth/skill/versions";
const SKILL_ROLLBACK_PATH: &str = "/sub-agent/agent/growth/skill/rollback";

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn station_error(command: &str, err: station_client::StationClientError) -> AppResult<StubPayload> {
    tracing::error!(command = command, error = %err, "Station skill request failed");
    err.into_app_result(format!("{} failed", command))
}

fn agent_id(input: Option<String>) -> String {
    input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_AGENT_ID)
        .to_string()
}

fn timestamp_json(ts: &Option<prost_types::Timestamp>) -> Value {
    ts.as_ref()
        .map(|value| {
            let millis = value.seconds.saturating_mul(1000) + i64::from(value.nanos / 1_000_000);
            Value::from(millis)
        })
        .unwrap_or(Value::Null)
}

fn identifier_for_name(name: &str) -> String {
    name.trim().to_lowercase().replace(' ', "-")
}

fn manifest_list_json(skill: &model::agent::SkillManifest) -> Value {
    let trust = skill.trust_level.trim();
    let verdict = skill.scan_verdict.trim();
    let meta_tags = [trust, verdict]
        .into_iter()
        .filter(|value| !value.is_empty())
        .map(Value::from)
        .collect::<Vec<_>>();

    json!({
        "id": skill.skill_id,
        "identifier": identifier_for_name(&skill.name),
        "name": skill.name,
        "description": skill.description,
        "version": skill.version.to_string(),
        "authorName": "Station",
        "metaAvatar": "",
        "metaTitle": skill.name,
        "metaTags": meta_tags,
        "source": if skill.source.trim().is_empty() { "station" } else { skill.source.as_str() },
        "trustLevel": skill.trust_level,
        "scanVerdict": skill.scan_verdict,
        "enabled": skill.enabled,
        "createdAt": timestamp_json(&skill.created_at),
        "updatedAt": timestamp_json(&skill.updated_at),
        "useCount": 0,
        "agentId": skill.agent_id,
        "resourceCount": skill.resources.len(),
        "resources": skill.resources.iter().map(skill_resource_json).collect::<Vec<_>>()
    })
}

fn manifest_detail_json(skill: &model::agent::SkillManifest, content: &str) -> Value {
    let mut base = manifest_list_json(skill);
    if let Some(obj) = base.as_object_mut() {
        obj.insert("authorUrl".to_string(), json!(""));
        obj.insert("license".to_string(), json!(""));
        obj.insert("repository".to_string(), json!(""));
        obj.insert("sourceUrl".to_string(), json!(skill.source));
        obj.insert("permissions".to_string(), json!([]));
        obj.insert("content".to_string(), json!(content));
        obj.insert("metaDescription".to_string(), json!(skill.description));
        obj.insert("metaBackgroundColor".to_string(), json!(""));
        obj.insert("keywords".to_string(), json!([]));
        obj.insert("globs".to_string(), json!([]));
        obj.insert("agentOnly".to_string(), json!([]));
        obj.insert("sourceUri".to_string(), json!(skill.source));
        obj.insert("zipFileHash".to_string(), json!(""));
        obj.insert(
            "resourceTree".to_string(),
            skill_resource_tree(skill, content),
        );
        obj.insert(
            "runtimeLoad".to_string(),
            skill_runtime_load(skill, content),
        );
    }
    base
}

fn skill_execution_owner_json(owner: i32) -> &'static str {
    match model::agent::ToolExecutionOwner::try_from(owner).unwrap_or_default() {
        model::agent::ToolExecutionOwner::Station => "station",
        model::agent::ToolExecutionOwner::ClientCapability => "client_capability",
        model::agent::ToolExecutionOwner::Unspecified => "unspecified",
    }
}

fn skill_resource_kind_json(kind: i32) -> &'static str {
    model::agent::SkillResourceKind::try_from(kind)
        .unwrap_or_default()
        .as_str_name()
        .trim_start_matches("SKILL_RESOURCE_KIND_")
}

fn skill_resource_json(resource: &model::agent::SkillResource) -> Value {
    json!({
        "path": resource.path,
        "contentHash": resource.content_hash,
        "size": resource.size,
        "kind": skill_resource_kind_json(resource.kind),
        "executionOwner": skill_execution_owner_json(resource.execution_owner),
    })
}

fn skill_resource_tree(skill: &model::agent::SkillManifest, content: &str) -> Value {
    let mut children = vec![json!({
        "id": format!("skill:{}:v{}:SKILL.md", skill.skill_id, skill.version),
        "name": "SKILL.md",
        "path": "SKILL.md",
        "kind": "file",
        "role": "entrypoint",
        "mime": "text/markdown",
        "bytes": content.as_bytes().len(),
        "lineCount": line_count(content),
        "sha256": sha256_hex(content),
        "loadedAtRuntime": false,
        "loadTrigger": "skill_view",
        "summary": resource_summary(&skill.description, content)
    })];
    for resource in &skill.resources {
        let owner = skill_execution_owner_json(resource.execution_owner);
        children.push(json!({
            "id": format!("skill:{}:v{}:{}", skill.skill_id, skill.version, resource.path),
            "name": resource.path.rsplit('/').next().unwrap_or(resource.path.as_str()),
            "path": resource.path,
            "kind": "file",
            "role": skill_resource_kind_json(resource.kind).to_lowercase(),
            "bytes": resource.size,
            "sha256": resource.content_hash,
            "executionOwner": owner,
            "loadedAtRuntime": false,
            "loadTrigger": if resource.execution_owner == model::agent::ToolExecutionOwner::Station as i32 {
                "skill_resource_read"
            } else {
                "skill.resource.read"
            }
        }));
    }
    json!({
        "root": {
            "id": format!("skill:{}:v{}:root", skill.skill_id, skill.version),
            "name": skill.name,
            "path": "/",
            "kind": "directory",
            "bytes": content.as_bytes().len(),
            "lineCount": line_count(content),
            "loadedAtRuntime": false,
            "loadTrigger": "none",
            "children": children
        },
        "resources": skill.resources.iter().map(skill_resource_json).collect::<Vec<_>>()
    })
}

fn skill_runtime_load(skill: &model::agent::SkillManifest, content: &str) -> Value {
    json!({
        "systemPrompt": {
            "policy": "index-only",
            "loadedResources": [],
            "description": "Prompt assembly injects skill name and description only. Full content is not loaded until skill_view is called."
        },
        "skillView": {
            "policy": "on-demand",
            "toolName": "skill_view",
            "loadedResources": ["SKILL.md"],
            "bytes": content.as_bytes().len(),
            "lineCount": line_count(content),
            "sha256": sha256_hex(content)
        },
        "runtimeTrace": {
            "skillId": skill.skill_id,
            "version": skill.version,
            "enabled": skill.enabled,
            "trustLevel": skill.trust_level,
            "scanVerdict": skill.scan_verdict
        }
    })
}

fn split_skill_protocol(content: &str) -> (String, String) {
    if !content.starts_with("---\n") {
        return (String::new(), content.to_string());
    }
    let Some(end_idx) = content[4..].find("\n---") else {
        return (String::new(), content.to_string());
    };
    let end = end_idx + 4;
    let body_start = end + "\n---".len();
    (
        content[4..end].trim().to_string(),
        content.get(body_start..).unwrap_or("").trim().to_string(),
    )
}

fn line_count(content: &str) -> usize {
    if content.is_empty() {
        0
    } else {
        content.lines().count().max(1)
    }
}

fn sha256_hex(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

fn resource_summary(description: &str, content: &str) -> String {
    let description = description.trim();
    if !description.is_empty() {
        return description.to_string();
    }
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("---"))
        .unwrap_or("")
        .chars()
        .take(160)
        .collect()
}

fn builtin_json() -> Vec<Value> {
    vec![json!({
        "identifier": "builtin-file-search",
        "name": "File Search",
        "description": "Search files",
        "keywords": [],
        "avatar": "",
        "useCount": 0
    })]
}

fn list_station_skills(
    station_client: &StationClient,
    agent_id: String,
    token: &str,
) -> Result<Vec<model::agent::SkillManifest>, station_client::StationClientError> {
    let req = model::agent::ListSkillsRequest {
        agent_id,
        category: String::new(),
    };
    station_client
        .request_proto::<model::agent::ListSkillsRequest, model::agent::ListSkillsResponse>(
            Method::POST,
            SKILL_LIST_PATH,
            token,
            None,
            Some(&req),
        )
        .map(|resp| resp.skills)
}

pub fn skills_list(
    station_client: &StationClient,
    input: SkillsListInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let source = input.source.unwrap_or_else(|| "all".to_string());
    let skills = match list_station_skills(station_client, agent_id(input.agent_id), token) {
        Ok(items) => items
            .iter()
            .filter(|_| source == "all" || source == "user" || source == "station")
            .map(manifest_list_json)
            .collect::<Vec<_>>(),
        Err(err) => return station_error("skills_list", err),
    };
    success_payload(
        "skills_list",
        json!({ "skills": skills, "builtin": builtin_json() }),
    )
}

pub fn skills_search(
    station_client: &StationClient,
    input: SkillsSearchInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let q = input.q.trim().to_lowercase();
    if q.is_empty() {
        return invalid_argument("q is required");
    }
    let limit = input.limit.unwrap_or(20) as usize;
    let skills = match list_station_skills(station_client, agent_id(input.agent_id), token) {
        Ok(items) => items
            .iter()
            .filter(|item| {
                item.name.to_lowercase().contains(&q)
                    || item.description.to_lowercase().contains(&q)
                    || item.content.to_lowercase().contains(&q)
            })
            .take(limit)
            .map(manifest_list_json)
            .collect::<Vec<_>>(),
        Err(err) => return station_error("skills_search", err),
    };
    success_payload("skills_search", json!({ "skills": skills }))
}

pub fn skills_get(
    station_client: &StationClient,
    input: SkillIdInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let req = model::agent::GetSkillRequest {
        skill_id: id.to_string(),
        file_path: String::new(),
        agent_id: agent_id(input.agent_id),
    };
    match station_client
        .request_proto::<model::agent::GetSkillRequest, model::agent::GetSkillResponse>(
            Method::GET,
            SKILL_GET_PATH,
            token,
            Some(&[
                ("skill_id", req.skill_id.clone()),
                ("agent_id", req.agent_id.clone()),
            ]),
            None,
        ) {
        Ok(resp) => {
            let Some(skill) = resp.skill else {
                return AppResult::fail(ErrorCode::NotFound, "Skill not found", None);
            };
            success_payload(
                "skills_get",
                manifest_detail_json(&skill, &resp.file_content),
            )
        }
        Err(err) => station_error("skills_get", err),
    }
}

pub fn skills_get_builtin(input: BuiltinSkillIdInput) -> AppResult<StubPayload> {
    let identifier = input.identifier.trim();
    if identifier.is_empty() {
        return invalid_argument("identifier is required");
    }
    success_payload(
        "skills_get_builtin",
        json!({
            "identifier": identifier,
            "name": "Builtin Skill",
            "description": "",
            "keywords": [],
            "avatar": "",
            "useCount": 0,
            "content": format!("name: {}", identifier)
        }),
    )
}

pub fn skills_create(
    station_client: &StationClient,
    input: SkillCreateInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let req = model::agent::InstallSkillRequest {
        agent_id: agent_id(input.agent_id),
        source: "desktop".to_string(),
        name: name.to_string(),
        content: input.content,
        trust_level: "community".to_string(),
        resources: vec![],
    };
    match station_client
        .request_proto::<model::agent::InstallSkillRequest, model::agent::InstallSkillResponse>(
            Method::POST,
            SKILL_INSTALL_PATH,
            token,
            None,
            Some(&req),
        ) {
        Ok(resp) => success_payload(
            "skills_create",
            json!({
                "id": resp.skill_id,
                "identifier": identifier_for_name(name),
                "name": name,
                "isNew": resp.installed,
                "scanVerdict": resp.verdict
            }),
        ),
        Err(err) => station_error("skills_create", err),
    }
}

pub fn skills_update(
    station_client: &StationClient,
    input: SkillUpdateInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let req = model::agent::UpdateSkillRequest {
        agent_id: agent_id(input.agent_id),
        skill_id: id.to_string(),
        name: input.name,
        description: input.description,
        content: input.content,
        // Content-only edits carry no replacement set; Station clones the
        // pinned resources of the previous version onto the new revision.
        resources: vec![],
    };
    match station_client
        .request_proto::<model::agent::UpdateSkillRequest, model::agent::UpdateSkillResponse>(
            Method::POST,
            SKILL_UPDATE_PATH,
            token,
            None,
            Some(&req),
        ) {
        Ok(resp) => {
            let mut managed_package_version: Option<i64> = None;
            if let Some(updated) = &resp.skill {
                if updated.version > 1 {
                    match crate::application::skills_market::managed_package::promote_managed_package(
                        id,
                        updated.version as i64,
                        &updated.content,
                    ) {
                        Ok(true) => managed_package_version = Some(updated.version as i64),
                        Ok(false) => {}
                        Err(error) => {
                            return AppResult::fail(
                                ErrorCode::InternalError,
                                format!("Station Skill updated but managed package promotion failed: {error}"),
                                None,
                            )
                        }
                    }
                }
            }
            let skill = resp.skill.map(|item| manifest_list_json(&item));
            success_payload(
                "skills_update",
                json!({
                    "ok": resp.success,
                    "skill": skill,
                    "managedPackageVersion": managed_package_version
                }),
            )
        }
        Err(err) => station_error("skills_update", err),
    }
}

pub fn skills_delete(
    station_client: &StationClient,
    input: SkillIdInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let req = model::agent::DeleteSkillRequest {
        agent_id: agent_id(input.agent_id),
        skill_id: id.to_string(),
    };
    match station_client
        .request_proto::<model::agent::DeleteSkillRequest, model::agent::DeleteSkillResponse>(
            Method::POST,
            SKILL_DELETE_PATH,
            token,
            None,
            Some(&req),
        ) {
        Ok(resp) => {
            let managed_removed =
                match crate::application::skills_market::managed_package::delete_managed_package(id)
                {
                    Ok(removed) => removed,
                    Err(error) => {
                        return AppResult::fail(
                            ErrorCode::InternalError,
                            format!(
                                "Station Skill deleted but managed package cleanup failed: {error}"
                            ),
                            None,
                        )
                    }
                };
            success_payload(
                "skills_delete",
                json!({ "ok": resp.success, "managedRemoved": managed_removed }),
            )
        }
        Err(err) => station_error("skills_delete", err),
    }
}

pub fn skills_toggle(
    station_client: &StationClient,
    input: SkillToggleInput,
    token: &str,
) -> AppResult<StubPayload> {
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let skill_id = input.id.trim();
    if skill_id.is_empty() {
        return invalid_argument("id is required");
    }
    match station_client.request_json_auth(
        Method::POST,
        "/sub-agent/agent/growth/skill/toggle",
        token,
        None,
        Some(&json!({
            "agent_id": agent_id(input.agent_id),
            "skill_id": skill_id,
            "enabled": input.enabled,
        })),
    ) {
        Ok(response) => success_payload("skills_toggle", response),
        Err(err) => station_error("skills_toggle", err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_manifest_json_exposes_station_metadata() {
        let skill = model::agent::SkillManifest {
            skill_id: "skill-1".to_string(),
            agent_id: "assistant".to_string(),
            name: "Workspace Helper".to_string(),
            description: "Helps with workspace tasks".to_string(),
            category: String::new(),
            platforms: vec![],
            conditions: None,
            content: "name: Workspace Helper".to_string(),
            source: "desktop".to_string(),
            trust_level: "community".to_string(),
            scan_verdict: "safe".to_string(),
            version: 3,
            created_at: None,
            updated_at: None,
            enabled: true,
            resources: vec![],
        };

        let json = manifest_list_json(&skill);

        assert_eq!(json["id"], "skill-1");
        assert_eq!(json["identifier"], "workspace-helper");
        assert_eq!(json["version"], "3");
        assert_eq!(json["source"], "desktop");
        assert_eq!(json["trustLevel"], "community");
        assert_eq!(json["scanVerdict"], "safe");
        assert_eq!(json["enabled"], true);
        assert_eq!(json["metaTags"][0], "community");
        assert_eq!(json["metaTags"][1], "safe");
    }

    #[test]
    fn skill_agent_id_defaults_to_assistant() {
        assert_eq!(agent_id(None), "assistant");
        assert_eq!(agent_id(Some("  ".to_string())), "assistant");
        assert_eq!(agent_id(Some("agent-1".to_string())), "agent-1");
    }

    #[test]
    fn skill_station_paths_target_agent_subserver() {
        for path in [
            SKILL_LIST_PATH,
            SKILL_GET_PATH,
            SKILL_INSTALL_PATH,
            SKILL_UPDATE_PATH,
            SKILL_DELETE_PATH,
            SKILL_VERSIONS_PATH,
            SKILL_ROLLBACK_PATH,
        ] {
            assert!(
                path.starts_with("/sub-agent/agent/"),
                "skill route must target the Agent subserver: {path}"
            );
        }
    }

    #[test]
    fn skill_detail_json_exposes_resource_tree_and_runtime_load_policy() {
        let skill = model::agent::SkillManifest {
            skill_id: "skill-1".to_string(),
            agent_id: "assistant".to_string(),
            name: "Review".to_string(),
            description: "Reviews code".to_string(),
            category: String::new(),
            platforms: vec![],
            conditions: None,
            content: String::new(),
            source: "desktop".to_string(),
            trust_level: "community".to_string(),
            scan_verdict: "safe".to_string(),
            version: 2,
            created_at: None,
            updated_at: None,
            enabled: true,
            resources: vec![
                model::agent::SkillResource {
                    path: "references/api.md".to_string(),
                    content_hash: "station-hash".to_string(),
                    size: 14,
                    kind: model::agent::SkillResourceKind::Reference.into(),
                    execution_owner: model::agent::ToolExecutionOwner::Station.into(),
                },
                model::agent::SkillResource {
                    path: "scripts/run.sh".to_string(),
                    content_hash: "client-hash".to_string(),
                    size: 10,
                    kind: model::agent::SkillResourceKind::Script.into(),
                    execution_owner: model::agent::ToolExecutionOwner::ClientCapability.into(),
                },
            ],
        };
        let content = "---\nname: Review\n---\n\nReview the selected code.";

        let detail = manifest_detail_json(&skill, content);

        assert_eq!(
            detail
                .get("runtimeLoad")
                .and_then(|value| value.get("systemPrompt"))
                .and_then(|value| value.get("policy"))
                .and_then(Value::as_str),
            Some("index-only")
        );
        let children = detail
            .get("resourceTree")
            .and_then(|value| value.get("root"))
            .and_then(|value| value.get("children"))
            .and_then(Value::as_array)
            .expect("root children");
        assert_eq!(children.len(), 3);
        assert_eq!(
            children[0].get("path").and_then(Value::as_str),
            Some("SKILL.md")
        );
        assert_eq!(
            children[0].get("loadTrigger").and_then(Value::as_str),
            Some("skill_view")
        );
        assert_eq!(
            children[0].get("loadedAtRuntime").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            children[1].get("role").and_then(Value::as_str),
            Some("reference")
        );
        assert_eq!(
            children[1].get("executionOwner").and_then(Value::as_str),
            Some("station")
        );
        assert_eq!(
            children[1].get("loadTrigger").and_then(Value::as_str),
            Some("skill_resource_read")
        );
        assert_eq!(
            children[2].get("role").and_then(Value::as_str),
            Some("script")
        );
        assert_eq!(
            children[2].get("executionOwner").and_then(Value::as_str),
            Some("client_capability")
        );
        assert_eq!(
            children[2].get("loadTrigger").and_then(Value::as_str),
            Some("skill.resource.read")
        );

        let flat = detail
            .get("resourceTree")
            .and_then(|value| value.get("resources"))
            .and_then(Value::as_array)
            .expect("flat resource metadata");
        assert_eq!(flat.len(), 2);
        assert_eq!(
            flat[0].get("kind").and_then(Value::as_str),
            Some("Reference")
        );
        assert_eq!(
            flat[1].get("executionOwner").and_then(Value::as_str),
            Some("client_capability")
        );
    }

    #[test]
    fn skill_versions_projection_exposes_reversible_rollback_policy() {
        let projected = normalize_versions_response(json!({
            "versions": [
                {
                    "version_id": "sv-1",
                    "skill_id": "skill-1",
                    "agent_id": "assistant",
                    "version": 2,
                    "trigger": "patch",
                    "created_at": "2026-06-17T00:00:00Z"
                }
            ],
            "total": 1
        }));

        assert_eq!(projected["total"], 1);
        assert_eq!(projected["versions"][0]["version"], 2);
        assert_eq!(projected["rollbackPolicy"]["owner"], "station");
        assert_eq!(projected["rollbackPolicy"]["reversible"], true);

        let rollback = normalize_rollback_response(json!({ "success": true }));
        assert_eq!(rollback["ok"], true);
        assert_eq!(rollback["rollbackPolicy"]["reversible"], true);
    }
}

pub fn skills_versions(
    station_client: &StationClient,
    input: SkillVersionsInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let limit = input.limit.unwrap_or(20).clamp(1, 100).to_string();
    let offset = input.offset.unwrap_or(0).to_string();
    let agent = agent_id(input.agent_id);
    let query = [
        ("agent_id", agent),
        ("skill_id", input.id),
        ("limit", limit),
        ("offset", offset),
    ];
    match station_client.request_json(Method::GET, SKILL_VERSIONS_PATH, token, Some(&query), None) {
        Ok(resp) => success_payload("skills_versions", normalize_versions_response(resp)),
        Err(err) => station_error("skills_versions", err),
    }
}

pub fn skills_rollback(
    station_client: &StationClient,
    input: SkillRollbackInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.target_version <= 0 {
        return invalid_argument("target_version must be > 0");
    }
    let body = json!({
        "agent_id": agent_id(input.agent_id),
        "skill_id": input.id,
        "target_version": input.target_version,
    });
    match station_client.request_json(Method::POST, SKILL_ROLLBACK_PATH, token, None, Some(body)) {
        Ok(resp) => success_payload("skills_rollback", normalize_rollback_response(resp)),
        Err(err) => station_error("skills_rollback", err),
    }
}

fn unwrap_station_data(value: Value) -> Value {
    value
        .get("data")
        .cloned()
        .or_else(|| value.get("Data").cloned())
        .unwrap_or(value)
}

fn normalize_versions_response(value: Value) -> Value {
    let data = unwrap_station_data(value);
    let versions = data
        .get("versions")
        .cloned()
        .or_else(|| data.get("Versions").cloned())
        .unwrap_or_else(|| json!([]));
    let total = data
        .get("total")
        .cloned()
        .or_else(|| data.get("Total").cloned())
        .unwrap_or_else(|| {
            versions
                .as_array()
                .map(|items| json!(items.len()))
                .unwrap_or_else(|| json!(0))
        });
    json!({
        "versions": versions,
        "total": total,
        "rollbackPolicy": {
            "owner": "station",
            "reversible": true,
            "preRollbackSnapshot": "current skill content is recorded as a rollback version before restore"
        }
    })
}

fn normalize_rollback_response(value: Value) -> Value {
    let data = unwrap_station_data(value);
    let success = data
        .get("success")
        .or_else(|| data.get("Success"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    json!({
        "ok": success,
        "rollbackPolicy": {
            "owner": "station",
            "reversible": true
        }
    })
}
