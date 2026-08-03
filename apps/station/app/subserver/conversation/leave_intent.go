package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mlsLeaveIntentVersion = 1
	maxLeaveIntentTTL     = 15 * time.Minute
)

type mlsLeaveIntentModel struct {
	IntentID        string     `gorm:"column:intent_id;size:64;primaryKey"`
	ConversationID  string     `gorm:"column:conversation_id;size:128;index"`
	ActorPtid       string     `gorm:"column:actor_ptid;size:255;index"`
	ActorDeviceID   string     `gorm:"column:actor_device_id;size:255"`
	MembershipEpoch int64      `gorm:"column:membership_epoch"`
	MlsEpoch        int64      `gorm:"column:mls_epoch"`
	IntentBytes     []byte     `gorm:"column:intent_bytes;type:bytea"`
	Status          string     `gorm:"column:status;size:32;index"`
	ConsumedBy      string     `gorm:"column:consumed_by;size:64"`
	CreatedAt       time.Time  `gorm:"column:created_at"`
	ExpiresAt       time.Time  `gorm:"column:expires_at;index"`
	ConsumedAt      *time.Time `gorm:"column:consumed_at"`
}

func (*mlsLeaveIntentModel) TableName() string { return "conversation_mls_leave_intents" }

type LeaveIntentRepository interface {
	CreateVerified(context.Context, *chat.MlsLeaveIntent) error
	ListPending(context.Context, string, time.Time) ([]*chat.MlsLeaveIntent, error)
	GetPendingForUpdate(context.Context, string) (*chat.MlsLeaveIntent, error)
	Consume(context.Context, string, string, time.Time) error
}

type postgresLeaveIntentRepository struct {
	db *gorm.DB
}

func newPostgresLeaveIntentRepository(db *gorm.DB) *postgresLeaveIntentRepository {
	return &postgresLeaveIntentRepository{db: db}
}

func (r *postgresLeaveIntentRepository) CreateVerified(
	ctx context.Context,
	intent *chat.MlsLeaveIntent,
) error {
	intentBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(intent)
	if err != nil {
		return fmt.Errorf("marshal leave intent: %w", err)
	}
	model := &mlsLeaveIntentModel{
		IntentID:        intent.IntentId,
		ConversationID:  intent.ConversationId,
		ActorPtid:       intent.ActorPtid,
		ActorDeviceID:   intent.ActorDeviceId,
		MembershipEpoch: intent.ObservedMembershipEpoch,
		MlsEpoch:        intent.ObservedMlsEpoch,
		IntentBytes:     intentBytes,
		Status:          "pending",
		CreatedAt:       time.UnixMilli(intent.CreatedAtUnixMs),
		ExpiresAt:       time.UnixMilli(intent.ExpiresAtUnixMs),
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing mlsLeaveIntentModel
	if err := r.db.WithContext(ctx).First(&existing, "intent_id = ?", intent.IntentId).Error; err != nil {
		return err
	}
	if !bytes.Equal(existing.IntentBytes, intentBytes) {
		return transitionError("TRANSITION_CONFLICT", "leave intent id is already bound to different bytes")
	}
	return nil
}

func (r *postgresLeaveIntentRepository) ListPending(
	ctx context.Context,
	conversationID string,
	now time.Time,
) ([]*chat.MlsLeaveIntent, error) {
	var models []mlsLeaveIntentModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND status = ? AND expires_at > ?",
			conversationID,
			"pending",
			now,
		).
		Order("created_at ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	intents := make([]*chat.MlsLeaveIntent, 0, len(models))
	for _, model := range models {
		intent := &chat.MlsLeaveIntent{}
		if err := proto.Unmarshal(model.IntentBytes, intent); err != nil {
			return nil, fmt.Errorf("unmarshal stored leave intent: %w", err)
		}
		intents = append(intents, intent)
	}
	return intents, nil
}

func (r *postgresLeaveIntentRepository) GetPendingForUpdate(
	ctx context.Context,
	intentID string,
) (*chat.MlsLeaveIntent, error) {
	var model mlsLeaveIntentModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "intent_id = ? AND status = ?", intentID, "pending").Error; err != nil {
		return nil, err
	}
	intent := &chat.MlsLeaveIntent{}
	if err := proto.Unmarshal(model.IntentBytes, intent); err != nil {
		return nil, fmt.Errorf("unmarshal stored leave intent: %w", err)
	}
	return intent, nil
}

