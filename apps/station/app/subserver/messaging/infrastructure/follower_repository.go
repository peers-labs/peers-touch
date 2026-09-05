package infrastructure

import (
	"bytes"
	"context"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FollowerConversationModel struct {
	ConversationID        string    `gorm:"column:conversation_id;size:128;primaryKey"`
	AuthorityStationID    string    `gorm:"column:authority_station_id;size:255;not null"`
	AuthoritySigningKeyID string    `gorm:"column:authority_signing_key_id;size:64;not null"`
	Kind                  int32     `gorm:"column:kind;not null"`
	Name                  string    `gorm:"column:name;size:255"`
	OwnerPTID             string    `gorm:"column:owner_ptid;size:255;not null"`
	CurrentSequence       int64     `gorm:"column:current_sequence;not null"`
	CurrentEventHash      []byte    `gorm:"column:current_event_hash;type:bytea;not null"`
	MembershipEpoch       int64     `gorm:"column:membership_epoch;not null"`
	MlsEpoch              int64     `gorm:"column:mls_epoch;not null"`
	State                 string    `gorm:"column:state;size:64;not null"`
	UpdatedAt             time.Time `gorm:"column:updated_at;not null"`
}

func (*FollowerConversationModel) TableName() string {
	return "messaging_follower_conversations"
}

type FollowerMemberModel struct {
	ConversationID string `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string `gorm:"column:ptid;size:255;primaryKey"`
	HomeStationID  string `gorm:"column:home_station_id;size:255;not null"`
	Role           string `gorm:"column:role;size:32;not null"`
	Active         bool   `gorm:"column:active;not null;index"`
	JoinedSequence int64  `gorm:"column:joined_sequence;not null"`
	LeftSequence   int64  `gorm:"column:left_sequence;not null"`
}

func (*FollowerMemberModel) TableName() string {
	return "messaging_follower_members"
}

type FollowerEventReceiptModel struct {
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey;uniqueIndex:uidx_follower_event_identity,priority:1"`
	Sequence       int64     `gorm:"column:sequence;primaryKey"`
	EventID        string    `gorm:"column:event_id;size:128;not null;uniqueIndex:uidx_follower_event_identity,priority:2"`
	EventHash      []byte    `gorm:"column:event_hash;type:bytea;not null"`
	PreviousHash   []byte    `gorm:"column:previous_hash;type:bytea;not null"`
	EventKind      string    `gorm:"column:event_kind;size:64;not null"`
	AppliedAt      time.Time `gorm:"column:applied_at;not null"`
}

func (*FollowerEventReceiptModel) TableName() string {
	return "messaging_follower_event_receipts"
}

type FollowerPendingEventModel struct {
	ConversationID   string    `gorm:"column:conversation_id;size:128;primaryKey;uniqueIndex:uidx_follower_pending_identity,priority:1"`
	Sequence         int64     `gorm:"column:sequence;primaryKey"`
	EventID          string    `gorm:"column:event_id;size:128;not null;uniqueIndex:uidx_follower_pending_identity,priority:2"`
	EventHash        []byte    `gorm:"column:event_hash;type:bytea;not null"`
	PreviousHash     []byte    `gorm:"column:previous_hash;type:bytea;not null"`
	PublicEventBytes []byte    `gorm:"column:public_event_bytes;type:bytea;not null"`
	ExpiresAt        time.Time `gorm:"column:expires_at;not null;index"`
}

func (*FollowerPendingEventModel) TableName() string {
	return "messaging_follower_pending_events"
}

type FollowerRepository struct {
	db *gorm.DB
}

func NewFollowerRepository(db *gorm.DB) (*FollowerRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: follower repository is not configured")
	}
	return &FollowerRepository{db: db}, nil
}

func (r *FollowerRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&FollowerConversationModel{},
		&FollowerMemberModel{},
		&FollowerEventReceiptModel{},
		&FollowerPendingEventModel{},
	)
}

