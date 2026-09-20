package persistence

import "time"

type ConversationModel struct {
	ConversationID         string    `gorm:"column:conversation_id;size:128;primaryKey"`
	Kind                   string    `gorm:"column:kind;size:16;not null"`
	Status                 string    `gorm:"column:status;size:32;not null;index"`
	FederationID           string    `gorm:"column:federation_id;size:128;not null"`
	AuthorityStationPeerID string    `gorm:"column:authority_station_peer_id;size:255;not null"`
	AuthorityEpoch         uint64    `gorm:"column:authority_epoch;not null"`
	OwnerPTID              string    `gorm:"column:owner_ptid;size:255;not null"`
	CurrentSequence        uint64    `gorm:"column:current_sequence;not null"`
	CurrentEventHash       []byte    `gorm:"column:current_event_hash;type:bytea"`
	MembershipEpoch        uint64    `gorm:"column:membership_epoch;not null"`
	MLSEpoch               uint64    `gorm:"column:mls_epoch;not null"`
	Name                   string    `gorm:"column:name;size:255"`
	Description            string    `gorm:"column:description;type:text"`
	AvatarObjectID         string    `gorm:"column:avatar_object_id;size:255"`
	Visibility             string    `gorm:"column:visibility;size:32"`
	DisappearTimerSeconds  uint32    `gorm:"column:disappear_timer_seconds;not null"`
	CreatedAt              time.Time `gorm:"column:created_at;not null"`
	UpdatedAt              time.Time `gorm:"column:updated_at;not null"`
}

func (*ConversationModel) TableName() string {
	return "conversations"
}

type ConversationMemberModel struct {
	ConversationID string     `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string     `gorm:"column:ptid;size:255;primaryKey;index"`
	Role           string     `gorm:"column:role;size:32;not null"`
	Status         string     `gorm:"column:member_status;size:32;not null;index"`
	HomeStation    string     `gorm:"column:actor_home_station_peer_id;size:255;not null"`
	JoinedSequence uint64     `gorm:"column:joined_sequence;not null"`
	LeftSequence   uint64     `gorm:"column:left_sequence;not null"`
	Muted          bool       `gorm:"column:muted;not null"`
	MutedUntil     *time.Time `gorm:"column:muted_until"`
}

func (*ConversationMemberModel) TableName() string {
	return "conversation_members"
}

type ConversationMemberDeviceModel struct {
	ConversationID string `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string `gorm:"column:ptid;size:255;primaryKey;index"`
	DeviceID       string `gorm:"column:device_id;size:255;primaryKey"`
	HomeStation    string `gorm:"column:home_station_peer_id;size:255;not null"`
	Active         bool   `gorm:"column:active;not null;index"`
	JoinedSequence uint64 `gorm:"column:joined_sequence;not null"`
	LeftSequence   uint64 `gorm:"column:left_sequence;not null"`
}

func (*ConversationMemberDeviceModel) TableName() string {
	return "conversation_member_devices"
}

type ConversationEventModel struct {
	EventID          string    `gorm:"column:event_id;size:128;primaryKey"`
	ConversationID   string    `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_conversation_event_sequence;uniqueIndex:uidx_conversation_event_command,priority:1;uniqueIndex:uidx_conversation_message,priority:1;index"`
	Sequence         uint64    `gorm:"column:sequence;uniqueIndex:uidx_conversation_event_sequence"`
	CommandID        string    `gorm:"column:command_id;size:128;uniqueIndex:uidx_conversation_event_command,priority:2"`
	MessageID        *string   `gorm:"column:message_id;size:128;uniqueIndex:uidx_conversation_message,priority:2"`
	MessageAuthor    string    `gorm:"column:message_author_ptid;size:255"`
	ActorPTID        string    `gorm:"column:actor_ptid;size:255;not null"`
	ActorDeviceID    string    `gorm:"column:actor_device_id;size:255;not null"`
	PreviousHash     []byte    `gorm:"column:previous_hash;type:bytea"`
	EventHash        []byte    `gorm:"column:event_hash;type:bytea;not null"`
	MembershipEpoch  uint64    `gorm:"column:membership_epoch;not null"`
	MLSEpoch         uint64    `gorm:"column:mls_epoch;not null"`
	AuthorityStation string    `gorm:"column:authority_station_peer_id;size:255;not null"`
	EventKind        string    `gorm:"column:event_kind;size:64;not null"`
	HashScheme       string    `gorm:"column:hash_scheme;size:32;not null"`
	EventBytes       []byte    `gorm:"column:event_bytes;type:bytea;not null"`
	DomainSnapshot   []byte    `gorm:"column:domain_snapshot_bytes;type:bytea;not null"`
	CommittedAt      time.Time `gorm:"column:committed_at;not null"`
}

