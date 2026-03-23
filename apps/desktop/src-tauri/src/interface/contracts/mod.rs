use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StubPayload {
    pub command: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthLoginInput {
    pub account: String,
    pub password: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthValidateTokenInput {
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsGetInput {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsSetInput {
    pub key: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatListMessagesInput {
    pub conversation_id: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSendMessageInput {
    pub conversation_id: String,
    pub content: String,
    pub client_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMarkReadInput {
    pub conversation_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineListInput {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineActionInput {
    pub post_id: String,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileUpdateInput {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilePrivacyInput {
    pub visibility: String,
    pub allow_direct_message: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileUploadInput {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminNetworkProbeInput {
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminExecuteActionInput {
    pub action: String,
    pub payload: Option<serde_json::Value>,
}
