package infrastructure

import "time"

const (
	friendRequestPolicyRelationshipAccepted int32 = 2
)

type federatedFriendRequestCommandModel struct {
	Role                   string     `gorm:"column:role;size:32;primaryKey"`
	AuthorityStationPeerID string     `gorm:"column:authority_station_peer_id;size:255;primaryKey"`
	CommandID              string     `gorm:"column:command_id;size:255;primaryKey"`
	RequestID              string     `gorm:"column:request_id;size:255;not null;index"`
	CommandBytes           []byte     `gorm:"column:command_bytes;type:bytea;not null"`
	CommandPayloadSHA256   []byte     `gorm:"column:command_payload_sha256;type:bytea;not null"`
	ResultBytes            []byte     `gorm:"column:result_bytes;type:bytea"`
	CreatedAt              time.Time  `gorm:"column:created_at;not null"`
	ResolvedAt             *time.Time `gorm:"column:resolved_at"`
}

func (*federatedFriendRequestCommandModel) TableName() string {
	return "social_friend_request_commands"
}

type federatedFriendRequestProjectionModel struct {
	RequestID                 string     `gorm:"column:request_id;size:255;primaryKey"`
	FederationID              string     `gorm:"column:federation_id;size:255;not null;index"`
	AuthorityStationPeerID    string     `gorm:"column:authority_station_peer_id;size:255;not null;index"`
	SenderPTID                string     `gorm:"column:sender_ptid;size:255;not null;index"`
	ReceiverPTID              string     `gorm:"column:receiver_ptid;size:255;not null;index"`
	SenderActorRefBytes       []byte     `gorm:"column:sender_actor_ref_bytes;type:bytea;not null"`
	ReceiverActorRefBytes     []byte     `gorm:"column:receiver_actor_ref_bytes;type:bytea;not null"`
	SenderHomeStationPeerID   string     `gorm:"column:sender_home_station_peer_id;size:255;not null"`
	ReceiverHomeStationPeerID string     `gorm:"column:receiver_home_station_peer_id;size:255;not null"`
	Message                   string     `gorm:"column:message;type:text;not null"`
	State                     int32      `gorm:"column:state;not null;index"`
	Sequence                  int64      `gorm:"column:sequence;not null"`
	LastEventHash             []byte     `gorm:"column:last_event_hash;type:bytea"`
	LastEventBytes            []byte     `gorm:"column:last_event_bytes;type:bytea"`
	AuthorityConfirmed        bool       `gorm:"column:authority_confirmed;not null"`
	CreatedAt                 time.Time  `gorm:"column:created_at;not null"`
	RespondedAt               *time.Time `gorm:"column:responded_at"`
}

func (*federatedFriendRequestProjectionModel) TableName() string {
	return "social_friend_requests"
}

type federatedRelationshipProjectionModel struct {
	OwnerPTID         string    `gorm:"column:owner_ptid;size:255;primaryKey"`
	PeerPTID          string    `gorm:"column:peer_ptid;size:255;primaryKey"`
	RequestID         string    `gorm:"column:request_id;size:255;not null;index"`
	AcceptedEventID   string    `gorm:"column:accepted_event_id;size:255;not null"`
	AcceptedEventHash []byte    `gorm:"column:accepted_event_hash;type:bytea;not null"`
	AcceptedAt        time.Time `gorm:"column:accepted_at;not null"`
}

func (*federatedRelationshipProjectionModel) TableName() string {
	return "social_relationship_projections"
}

type directConversationEffectState string

const (
	directConversationEffectPending   directConversationEffectState = "pending"
	directConversationEffectLeased    directConversationEffectState = "leased"
	directConversationEffectCompleted directConversationEffectState = "completed"
)

type directConversationEffectModel struct {
	EffectID        string                        `gorm:"column:effect_id;size:255;primaryKey"`
	RequestID       string                        `gorm:"column:request_id;size:255;not null;uniqueIndex"`
	FederationID    string                        `gorm:"column:federation_id;size:255;not null;index"`
	ActorAPTID      string                        `gorm:"column:actor_a_ptid;size:255;not null"`
	ActorBPTID      string                        `gorm:"column:actor_b_ptid;size:255;not null"`
	AcceptedEventID string                        `gorm:"column:accepted_event_id;size:255;not null"`
	State           directConversationEffectState `gorm:"column:state;size:32;not null;index:idx_social_direct_effect_ready,priority:1"`
	AttemptCount    uint32                        `gorm:"column:attempt_count;not null"`
	NextAttemptAt   time.Time                     `gorm:"column:next_attempt_at;not null;index:idx_social_direct_effect_ready,priority:2"`
	LeaseOwner      string                        `gorm:"column:lease_owner;size:255;not null;default:''"`
	LeaseGeneration uint64                        `gorm:"column:lease_generation;not null"`
	LeaseExpiresAt  *time.Time                    `gorm:"column:lease_expires_at;index"`
	ConversationID  string                        `gorm:"column:conversation_id;size:255;not null;default:''"`
	LastFailure     string                        `gorm:"column:last_failure;size:64;not null;default:''"`
	CreatedAt       time.Time                     `gorm:"column:created_at;not null"`
	CompletedAt     *time.Time                    `gorm:"column:completed_at"`
}

func (*directConversationEffectModel) TableName() string {
	return "social_friend_request_effects"
}