func (*ConversationEventModel) TableName() string {
	return "conversation_events"
}

type ConversationCommandReceiptModel struct {
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	CommandID      string    `gorm:"column:command_id;size:128;primaryKey"`
	CommandHash    []byte    `gorm:"column:command_sha256;type:bytea;not null"`
	Outcome        string    `gorm:"column:outcome;size:16;not null"`
	EventID        string    `gorm:"column:event_id;size:128;index"`
	EventBytes     []byte    `gorm:"column:event_bytes;type:bytea"`
	RejectionCode  string    `gorm:"column:rejection_code;size:64"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
}

func (*ConversationCommandReceiptModel) TableName() string {
	return "conversation_command_receipts"
}

type ConversationAuthorityPlanModel struct {
	PlanID            string     `gorm:"column:plan_id;size:128;primaryKey"`
	ConversationID    string     `gorm:"column:conversation_id;size:128;not null;index"`
	FederationID      string     `gorm:"column:federation_id;size:128;not null"`
	AuthorityEpoch    uint64     `gorm:"column:authority_epoch;not null"`
	RequesterPTID     string     `gorm:"column:requester_ptid;size:255;not null"`
	RequesterDeviceID string     `gorm:"column:requester_device_id;size:255;not null"`
	AuthoritySequence uint64     `gorm:"column:authority_sequence;not null"`
	AuthorityHash     []byte     `gorm:"column:authority_hash;type:bytea"`
	MembershipEpoch   uint64     `gorm:"column:membership_epoch;not null"`
	MLSEpoch          uint64     `gorm:"column:mls_epoch;not null"`
	PlanHash          []byte     `gorm:"column:authority_plan_sha256;type:bytea;not null"`
	State             string     `gorm:"column:state;size:32;not null;index"`
	SnapshotBytes     []byte     `gorm:"column:snapshot_bytes;type:bytea;not null"`
	ExpiresAt         time.Time  `gorm:"column:expires_at;not null;index"`
	TerminalAt        *time.Time `gorm:"column:terminal_at"`
}

func (*ConversationAuthorityPlanModel) TableName() string {
	return "conversation_authority_plans"
}

type ConversationMemberSettingsModel struct {
	ConversationID      string    `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID                string    `gorm:"column:ptid;size:255;primaryKey"`
	Nickname            string    `gorm:"column:nickname;size:255"`
	Muted               bool      `gorm:"column:muted;not null"`
	Pinned              bool      `gorm:"column:pinned;not null"`
	AlertEnabled        bool      `gorm:"column:alert_enabled;not null"`
	Background          string    `gorm:"column:background;size:32;not null"`
	BackgroundImage     string    `gorm:"column:background_image;size:2048"`
	ClearedAtUnixMillis int64     `gorm:"column:cleared_at_unix_ms;not null"`
	UpdatedAt           time.Time `gorm:"column:updated_at;not null"`
}

func (*ConversationMemberSettingsModel) TableName() string {
	return "conversation_member_settings"
}

type ConversationReadCursorModel struct {
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string    `gorm:"column:ptid;size:255;primaryKey"`
	Sequence       uint64    `gorm:"column:last_read_sequence;not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null"`
}

func (*ConversationReadCursorModel) TableName() string {
	return "conversation_read_cursors"
}

