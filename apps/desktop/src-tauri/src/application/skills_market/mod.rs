use crate::application::{agents, mcp, plugins};
use crate::contracts::{
    AgentIdInput, AgentPackageImportInput, McpCreateInput, McpNameInput, SkillImportAddressInput,
    SkillImportGitHubInput, SkillImportZipInput, SkillMarketAddInput, SkillMarketDetailInput,
    SkillMarketIdInput, SkillMarketListInput, SkillMarketSyncInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model;
use base64::prelude::*;
use reqwest::blocking::Client;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarketSource {
    id: String,
    name: String,
    url: String,
    branch: Option<String>,
    skills: Vec<MarketSkill>,
    last_synced: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarketSkill {
    identifier: String,
    name: String,
    description: String,
    file_path: String,
    content: Option<String>,
    version: Option<String>,
    author: Option<String>,
    license: Option<String>,
    keywords: Vec<String>,
    publisher: Option<String>,
    homepage: Option<String>,
    repository: Option<String>,
    trust_level: Option<String>,
    risk_level: Option<String>,
    package_type: Option<String>,
    source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MarketInstallRecord {
    market_id: String,
    file_path: String,
    agent_id: String,
    skill_id: String,
    installed_at: String,
    source: String,
    scan_verdict: String,
    package_type: Option<String>,
}

#[derive(Default)]
struct MarketStore {
    sources: Vec<MarketSource>,
    installed: Vec<MarketInstallRecord>,
}

#[derive(Default, Serialize, Deserialize)]
struct MarketStoreFile {
    sources: Vec<MarketSource>,
    installed: Vec<MarketInstallRecord>,
}

struct SkillInstallOutcome {
    skill_id: String,
    installed: bool,
    verdict: String,
}

fn market_store() -> &'static Mutex<MarketStore> {
    static STORE: OnceLock<Mutex<MarketStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(load_market_store()))
}

fn station_error(command: &str, err: station_client::StationClientError) -> AppResult<StubPayload> {
    tracing::error!(command = command, error = %err, "Station skill import request failed");
    err.into_app_result(format!("{} failed", command))
}

fn agent_id(input: Option<String>) -> String {
    input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("assistant")
        .to_string()
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to create HTTP client: {error}"))
}

fn fetch_text(url: &str) -> Result<String, String> {
    let response = http_client()?
        .get(url)
        .header("Accept", "text/plain, application/json")
        .send()
        .map_err(|error| format!("failed to fetch skill source: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|error| format!("failed to read skill source: {error}"))?;
    if !status.is_success() {
        return Err(format!("skill source returned HTTP {}", status.as_u16()));
    }
    Ok(text)
}

fn github_raw_url(
    owner: &str,
    repo: &str,
    branch: Option<&str>,
    file_path: Option<&str>,
) -> String {
    let branch = branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    let file_path = file_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("SKILL.md")
        .trim_start_matches('/');
    format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file_path}")
}

fn derive_skill_name(content: &str, fallback: &str) -> Result<String, String> {
    for line in content.lines().take(80) {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return Ok(name.to_string());
            }
        }
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return Ok(title.to_string());
            }
        }
    }
    let fallback = fallback.trim();
    if fallback.is_empty() {
        return Err("skill package must include a name field or markdown title".to_string());
    }
    Ok(fallback.to_string())
}

fn validate_skill_content(content: &str, fallback_name: &str) -> Result<String, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("skill content is empty".to_string());
    }
    if trimmed.len() > 256 * 1024 {
        return Err("skill content exceeds 256 KiB".to_string());
    }
    derive_skill_name(trimmed, fallback_name)
}

fn install_skill(
    agent_id: String,
    name: String,
    source: String,
    content: String,
    token: &str,
) -> AppResult<StubPayload> {
    let outcome = match install_skill_at_station(agent_id, name.clone(), source, content, token) {
        Ok(outcome) => outcome,
        Err(result) => return result,
    };
    success_payload(
        "skills_import",
        json!({
            "id": outcome.skill_id,
            "identifier": name.to_lowercase().replace(' ', "-"),
            "name": name,
            "isNew": outcome.installed,
            "scanVerdict": outcome.verdict
        }),
    )
}

