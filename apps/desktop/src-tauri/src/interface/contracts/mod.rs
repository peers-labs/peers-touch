use serde::{Deserialize, Serialize};

pub const CONTRACT_VERSION: &str = "2026-03-24.desktop-tauri-rust.v1";

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
pub struct ChatCompletionInput {
    pub session_id: String,
    pub model: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMarkReadInput {
    pub conversation_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatConversationInput {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRenameConversationInput {
    pub conversation_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSetConversationModelInput {
    pub conversation_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatUpdateMessageInput {
    pub message_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageInput {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUpdateInput {
    pub id: String,
    pub enabled: bool,
    pub key_vaults: Option<String>,
    pub config_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCheckInput {
    pub id: String,
    pub key_vaults: Option<String>,
    pub config_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCreateInput {
    pub name: String,
    pub description: String,
    pub logo: String,
    pub key_vaults: String,
    pub config_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsListInput {
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsSearchInput {
    pub q: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltinSkillIdInput {
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCreateInput {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillUpdateInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillToggleInput {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpNameInput {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCreateInput {
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpUpdateInput {
    pub name: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToggleInput {
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronCreateInput {
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronUpdateInput {
    pub id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronToggleInput {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronRunsInput {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronParseScheduleInput {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfigKeyInput {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfigSetInput {
    pub key: String,
    pub r#ref: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderIdInputV2 {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelCreateInput {
    pub name: String,
    pub r#type: String,
    pub config: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelUpdateInput {
    pub id: String,
    pub name: Option<String>,
    pub r#type: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSendMessageInput {
    pub id: String,
    pub text: String,
    pub title: Option<String>,
    pub target_id: Option<String>,
    pub target_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelEventsInput {
    pub id: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthSetCredentialsInput {
    pub id: String,
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthAuthorizeInput {
    pub id: String,
    pub environment: Option<String>,
    pub return_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCallbackInput {
    pub provider: String,
    pub provider_user_id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUpsertOAuthInput {
    pub provider: String,
    pub provider_user_id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthResourceInput {
    pub id: String,
    pub resource: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryListInput {
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySearchInput {
    pub query: String,
    pub layers: Option<Vec<String>>,
    pub limit: Option<u32>,
    pub agent_id: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub period: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEventsInput {
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryExportInput {
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryImportInput {
    pub data: serde_json::Value,
    pub skip_duplicates: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryPersonaInput {
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsInput {
    pub text: String,
    pub voice: Option<String>,
    pub speed: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicIdInput {
    pub topic_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookCreateInput {
    pub topic_id: String,
    pub title: String,
    pub content: String,
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookUpdateInput {
    pub id: String,
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletConfigSetInput {
    pub id: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletActionInput {
    pub id: String,
    pub action: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletInvokeInput {
    pub id: String,
    pub capability: String,
    pub action: Option<String>,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillImportAddressInput {
    pub address: String,
    pub oauth_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillImportGitHubInput {
    pub owner: String,
    pub repo: String,
    pub branch: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMarketIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMarketAddInput {
    pub url: String,
    pub name: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMarketSyncInput {
    pub market_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMarketListInput {
    pub market_id: String,
    pub q: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMarketDetailInput {
    pub market_id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCreateInput {
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentUpdateInput {
    pub id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDuplicateInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSearchInput {
    pub q: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPrimaryInput {
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQueryInput {
    pub query: String,
    pub source: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSearchInput {
    pub query: String,
    pub web: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingSetInput {
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WizardStepInput {
    pub step_id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WizardExecuteApiInput {
    pub method: String,
    pub path: String,
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreferencesSetInput {
    pub prefs: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareSessionInput {
    pub session_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareIdInput {
    pub share_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogsTailInput {
    pub cursor: i64,
    pub limit: Option<u32>,
    pub max_bytes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthSimulateStartInput {
    pub create_bot: Option<bool>,
    pub app_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthSessionInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCreateBotSessionInput {
    pub app_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSectionInput {
    pub section: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSectionSetInput {
    pub section: String,
    pub values: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFieldResetInput {
    pub section: String,
    pub field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigPostgresTestInput {
    pub dsn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelAddInput {
    pub provider_id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelUpdateInput {
    pub provider_id: String,
    pub model_id: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelDeleteInput {
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelFetchInput {
    pub provider_id: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelToggleInput {
    pub provider_id: String,
    pub model_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModelToggleAllInput {
    pub provider_id: String,
    pub enabled: bool,
}
