use crate::application::skills;
use crate::contracts::{
    SkillImportAddressInput, SkillImportGitHubInput, SkillMarketAddInput, SkillMarketDetailInput,
    SkillMarketIdInput, SkillMarketListInput, SkillMarketSyncInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;

const DEFAULT_MARKET_ID: &str = "peers-touch-default";

#[derive(Clone, Copy)]
struct MarketSkill {
    identifier: &'static str,
    name: &'static str,
    description: &'static str,
    file_path: &'static str,
    content: &'static str,
    readme: &'static str,
    tags: &'static [&'static str],
}

const MARKET_SKILLS: &[MarketSkill] = &[
    MarketSkill {
        identifier: "conversation-memory-review",
        name: "Conversation Memory Review",
        description: "Review a conversation turn and propose memory writes with evidence.",
        file_path: "conversation-memory-review/SKILL.md",
        content: "# Conversation Memory Review\n\nUse this skill when a turn may update user or agent memory. Extract durable facts, cite the source turn, and avoid storing transient preferences.",
        readme: "Reviews a conversation turn and proposes white-box memory updates.",
        tags: &["memory", "review"],
    },
    MarketSkill {
        identifier: "cli-bridge-audit",
        name: "CLI Bridge Audit",
        description: "Inspect CLI-wrapped provider output for bridge policy, allowlist, and trace gaps.",
        file_path: "cli-bridge-audit/SKILL.md",
        content: "# CLI Bridge Audit\n\nUse this skill when a CLI-wrapped provider is involved. Check sandbox preset, retry count, bridge allowlist, and missing trace evidence before accepting side effects.",
        readme: "Audits CLI-wrapped provider runs and highlights policy gaps.",
        tags: &["provider", "audit"],
    },
];

fn market_skill_by_path(path: &str) -> Option<MarketSkill> {
    MARKET_SKILLS
        .iter()
        .copied()
        .find(|skill| skill.file_path == path)
}

fn market_skill_entry(skill: MarketSkill) -> serde_json::Value {
    json!({
        "identifier": skill.identifier,
        "name": skill.name,
        "description": skill.description,
        "filePath": skill.file_path,
        "installed": false
    })
}

fn market_skill_detail(skill: MarketSkill) -> serde_json::Value {
    json!({
        "identifier": skill.identifier,
        "name": skill.name,
        "description": skill.description,
        "filePath": skill.file_path,
        "installed": false,
        "content": skill.content,
        "version": "1.0.0",
        "author": "Peers",
        "authorUrl": "",
        "license": "MIT",
        "keywords": skill.tags,
        "avatar": "",
        "tags": skill.tags,
        "readme": skill.readme
    })
}

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
    let imported = match skills::install_market_skill(
        "imported-url-skill",
        "Imported URL Skill",
        input.address.trim(),
        &format!("# Imported URL Skill\n\nSource: {}", input.address.trim()),
    ) {
        Ok(value) => value,
        Err(err) => return err,
    };
    success_payload(
        "skills_import_url",
        json!({ "success": 1, "failed": 0, "items": [imported], "imported": [imported], "total": 1, "kind": "url" }),
    )
}

pub fn skills_import_github(input: SkillImportGitHubInput) -> AppResult<StubPayload> {
    if input.owner.trim().is_empty() || input.repo.trim().is_empty() {
        return invalid_argument("owner and repo are required");
    }
    let identifier = format!("{}-{}", input.owner.trim(), input.repo.trim());
    let name = format!("{}/{}", input.owner.trim(), input.repo.trim());
    let content = format!(
        "# {name}\n\nImported from GitHub repository `{}/{}`.",
        input.owner.trim(),
        input.repo.trim()
    );
    let imported =
        match skills::install_market_skill(&identifier, &name, "Imported GitHub Skill", &content) {
            Ok(value) => value,
            Err(err) => return err,
        };
    success_payload("skills_import_github", imported)
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
    success_payload(
        "skills_market_list",
        json!({
            "markets": [{
                "id": DEFAULT_MARKET_ID,
                "name": "Peers Touch",
                "url": "local://peers-touch/skills",
                "branch": "local",
                "skillCount": MARKET_SKILLS.len(),
                "lastSynced": "",
                "synced": true
            }]
        }),
    )
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
    if input.market_id.trim() != DEFAULT_MARKET_ID {
        return AppResult::fail(ErrorCode::NotFound, "Skill market not found", None);
    }
    let skills = MARKET_SKILLS
        .iter()
        .copied()
        .map(market_skill_entry)
        .collect::<Vec<_>>();
    let total = skills.len();
    success_payload(
        "skills_market_sync",
        json!({ "skills": skills, "total": total }),
    )
}