func (r *postgresLeaveIntentRepository) Consume(
	ctx context.Context,
	intentID string,
	transitionID string,
	now time.Time,
) error {
	result := r.db.WithContext(ctx).
		Model(&mlsLeaveIntentModel{}).
		Where("intent_id = ? AND status = ?", intentID, "pending").
		Updates(map[string]any{
			"status":      "consumed",
			"consumed_by": transitionID,
			"consumed_at": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return transitionError("TRANSITION_CONFLICT", "leave intent was already consumed")
	}
	return nil
}

type MlsLeaveIntentService struct {
	conversations Repository
	intents       LeaveIntentRepository
	actorKeys     ActorDeviceSigningKeyResolver
	localStation  string
	clock         Clock
}

func NewMlsLeaveIntentService(
	conversations Repository,
	intents LeaveIntentRepository,
	actorKeys ActorDeviceSigningKeyResolver,
	localStation string,
) *MlsLeaveIntentService {
	return &MlsLeaveIntentService{
		conversations: conversations,
		intents:       intents,
		actorKeys:     actorKeys,
		localStation:  localStation,
		clock:         time.Now,
	}
}

func (s *MlsLeaveIntentService) Submit(
	ctx context.Context,
	authenticatedPtid string,
	authenticatedDeviceID string,
	intent *chat.MlsLeaveIntent,
) (*chat.MlsLeaveIntent, error) {
	if err := validateLeaveIntentShape(s.clock(), intent); err != nil {
		return nil, err
	}
	if authenticatedPtid != intent.ActorPtid ||
		authenticatedDeviceID != intent.ActorDeviceId {
		return nil, transitionError("PERMISSION_DENIED", "leave intent actor device does not match authentication")
	}
	conversation, err := s.conversations.GetConversation(ctx, intent.ConversationId)
	if err != nil {
		return nil, err
	}
	if conversation.AuthorityStationPeerId != s.localStation ||
		intent.AuthorityStationPeerId != s.localStation ||
		intent.FederationId != conversation.FederationId ||
		intent.AuthorityEpoch != conversation.AuthorityEpoch ||
		intent.ObservedMembershipEpoch != conversation.MembershipEpoch ||
		intent.ObservedMlsEpoch != conversation.MlsEpoch {
		return nil, transitionError("EPOCH_STALE", "leave intent is not bound to the current authority head")
	}
	if conversation.OwnerPtid == intent.ActorPtid {
		return nil, transitionError("PERMISSION_DENIED", "group owner must transfer ownership before leaving")
	}
	member, err := s.conversations.GetMember(ctx, intent.ConversationId, intent.ActorPtid)
	if err != nil || member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
		return nil, transitionError("NOT_MEMBER", "leave intent actor is not an active member")
	}
	devices, err := s.conversations.ListMemberDevices(ctx, intent.ConversationId, true)
	if err != nil {
		return nil, err
	}
	if !hasActiveMemberDevice(devices, intent.ActorPtid, intent.ActorDeviceId) {
		return nil, transitionError("PERMISSION_DENIED", "leave intent device is not an active MLS leaf")
	}
	key, err := s.actorKeys.ResolveSigningKey(
		ctx,
		intent.ActorPtid,
		intent.ActorDeviceId,
		intent.ActorSigningKeyId,
	)
	if err != nil ||
		key.ActorPtid != intent.ActorPtid ||
		key.ActorDeviceId != intent.ActorDeviceId ||
		key.SigningKeyId != intent.ActorSigningKeyId ||
		key.HomeStationPeerId != intent.HomeStationPeerId ||
		len(key.Ed25519PublicKey) != ed25519.PublicKeySize {
		return nil, transitionError("PERMISSION_DENIED", "leave intent signing key is unavailable")
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		leaveIntentSigningInput(intent),
	)
	if err != nil {
		return nil, err
	}
	if !ed25519.Verify(ed25519.PublicKey(key.Ed25519PublicKey), signingBytes, intent.ActorSignature) {
		return nil, transitionError("PERMISSION_DENIED", "leave intent signature is invalid")
	}
	if err := s.intents.CreateVerified(ctx, intent); err != nil {
		return nil, err
	}
	return proto.Clone(intent).(*chat.MlsLeaveIntent), nil
}

