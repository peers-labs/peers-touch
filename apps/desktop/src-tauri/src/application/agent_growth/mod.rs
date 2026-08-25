use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::infrastructure::station_client;
use crate::model;
use prost::Message;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentGrowthInput {
    pub agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentMemoryListInput {
    pub agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentSkillListInput {
    pub agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentFeedbackInput {
    pub agent_id: String,
    pub turn_id: String,
    pub conversation_id: String,
    pub assistant_message_id: String,
    pub signal: String,
    pub source: String,
    pub rating: i32,
    pub categories: Vec<String>,
    pub comment: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentTurnFeedbackListInput {
    pub turn_id: String,
}

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> Value {
    ts.as_ref()
        .map(|t| {
            let secs = t.seconds as i128 * 1000;
            let nanos = t.nanos as i128 / 1_000_000;
            Value::from((secs + nanos) as i64)
        })
        .unwrap_or(Value::Null)
}

fn memory_item_to_json(m: &model::agent::MemoryItem) -> Value {
    json!({
        "memoryId": m.memory_id,
        "agentId": m.agent_id,
        "target": m.target,
        "content": m.content,
        "sourceTurnId": m.source_turn_id,
        "createdAt": ts_millis(&m.created_at),
        "updatedAt": ts_millis(&m.updated_at),
    })
}

fn skill_conditions_to_json(c: &model::agent::SkillConditions) -> Value {
    json!({
        "fallbackForToolsets": c.fallback_for_toolsets,
        "requiresTools": c.requires_tools,
    })
}

fn skill_manifest_to_json(s: &model::agent::SkillManifest) -> Value {
    json!({
        "skillId": s.skill_id,
        "agentId": s.agent_id,
        "name": s.name,
        "description": s.description,
        "category": s.category,
        "platforms": s.platforms,
        "conditions": s.conditions.as_ref().map(skill_conditions_to_json),
        "content": s.content,
        "source": s.source,
        "trustLevel": s.trust_level,
        "scanVerdict": s.scan_verdict,
        "version": s.version,
        "createdAt": ts_millis(&s.created_at),
        "updatedAt": ts_millis(&s.updated_at),
    })
}

fn growth_snapshot_to_json(r: &model::agent::GetGrowthSnapshotResponse) -> Value {
    json!({
        "agentId": r.agent_id,
        "totalMemories": r.total_memories,
        "totalSkills": r.total_skills,
        "totalReviews": r.total_reviews,
        "totalTurns": r.total_turns,
        "positiveFeedback": r.positive_feedback,
        "negativeFeedback": r.negative_feedback,
        "feedbackRatio": r.feedback_ratio,
        "errorRate": r.error_rate,
        "retryRate": r.retry_rate,
        "reviewSuccessRate": r.review_success_rate,
        "memoryGrowthRate": r.memory_growth_rate,
        "skillGrowthRate": r.skill_growth_rate,
        "qualityTrend": r.quality_trend,
        "growthScore": r.growth_score,
        "growthVerdict": r.growth_verdict,
        "windowStart": r.window_start,
        "windowEnd": r.window_end,
    })
}

pub fn agent_growth_snapshot(input: AgentGrowthInput, token: &str) -> AppResult<StubPayload> {
    let req = model::agent::GetGrowthSnapshotRequest {
        agent_id: input.agent_id,
    };

    match station_client::request_proto::<
        model::agent::GetGrowthSnapshotRequest,
        model::agent::GetGrowthSnapshotResponse,
    >(
        Method::POST,
        "/agent/growth/snapshot",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let status = serde_json::to_string(&growth_snapshot_to_json(&resp))
                .unwrap_or_else(|_| r#"{"agentId":""}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_growth_snapshot".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_growth_snapshot", error = %err);
            err.into_app_result("Failed to get growth snapshot")
        }
    }
}

pub fn agent_memory_list(input: AgentMemoryListInput, token: &str) -> AppResult<StubPayload> {
    let req = model::agent::ListMemoriesRequest {
        agent_id: input.agent_id,
        target: String::new(),
        layer: 0,
        page: 0,
        page_size: 100,
        order_by: "created_at".to_string(),
        since: String::new(),
        until: String::new(),
        period: String::new(),
    };

    match station_client::request_proto::<
        model::agent::ListMemoriesRequest,
        model::agent::ListMemoriesResponse,
    >(Method::POST, "/agent/memory/list", token, None, Some(&req))
    {
        Ok(resp) => {
            let items: Vec<Value> = resp.items.iter().map(memory_item_to_json).collect();
            let n = items.len() as i32;
            let payload = json!({
                "items": items,
                "total": n,
            });
            let status = serde_json::to_string(&payload)
                .unwrap_or_else(|_| r#"{"items":[],"total":0}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_memory_list".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_memory_list", error = %err);
            err.into_app_result("Failed to list agent memories")
        }
    }
}

pub fn agent_skill_list(input: AgentSkillListInput, token: &str) -> AppResult<StubPayload> {
    let req = model::agent::ListSkillsRequest {
        agent_id: input.agent_id,
        category: String::new(),
    };

    match station_client::request_proto::<
        model::agent::ListSkillsRequest,
        model::agent::ListSkillsResponse,
    >(
        Method::POST,
        "/sub-agent/agent/skill/list",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let skills: Vec<Value> = resp.skills.iter().map(skill_manifest_to_json).collect();
            let n = skills.len() as i32;
            let payload = json!({
                "skills": skills,
                "total": n,
            });
            let status = serde_json::to_string(&payload)
                .unwrap_or_else(|_| r#"{"skills":[],"total":0}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_skill_list".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_skill_list", error = %err);
            err.into_app_result("Failed to list agent skills")
        }
    }
}

pub fn agent_submit_feedback(input: AgentFeedbackInput, token: &str) -> AppResult<Vec<u8>> {
    let req = model::agent::RecordFeedbackRequest {
        agent_id: input.agent_id,
        turn_id: input.turn_id,
        conversation_id: input.conversation_id,
        signal: input.signal,
        comment: input.comment,
        assistant_message_id: input.assistant_message_id,
        source: input.source,
        rating: input.rating,
        categories: input.categories,
        idempotency_key: input.idempotency_key,
    };

    match station_client::request_proto::<
        model::agent::RecordFeedbackRequest,
        model::agent::RecordFeedbackResponse,
    >(
        Method::POST,
        "/sub-agent/agent/growth/feedback",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(err) => {
            tracing::error!(command = "agent_submit_feedback", error = %err);
            err.into_app_result("Failed to submit agent feedback")
        }
    }
}

pub fn agent_list_turn_feedback(
    input: AgentTurnFeedbackListInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    let turn_id = input.turn_id.trim().to_string();
    if turn_id.is_empty() {
        return AppResult::fail(
            crate::error::ErrorCode::InvalidArgument,
            "turn_id is required",
            None,
        );
    }
    let req = model::agent::ListTurnFeedbackRequest { turn_id };
    match station_client::request_proto::<
        model::agent::ListTurnFeedbackRequest,
        model::agent::ListTurnFeedbackResponse,
    >(
        Method::POST,
        "/sub-agent/agent/growth/feedback/turn/list",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(err) => {
            tracing::error!(command = "agent_list_turn_feedback", error = %err);
            err.into_app_result("Failed to list agent turn feedback")
        }
    }
}
