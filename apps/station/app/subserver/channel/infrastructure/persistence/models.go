// Package persistence owns the Channel subsystem storage schema.
package persistence

import "time"

// ChannelSecret is the at-rest record of an encrypted credential.
//
// Plaintext is never stored: WrappedDEK/Nonce/Ciphertext hold the sealed
// envelope produced by the secret package. Rows are actor-scoped; the service
// layer enforces that an actor can only read its own records.
type ChannelSecret struct {
	ID         string `gorm:"primaryKey;type:varchar(64)"`
	ActorPTID  string `gorm:"column:actor_ptid;not null;type:varchar(128);index:idx_channel_secret_actor,priority:1;uniqueIndex:uq_channel_secret_name,priority:1"`
	Purpose    string `gorm:"not null;type:varchar(40);uniqueIndex:uq_channel_secret_name,priority:2"`
	Name       string `gorm:"not null;type:varchar(128);uniqueIndex:uq_channel_secret_name,priority:3"`
	WrappedDEK []byte `gorm:"column:wrapped_dek;not null;type:bytea"`
	Nonce      []byte `gorm:"not null;type:bytea"`
	Ciphertext []byte `gorm:"not null;type:bytea"`
	KEKVersion string `gorm:"column:kek_version;not null;type:varchar(64);index:idx_channel_secret_kek"`
	ExpiresAt  *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// TableName keeps the table name explicit and decoupled from GORM pluralization.
func (ChannelSecret) TableName() string { return "channel_secrets" }

// ChannelPlugin is a registered dynamic channel plugin package.
// Lifecycle state lives here; the on-disk package is managed by pluginpkg.Installer.
type ChannelPlugin struct {
	ID           string `gorm:"primaryKey;type:varchar(64)"`
	Name         string `gorm:"not null;type:varchar(255)"`
	Version      string `gorm:"not null;type:varchar(64)"`
	ProviderKind string `gorm:"column:provider_kind;not null;type:varchar(64);index:idx_channel_plugin_provider"`
	Description  string `gorm:"type:text"`
	RootDir      string `gorm:"column:root_dir;not null;type:text"`
	ExecPath     string `gorm:"column:exec_path;not null;type:text"`
	Capabilities string `gorm:"column:capabilities;type:text"` // JSON array
	ProtocolMin  int    `gorm:"column:protocol_min;not null"`
	ProtocolMax  int    `gorm:"column:protocol_max;not null"`
	Enabled      bool   `gorm:"not null;default:false;index:idx_channel_plugin_enabled"`
	// Lifecycle is user-facing state: registered, active, failed, disabled.
	Lifecycle   string `gorm:"not null;type:varchar(32);default:'registered'"`
	HealthMsg   string `gorm:"column:health_msg;type:text"`
	InstalledAt time.Time
	UpdatedAt   time.Time
	LastStartAt *time.Time
	LastExitAt  *time.Time
}

func (ChannelPlugin) TableName() string { return "channel_plugins" }

// ChannelBinding binds one actor-owned provider application instance to an
// Agent and drives one plugin-side connection generation. Credentials never
// live here: CredentialSecretID references an fp-00 vault record.
type ChannelBinding struct {
	ID           string `gorm:"primaryKey;type:varchar(64)"`
	ActorPTID    string `gorm:"column:actor_ptid;not null;type:varchar(128);index:idx_channel_binding_actor;uniqueIndex:uq_channel_binding_identity,priority:1"`
	PluginID     string `gorm:"column:plugin_id;not null;type:varchar(64);index:idx_channel_binding_plugin"`
	ProviderKind string `gorm:"column:provider_kind;not null;type:varchar(64);uniqueIndex:uq_channel_binding_identity,priority:2"`
	// ProviderAppID is the platform application identity (Lark app_id), part
	// of the unique identity so the same actor may connect several apps.
	ProviderAppID string `gorm:"column:provider_app_id;not null;type:varchar(128);uniqueIndex:uq_channel_binding_identity,priority:3"`
	// Domain is the platform API domain; empty means the provider default.
	Domain      string `gorm:"column:domain;not null;default:'';type:varchar(128);uniqueIndex:uq_channel_binding_identity,priority:4"`
	Name        string `gorm:"not null;default:'';type:varchar(255)"`
	Description string `gorm:"type:text"`
	Region      string `gorm:"not null;default:'feishu';type:varchar(32)"`
	AppMode     string `gorm:"column:app_mode;not null;default:'custom';type:varchar(32)"`
	IsDefault   bool   `gorm:"column:is_default;not null;default:false;index:idx_channel_binding_default"`
	// Enabled is the desired state; the RuntimeHost reconciles toward it.
	Enabled bool `gorm:"not null;default:false;index:idx_channel_binding_enabled"`
	// AgentID is the bound Agent used for turn routing (consumed by fp-04).
	AgentID                   string `gorm:"column:agent_id;not null;default:'';type:varchar(64)"`
	GroupResponseMode         string `gorm:"column:group_response_mode;not null;default:'mention';type:varchar(32)"`
	ThreadIsolation           bool   `gorm:"column:thread_isolation;not null;default:true"`
	OutputMode                string `gorm:"column:output_mode;not null;default:'concise';type:varchar(32)"`
	AccessMode                string `gorm:"column:access_mode;not null;default:'approval';type:varchar(32)"`
	OwnerProviderUserID       string `gorm:"column:owner_provider_user_id;not null;default:'';type:varchar(128)"`
	PersonalOAuthConnectionID string `gorm:"column:personal_oauth_connection_id;not null;default:'';type:varchar(128)"`
	PersonalOAuthStatus       string `gorm:"column:personal_oauth_status;not null;default:'disconnected';type:varchar(32)"`
	// CredentialSecretID references a channel-secret vault record (fp-00).
	CredentialSecretID string `gorm:"column:credential_secret_id;not null;type:varchar(64)"`
	// ConnectionState/LastError are observed projections, never the source
	// of truth for recovery (Enabled + the binding set are).
	ConnectionState string `gorm:"column:connection_state;not null;default:'stopped';type:varchar(32)"`
	LastError       string `gorm:"column:last_error;type:text"`
	BotOpenID       string `gorm:"column:bot_open_id;not null;default:'';type:varchar(128)"`
	TenantKey       string `gorm:"column:tenant_key;not null;default:'';type:varchar(128)"`
	LastHealthAt    *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (ChannelBinding) TableName() string { return "channel_bindings" }

// ChannelRequesterAuthorization is the Station-owned projection of one
// provider user's OAuth grant for one Channel binding. Provider tokens remain
// in the isolated managed lark-cli profile; only non-secret identity and
// lifecycle state are persisted here.
type ChannelRequesterAuthorization struct {
	ID               string `gorm:"primaryKey;type:varchar(64)"`
	ActorPTID        string `gorm:"column:actor_ptid;not null;type:varchar(128);index:idx_channel_requester_actor"`
	BindingID        string `gorm:"column:binding_id;not null;type:varchar(64);index:idx_channel_requester_binding;uniqueIndex:uq_channel_requester_identity,priority:1"`
	ProviderUserID   string `gorm:"column:provider_user_id;not null;default:'';type:varchar(128);uniqueIndex:uq_channel_requester_identity,priority:2"`
	TenantKey        string `gorm:"column:tenant_key;not null;default:'';type:varchar(128);uniqueIndex:uq_channel_requester_identity,priority:3"`
	Region           string `gorm:"not null;type:varchar(32);uniqueIndex:uq_channel_requester_identity,priority:4"`
	Status           string `gorm:"not null;type:varchar(32);index:idx_channel_requester_status"`
	UserName         string `gorm:"column:user_name;not null;default:'';type:varchar(255)"`
	Email            string `gorm:"not null;default:'';type:varchar(255)"`
	GrantedScopes    string `gorm:"column:granted_scopes;type:text"`
	RequestedScope   string `gorm:"column:requested_scope;type:text"`
	PendingScope     string `gorm:"column:pending_scope;type:text"`
	AttemptKey       string `gorm:"column:attempt_key;not null;type:varchar(160);uniqueIndex:uq_channel_requester_attempt"`
	SecretID         string `gorm:"column:secret_id;not null;default:'';type:varchar(64)"`
	Revision         uint64 `gorm:"not null;default:1"`
	RecoveryAction   string `gorm:"column:recovery_action;not null;default:'';type:varchar(64)"`
	ErrorMessage     string `gorm:"column:error_message;type:text"`
	LeaseToken       string `gorm:"column:lease_token;not null;default:'';type:varchar(64)"`
	LeaseExpiresAt   *time.Time
	ExpiresAt        *time.Time
	AccessExpiresAt  *time.Time
	AttemptExpiresAt *time.Time
	LastVerifiedAt   *time.Time
	RevokedAt        *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (ChannelRequesterAuthorization) TableName() string {
	return "channel_requester_authorizations"
}

// ChannelConversationLink maps one platform scope (private chat, group root
// or group thread) to one Station conversation.
type ChannelConversationLink struct {
	ID             string `gorm:"primaryKey;type:varchar(64)"`
	BindingID      string `gorm:"column:binding_id;not null;type:varchar(64);uniqueIndex:uq_channel_conversation_scope,priority:1"`
	ScopeKey       string `gorm:"column:scope_key;not null;type:varchar(512);uniqueIndex:uq_channel_conversation_scope,priority:2"`
	ChatID         string `gorm:"column:chat_id;not null;type:varchar(128);index:idx_channel_conversation_chat"`
	ChatType       string `gorm:"column:chat_type;not null;default:'private';type:varchar(32)"`
	RootID         string `gorm:"column:root_id;not null;default:'';type:varchar(128)"`
	ThreadID       string `gorm:"column:thread_id;not null;default:'';type:varchar(128)"`
	ConversationID string `gorm:"column:conversation_id;not null;type:varchar(64)"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (ChannelConversationLink) TableName() string { return "channel_conversation_scopes" }

// ChannelInboundEvent is the durable admission journal. Provider callbacks are
// acknowledged only after this row and the canonical Agent admission exist.
type ChannelInboundEvent struct {
	ID                string `gorm:"primaryKey;type:varchar(64)"`
	BindingID         string `gorm:"column:binding_id;not null;type:varchar(64);uniqueIndex:uq_channel_inbound_event,priority:1;uniqueIndex:uq_channel_inbound_message,priority:1;index:idx_channel_inbound_binding"`
	ProviderKind      string `gorm:"column:provider_kind;not null;type:varchar(64)"`
	ProviderEventID   string `gorm:"column:provider_event_id;not null;type:varchar(255);uniqueIndex:uq_channel_inbound_event,priority:2"`
	ProviderMessageID string `gorm:"column:provider_message_id;not null;default:'';type:varchar(255);uniqueIndex:uq_channel_inbound_message,priority:2"`
	PayloadHash       string `gorm:"column:payload_hash;not null;type:varchar(64)"`
	ChatID            string `gorm:"column:chat_id;not null;type:varchar(128);index:idx_channel_inbound_chat"`
	ChatType          string `gorm:"column:chat_type;not null;type:varchar(32)"`
	ScopeKey          string `gorm:"column:scope_key;not null;type:varchar(512)"`
	SenderID          string `gorm:"column:sender_id;not null;default:'';type:varchar(128)"`
	SenderName        string `gorm:"column:sender_name;not null;default:'';type:varchar(255)"`
	SenderTenantKey   string `gorm:"column:sender_tenant_key;not null;default:'';type:varchar(128)"`
	MessageType       string `gorm:"column:message_type;not null;default:'text';type:varchar(32)"`
	Text              string `gorm:"type:text"`
	ContentJSON       string `gorm:"column:content_json;type:text"`
	ResourcesJSON     string `gorm:"column:resources_json;type:text"`
	MentionsJSON      string `gorm:"column:mentions_json;type:text"`
	ParentID          string `gorm:"column:parent_id;not null;default:'';type:varchar(128)"`
	RootID            string `gorm:"column:root_id;not null;default:'';type:varchar(128)"`
	ThreadID          string `gorm:"column:thread_id;not null;default:'';type:varchar(128)"`
	AgentID           string `gorm:"column:agent_id;not null;default:'';type:varchar(64)"`
	ConversationID    string `gorm:"column:conversation_id;not null;default:'';type:varchar(64)"`
	AdmissionKey      string `gorm:"column:admission_key;not null;type:varchar(255)"`
	TurnID            string `gorm:"column:turn_id;not null;default:'';type:varchar(64);index:idx_channel_inbound_turn"`
	Status            string `gorm:"not null;type:varchar(32);index:idx_channel_inbound_status"`
	ErrorCode         string `gorm:"column:error_code;not null;default:'';type:varchar(64)"`
	ErrorMessage      string `gorm:"column:error_message;type:text"`
	ReceivedAt        time.Time
	AdmittedAt        *time.Time
	CompletedAt       *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (ChannelInboundEvent) TableName() string { return "channel_inbound_events" }

// ChannelDeliveryIntent separates provider delivery from Agent execution.
// Retrying or reconciling this row never restarts a Turn.
type ChannelDeliveryIntent struct {
	ID                string `gorm:"primaryKey;type:varchar(64)"`
	BindingID         string `gorm:"column:binding_id;not null;type:varchar(64);index:idx_channel_delivery_binding"`
	InboundID         string `gorm:"column:inbound_id;not null;default:'';type:varchar(64);uniqueIndex:uq_channel_delivery_identity,priority:1"`
	IntentKind        string `gorm:"column:intent_kind;not null;type:varchar(32);uniqueIndex:uq_channel_delivery_identity,priority:2"`
	TargetChatID      string `gorm:"column:target_chat_id;not null;type:varchar(128)"`
	ReplyToMessageID  string `gorm:"column:reply_to_message_id;not null;default:'';type:varchar(255)"`
	RootID            string `gorm:"column:root_id;not null;default:'';type:varchar(128)"`
	ThreadID          string `gorm:"column:thread_id;not null;default:'';type:varchar(128)"`
	Kind              string `gorm:"not null;type:varchar(32)"`
	Text              string `gorm:"type:text"`
	ContentJSON       string `gorm:"column:content_json;type:text"`
	ResourceJSON      string `gorm:"column:resource_json;type:text"`
	ProviderMessageID string `gorm:"column:provider_message_id;not null;default:'';type:varchar(255)"`
	Status            string `gorm:"not null;type:varchar(32);index:idx_channel_delivery_status"`
	Revision          uint64 `gorm:"not null;default:1"`
	Terminal          bool   `gorm:"not null;default:false"`
	AttemptCount      int    `gorm:"column:attempt_count;not null;default:0"`
	LeaseToken        string `gorm:"column:lease_token;not null;default:'';type:varchar(64)"`
	LeaseExpiresAt    *time.Time
	NextAttemptAt     *time.Time
	LastAttemptAt     *time.Time
	DeliveredAt       *time.Time
	LastErrorCode     string `gorm:"column:last_error_code;not null;default:'';type:varchar(64)"`
	LastError         string `gorm:"column:last_error;type:text"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (ChannelDeliveryIntent) TableName() string { return "channel_delivery_intents" }

type ChannelRoute struct {
	ID        string `gorm:"primaryKey;type:varchar(64)"`
	BindingID string `gorm:"column:binding_id;not null;type:varchar(64);uniqueIndex:uq_channel_route_chat,priority:1;index:idx_channel_route_binding"`
	ChatID    string `gorm:"column:chat_id;not null;type:varchar(128);uniqueIndex:uq_channel_route_chat,priority:2"`
	ChatName  string `gorm:"column:chat_name;not null;default:'';type:varchar(255)"`
	AgentID   string `gorm:"column:agent_id;not null;type:varchar(64)"`
	Enabled   bool   `gorm:"not null;default:true"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ChannelRoute) TableName() string { return "channel_routes" }

type ChannelMemberAccess struct {
	ID             string `gorm:"primaryKey;type:varchar(64)"`
	BindingID      string `gorm:"column:binding_id;not null;type:varchar(64);uniqueIndex:uq_channel_member_access,priority:1;index:idx_channel_member_binding"`
	ProviderUserID string `gorm:"column:provider_user_id;not null;type:varchar(128);uniqueIndex:uq_channel_member_access,priority:2"`
	DisplayName    string `gorm:"column:display_name;not null;default:'';type:varchar(255)"`
	Status         string `gorm:"not null;type:varchar(32);index:idx_channel_member_status"`
	DecisionKey    string `gorm:"column:decision_key;not null;default:'';type:varchar(255)"`
	RequestedAt    time.Time
	DecidedAt      *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (ChannelMemberAccess) TableName() string { return "channel_member_access" }

type ChannelChat struct {
	ID             string `gorm:"primaryKey;type:varchar(64)"`
	BindingID      string `gorm:"column:binding_id;not null;type:varchar(64);uniqueIndex:uq_channel_chat,priority:1;index:idx_channel_chat_binding"`
	ChatID         string `gorm:"column:chat_id;not null;type:varchar(128);uniqueIndex:uq_channel_chat,priority:2"`
	Name           string `gorm:"not null;default:'';type:varchar(255)"`
	ChatType       string `gorm:"column:chat_type;not null;type:varchar(32)"`
	LastSenderName string `gorm:"column:last_sender_name;not null;default:'';type:varchar(255)"`
	LastMessageAt  time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (ChannelChat) TableName() string { return "channel_chats" }

type ChannelAutomation struct {
	ID                string `gorm:"primaryKey;type:varchar(64)"`
	BindingID         string `gorm:"column:binding_id;not null;type:varchar(64);index:idx_channel_automation_binding"`
	TriggerType       string `gorm:"column:trigger_type;not null;type:varchar(32)"`
	TriggerValue      string `gorm:"column:trigger_value;not null;type:text"`
	ActionPrompt      string `gorm:"column:action_prompt;not null;type:text"`
	AgentID           string `gorm:"column:agent_id;not null;type:varchar(64)"`
	DestinationChatID string `gorm:"column:destination_chat_id;not null;type:varchar(128)"`
	Enabled           bool   `gorm:"not null;default:true"`
	Revision          uint64 `gorm:"not null;default:1"`
	NextDueAt         *time.Time
	MissedWindowSecs  int64  `gorm:"column:missed_window_secs;not null;default:900"`
	TriggerCursor     string `gorm:"column:trigger_cursor;not null;default:'';type:varchar(255)"`
	LastTriggeredAt   *time.Time
	LastRunStatus     string `gorm:"column:last_run_status;not null;default:'never';type:varchar(32)"`
	LastRunAt         *time.Time
	LastError         string `gorm:"column:last_error;type:text"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (ChannelAutomation) TableName() string { return "channel_automations" }

type ChannelAutomationRun struct {
	ID                 string `gorm:"primaryKey;type:varchar(64)"`
	AutomationID       string `gorm:"column:automation_id;not null;type:varchar(64);index:idx_channel_automation_run"`
	AutomationRevision uint64 `gorm:"column:automation_revision;not null;default:1"`
	IdempotencyKey     string `gorm:"column:idempotency_key;not null;type:varchar(255);uniqueIndex:uq_channel_automation_run"`
	TriggerType        string `gorm:"column:trigger_type;not null;default:'manual';type:varchar(32)"`
	TriggerIdentity    string `gorm:"column:trigger_identity;not null;default:'';type:varchar(255)"`
	TriggerPayloadJSON string `gorm:"column:trigger_payload_json;type:text"`
	ScheduledFor       *time.Time
	InboundID          string `gorm:"column:inbound_id;not null;default:'';type:varchar(64)"`
	TurnID             string `gorm:"column:turn_id;not null;default:'';type:varchar(64)"`
	DeliveryID         string `gorm:"column:delivery_id;not null;default:'';type:varchar(64)"`
	Status             string `gorm:"not null;type:varchar(32);index:idx_channel_automation_run_status"`
	LeaseToken         string `gorm:"column:lease_token;not null;default:'';type:varchar(64)"`
	LeaseExpiresAt     *time.Time
	CancelledAt        *time.Time
	ErrorMessage       string `gorm:"column:error_message;type:text"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (ChannelAutomationRun) TableName() string { return "channel_automation_runs" }

type ChannelDiagnosticEvent struct {
	ID           string    `gorm:"primaryKey;type:varchar(64)"`
	BindingID    string    `gorm:"column:binding_id;not null;type:varchar(64);index:idx_channel_diag_binding"`
	Direction    string    `gorm:"not null;type:varchar(16)"`
	Phase        string    `gorm:"not null;type:varchar(32);index:idx_channel_diag_phase"`
	MessageType  string    `gorm:"column:message_type;not null;default:'';type:varchar(32)"`
	Summary      string    `gorm:"type:text"`
	SenderID     string    `gorm:"column:sender_id;not null;default:'';type:varchar(128)"`
	SenderName   string    `gorm:"column:sender_name;not null;default:'';type:varchar(255)"`
	TargetID     string    `gorm:"column:target_id;not null;default:'';type:varchar(128)"`
	ChatType     string    `gorm:"column:chat_type;not null;default:'';type:varchar(32)"`
	TurnID       string    `gorm:"column:turn_id;not null;default:'';type:varchar(64)"`
	DeliveryID   string    `gorm:"column:delivery_id;not null;default:'';type:varchar(64)"`
	ErrorCode    string    `gorm:"column:error_code;not null;default:'';type:varchar(64)"`
	ErrorMessage string    `gorm:"column:error_message;type:text"`
	OccurredAt   time.Time `gorm:"index:idx_channel_diag_occurred"`
	LatencyMS    int64
	CreatedAt    time.Time
}

func (ChannelDiagnosticEvent) TableName() string { return "channel_diagnostic_events" }

type ChannelProvisioningJob struct {
	ID                  string `gorm:"primaryKey;type:varchar(64)"`
	ActorPTID           string `gorm:"column:actor_ptid;not null;type:varchar(128);index:idx_channel_provision_actor"`
	SessionID           string `gorm:"column:session_id;not null;default:'';type:varchar(64);index:idx_channel_provision_session"`
	Region              string `gorm:"not null;default:'feishu';type:varchar(32)"`
	AppName             string `gorm:"column:app_name;not null;type:varchar(255)"`
	AppDescription      string `gorm:"column:app_description;type:text"`
	ProviderAppID       string `gorm:"column:provider_app_id;not null;default:'';type:varchar(128)"`
	OwnerProviderUserID string `gorm:"column:owner_provider_user_id;not null;default:'';type:varchar(128)"`
	CredentialSecretID  string `gorm:"column:credential_secret_id;not null;default:'';type:varchar(64)"`
	BindingID           string `gorm:"column:binding_id;not null;default:'';type:varchar(64)"`
	Status              string `gorm:"not null;type:varchar(32);index:idx_channel_provision_status"`
	Step                string `gorm:"not null;default:'prepare';type:varchar(64)"`
	ConsoleURL          string `gorm:"column:console_url;type:text"`
	ErrorCode           string `gorm:"column:error_code;not null;default:'';type:varchar(64)"`
	ErrorMessage        string `gorm:"column:error_message;type:text"`
	ReservationToken    string `gorm:"column:reservation_token;not null;default:'';type:varchar(64)"`
	ReservationExpires  *time.Time
	ExpiresAt           time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (ChannelProvisioningJob) TableName() string { return "channel_provisioning_jobs" }

type ChannelCardAction struct {
	ID             string `gorm:"primaryKey;type:varchar(64)"`
	BindingID      string `gorm:"column:binding_id;not null;type:varchar(64);index:idx_channel_action_binding"`
	ActionID       string `gorm:"column:action_id;not null;type:varchar(255);uniqueIndex:uq_channel_action"`
	ProviderUserID string `gorm:"column:provider_user_id;not null;type:varchar(128)"`
	MessageID      string `gorm:"column:message_id;not null;type:varchar(255)"`
	Action         string `gorm:"not null;type:varchar(64)"`
	ValueJSON      string `gorm:"column:value_json;type:text"`
	Status         string `gorm:"not null;type:varchar(32)"`
	Result         string `gorm:"type:text"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (ChannelCardAction) TableName() string { return "channel_card_actions" }

// AllModels returns every model owned by the Channel subserver database.
func AllModels() []interface{} {
	return []interface{}{
		&ChannelSecret{},
		&ChannelPlugin{},
		&ChannelBinding{},
		&ChannelRequesterAuthorization{},
		&ChannelConversationLink{},
		&ChannelInboundEvent{},
		&ChannelDeliveryIntent{},
		&ChannelRoute{},
		&ChannelMemberAccess{},
		&ChannelChat{},
		&ChannelAutomation{},
		&ChannelAutomationRun{},
		&ChannelDiagnosticEvent{},
		&ChannelProvisioningJob{},
		&ChannelCardAction{},
	}
}