fn install_skill_at_station(
    agent_id: String,
    name: String,
    source: String,
    content: String,
    token: &str,
) -> Result<SkillInstallOutcome, AppResult<StubPayload>> {
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    let req = model::agent::InstallSkillRequest {
        agent_id,
        source,
        name: name.clone(),
        content,
        trust_level: "community".to_string(),
    };
    match station_client::request_proto::<
        model::agent::InstallSkillRequest,
        model::agent::InstallSkillResponse,
    >(
        Method::POST,
        "/agent/skill/install",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => Ok(SkillInstallOutcome {
            skill_id: resp.skill_id,
            installed: resp.installed,
            verdict: resp.verdict,
        }),
        Err(err) => Err(station_error("skills_import", err)),
    }
}

fn zip_skill_content(bytes: &[u8]) -> Result<(String, String), String> {
    let reader = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|error| format!("invalid ZIP package: {error}"))?;
    let mut candidates: Vec<(String, String)> = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("failed to read ZIP entry: {error}"))?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        let lower = name.to_lowercase();
        if !(lower.ends_with("skill.md")
            || lower.ends_with(".skill.md")
            || lower.ends_with("skill.yml")
            || lower.ends_with("skill.yaml"))
        {
            continue;
        }
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|error| format!("failed to read skill file as UTF-8: {error}"))?;
        candidates.push((name, content));
    }

    let Some((path, content)) = candidates
        .into_iter()
        .find(|(path, _)| path.to_lowercase().ends_with("skill.md"))
        .or_else(|| None)
    else {
        return Err("ZIP package must contain SKILL.md".to_string());
    };
    let fallback = path
        .rsplit('/')
        .next()
        .unwrap_or("Skill")
        .trim_end_matches(".md")
        .trim_end_matches(".yml")
        .trim_end_matches(".yaml");
    let name = validate_skill_content(&content, fallback)?;
    Ok((name, content))
}

fn market_skill_to_json(
    market_id: &str,
    skill: &MarketSkill,
    installed: Option<&MarketInstallRecord>,
) -> Value {
    json!({
        "marketId": market_id,
        "identifier": skill.identifier,
        "name": skill.name,
        "description": skill.description,
        "filePath": skill.file_path,
        "installed": installed.is_some(),
        "installedSkillId": installed.map(|record| record.skill_id.as_str()).unwrap_or(""),
        "installedAt": installed.map(|record| record.installed_at.as_str()).unwrap_or(""),
        "scanVerdict": installed.map(|record| record.scan_verdict.as_str()).unwrap_or(""),
        "version": skill.version.clone().unwrap_or_else(|| "1".to_string()),
        "author": skill.author.clone().unwrap_or_default(),
        "authorUrl": "",
        "license": skill.license.clone().unwrap_or_default(),
        "keywords": skill.keywords.clone(),
        "avatar": "",
        "tags": skill.keywords.clone(),
        "publisher": skill.publisher.clone().or_else(|| skill.author.clone()).unwrap_or_default(),
        "homepage": skill.homepage.clone().unwrap_or_default(),
        "repository": skill.repository.clone().unwrap_or_default(),
        "trustLevel": skill.trust_level.clone().unwrap_or_else(|| "community".to_string()),
        "riskLevel": skill.risk_level.clone().unwrap_or_else(|| infer_risk_level(skill).to_string()),
        "packageType": skill.package_type.clone().or_else(|| installed.and_then(|record| record.package_type.clone())).unwrap_or_else(|| "skill".to_string()),
        "source": skill.source.clone().unwrap_or_else(|| "market".to_string())
    })
}

fn market_store_path() -> Result<PathBuf, String> {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["skills_market", "store.json"],
    )
    .map_err(|error| format!("failed to resolve skill market store path: {error:?}"))
}

fn load_market_store() -> MarketStore {
    let path = match market_store_path() {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(error = %error, "Failed to resolve skill market store path");
            return MarketStore::default();
        }
    };
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return MarketStore::default()
        }
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "Failed to read skill market store");
            return MarketStore::default();
        }
    };
    match serde_json::from_str::<MarketStoreFile>(&content) {
        Ok(file) => MarketStore {
            sources: file.sources,
            installed: file.installed,
        },
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "Failed to parse skill market store");
            MarketStore::default()
        }
    }
}