func (s *MlsLeaveIntentService) ListPending(
	ctx context.Context,
	authenticatedPtid string,
	authenticatedDeviceID string,
	conversationID string,
) ([]*chat.MlsLeaveIntent, error) {
	member, err := s.conversations.GetMember(ctx, conversationID, authenticatedPtid)
	if err != nil || member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
		return nil, transitionError("NOT_MEMBER", "committer is not an active member")
	}
	devices, err := s.conversations.ListMemberDevices(ctx, conversationID, true)
	if err != nil {
		return nil, err
	}
	if !hasActiveMemberDevice(devices, authenticatedPtid, authenticatedDeviceID) {
		return nil, transitionError("PERMISSION_DENIED", "committer device is not an active MLS leaf")
	}
	return s.intents.ListPending(ctx, conversationID, s.clock())
}

func validateLeaveIntentShape(now time.Time, intent *chat.MlsLeaveIntent) error {
	if intent == nil ||
		intent.Version != mlsLeaveIntentVersion ||
		intent.IntentId == "" ||
		intent.ConversationId == "" ||
		intent.AuthorityStationPeerId == "" ||
		intent.HomeStationPeerId == "" ||
		intent.ActorPtid == "" ||
		intent.ActorDeviceId == "" ||
		intent.ActorSigningKeyId == "" ||
		len(intent.ActorSignature) != ed25519.SignatureSize {
		return transitionError("INVALID_TRANSITION", "leave intent is incomplete")
	}
	created := time.UnixMilli(intent.CreatedAtUnixMs)
	expires := time.UnixMilli(intent.ExpiresAtUnixMs)
	if expires.Before(now) ||
		created.After(now.Add(time.Minute)) ||
		!expires.After(created) ||
		expires.Sub(created) > maxLeaveIntentTTL {
		return transitionError("INVALID_TRANSITION", "leave intent time window is invalid")
	}
	return nil
}

func leaveIntentSigningInput(intent *chat.MlsLeaveIntent) *chat.MlsLeaveIntentSigningInput {
	return &chat.MlsLeaveIntentSigningInput{
		Version:                 intent.Version,
		IntentId:                intent.IntentId,
		FederationId:            intent.FederationId,
		AuthorityStationPeerId:  intent.AuthorityStationPeerId,
		AuthorityEpoch:          intent.AuthorityEpoch,
		HomeStationPeerId:       intent.HomeStationPeerId,
		ConversationId:          intent.ConversationId,
		ActorPtid:               intent.ActorPtid,
		ActorDeviceId:           intent.ActorDeviceId,
		ActorSigningKeyId:       intent.ActorSigningKeyId,
		ObservedMembershipEpoch: intent.ObservedMembershipEpoch,
		ObservedMlsEpoch:        intent.ObservedMlsEpoch,
		CreatedAtUnixMs:         intent.CreatedAtUnixMs,
		ExpiresAtUnixMs:         intent.ExpiresAtUnixMs,
	}
}

func validateDelegatedLeaveIntent(
	intent *chat.MlsLeaveIntent,
	conversation *chat.Conversation,
	transition *chat.MembershipTransitionCommand,
	targetPtid string,
	now time.Time,
) error {
	if intent.ConversationId != conversation.ConversationId ||
		intent.FederationId != conversation.FederationId ||
		intent.AuthorityStationPeerId != conversation.AuthorityStationPeerId ||
		intent.AuthorityEpoch != conversation.AuthorityEpoch ||
		intent.ActorPtid != targetPtid ||
		intent.ObservedMembershipEpoch != transition.FromMembershipEpoch ||
		intent.ObservedMlsEpoch != transition.FromMlsEpoch ||
		intent.ExpiresAtUnixMs <= now.UnixMilli() {
		return transitionError("EPOCH_STALE", "leave intent does not match the transition authority head")
	}
	return nil
}

func isMissingLeaveIntent(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
