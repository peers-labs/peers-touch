use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONTRACT_VERSION: &str = "2026-03-24.desktop-tauri-rust.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StubPayload {
    pub command: String,
    pub status: String,
}

/// Rich auth response payload carrying actor identity fields.
/// Used by all auth commands so the frontend can populate user context
/// immediately after login / session-restore without an extra round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSessionPayload {
    pub command: String,
    pub status: String,
    pub actor_id: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub avatar_local_path: Option<String>,
    pub login_method: Option<String>,
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

// --- Access gate (interactive chain) contracts ---
//
// The Station owns the access policy and emits an ordered gate chain. The
// desktop client drives the chain interactively: it starts an attempt, then
// submits the gate the Station marks `action_required` (invite code first,
// then login credentials). `AccessDecisionPayload.decision` carries the raw
// Station decision JSON unchanged so the TS layer can normalize the
// snake_case / string-enum wire shape with the same logic mobile uses.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessSubmitInviteInput {
    pub attempt_id: String,
    pub invite_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessSubmitLoginInput {
    pub attempt_id: String,
    pub account: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessDecisionPayload {
    pub command: String,
    pub status: String,
    /// Raw Station `AccessDecision` JSON. Passed through verbatim so the
    /// frontend normalizes the wire shape (snake_case keys, string enums).
    pub decision: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsGetInput {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsGetPayload {
    pub command: String,
    pub status: String,
    pub value: serde_json::Value,
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
    pub provider_id: Option<String>,
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
pub struct FriendChatListInput {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatCreateSessionInput {
    pub participant_did: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendConversationSettingsInput {
    pub session_ulid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendConversationSettingsUpdateInput {
    pub session_ulid: String,
    pub is_muted: Option<bool>,
    pub is_pinned: Option<bool>,
    pub alert_enabled: Option<bool>,
    pub background: Option<String>,
    pub cleared_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatListMessagesInput {
    pub session_ulid: String,
    pub before_ulid: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatThreadInput {
    pub session_ulid: String,
    pub root_ulid: String,
    pub after_ulid: Option<String>,
    pub limit: Option<u32>,
    pub max_pages: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatThreadCountsInput {
    pub session_ulid: String,
    pub root_ulids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatThreadReadInput {
    pub session_ulid: String,
    pub root_ulid: String,
    pub last_read_ulid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentInput {
    pub cid: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub thumbnail_cid: Option<String>,
    /// Sender-authoritative visibility ("public" / "chat" / "private").
    /// Plumbed through to the proto FriendMessageAttachment.visibility
    /// so the receiver can render the badge that matches the OSS file
    /// row. Optional so older callers stay source-compatible; missing
    /// value is treated as "unknown" downstream.
    #[serde(default)]
    pub visibility: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatSendInput {
    pub session_ulid: String,
    pub receiver_did: String,
    pub content: String,
    /// Base64-encoded ciphertext when sending E2E encrypted messages (optional).
    pub encrypted_payload: Option<String>,
    /// Client-generated idempotency key. Shared by direct + relay send attempts.
    pub client_ulid: Option<String>,
    pub r#type: Option<i32>,
    pub reply_to_ulid: Option<String>,
    pub thread_root_ulid: Option<String>,
    pub attachments: Option<Vec<AttachmentInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatSendFriendRequestInput {
    pub receiver_did: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatAcceptFriendRequestInput {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatRejectFriendRequestInput {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatListFriendRequestsInput {
    pub status: Option<i32>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatBlockUserInput {
    pub target_did: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatListBlockedUsersInput {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyExchangeUploadInput {
    pub ik_pub: String,
    pub spk_id: i32,
    pub spk_pub: String,
    pub spk_sig: String,
    pub opk_ids: Vec<i32>,
    pub opk_pubs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyExchangeFetchInput {
    pub did: String,
    pub device_id: Option<String>,
    pub home_station_peer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatAckInput {
    pub ulids: Vec<String>,
    pub status: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatRecallInput {
    pub session_ulid: String,
    pub message_ulid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatEditInput {
    pub session_ulid: String,
    pub message_ulid: String,
    /// Plaintext replacement body. Mutually optional with
    /// `new_encrypted_payload`; at least one must be non-empty.
    /// Both can be set at once when the chat upgrades to E2EE
    /// mid-edit and the client wants to keep the legacy index
    /// hot.
    pub new_content: Option<String>,
    /// E2EE replacement body. The TS layer decodes from base64
    /// before reaching this contract — we accept raw bytes here.
    pub new_encrypted_payload: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatDeleteInput {
    pub session_ulid: String,
    pub message_ulid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatListInput {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatListMessagesInput {
    pub group_ulid: String,
    pub before_ulid: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatThreadInput {
    pub group_ulid: String,
    pub root_ulid: String,
    pub after_ulid: Option<String>,
    pub limit: Option<u32>,
    pub max_pages: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatThreadCountsInput {
    pub group_ulid: String,
    pub root_ulids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatThreadReadInput {
    pub group_ulid: String,
    pub root_ulid: String,
    pub last_read_ulid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatSendInput {
    pub group_ulid: String,
    pub content: String,
    pub r#type: Option<i32>,
    pub reply_to_ulid: Option<String>,
    pub thread_root_ulid: Option<String>,
    pub mentioned_dids: Option<Vec<String>>,
    pub mention_all: Option<bool>,
    pub attachments: Option<Vec<AttachmentInput>>,
    /// Optional base64 ciphertext envelope for E2E (group symmetric key); forwarded to Station JSON when set.
    pub encrypted_payload: Option<String>,
    pub observed_membership_epoch: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSkdmSubmitInput {
    pub group_ulid: String,
    pub membership_epoch: i64,
    pub sender_did: String,
    pub sender_key_id: u32,
    pub recipient_did: String,
    pub recipient_device_id: String,
    pub recipient_home_station_peer_id: String,
    /// Base64 of the already sealed SKDM carrier payload. Desktop must never
    /// submit raw SenderKeyDistributionMessage bytes to Station.
    pub encrypted_payload: String,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatUnreadInput {
    pub group_ulid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatMarkReadInput {
    pub group_ulid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatSyncInput {
    pub session_ulid: String,
    pub limit: Option<u32>,
    pub max_pages: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatSyncInput {
    pub group_ulid: String,
    pub limit: Option<u32>,
    pub max_pages: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatLocalSearchInput {
    pub query: String,
    pub limit: Option<u32>,
}

/// Unified local FTS search (friend + group), with optional scope and conversation filters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChatSearchLocalInput {
    pub query: String,
    #[serde(default)]
    pub scope: String,
    pub conversation_id: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChatIndexLocalInput {
    pub messages: Vec<ChatIndexLocalMessageInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChatIndexLocalMessageInput {
    pub scope: String,
    pub conversation_id: String,
    pub message_id: String,
    pub sender_did: String,
    pub content: String,
    pub reply_to_ulid: Option<String>,
    pub thread_root_ulid: Option<String>,
    pub sent_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatScopeCursorSetInput {
    pub scope: String,
    pub cursor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatScopeCursorGetInput {
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatKeyRotateInput {
    pub next_version: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileUpdateInput {
    pub display_name: Option<String>,
    pub note: Option<String>,
    pub avatar: Option<String>,
    pub header: Option<String>,
    pub region: Option<String>,
    pub timezone: Option<String>,
    pub tags: Option<Vec<String>>,
    pub links: Option<Vec<ProfileLinkInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileLinkInput {
    pub label: String,
    pub url: String,
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
    pub runtime_kind: Option<String>,
    pub cli_command: Option<String>,
    pub protocol: Option<String>,
    #[serde(default)]
    pub version: i64,
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
    pub runtime_kind: Option<String>,
    pub cli_command: Option<String>,
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsListInput {
    pub agent_id: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsSearchInput {
    pub agent_id: Option<String>,
    pub q: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillIdInput {
    pub agent_id: Option<String>,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltinSkillIdInput {
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCreateInput {
    pub agent_id: Option<String>,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillUpdateInput {
    pub agent_id: Option<String>,
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillToggleInput {
    pub agent_id: Option<String>,
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillVersionsInput {
    pub agent_id: Option<String>,
    pub id: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRollbackInput {
    pub agent_id: Option<String>,
    pub id: String,
    pub target_version: i32,
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
pub struct McpExecuteToolInput {
    pub server_name: String,
    pub tool_name: String,
    pub arguments: Option<serde_json::Value>,
    pub call_id: Option<String>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub allowed_roots: Option<Vec<String>>,
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
pub struct OAuthLoopbackStartInput {
    pub id: String,
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthLoopbackPollInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCallbackInput {
    pub provider: String,
    pub provider_user_id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub created_at: Option<String>,
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
pub struct AccountSyncAvatarInput {
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvatarResolveLocalInput {
    pub url: Option<String>,
}

/// Input for `peer_profile_get`. `did` is the peer's numeric actor id (also
/// referred to as DID throughout the desktop chat layer).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerProfileGetInput {
    pub did: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUpsertOAuthInput {
    pub provider: String,
    pub provider_user_id: String,
    pub name: Option<String>,
    pub created_at: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
}

// ── PIN / multi-account contracts ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSetPinInput {
    pub account_id: String,
    pub pin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUnlockInput {
    pub account_id: String,
    pub pin: String,
}

/// Input for removing PIN protection from an account (Settings > Security).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRemovePinInput {
    pub account_id: String,
    pub pin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountAuthorizePinRecoveryInput {
    pub recovery_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountResetPinInput {
    pub recovery_id: String,
    pub new_pin: String,
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
pub struct AppletStoreListCatalogInput {
    #[serde(rename = "deviceId")]
    pub device_id: Option<String>,
    #[serde(rename = "targetPlatform")]
    pub target_platform: Option<String>,
    pub channel: Option<String>,
    #[serde(rename = "searchKeyword")]
    pub search_keyword: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreListInstalledInput {
    #[serde(rename = "deviceId")]
    pub device_id: Option<String>,
    #[serde(rename = "includeDisabled")]
    pub include_disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreInstallInput {
    #[serde(rename = "deviceId")]
    pub device_id: Option<String>,
    #[serde(rename = "appletId")]
    pub applet_id: String,
    pub version: Option<String>,
    pub channel: Option<String>,
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreUninstallInput {
    #[serde(rename = "deviceId")]
    pub device_id: Option<String>,
    #[serde(rename = "appletId")]
    pub applet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreGetVersionInput {
    #[serde(rename = "appletId")]
    pub applet_id: String,
    pub version: Option<String>,
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreMaterializeBundleInput {
    #[serde(rename = "appletId")]
    pub applet_id: String,
    pub version: Option<String>,
    #[serde(rename = "bundleUrl")]
    pub bundle_url: String,
    #[serde(rename = "bundleSha256")]
    pub bundle_sha256: Option<String>,
    pub entry: Option<String>,
    pub assets: Option<Vec<AppletStoreBundleAssetInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreBundleAssetInput {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletStoreUploadAuditInput {
    #[serde(rename = "deviceId")]
    pub device_id: Option<String>,
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
pub struct AppletCreateSessionInput {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub manifest: AppletGatewayManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletInvokeInput {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub capability: String,
    pub action: Option<String>,
    pub params: Option<serde_json::Value>,
    pub manifest: AppletGatewayManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletGatewayManifest {
    pub id: String,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub services: Vec<AppletGatewayService>,
    #[serde(default)]
    pub skills: Vec<AppletGatewaySkill>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletGatewayService {
    pub id: String,
    pub kind: String,
    pub binding: String,
    #[serde(rename = "allowedMethods")]
    pub allowed_methods: Vec<String>,
    #[serde(rename = "allowedPaths")]
    pub allowed_paths: Vec<String>,
    #[serde(rename = "publicPathPrefix")]
    pub public_path_prefix: Option<String>,
    #[serde(rename = "stationPathPrefix")]
    pub station_path_prefix: Option<String>,
    #[serde(default)]
    pub streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppletGatewaySkill {
    pub id: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: String,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillImportAddressInput {
    pub agent_id: Option<String>,
    pub address: String,
    pub oauth_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillImportGitHubInput {
    pub agent_id: Option<String>,
    pub owner: String,
    pub repo: String,
    pub branch: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillImportZipInput {
    pub agent_id: Option<String>,
    pub file_name: String,
    pub data_base64: String,
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
    pub agent_id: Option<String>,
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
pub struct AgentPackageExportInput {
    pub id: String,
    #[serde(default, rename = "include_local_paths", alias = "includeLocalPaths")]
    pub include_local_paths: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPackageImportInput {
    pub package: serde_json::Value,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSearchInput {
    pub q: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSelectInput {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecuteTurnInput {
    pub stream_id: Option<String>,
    pub conversation_id: String,
    pub agent_id: String,
    pub user_input: String,
    pub attachments: Option<Vec<AttachmentInput>>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub cli_command: Option<String>,
    pub workspace_mode: Option<String>,
    pub runtime_backend: Option<String>,
    pub rootfs_path: Option<String>,
    pub allowed_roots: Option<Vec<String>>,
    pub identity: Option<String>,
    pub agent_config_prompt: Option<String>,
    pub effort: Option<String>,
    pub platform: Option<String>,
    pub workspace_root: Option<String>,
    pub context_window_size: Option<u32>,
    pub max_retries: Option<u32>,
    pub knowledge_resources: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTurnStreamCancelInput {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTurnTraceListInput {
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTurnTraceGetInput {
    pub trace_id: Option<String>,
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationCreateInput {
    pub title: String,
    pub description: String,
    pub engine_type: i32,
    pub agent_ids: Vec<String>,
    pub judge_agent_id: Option<String>,
    pub workspace_id: Option<String>,
    pub budget_tokens: Option<f64>,
    pub budget_money: Option<f64>,
    pub budget_time_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationGetInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationListInput {
    pub status: Option<i32>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationListEventsInput {
    pub task_id: String,
    pub after_event_seq: Option<i64>,
    pub page_size: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationSubscribeInput {
    pub stream_id: Option<String>,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub after_event_seq: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationCancelInput {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationCancelTaskInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationResumeTaskInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationSubmitNodeResultInput {
    pub task_id: String,
    pub node_id: String,
    pub result_summary: String,
    pub status: Option<String>,
    pub turn_id: Option<String>,
    pub lease_id: Option<String>,
    pub executor_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationClaimExecutorInput {
    pub executor_id: String,
    pub lease_ttl_ms: Option<i64>,
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub node_id: Option<String>,
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationHeartbeatLeaseInput {
    pub lease_id: String,
    pub executor_id: String,
    pub lease_ttl_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCollaborationReleaseLeaseInput {
    pub lease_id: String,
    pub executor_id: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLocalToolRequestInput {
    pub source: String,
    pub server_name: Option<String>,
    pub tool_name: String,
    pub arguments: Option<serde_json::Value>,
    pub call_id: Option<String>,
    pub turn_id: Option<String>,
    pub workspace_root: Option<String>,
    pub allowed_roots: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolApprovalDecisionInput {
    pub approval_id: String,
    pub approved: bool,
    pub actor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWorkspaceInfoInput {
    pub agent_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWorkspaceCleanInput {
    pub agent_id: String,
    pub scope: String,
    #[serde(default)]
    pub retention_days: Option<u32>,
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
pub struct PreferencesSetInput {
    pub prefs: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalUrlInput {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSnapshotGetInput {
    pub slices: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextActionDispatchInput {
    pub action: String,
    pub payload: Option<serde_json::Value>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatSyncMessagesInput {
    /// JSON stringified array of SyncMessageItem-like objects from the frontend.
    pub messages_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendChatPendingInput {
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupCreateInput {
    pub name: String,
    pub description: Option<String>,
    pub member_dids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUlidInput {
    pub group_ulid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUpdateInput {
    pub group_ulid: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar_cid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupInviteInput {
    pub group_ulid: String,
    pub member_dids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupAddFederatedMemberInput {
    pub group_ulid: String,
    pub member: GroupChatFederatedActorInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRemoveMemberInput {
    pub group_ulid: String,
    pub member_did: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupTransferOwnershipInput {
    pub group_ulid: String,
    pub next_owner_did: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUpdateMemberInput {
    pub group_ulid: String,
    pub member_did: String,
    pub role: Option<i32>,
    pub muted: Option<bool>,
    pub muted_until_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMessageActionInput {
    pub group_ulid: String,
    pub message_ulid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatEditInput {
    pub group_ulid: String,
    pub message_ulid: String,
    /// Plaintext replacement body. Mutually optional with
    /// `new_encrypted_payload`; at least one must be non-empty.
    pub new_content: Option<String>,
    /// E2EE replacement body. Decoded from base64 by the TS layer
    /// before reaching this contract.
    pub new_encrypted_payload: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSearchMessagesInput {
    pub group_ulid: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUpdateNicknameInput {
    pub group_ulid: String,
    pub nickname: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUpdateMySettingsInput {
    pub group_ulid: String,
    pub is_muted: Option<bool>,
    pub is_pinned: Option<bool>,
    pub show_member_nickname: Option<bool>,
    pub alert_enabled: Option<bool>,
    pub background: Option<String>,
    pub cleared_at_unix_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupAckOfflineInput {
    pub group_ulid: String,
    pub message_ulids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupJoinInput {
    pub group_ulid: String,
    pub invitation_ulid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMembersInput {
    pub group_ulid: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupOfflineMessagesInput {
    pub group_ulid: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendLogInput {
    pub level: String,
    pub tag: String,
    pub message: String,
    pub data: Option<String>,
}

// --- Onboarding / Wizard contracts ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingSetInput {
    pub step: Option<String>,
    pub completed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WizardStepInput {
    pub step: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WizardExecuteApiInput {
    pub action: String,
    pub params: Option<serde_json::Value>,
}

// --- Actor contracts ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorSearchUsersInput {
    pub q: String,
    pub limit: Option<u32>,
}

// --- Group chat create / leave contracts ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatFederatedActorInput {
    pub actor_did: String,
    pub home_station_peer_id: String,
    pub home_station_domain: Option<String>,
    pub federated_handle: Option<String>,
    pub actor_identity_public_key: Option<Vec<u8>>,
    pub profile_version: Option<i64>,
    pub federation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatCreateGroupInput {
    pub name: String,
    pub description: Option<String>,
    pub member_dids: Option<Vec<String>>,
    pub initial_federated_members: Option<Vec<GroupChatFederatedActorInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupChatLeaveGroupInput {
    pub group_ulid: String,
}

// --- Friend Request contracts ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequestSendInput {
    pub receiver_did: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequestActionInput {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequestListInput {
    pub status: Option<i32>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequestDeleteInput {
    pub peer_did: String,
}

// --- Notification contracts ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationListInput {
    pub category: Option<i32>,
    pub status: Option<i32>,
    pub cursor: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationMarkReadInput {
    pub notification_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationMarkAllReadInput {
    pub category: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationDeleteInput {
    pub notification_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPreferenceUpdateInput {
    pub category: i32,
    pub enabled: bool,
    pub push_enabled: bool,
    pub sound_enabled: bool,
}

// ===========================================================================
// Social (Moments) — Tauri command inputs
//
// All payloads here are POJOs deserialized from the JS-side `invoke()`
// call. The richer wire shapes (Audience selectors, Mention positions,
// reaction summaries) live on protobuf messages that the TS layer
// constructs and encodes BEFORE calling the BFF — this avoids
// duplicating the audience / mention discriminator logic in three
// places (TS / Rust / Go).
//
// `serde(default)` is used for optional fields so older clients keep
// working when the schema gains a non-required knob.
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCreateMomentInput {
    /// Encoded `CreatePostRequest` proto bytes. The TS layer composes the
    /// proto (oneof content + audience selector) and ships it as a single
    /// opaque blob; the BFF only forwards.
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialGetMomentInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialDeleteMomentInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialListByAuthorInput {
    pub user_id: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialGetTimelineInput {
    /// One of "PUBLIC" / "HOME" / "USER" — string-typed because the
    /// station handler accepts the enum-name form on the query string.
    pub r#type: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
    /// Optional sort knob — `"recent"` (default) or `"hot"`. Only the
    /// PUBLIC timeline honours `hot`; HOME / USER stay on recency.
    #[serde(default)]
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialSyncMomentsProjectionInput {
    #[serde(default)]
    pub home_cursor: Option<String>,
    #[serde(default)]
    pub public_cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
    #[serde(default)]
    pub public_sort: Option<i32>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialStationModerationUpsertInput {
    pub station_domain: String,
    #[serde(default)]
    pub station_peer_id: Option<String>,
    #[serde(default)]
    pub kind: Option<i32>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialStationModerationDeleteInput {
    #[serde(default)]
    pub station_domain: Option<String>,
    #[serde(default)]
    pub station_peer_id: Option<String>,
    #[serde(default)]
    pub kind: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialStationModerationListInput {
    #[serde(default)]
    pub kind: Option<i32>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialReactInput {
    pub post_id: String,
    /// `ReactionKind` enum value (1=LIKE, 2=LOVE, 3=LAUGH, 4=WOW, 5=SAD).
    /// 0 (`REACTION_UNSPECIFIED`) is rejected at the BFF.
    pub kind: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialUnreactInput {
    pub post_id: String,
    /// `0` clears all reactions by the viewer; otherwise removes only
    /// the specified kind.
    #[serde(default)]
    pub kind: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialGetCommentsInput {
    pub post_id: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCreateCommentInput {
    pub post_id: String,
    pub content: String,
    /// Empty string ↔ top-level comment.
    #[serde(default)]
    pub reply_to_comment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialDeleteCommentInput {
    pub comment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialFollowInput {
    pub target_user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialGetFollowersInput {
    /// `None` ↔ "for the calling actor".
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialGetFollowingInput {
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialGetRelationshipInput {
    pub target_user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCircleCreateInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub member_dids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCircleRenameInput {
    pub circle_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCircleDeleteInput {
    pub circle_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCircleAddMembersInput {
    pub circle_id: String,
    pub member_dids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCircleRemoveMembersInput {
    pub circle_id: String,
    pub member_dids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialCircleListMembersInput {
    pub circle_id: String,
}

// Federation gateway inputs (Tier A1 — Desktop FederationRuntime).
//
// Two non-trivial commands take input:
//
//   • `federation_update_visibility`: the dropdown label the user just
//     picked ("hidden" | "by_handle" | "indexed"). Server validates the
//     vocabulary; we only round-trip whatever the UI sent.
//   • `federation_resolve`: the canonical "@user@host" handle the user
//     typed into search / add-friend.
//
// The remaining two (`federation_get_self`, `federation_health`) take
// no payload and reuse `tauri::command` argument injection only.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationVisibilityInput {
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationResolveInput {
    pub handle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationCatalogSearchInput {
    pub federation_id: String,
    pub prefix: String,
    #[serde(default)]
    pub station_id: Option<String>,
    #[serde(default)]
    pub page_size: Option<u32>,
}

// ─── Federation Lifecycle Inputs ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationCreateInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub policy_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationJoinInput {
    #[serde(default)]
    pub federation_endpoint: String,
    #[serde(default)]
    pub federation_id: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationLeaveInput {
    pub federation_id: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationListMemberStationsInput {
    pub federation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationDeleteInput {
    pub federation_id: String,
}