fn persist_market_store(store: &MarketStore) -> Result<(), String> {
    let path = market_store_path()?;
    let file = MarketStoreFile {
        sources: store.sources.clone(),
        installed: store.installed.clone(),
    };
    let content = serde_json::to_string_pretty(&file)
        .map_err(|error| format!("failed to serialize skill market store: {error}"))?;
    storage::write_string_atomic(&path, &content)
        .map_err(|error| format!("failed to write skill market store: {error}"))
}

fn persist_error(error: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %error, "Failed to persist skill market store");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("failed to persist skill market store: {error}"),
        None,
    )
}

fn installed_record<'a>(
    store: &'a MarketStore,
    market_id: &str,
    file_path: &str,
    agent_id: &str,
) -> Option<&'a MarketInstallRecord> {
    store.installed.iter().find(|record| {
        record.market_id == market_id
            && record.file_path == file_path
            && record.agent_id == agent_id
    })
}

fn infer_risk_level(skill: &MarketSkill) -> &'static str {
    let text = format!(
        "{} {} {}",
        skill.name,
        skill.description,
        skill.keywords.join(" ")
    )
    .to_lowercase();
    if text.contains("shell") || text.contains("filesystem") || text.contains("network") {
        "medium"
    } else {
        "low"
    }
}

fn parse_market_skills(text: &str) -> Result<Vec<MarketSkill>, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|error| format!("invalid market JSON: {error}"))?;
    let items = value
        .get("skills")
        .or_else(|| value.get("items"))
        .and_then(Value::as_array)
        .or_else(|| value.as_array())
        .ok_or_else(|| "market index must be a JSON array or contain skills[]".to_string())?;

    let mut out = Vec::new();
    for item in items {
        let file_path = item
            .get("filePath")
            .or_else(|| item.get("file_path"))
            .or_else(|| item.get("path"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if file_path.is_empty() {
            continue;
        }
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(file_path)
            .to_string();
        let identifier = item
            .get("identifier")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| name.to_lowercase().replace(' ', "-"));
        out.push(MarketSkill {
            identifier,
            name,
            description: item
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            file_path: file_path.to_string(),
            content: item
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_string),
            version: item
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_string),
            author: item
                .get("author")
                .and_then(Value::as_str)
                .map(str::to_string),
            license: item
                .get("license")
                .and_then(Value::as_str)
                .map(str::to_string),
            keywords: item
                .get("keywords")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            publisher: item
                .get("publisher")
                .and_then(Value::as_str)
                .map(str::to_string),
            homepage: item
                .get("homepage")
                .or_else(|| item.get("authorUrl"))
                .and_then(Value::as_str)
                .map(str::to_string),
            repository: item
                .get("repository")
                .and_then(Value::as_str)
                .map(str::to_string),
            trust_level: item
                .get("trustLevel")
                .or_else(|| item.get("trust_level"))
                .and_then(Value::as_str)
                .map(str::to_string),
            risk_level: item
                .get("riskLevel")
                .or_else(|| item.get("risk_level"))
                .and_then(Value::as_str)
                .map(str::to_string),
            package_type: item
                .get("packageType")
                .or_else(|| item.get("package_type"))
                .and_then(Value::as_str)
                .map(str::to_string),
            source: item
                .get("source")
                .and_then(Value::as_str)
                .map(str::to_string),
        });
    }
    Ok(out)
}

fn join_market_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

