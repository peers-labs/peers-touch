package conversation

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// --- GORM Models ---

type conversationModel struct {
	ID                     uint      `gorm:"column:id;primaryKey"`
	ConversationID         string    `gorm:"column:conversation_id;size:128;uniqueIndex"`
	Kind                   int32     `gorm:"column:kind"`
	AuthorityStationPeerID string    `gorm:"column:authority_station_peer_id;size:255"`
	MembershipEpoch        int64     `gorm:"column:membership_epoch"`
	Status                 int32     `gorm:"column:status"`
	CurrentSeq             int64     `gorm:"column:current_seq"`
	Name                   string    `gorm:"column:name;size:255"`
	Description            string    `gorm:"column:description;type:text"`
	AvatarCID              string    `gorm:"column:avatar_cid;size:255"`
	OwnerActorDID          string    `gorm:"column:owner_actor_did;size:255"`
	MaxMembers             int32     `gorm:"column:max_members"`
	Visibility             int32     `gorm:"column:visibility"`
	CreatedAt              time.Time `gorm:"column:created_at"`
	UpdatedAt              time.Time `gorm:"column:updated_at"`
}

func (*conversationModel) TableName() string { return "conversations" }

type conversationMemberModel struct {
	ID                     uint       `gorm:"column:id;primaryKey"`
	ConversationID         string     `gorm:"column:conversation_id;size:128;index:idx_member_conv;uniqueIndex:idx_member_conv_actor"`
	ActorDID               string     `gorm:"column:actor_did;size:255;index:idx_member_actor;uniqueIndex:idx_member_conv_actor"`
	Role                   int32      `gorm:"column:role"`
	MemberStatus           int32      `gorm:"column:member_status"`
	ActorHomeStationPeerID string     `gorm:"column:actor_home_station_peer_id;size:255"`
	ActorHomeStationDomain string     `gorm:"column:actor_home_station_domain;size:255"`
	Nickname               string     `gorm:"column:nickname;size:255"`
	Muted                  bool       `gorm:"column:muted"`
	MutedUntil             *time.Time `gorm:"column:muted_until"`
	JoinedAt               time.Time  `gorm:"column:joined_at"`
	InvitedByActorDID      string     `gorm:"column:invited_by_actor_did;size:255"`
}

func (*conversationMemberModel) TableName() string { return "conversation_members" }

type conversationEventModel struct {
	ID             uint      `gorm:"column:id;primaryKey"`
	EventID        string    `gorm:"column:event_id;size:64;uniqueIndex"`
	ConversationID string    `gorm:"column:conversation_id;size:128;index:idx_event_conv_seq"`
	GroupSeq       int64     `gorm:"column:group_seq;index:idx_event_conv_seq"`
	EventBytes     []byte    `gorm:"column:event_bytes;type:bytea"`
	CommittedAt    time.Time `gorm:"column:committed_at"`
}

func (*conversationEventModel) TableName() string { return "conversation_events" }

// --- PostgresConversationRepo ---

type postgresConversationRepo struct {
	db *gorm.DB
}

func newPostgresConversationRepo(db *gorm.DB) *postgresConversationRepo {
	return &postgresConversationRepo{db: db}
}

func (r *postgresConversationRepo) UpsertConversation(ctx context.Context, conv *chat.Conversation) error {
	model := &conversationModel{
		ConversationID:         conv.ConversationId,
		Kind:                   int32(conv.Kind),
		AuthorityStationPeerID: conv.AuthorityStationPeerId,
		MembershipEpoch:        conv.MembershipEpoch,
		Status:                 int32(conv.Status),
		Name:                   conv.Name,
		Description:            conv.Description,
		AvatarCID:              conv.AvatarCid,
		OwnerActorDID:          conv.OwnerActorDid,
		MaxMembers:             conv.MaxMembers,
		Visibility:             int32(conv.Visibility),
		CreatedAt:              conv.CreatedAt.AsTime(),
		UpdatedAt:              conv.UpdatedAt.AsTime(),
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "conversation_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"status", "membership_epoch", "name", "description", "updated_at"}),
		}).
		Create(model).Error
}

func (r *postgresConversationRepo) GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error) {
	var model conversationModel
	if err := r.db.WithContext(ctx).Where("conversation_id = ?", conversationID).First(&model).Error; err != nil {
		return nil, err
	}
	return model.toProto(), nil
}

func (r *postgresConversationRepo) ListByActor(ctx context.Context, actorDID string) ([]*chat.Conversation, error) {
	var members []conversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("actor_did = ? AND member_status = ?", actorDID, int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE)).
		Find(&members).Error; err != nil {
		return nil, err
	}

	if len(members) == 0 {
		return nil, nil
	}

	convIDs := make([]string, 0, len(members))
	for _, m := range members {
		convIDs = append(convIDs, m.ConversationID)
	}

	var models []conversationModel
	if err := r.db.WithContext(ctx).Where("conversation_id IN ?", convIDs).Find(&models).Error; err != nil {
		return nil, err
	}

	result := make([]*chat.Conversation, 0, len(models))
	for _, m := range models {
		result = append(result, m.toProto())
	}
	return result, nil
}