type ConversationLeaveIntentModel struct {
	Version           uint32     `gorm:"column:version;not null"`
	IntentID          string     `gorm:"column:intent_id;size:128;primaryKey"`
	FederationID      string     `gorm:"column:federation_id;size:128;not null"`
	ConversationID    string     `gorm:"column:conversation_id;size:128;not null;index"`
	ActorPTID         string     `gorm:"column:actor_ptid;size:255;not null;index"`
	ActorDeviceID     string     `gorm:"column:actor_device_id;size:255;not null"`
	ActorSigningKeyID string     `gorm:"column:actor_signing_key_id;size:255;not null"`
	HomeStation       string     `gorm:"column:home_station_peer_id;size:255;not null"`
	AuthorityStation  string     `gorm:"column:authority_station_peer_id;size:255;not null"`
	AuthorityEpoch    uint64     `gorm:"column:authority_epoch;not null"`
	AuthoritySequence uint64     `gorm:"column:authority_sequence;not null"`
	AuthorityHash     []byte     `gorm:"column:authority_hash;type:bytea;not null"`
	MembershipEpoch   uint64     `gorm:"column:membership_epoch;not null"`
	MLSEpoch          uint64     `gorm:"column:mls_epoch;not null"`
	SigningBytes      []byte     `gorm:"column:signing_bytes;type:bytea;not null"`
	Signature         []byte     `gorm:"column:signature;type:bytea;not null"`
	State             string     `gorm:"column:state;size:32;not null;index"`
	CreatedAt         time.Time  `gorm:"column:created_at;not null"`
	ExpiresAt         time.Time  `gorm:"column:expires_at;not null"`
	ConsumedAt        *time.Time `gorm:"column:consumed_at"`
	TransitionID      string     `gorm:"column:transition_id;size:128"`
}

func (*ConversationLeaveIntentModel) TableName() string {
	return "conversation_mls_leave_intents"
}

type ConversationFollowerHeadModel struct {
	ConversationID         string    `gorm:"column:conversation_id;size:128;primaryKey"`
	FederationID           string    `gorm:"column:federation_id;size:128;not null"`
	AuthorityStationPeerID string    `gorm:"column:authority_station_peer_id;size:255;not null"`
	AuthorityEpoch         uint64    `gorm:"column:authority_epoch;not null"`
	Sequence               uint64    `gorm:"column:group_seq;not null"`
	EventHash              []byte    `gorm:"column:event_hash;type:bytea;not null"`
	MembershipEpoch        uint64    `gorm:"column:membership_epoch;not null"`
	MLSEpoch               uint64    `gorm:"column:mls_epoch;not null"`
	SnapshotBytes          []byte    `gorm:"column:snapshot_bytes;type:bytea;not null"`
	UpdatedAt              time.Time `gorm:"column:updated_at;not null"`
}

func (*ConversationFollowerHeadModel) TableName() string {
	return "conversation_follower_heads"
}

type ConversationFollowerStateModel struct {
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	Status         string    `gorm:"column:status;size:32;not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null"`
}

func (*ConversationFollowerStateModel) TableName() string {
	return "conversation_follower_states"
}

type ConversationFollowerPendingEventModel struct {
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	Sequence       uint64    `gorm:"column:sequence;primaryKey"`
	EventID        string    `gorm:"column:event_id;size:128;not null;uniqueIndex:uidx_conversation_follower_pending_event"`
	EventHash      []byte    `gorm:"column:event_hash;type:bytea;not null"`
	HashScheme     string    `gorm:"column:hash_scheme;size:32;not null"`
	EventBytes     []byte    `gorm:"column:event_bytes;type:bytea;not null"`
	DomainSnapshot []byte    `gorm:"column:domain_snapshot_bytes;type:bytea;not null"`
	ReceivedAt     time.Time `gorm:"column:received_at;not null"`
}

func (*ConversationFollowerPendingEventModel) TableName() string {
	return "conversation_follower_pending_events"
}

type ConversationFollowerMemberModel struct {
	ConversationID string `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string `gorm:"column:ptid;size:255;primaryKey;index"`
	Status         string `gorm:"column:status;size:32;not null;index"`
}

func (*ConversationFollowerMemberModel) TableName() string {
	return "conversation_follower_members"
}