pub fn skills_import_url(input: SkillImportAddressInput, token: &str) -> AppResult<StubPayload> {
    if input.address.trim().is_empty() {
        return invalid_argument("address is required");
    }
    let content = match fetch_text(input.address.trim()) {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let name = match validate_skill_content(&content, input.address.trim()) {
        Ok(name) => name,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    install_skill(
        agent_id(input.agent_id),
        name,
        input.address,
        content,
        token,
    )
}

pub fn skills_import_github(input: SkillImportGitHubInput, token: &str) -> AppResult<StubPayload> {
    if input.owner.trim().is_empty() || input.repo.trim().is_empty() {
        return invalid_argument("owner and repo are required");
    }
    let url = github_raw_url(
        input.owner.trim(),
        input.repo.trim(),
        input.branch.as_deref(),
        input.file_path.as_deref(),
    );
    let content = match fetch_text(&url) {
        Ok(content) => content,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let fallback = input
        .file_path
        .as_deref()
        .unwrap_or("SKILL.md")
        .rsplit('/')
        .next()
        .unwrap_or("Skill");
    let name = match validate_skill_content(&content, fallback) {
        Ok(name) => name,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    install_skill(agent_id(input.agent_id), name, url, content, token)
}

pub fn skills_import_zip(input: SkillImportZipInput, token: &str) -> AppResult<StubPayload> {
    if input.data_base64.trim().is_empty() {
        return invalid_argument("data_base64 is required");
    }
    let bytes = match BASE64_STANDARD.decode(input.data_base64.trim()) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid ZIP payload: {error}"),
                None,
            )
        }
    };
    let (name, content) = match zip_skill_content(&bytes) {
        Ok(value) => value,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    install_skill(
        agent_id(input.agent_id),
        name,
        input.file_name,
        content,
        token,
    )
}

pub fn skills_validate_zip(input: SkillImportZipInput) -> AppResult<StubPayload> {
    if input.data_base64.trim().is_empty() {
        return invalid_argument("data_base64 is required");
    }
    let bytes = match BASE64_STANDARD.decode(input.data_base64.trim()) {
        Ok(bytes) => bytes,
        Err(error) => {
            return success_payload(
                "skills_validate_zip",
                json!({ "valid": false, "skillPath": "", "skillName": "", "skillCount": 0, "error": format!("invalid ZIP payload: {error}") }),
            )
        }
    };
    match zip_skill_content(&bytes) {
        Ok((name, _)) => success_payload(
            "skills_validate_zip",
            json!({ "valid": true, "skillPath": "SKILL.md", "skillName": name, "skillCount": 1 }),
        ),
        Err(error) => success_payload(
            "skills_validate_zip",
            json!({ "valid": false, "skillPath": "", "skillName": "", "skillCount": 0, "error": error }),
        ),
    }
}

pub fn skills_market_dir() -> AppResult<StubPayload> {
    success_payload("skills_market_dir", json!({ "path": ".skills" }))
}

pub fn skills_market_open_dir() -> AppResult<StubPayload> {
    success_payload(
        "skills_market_open_dir",
        json!({ "ok": true, "path": ".skills" }),
    )
}

pub fn skills_market_list() -> AppResult<StubPayload> {
    let guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let markets = guard
        .sources
        .iter()
        .map(|source| {
            json!({
                "id": source.id,
                "name": source.name,
                "url": source.url,
                "branch": source.branch,
                "skillCount": source.skills.len(),
                "lastSynced": source.last_synced,
                "synced": source.error.is_none() && !source.skills.is_empty(),
                "error": source.error
            })
        })
        .collect::<Vec<_>>();
    success_payload("skills_market_list", json!({ "markets": markets }))
}

pub fn skills_market_add(input: SkillMarketAddInput) -> AppResult<StubPayload> {
    if input.url.trim().is_empty() {
        return invalid_argument("url is required");
    }
    let url = input.url.trim().to_string();
    let id = format!("market-{}", sha256_short(&url));
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    if !guard.sources.iter().any(|source| source.id == id) {
        guard.sources.push(MarketSource {
            id: id.clone(),
            name: input.name.unwrap_or_else(|| url.clone()),
            url,
            branch: input.branch,
            skills: Vec::new(),
            last_synced: None,
            error: None,
        });
    }
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload("skills_market_add", json!({ "ok": true, "id": id }))
}

pub fn skills_market_remove(input: SkillMarketIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let before = guard.sources.len();
    guard.sources.retain(|source| source.id != input.id);
    guard
        .installed
        .retain(|record| record.market_id != input.id);
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "skills_market_remove",
        json!({ "ok": before != guard.sources.len() }),
    )
}

pub fn skills_market_sync(input: SkillMarketSyncInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let market_id = input.market_id.clone();
    let sync_result = {
        let Some(source) = guard
            .sources
            .iter_mut()
            .find(|source| source.id == input.market_id)
        else {
            return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
        };
        match fetch_text(&source.url).and_then(|text| parse_market_skills(&text)) {
            Ok(skills) => {
                source.skills = skills;
                source.last_synced = Some(current_millis().to_string());
                source.error = None;
                Ok(source.skills.clone())
            }
            Err(error) => {
                source.error = Some(error.clone());
                Err(error)
            }
        }
    };
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    match sync_result {
        Ok(source_skills) => {
            let skills = source_skills
                .iter()
                .map(|skill| {
                    market_skill_to_json(
                        &market_id,
                        skill,
                        installed_record(&guard, &market_id, &skill.file_path, "assistant"),
                    )
                })
                .collect::<Vec<_>>();
            let total = skills.len();
            success_payload(
                "skills_market_sync",
                json!({ "skills": skills, "total": total }),
            )
        }
        Err(error) => AppResult::fail(ErrorCode::InvalidArgument, error, None),
    }
}

pub fn skills_market_list_skills(input: SkillMarketListInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    let guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let Some(source) = guard
        .sources
        .iter()
        .find(|source| source.id == input.market_id)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
    };
    let q = input.q.unwrap_or_default().to_lowercase();
    let skills = source
        .skills
        .iter()
        .filter(|skill| {
            q.is_empty()
                || skill.name.to_lowercase().contains(&q)
                || skill.description.to_lowercase().contains(&q)
                || skill.identifier.to_lowercase().contains(&q)
        })
        .map(|skill| {
            market_skill_to_json(
                &source.id,
                skill,
                installed_record(&guard, &source.id, &skill.file_path, "assistant"),
            )
        })
        .collect::<Vec<_>>();
    success_payload(
        "skills_market_list_skills",
        json!({ "skills": skills, "total": skills.len() }),
    )
}

