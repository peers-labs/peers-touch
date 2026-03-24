use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    SkillImportAddressInput, SkillImportGitHubInput, SkillMarketAddInput, SkillMarketDetailInput, SkillMarketIdInput,
    SkillMarketListInput, SkillMarketSyncInput, StubPayload,
};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn skills_import_url(input: SkillImportAddressInput) -> AppResult<StubPayload> {
    if input.address.trim().is_empty() {
        return invalid_argument("address is required");
    }
    success_payload("skills_import_url", json!({ "success": 1, "failed": 0, "items": [] }))
}

pub fn skills_import_github(input: SkillImportGitHubInput) -> AppResult<StubPayload> {
    if input.owner.trim().is_empty() || input.repo.trim().is_empty() {
        return invalid_argument("owner and repo are required");
    }
    success_payload(
        "skills_import_github",
        json!({ "id":"skill-imported","identifier":"imported","name":"Imported Skill","isNew":true }),
    )
}

pub fn skills_market_dir() -> AppResult<StubPayload> {
    success_payload("skills_market_dir", json!({ "path": ".skills" }))
}

pub fn skills_market_open_dir() -> AppResult<StubPayload> {
    success_payload("skills_market_open_dir", json!({ "ok": true, "path": ".skills" }))
}

pub fn skills_market_list() -> AppResult<StubPayload> {
    success_payload("skills_market_list", json!({ "markets": [] }))
}

pub fn skills_market_add(input: SkillMarketAddInput) -> AppResult<StubPayload> {
    if input.url.trim().is_empty() {
        return invalid_argument("url is required");
    }
    success_payload("skills_market_add", json!({ "ok": true }))
}

pub fn skills_market_remove(input: SkillMarketIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("skills_market_remove", json!({ "ok": true }))
}

pub fn skills_market_sync(input: SkillMarketSyncInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    success_payload("skills_market_sync", json!({ "skills": [], "total": 0 }))
}

pub fn skills_market_list_skills(input: SkillMarketListInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    let _ = input.q;
    success_payload("skills_market_list_skills", json!({ "skills": [], "total": 0 }))
}

pub fn skills_market_detail(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    success_payload(
        "skills_market_detail",
        json!({
            "skill":{
                "name":"Skill",
                "identifier":"skill",
                "description":"",
                "version":"1.0.0"
            },
            "readme":""
        }),
    )
}

pub fn skills_market_install(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    success_payload(
        "skills_market_install",
        json!({ "id":"skill-installed","identifier":"installed","name":"Installed Skill","isNew":true }),
    )
}