pub fn skills_market_list_skills(input: SkillMarketListInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() {
        return invalid_argument("market_id is required");
    }
    if input.market_id.trim() != DEFAULT_MARKET_ID {
        return AppResult::fail(ErrorCode::NotFound, "Skill market not found", None);
    }
    let q = input.q.unwrap_or_default().trim().to_lowercase();
    let skills = MARKET_SKILLS
        .iter()
        .copied()
        .filter(|skill| {
            q.is_empty()
                || skill.name.to_lowercase().contains(&q)
                || skill.description.to_lowercase().contains(&q)
                || skill.identifier.contains(&q)
        })
        .map(market_skill_entry)
        .collect::<Vec<_>>();
    let total = skills.len();
    success_payload(
        "skills_market_list_skills",
        json!({ "skills": skills, "total": total }),
    )
}

pub fn skills_market_detail(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    if input.market_id.trim() != DEFAULT_MARKET_ID {
        return AppResult::fail(ErrorCode::NotFound, "Skill market not found", None);
    }
    let Some(skill) = market_skill_by_path(input.file_path.trim()) else {
        return AppResult::fail(ErrorCode::NotFound, "Skill not found in market", None);
    };
    success_payload("skills_market_detail", market_skill_detail(skill))
}

pub fn skills_market_install(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    if input.market_id.trim().is_empty() || input.file_path.trim().is_empty() {
        return invalid_argument("market_id and file_path are required");
    }
    if input.market_id.trim() != DEFAULT_MARKET_ID {
        return AppResult::fail(ErrorCode::NotFound, "Skill market not found", None);
    }
    let Some(skill) = market_skill_by_path(input.file_path.trim()) else {
        return AppResult::fail(ErrorCode::NotFound, "Skill not found in market", None);
    };
    match skills::install_market_skill(
        skill.identifier,
        skill.name,
        skill.description,
        skill.content,
    ) {
        Ok(value) => success_payload("skills_market_install", value),
        Err(err) => err,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_status(payload: &StubPayload) -> serde_json::Value {
        serde_json::from_str(&payload.status).expect("status should be valid json")
    }

    #[test]
    fn market_should_list_default_skills() {
        let result = skills_market_list();
        assert!(result.ok);
        let status = parse_status(&result.data.expect("payload"));
        assert_eq!(status["markets"][0]["id"], DEFAULT_MARKET_ID);

        let result = skills_market_list_skills(SkillMarketListInput {
            market_id: DEFAULT_MARKET_ID.to_string(),
            q: Some("memory".to_string()),
        });
        assert!(result.ok);
        let status = parse_status(&result.data.expect("payload"));
        assert_eq!(status["total"], 1);
    }

    #[test]
    fn market_install_should_create_skill() {
        let result = skills_market_install(SkillMarketDetailInput {
            market_id: DEFAULT_MARKET_ID.to_string(),
            file_path: "cli-bridge-audit/SKILL.md".to_string(),
        });
        assert!(result.ok);
        let status = parse_status(&result.data.expect("payload"));
        assert_eq!(status["identifier"], "cli-bridge-audit");
        assert!(status["id"]
            .as_str()
            .unwrap_or_default()
            .starts_with("skill-"));
    }
}