pub fn skills_market_detail(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    let guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    let Some(source) = guard
        .sources
        .iter()
        .find(|source| source.id == input.market_id)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
    };
    let Some(skill) = source
        .skills
        .iter()
        .find(|skill| skill.file_path == input.file_path)
    else {
        return AppResult::fail(ErrorCode::NotFound, "market skill not found", None);
    };
    let content = match &skill.content {
        Some(content) => content.clone(),
        None => match fetch_text(&join_market_url(&source.url, &skill.file_path)) {
            Ok(content) => content,
            Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
        },
    };
    let mut detail = market_skill_to_json(
        &source.id,
        skill,
        installed_record(&guard, &source.id, &skill.file_path, "assistant"),
    );
    if let Some(obj) = detail.as_object_mut() {
        obj.insert("content".to_string(), json!(content));
    }
    success_payload("skills_market_detail", detail)
}

pub fn skills_market_install(
    actor_id: &str,
    input: SkillMarketDetailInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    let target_agent_id = agent_id(input.agent_id.clone());
    let (source_url, market_id, skill) = {
        let guard = match market_store().lock() {
            Ok(guard) => guard,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("failed to access market store: {error}"),
                    None,
                )
            }
        };
        let Some(source) = guard
            .sources
            .iter()
            .find(|source| source.id == input.market_id)
        else {
            return AppResult::fail(ErrorCode::NotFound, "market source not found", None);
        };
        let Some(skill) = source
            .skills
            .iter()
            .find(|skill| skill.file_path == input.file_path)
        else {
            return AppResult::fail(ErrorCode::NotFound, "market skill not found", None);
        };
        (source.url.clone(), source.id.clone(), skill.clone())
    };
    let source = join_market_url(&source_url, &skill.file_path);
    let content = match skill.content.clone() {
        Some(content) => content,
        None => match fetch_text(&source) {
            Ok(content) => content,
            Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
        },
    };
    match skill.package_type.as_deref().unwrap_or("skill") {
        "agent" => {
            return install_agent_market_package(
                actor_id,
                token,
                target_agent_id,
                market_id,
                skill,
                source,
                content,
            );
        }
        "mcp" => {
            return install_mcp_market_package(target_agent_id, market_id, skill, source, content);
        }
        "plugin" => {
            return install_plugin_market_package(
                target_agent_id,
                market_id,
                skill,
                source,
                content,
            );
        }
        _ => {}
    }
    let name = match validate_skill_content(&content, &skill.name) {
        Ok(name) => name,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let outcome = match install_skill_at_station(
        target_agent_id.clone(),
        name.clone(),
        source.clone(),
        content,
        token,
    ) {
        Ok(outcome) => outcome,
        Err(result) => return result,
    };
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    guard.installed.retain(|record| {
        !(record.market_id == market_id
            && record.file_path == skill.file_path
            && record.agent_id == target_agent_id)
    });
    guard.installed.push(MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: outcome.skill_id.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: outcome.verdict.clone(),
        package_type: Some("skill".to_string()),
    });
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": outcome.skill_id,
            "identifier": name.to_lowercase().replace(' ', "-"),
            "name": name,
            "isNew": outcome.installed,
            "packageType": "skill",
            "scanVerdict": outcome.verdict
        }),
    )
}