func (r *postgresConversationRepo) UpsertMember(ctx context.Context, member *chat.ConversationMember) error {
	model := &conversationMemberModel{
		ConversationID:         member.ConversationId,
		ActorDID:               member.ActorDid,
		Role:                   int32(member.Role),
		MemberStatus:           int32(member.MemberStatus),
		ActorHomeStationPeerID: member.ActorHomeStationPeerId,
		ActorHomeStationDomain: member.ActorHomeStationDomain,
		Nickname:               member.Nickname,
		Muted:                  member.Muted,
		JoinedAt:               member.JoinedAt.AsTime(),
		InvitedByActorDID:      member.InvitedByActorDid,
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "conversation_id"}, {Name: "actor_did"}},
			DoUpdates: clause.AssignmentColumns([]string{"role", "member_status", "nickname", "muted"}),
		}).
		Create(model).Error
}

func (r *postgresConversationRepo) GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error) {
	var models []conversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Find(&models).Error; err != nil {
		return nil, err
	}
	result := make([]*chat.ConversationMember, 0, len(models))
	for _, m := range models {
		result = append(result, m.toProto())
	}
	return result, nil
}

func (r *postgresConversationRepo) GetMember(ctx context.Context, conversationID, actorDID string) (*chat.ConversationMember, error) {
	var model conversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND actor_did = ?", conversationID, actorDID).
		First(&model).Error; err != nil {
		return nil, err
	}
	return model.toProto(), nil
}

func (r *postgresConversationRepo) AppendEvent(ctx context.Context, event *chat.CommittedConversationEvent) error {
	eventBytes, err := proto.Marshal(event)
	if err != nil {
		return err
	}
	model := &conversationEventModel{
		EventID:        event.EventId,
		ConversationID: event.ConversationId,
		GroupSeq:       event.GroupSeq,
		EventBytes:     eventBytes,
		CommittedAt:    event.CommittedAt.AsTime(),
	}
	return r.db.WithContext(ctx).Create(model).Error
}

func (r *postgresConversationRepo) ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	var models []conversationEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND group_seq > ?", conversationID, afterSeq).
		Order("group_seq ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, err
	}
	result := make([]*chat.CommittedConversationEvent, 0, len(models))
	for _, m := range models {
		event := &chat.CommittedConversationEvent{}
		if err := proto.Unmarshal(m.EventBytes, event); err != nil {
			continue
		}
		result = append(result, event)
	}
	return result, nil
}

func (r *postgresConversationRepo) NextSeq(ctx context.Context, conversationID string) (int64, error) {
	var seq int64
	err := r.db.WithContext(ctx).Raw(
		"UPDATE conversations SET current_seq = current_seq + 1 WHERE conversation_id = ? RETURNING current_seq",
		conversationID,
	).Scan(&seq).Error
	return seq, err
}

func (r *postgresConversationRepo) BumpMembershipEpoch(ctx context.Context, conversationID string, newEpoch int64) error {
	return r.db.WithContext(ctx).
		Model(&conversationModel{}).
		Where("conversation_id = ?", conversationID).
		Update("membership_epoch", newEpoch).Error
}

// --- Proto converters ---

func (m *conversationModel) toProto() *chat.Conversation {
	return &chat.Conversation{
		ConversationId:         m.ConversationID,
		Kind:                   chat.ConversationKind(m.Kind),
		AuthorityStationPeerId: m.AuthorityStationPeerID,
		MembershipEpoch:        m.MembershipEpoch,
		Status:                 chat.ConversationStatus(m.Status),
		Name:                   m.Name,
		Description:            m.Description,
		AvatarCid:              m.AvatarCID,
		OwnerActorDid:          m.OwnerActorDID,
		MaxMembers:             m.MaxMembers,
		Visibility:             chat.GroupVisibilityV1(m.Visibility),
		CreatedAt:              timestamppb.New(m.CreatedAt),
		UpdatedAt:              timestamppb.New(m.UpdatedAt),
	}
}

func (m *conversationMemberModel) toProto() *chat.ConversationMember {
	return &chat.ConversationMember{
		ConversationId:         m.ConversationID,
		ActorDid:               m.ActorDID,
		Role:                   chat.MemberRole(m.Role),
		MemberStatus:           chat.MemberStatus(m.MemberStatus),
		ActorHomeStationPeerId: m.ActorHomeStationPeerID,
		ActorHomeStationDomain: m.ActorHomeStationDomain,
		Nickname:               m.Nickname,
		Muted:                  m.Muted,
		JoinedAt:               timestamppb.New(m.JoinedAt),
		InvitedByActorDid:      m.InvitedByActorDID,
	}
}