func (r *FollowerRepository) CreateConversation(
	ctx context.Context,
	conversation *messaging.FollowerConversation,
) (bool, error) {
	if err := validateFollowerConversation(conversation); err != nil {
		return false, err
	}
	model := followerConversationModel(conversation)
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	existing, err := r.GetConversation(ctx, conversation.ConversationID)
	if err != nil {
		return false, err
	}
	if !sameFollowerConversation(existing, conversation) {
		return false, messaging.ErrFollowerProjectionConflict
	}
	return false, nil
}

func (r *FollowerRepository) GetConversation(
	ctx context.Context,
	conversationID string,
) (*messaging.FollowerConversation, error) {
	var model FollowerConversationModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return followerConversationFromModel(model), nil
}

func (r *FollowerRepository) AdvanceConversationHead(
	ctx context.Context,
	expectedSequence int64,
	expectedEventHash []byte,
	next *messaging.FollowerConversation,
) error {
	if err := validateFollowerConversation(next); err != nil {
		return err
	}
	query := r.db.WithContext(ctx).
		Model(&FollowerConversationModel{}).
		Where(
			"conversation_id = ? AND authority_station_id = ? "+
				"AND authority_signing_key_id = ? AND current_sequence = ?",
			next.ConversationID,
			next.AuthorityStationID,
			next.AuthoritySigningKeyID,
			expectedSequence,
		)
	if len(expectedEventHash) == 0 {
		query = query.Where("length(current_event_hash) = 0")
	} else {
		query = query.Where("current_event_hash = ?", expectedEventHash)
	}
	result := query.Updates(map[string]any{
		"kind":               int32(next.Kind),
		"name":               next.Name,
		"owner_ptid":         next.OwnerPTID,
		"current_sequence":   next.CurrentSequence,
		"current_event_hash": append([]byte(nil), next.CurrentEventHash...),
		"membership_epoch":   next.MembershipEpoch,
		"mls_epoch":          next.MlsEpoch,
		"state":              string(next.State),
		"updated_at":         next.UpdatedAt.UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrFollowerHeadConflict
	}
	return nil
}

func (r *FollowerRepository) UpsertMember(
	ctx context.Context,
	member *messaging.FollowerMember,
) error {
	if member == nil ||
		member.ConversationID == "" ||
		member.PTID == "" ||
		member.HomeStationID == "" ||
		member.Role == "" ||
		member.JoinedSequence <= 0 ||
		member.LeftSequence < 0 ||
		(member.Active && member.LeftSequence != 0) {
		return fmt.Errorf("messaging: complete follower member is required")
	}
	model := FollowerMemberModel{
		ConversationID: member.ConversationID,
		PTID:           member.PTID,
		HomeStationID:  member.HomeStationID,
		Role:           member.Role,
		Active:         member.Active,
		JoinedSequence: member.JoinedSequence,
		LeftSequence:   member.LeftSequence,
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	update := r.db.WithContext(ctx).
		Model(&FollowerMemberModel{}).
		Where(
			"conversation_id = ? AND ptid = ? AND home_station_id = ?",
			member.ConversationID,
			member.PTID,
			member.HomeStationID,
		).
		Updates(map[string]any{
			"role":            member.Role,
			"active":          member.Active,
			"joined_sequence": member.JoinedSequence,
			"left_sequence":   member.LeftSequence,
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return messaging.ErrFollowerProjectionConflict
	}
	return nil
}

func (r *FollowerRepository) ListMembers(
	ctx context.Context,
	conversationID string,
) ([]messaging.FollowerMember, error) {
	var models []FollowerMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Order("ptid ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	members := make([]messaging.FollowerMember, 0, len(models))
	for _, model := range models {
		members = append(members, messaging.FollowerMember{
			ConversationID: model.ConversationID,
			PTID:           model.PTID,
			HomeStationID:  model.HomeStationID,
			Role:           model.Role,
			Active:         model.Active,
			JoinedSequence: model.JoinedSequence,
			LeftSequence:   model.LeftSequence,
		})
	}
	return members, nil
}

func (r *FollowerRepository) AppendEventReceipt(
	ctx context.Context,
	receipt *messaging.FollowerEventReceipt,
) error {
	if receipt == nil ||
		receipt.ConversationID == "" ||
		receipt.Sequence <= 0 ||
		receipt.EventID == "" ||
		len(receipt.EventHash) == 0 ||
		receipt.EventKind == "" ||
		receipt.AppliedAt.IsZero() {
		return fmt.Errorf("messaging: complete follower event receipt is required")
	}
	model := FollowerEventReceiptModel{
		ConversationID: receipt.ConversationID,
		Sequence:       receipt.Sequence,
		EventID:        receipt.EventID,
		EventHash:      append([]byte(nil), receipt.EventHash...),
		PreviousHash:   append([]byte{}, receipt.PreviousHash...),
		EventKind:      receipt.EventKind,
		AppliedAt:      receipt.AppliedAt.UTC(),
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing []FollowerEventReceiptModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND (sequence = ? OR event_id = ?)",
			receipt.ConversationID,
			receipt.Sequence,
			receipt.EventID,
		).
		Find(&existing).Error; err != nil {
		return err
	}
	if len(existing) != 1 || !sameFollowerEventReceipt(existing[0], model) {
		return messaging.ErrFollowerProjectionConflict
	}
	return nil
}

func (r *FollowerRepository) GetEventReceipt(
	ctx context.Context,
	conversationID string,
	sequence int64,
) (*messaging.FollowerEventReceipt, error) {
	var model FollowerEventReceiptModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND sequence = ?", conversationID, sequence).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &messaging.FollowerEventReceipt{
		ConversationID: model.ConversationID,
		Sequence:       model.Sequence,
		EventID:        model.EventID,
		EventHash:      append([]byte(nil), model.EventHash...),
		PreviousHash:   append([]byte(nil), model.PreviousHash...),
		EventKind:      model.EventKind,
		AppliedAt:      model.AppliedAt,
	}, nil
}

func (r *FollowerRepository) GetEventReceiptByEventID(
	ctx context.Context,
	conversationID string,
	eventID string,
) (*messaging.FollowerEventReceipt, error) {
	var model FollowerEventReceiptModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND event_id = ?", conversationID, eventID).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &messaging.FollowerEventReceipt{
		ConversationID: model.ConversationID,
		Sequence:       model.Sequence,
		EventID:        model.EventID,
		EventHash:      append([]byte(nil), model.EventHash...),
		PreviousHash:   append([]byte(nil), model.PreviousHash...),
		EventKind:      model.EventKind,
		AppliedAt:      model.AppliedAt,
	}, nil
}

func (r *FollowerRepository) StorePendingEvent(
	ctx context.Context,
	event *messaging.FollowerPendingEvent,
) error {
	if event == nil ||
		event.ConversationID == "" ||
		event.Sequence <= 0 ||
		event.EventID == "" ||
		len(event.EventHash) == 0 ||
		len(event.PublicEventBytes) == 0 ||
		event.ExpiresAt.IsZero() {
		return fmt.Errorf("messaging: complete follower pending event is required")
	}
	model := FollowerPendingEventModel{
		ConversationID:   event.ConversationID,
		Sequence:         event.Sequence,
		EventID:          event.EventID,
		EventHash:        append([]byte(nil), event.EventHash...),
		PreviousHash:     append([]byte{}, event.PreviousHash...),
		PublicEventBytes: append([]byte(nil), event.PublicEventBytes...),
		ExpiresAt:        event.ExpiresAt.UTC(),
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing []FollowerPendingEventModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND (sequence = ? OR event_id = ?)",
			event.ConversationID,
			event.Sequence,
			event.EventID,
		).
		Find(&existing).Error; err != nil {
		return err
	}
	if len(existing) != 1 || !sameFollowerPendingEvent(existing[0], model) {
		return messaging.ErrFollowerProjectionConflict
	}
	return nil
}

func (r *FollowerRepository) ListPendingEvents(
	ctx context.Context,
	conversationID string,
) ([]messaging.FollowerPendingEvent, error) {
	var models []FollowerPendingEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Order("sequence ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	events := make([]messaging.FollowerPendingEvent, 0, len(models))
	for _, model := range models {
		events = append(events, messaging.FollowerPendingEvent{
			ConversationID:   model.ConversationID,
			Sequence:         model.Sequence,
			EventID:          model.EventID,
			EventHash:        append([]byte(nil), model.EventHash...),
			PreviousHash:     append([]byte(nil), model.PreviousHash...),
			PublicEventBytes: append([]byte(nil), model.PublicEventBytes...),
			ExpiresAt:        model.ExpiresAt,
		})
	}
	return events, nil
}

func (r *FollowerRepository) DeletePendingEvent(
	ctx context.Context,
	conversationID string,
	sequence int64,
) error {
	return r.db.WithContext(ctx).
		Where("conversation_id = ? AND sequence = ?", conversationID, sequence).
		Delete(&FollowerPendingEventModel{}).Error
}

func (r *FollowerRepository) DeleteExpiredPendingEvents(
	ctx context.Context,
	conversationID string,
	expiresAtOrBefore time.Time,
) (int64, error) {
	result := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND expires_at <= ?",
			conversationID,
			expiresAtOrBefore.UTC(),
		).
		Delete(&FollowerPendingEventModel{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

func (r *FollowerRepository) UpdateConversationState(
	ctx context.Context,
	conversationID string,
	state messaging.FollowerConversationState,
	updatedAt time.Time,
) error {
	if conversationID == "" || state == "" || updatedAt.IsZero() {
		return fmt.Errorf("messaging: follower conversation state update is incomplete")
	}
	result := r.db.WithContext(ctx).
		Model(&FollowerConversationModel{}).
		Where("conversation_id = ?", conversationID).
		Updates(map[string]any{
			"state":      string(state),
			"updated_at": updatedAt.UTC(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrNotFound
	}
	return nil
}

func (r *FollowerRepository) ListConversationsByState(
	ctx context.Context,
	state messaging.FollowerConversationState,
) ([]messaging.FollowerConversation, error) {
	var models []FollowerConversationModel
	if err := r.db.WithContext(ctx).
		Where("state = ?", string(state)).
		Order("conversation_id ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	conversations := make([]messaging.FollowerConversation, 0, len(models))
	for _, model := range models {
		conversations = append(conversations, *followerConversationFromModel(model))
	}
	return conversations, nil
}

func (r *FollowerRepository) ListActiveConversationsForActor(
	ctx context.Context,
	ptid string,
	localStationID string,
) ([]messaging.FollowerConversationView, error) {
	if ptid == "" || localStationID == "" {
		return nil, fmt.Errorf("messaging: follower conversation actor scope is required")
	}
	var models []FollowerConversationModel
	if err := r.db.WithContext(ctx).
		Where(
			"state = ? AND authority_station_id <> ? AND EXISTS ("+
				"SELECT 1 FROM messaging_follower_members members "+
				"WHERE members.conversation_id = messaging_follower_conversations.conversation_id "+
				"AND members.ptid = ? AND members.home_station_id = ? AND members.active = ?)",
			string(messaging.FollowerConversationStateActive),
			localStationID,
			ptid,
			localStationID,
			true,
		).
		Order("conversation_id ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	views := make([]messaging.FollowerConversationView, 0, len(models))
	for _, model := range models {
		members, err := r.ListMembers(ctx, model.ConversationID)
		if err != nil {
			return nil, err
		}
		memberPTIDs := make([]string, 0, len(members))
		for _, member := range members {
			if member.Active {
				memberPTIDs = append(memberPTIDs, member.PTID)
			}
		}
		views = append(views, messaging.FollowerConversationView{
			Conversation: followerConversationFromModel(model),
			MemberPTIDs:  memberPTIDs,
		})
	}
	return views, nil
}

func validateFollowerConversation(conversation *messaging.FollowerConversation) error {
	if conversation == nil ||
		conversation.ConversationID == "" ||
		conversation.AuthorityStationID == "" ||
		conversation.AuthoritySigningKeyID == "" ||
		conversation.CurrentSequence < 0 ||
		conversation.MembershipEpoch < 0 ||
		conversation.MlsEpoch < 0 ||
		conversation.State == "" ||
		conversation.UpdatedAt.IsZero() {
		return fmt.Errorf("messaging: complete follower conversation is required")
	}
	if conversation.CurrentSequence == 0 {
		if len(conversation.CurrentEventHash) != 0 ||
			conversation.Kind != messaging.AuthorityConversationKindUnspecified ||
			conversation.OwnerPTID != "" ||
			conversation.State != messaging.FollowerConversationStateGapWaitingResync {
			return fmt.Errorf("messaging: incomplete follower checkpoint is invalid")
		}
		return nil
	}
	if conversation.Kind == messaging.AuthorityConversationKindUnspecified ||
		conversation.OwnerPTID == "" ||
		len(conversation.CurrentEventHash) == 0 {
		return fmt.Errorf("messaging: complete follower checkpoint is required")
	}
	return nil
}

func followerConversationModel(
	conversation *messaging.FollowerConversation,
) FollowerConversationModel {
	return FollowerConversationModel{
		ConversationID:        conversation.ConversationID,
		AuthorityStationID:    conversation.AuthorityStationID,
		AuthoritySigningKeyID: conversation.AuthoritySigningKeyID,
		Kind:                  int32(conversation.Kind),
		Name:                  conversation.Name,
		OwnerPTID:             conversation.OwnerPTID,
		CurrentSequence:       conversation.CurrentSequence,
		CurrentEventHash:      append([]byte{}, conversation.CurrentEventHash...),
		MembershipEpoch:       conversation.MembershipEpoch,
		MlsEpoch:              conversation.MlsEpoch,
		State:                 string(conversation.State),
		UpdatedAt:             conversation.UpdatedAt.UTC(),
	}
}

func followerConversationFromModel(
	model FollowerConversationModel,
) *messaging.FollowerConversation {
	return &messaging.FollowerConversation{
		ConversationID:        model.ConversationID,
		AuthorityStationID:    model.AuthorityStationID,
		AuthoritySigningKeyID: model.AuthoritySigningKeyID,
		Kind:                  messaging.AuthorityConversationKind(model.Kind),
		Name:                  model.Name,
		OwnerPTID:             model.OwnerPTID,
		CurrentSequence:       model.CurrentSequence,
		CurrentEventHash:      append([]byte(nil), model.CurrentEventHash...),
		MembershipEpoch:       model.MembershipEpoch,
		MlsEpoch:              model.MlsEpoch,
		State:                 messaging.FollowerConversationState(model.State),
		UpdatedAt:             model.UpdatedAt,
	}
}

func sameFollowerConversation(
	left *messaging.FollowerConversation,
	right *messaging.FollowerConversation,
) bool {
	return left != nil &&
		right != nil &&
		left.ConversationID == right.ConversationID &&
		left.AuthorityStationID == right.AuthorityStationID &&
		left.AuthoritySigningKeyID == right.AuthoritySigningKeyID &&
		left.Kind == right.Kind &&
		left.Name == right.Name &&
		left.OwnerPTID == right.OwnerPTID &&
		left.CurrentSequence == right.CurrentSequence &&
		bytes.Equal(left.CurrentEventHash, right.CurrentEventHash) &&
		left.MembershipEpoch == right.MembershipEpoch &&
		left.MlsEpoch == right.MlsEpoch &&
		left.State == right.State &&
		left.UpdatedAt.Equal(right.UpdatedAt)
}

func sameFollowerEventReceipt(
	left FollowerEventReceiptModel,
	right FollowerEventReceiptModel,
) bool {
	return left.ConversationID == right.ConversationID &&
		left.Sequence == right.Sequence &&
		left.EventID == right.EventID &&
		bytes.Equal(left.EventHash, right.EventHash) &&
		bytes.Equal(left.PreviousHash, right.PreviousHash) &&
		left.EventKind == right.EventKind &&
		left.AppliedAt.Equal(right.AppliedAt)
}

func sameFollowerPendingEvent(
	left FollowerPendingEventModel,
	right FollowerPendingEventModel,
) bool {
	return left.ConversationID == right.ConversationID &&
		left.Sequence == right.Sequence &&
		left.EventID == right.EventID &&
		bytes.Equal(left.EventHash, right.EventHash) &&
		bytes.Equal(left.PreviousHash, right.PreviousHash) &&
		bytes.Equal(left.PublicEventBytes, right.PublicEventBytes) &&
		left.ExpiresAt.Equal(right.ExpiresAt)
}

var _ messaging.FollowerRepository = (*FollowerRepository)(nil)