fn install_plugin_market_package(
    target_agent_id: String,
    market_id: String,
    skill: MarketSkill,
    source: String,
    content: String,
) -> AppResult<StubPayload> {
    let result = plugins::install_plugin_from_content(
        &content,
        &source,
        Some(market_id.clone()),
        Some(skill.file_path.clone()),
    );
    let Some(payload) = result.data else {
        return result;
    };
    let payload_value = serde_json::from_str::<Value>(&payload.status).unwrap_or_else(|error| {
        json!({
            "id": "",
            "error": format!("failed to decode plugin install payload: {error}")
        })
    });
    let plugin_id = payload_value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if plugin_id.is_empty() {
        return AppResult {
            ok: false,
            data: None,
            error: result.error,
        };
    }
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    guard.installed.retain(|record| {
        !(record.market_id == market_id
            && record.file_path == skill.file_path
            && record.agent_id == target_agent_id)
    });
    guard.installed.push(MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: plugin_id.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: "manifest-validated".to_string(),
        package_type: Some("plugin".to_string()),
    });
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": plugin_id,
            "identifier": plugin_id,
            "name": skill.name,
            "isNew": true,
            "packageType": "plugin",
            "scanVerdict": "manifest-validated"
        }),
    )
}

fn install_agent_market_package(
    actor_id: &str,
    token: &str,
    target_agent_id: String,
    market_id: String,
    skill: MarketSkill,
    source: String,
    content: String,
) -> AppResult<StubPayload> {
    let package = match serde_json::from_str::<Value>(&content) {
        Ok(value) => value.get("package").cloned().unwrap_or(value),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid Agent package JSON: {error}"),
                None,
            )
        }
    };
    let result = agents::agents_import_package(
        actor_id,
        token,
        AgentPackageImportInput {
            package,
            name: Some(skill.name.clone()),
        },
    );
    let Some(payload) = result.data else {
        return result;
    };
    let agent = serde_json::from_str::<Value>(&payload.status).unwrap_or_else(|_| json!({}));
    let agent_id = agent
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if agent_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Agent package installed without an agent id",
            None,
        );
    }
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    guard.installed.retain(|record| {
        !(record.market_id == market_id
            && record.file_path == skill.file_path
            && record.agent_id == target_agent_id)
    });
    guard.installed.push(MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: agent_id.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: "package-validated".to_string(),
        package_type: Some("agent".to_string()),
    });
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": agent_id,
            "identifier": agent.get("name").and_then(Value::as_str).unwrap_or(&skill.identifier),
            "name": agent.get("title").and_then(Value::as_str).unwrap_or(&skill.name),
            "isNew": true,
            "packageType": "agent",
            "scanVerdict": "package-validated"
        }),
    )
}

fn install_mcp_market_package(
    target_agent_id: String,
    market_id: String,
    skill: MarketSkill,
    source: String,
    content: String,
) -> AppResult<StubPayload> {
    let server = match serde_json::from_str::<Value>(&content) {
        Ok(value) => value
            .get("server")
            .or_else(|| value.get("mcpServer"))
            .cloned()
            .unwrap_or(value),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid MCP server package JSON: {error}"),
                None,
            )
        }
    };
    let result = mcp::mcp_create_server(McpCreateInput { data: server });
    let Some(payload) = result.data else {
        return result;
    };
    let value = serde_json::from_str::<Value>(&payload.status).unwrap_or_else(|_| json!({}));
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "MCP package installed without a server name",
            None,
        );
    }
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            )
        }
    };
    guard.installed.retain(|record| {
        !(record.market_id == market_id
            && record.file_path == skill.file_path
            && record.agent_id == target_agent_id)
    });
    guard.installed.push(MarketInstallRecord {
        market_id,
        file_path: skill.file_path,
        agent_id: target_agent_id,
        skill_id: name.clone(),
        installed_at: current_millis().to_string(),
        source,
        scan_verdict: "config-validated".to_string(),
        package_type: Some("mcp".to_string()),
    });
    if let Err(error) = persist_market_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "skills_market_install",
        json!({
            "id": name,
            "identifier": skill.identifier,
            "name": skill.name,
            "isNew": true,
            "packageType": "mcp",
            "scanVerdict": "config-validated"
        }),
    )
}

pub fn skills_market_uninstall(
    actor_id: &str,
    input: SkillMarketDetailInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let target_agent_id = agent_id(input.agent_id.clone());
    let record = {
        let guard = match market_store().lock() {
            Ok(guard) => guard,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("failed to access market store: {error}"),
                    None,
                )
            }
        };
        installed_record(&guard, &input.market_id, &input.file_path, &target_agent_id).cloned()
    };
    let Some(record) = record else {
        return AppResult::fail(ErrorCode::NotFound, "market package is not installed", None);
    };
    let package_type =
        record
            .package_type
            .as_deref()
            .unwrap_or(if record.scan_verdict == "manifest-validated" {
                "plugin"
            } else {
                "skill"
            });

    if package_type == "agent" {
        let result = agents::agents_delete(
            actor_id,
            token,
            AgentIdInput {
                id: record.skill_id.clone(),
            },
        );
        if !result.ok {
            return result;
        }
        if let Err(result) = remove_market_install_record(&record) {
            return result;
        }
        return success_payload(
            "skills_market_uninstall",
            json!({ "ok": true, "skillId": record.skill_id, "packageType": "agent" }),
        );
    }

    if package_type == "mcp" {
        let result = mcp::mcp_delete_server(McpNameInput {
            name: record.skill_id.clone(),
        });
        if !result.ok {
            return result;
        }
        if let Err(result) = remove_market_install_record(&record) {
            return result;
        }
        return success_payload(
            "skills_market_uninstall",
            json!({ "ok": true, "skillId": record.skill_id, "packageType": "mcp" }),
        );
    }

    if package_type == "plugin" {
        let result =
            plugins::uninstall_plugin_by_market_package(&record.market_id, &record.file_path);
        if !result.ok {
            return result;
        }
        if let Err(result) = remove_market_install_record(&record) {
            return result;
        }
        return success_payload(
            "skills_market_uninstall",
            json!({ "ok": true, "skillId": record.skill_id, "packageType": "plugin" }),
        );
    }
    let req = model::agent::DeleteSkillRequest {
        agent_id: record.agent_id.clone(),
        skill_id: record.skill_id.clone(),
    };
    if let Err(err) = station_client::request_proto::<
        model::agent::DeleteSkillRequest,
        model::agent::DeleteSkillResponse,
    >(Method::POST, "/agent/skill/delete", token, None, Some(&req))
    {
        return station_error("skills_market_uninstall", err);
    }
    if let Err(result) = remove_market_install_record(&record) {
        return result;
    }
    success_payload(
        "skills_market_uninstall",
        json!({ "ok": true, "skillId": record.skill_id, "packageType": "skill" }),
    )
}

fn remove_market_install_record(
    record: &MarketInstallRecord,
) -> Result<(), AppResult<StubPayload>> {
    let mut guard = match market_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access market store: {error}"),
                None,
            ))
        }
    };
    guard.installed.retain(|item| {
        !(item.market_id == record.market_id
            && item.file_path == record.file_path
            && item.agent_id == record.agent_id)
    });
    if let Err(error) = persist_market_store(&guard) {
        return Err(persist_error(error));
    }
    Ok(())
}

fn sha256_short(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(value.as_bytes());
    hex::encode(&digest[..6])
}

fn current_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn with_temp_storage_root(f: impl FnOnce()) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "peers-touch-skill-market-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("temp storage root");
        let previous_storage_root = std::env::var_os("PEERS_STORAGE_ROOT");
        std::env::set_var("PEERS_STORAGE_ROOT", base.to_str().expect("utf8 path"));
        f();
        match previous_storage_root {
            Some(value) => std::env::set_var("PEERS_STORAGE_ROOT", value),
            None => std::env::remove_var("PEERS_STORAGE_ROOT"),
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn skill_content_validation_accepts_frontmatter_name() {
        let name = validate_skill_content("---\nname: Code Review\n---\nReview code.", "fallback")
            .expect("valid skill content");
        assert_eq!(name, "Code Review");
    }

    #[test]
    fn market_index_parser_accepts_skills_array() {
        let skills = parse_market_skills(
            r#"{
              "skills": [
                {
                  "identifier": "review",
                  "name": "Review",
                  "description": "Review code",
                  "filePath": "skills/review/SKILL.md",
                  "keywords": ["code"]
                }
              ]
            }"#,
        )
        .expect("valid market index");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].identifier, "review");
        assert_eq!(skills[0].file_path, "skills/review/SKILL.md");
        assert_eq!(skills[0].keywords, vec!["code".to_string()]);
    }

    #[test]
    fn market_index_parser_keeps_trust_and_risk_metadata() {
        let skills = parse_market_skills(
            r#"{
              "skills": [
                {
                  "identifier": "shell-helper",
                  "name": "Shell Helper",
                  "description": "Run shell workflows",
                  "filePath": "skills/shell/SKILL.md",
                  "publisher": "Peers",
                  "repository": "https://example.test/repo",
                  "trustLevel": "verified",
                  "riskLevel": "high",
                  "packageType": "plugin"
                }
              ]
            }"#,
        )
        .expect("valid market index");

        let item = market_skill_to_json("market-a", &skills[0], None);
        assert_eq!(item.get("publisher").and_then(Value::as_str), Some("Peers"));
        assert_eq!(
            item.get("trustLevel").and_then(Value::as_str),
            Some("verified")
        );
        assert_eq!(item.get("riskLevel").and_then(Value::as_str), Some("high"));
        assert_eq!(
            item.get("packageType").and_then(Value::as_str),
            Some("plugin")
        );
    }

    #[test]
    fn market_index_parser_accepts_agent_and_mcp_packages() {
        let packages = parse_market_skills(
            r#"{
              "items": [
                {
                  "identifier": "agent-reviewer",
                  "name": "Reviewer Agent",
                  "filePath": "agents/reviewer.json",
                  "packageType": "agent",
                  "publisher": "Peers",
                  "trustLevel": "verified",
                  "riskLevel": "medium"
                },
                {
                  "identifier": "filesystem-mcp",
                  "name": "Filesystem MCP",
                  "filePath": "mcp/filesystem.json",
                  "packageType": "mcp",
                  "publisher": "Peers",
                  "trustLevel": "community",
                  "riskLevel": "high"
                }
              ]
            }"#,
        )
        .expect("valid market index");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].package_type.as_deref(), Some("agent"));
        assert_eq!(packages[1].package_type.as_deref(), Some("mcp"));
    }

    #[test]
    fn market_store_persists_sources_and_install_ledger() {
        with_temp_storage_root(|| {
            let store = MarketStore {
                sources: vec![MarketSource {
                    id: "market-a".to_string(),
                    name: "Market A".to_string(),
                    url: "https://example.test/index.json".to_string(),
                    branch: None,
                    skills: vec![MarketSkill {
                        identifier: "review".to_string(),
                        name: "Review".to_string(),
                        description: "Review code".to_string(),
                        file_path: "skills/review/SKILL.md".to_string(),
                        content: None,
                        version: Some("1.0.0".to_string()),
                        author: Some("Peers".to_string()),
                        license: Some("MIT".to_string()),
                        keywords: vec!["code".to_string()],
                        publisher: Some("Peers".to_string()),
                        homepage: None,
                        repository: None,
                        trust_level: Some("verified".to_string()),
                        risk_level: Some("low".to_string()),
                        package_type: Some("skill".to_string()),
                        source: Some("market".to_string()),
                    }],
                    last_synced: Some("1".to_string()),
                    error: None,
                }],
                installed: vec![MarketInstallRecord {
                    market_id: "market-a".to_string(),
                    file_path: "skills/review/SKILL.md".to_string(),
                    agent_id: "assistant".to_string(),
                    skill_id: "skill-1".to_string(),
                    installed_at: "2".to_string(),
                    source: "https://example.test/skills/review/SKILL.md".to_string(),
                    scan_verdict: "safe".to_string(),
                    package_type: Some("skill".to_string()),
                }],
            };
            persist_market_store(&store).expect("persist market store");

            let loaded = load_market_store();
            assert_eq!(loaded.sources.len(), 1);
            assert_eq!(loaded.installed.len(), 1);
            let installed =
                installed_record(&loaded, "market-a", "skills/review/SKILL.md", "assistant")
                    .expect("installed record");
            let item =
                market_skill_to_json("market-a", &loaded.sources[0].skills[0], Some(installed));
            assert_eq!(item.get("installed").and_then(Value::as_bool), Some(true));
            assert_eq!(
                item.get("installedSkillId").and_then(Value::as_str),
                Some("skill-1")
            );
        });
    }
}
