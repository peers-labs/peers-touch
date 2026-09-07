package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FederatedFriendRequestTransaction exposes only Social mutations and a bound shared outbox.
type FederatedFriendRequestTransaction interface {
	VerifyFriendRequestCommandSignature(
		ctx context.Context,
		device *model.ActorDeviceRef,
		claimedHomeStationPeerID string,
		signingKeyID string,
		canonicalSigningBytes []byte,
		signature []byte,
	) error
	PutCommand(
		ctx context.Context,
		record domain.FriendRequestCommandRecord,
	) (domain.FriendRequestCommandRecord, bool, error)
	LoadCommand(
		ctx context.Context,
		role domain.FriendRequestCommandRole,
		authorityStationPeerID string,
		commandID string,
	) (*domain.FriendRequestCommandRecord, error)
	ResolveCommand(
		ctx context.Context,
		role domain.FriendRequestCommandRole,
		authorityStationPeerID string,
		commandID string,
		resultBytes []byte,
		resolvedAt time.Time,
	) error
	LoadProjection(
		ctx context.Context,
		requestID string,
	) (*domain.FriendRequestProjection, error)
	SaveProjection(
		ctx context.Context,
		projection domain.FriendRequestProjection,
		expectedSequence *int64,
	) error
	PutRelationship(
		ctx context.Context,
		projection domain.FriendRequestRelationshipProjection,
	) error
	PutDirectConversationEffect(
		ctx context.Context,
		effect domain.DirectConversationEffect,
	) error
	Outbox() delivery.OutboxWriter
}

// FederatedFriendRequestUnitOfWork owns sender-side Social and Federation atomicity.
type FederatedFriendRequestUnitOfWork interface {
	Execute(
		ctx context.Context,
		fn func(FederatedFriendRequestTransaction) error,
	) error
}

// DirectConversationEffectClaim is a lease-fenced durable integration effect.
type DirectConversationEffectClaim struct {
	Effect         domain.DirectConversationEffect
	WorkerID       string
	Generation     uint64
	AttemptCount   uint32
	LeaseExpiresAt time.Time
}

// DirectConversationEffectStore owns restart-safe post-accept effect delivery.
type DirectConversationEffectStore interface {
	ClaimDirectConversationEffect(
		ctx context.Context,
		workerID string,
		now time.Time,
		leaseDuration time.Duration,
	) (DirectConversationEffectClaim, bool, error)
	CompleteDirectConversationEffect(
		ctx context.Context,
		claim DirectConversationEffectClaim,
		conversationID string,
		completedAt time.Time,
	) error
	RetryDirectConversationEffect(
		ctx context.Context,
		claim DirectConversationEffectClaim,
		nextAttemptAt time.Time,
		failure string,
	) error
}

// GORMFederatedFriendRequestStore implements Social state and shared-outbox transactions.
type GORMFederatedFriendRequestStore struct {
	db    *gorm.DB
	clock delivery.Clock
}

// NewGORMFederatedFriendRequestStore creates the test-composable Social store.
func NewGORMFederatedFriendRequestStore(
	db *gorm.DB,
	clock delivery.Clock,
) (*GORMFederatedFriendRequestStore, error) {
	if db == nil || clock == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.new_federated_friend_request_store",
			"dependencies",
			"database and clock are required",
		)
	}
	return &GORMFederatedFriendRequestStore{db: db, clock: clock}, nil
}

// Migrate creates the test-only target Social tables without production registration.
func (s *GORMFederatedFriendRequestStore) Migrate(ctx context.Context) error {
	if err := s.db.WithContext(ctx).AutoMigrate(
		&federatedFriendRequestCommandModel{},
		&federatedFriendRequestProjectionModel{},
		&federatedRelationshipProjectionModel{},
		&directConversationEffectModel{},
	); err != nil {
		return domain.WrapFederationError(
			domain.FederationErrorPersistence,
			"social.migrate_federated_friend_request_store",
			err,
		)
	}
	return nil
}

// Execute binds Social writes and the shared Federation outbox to one SQL transaction.
func (s *GORMFederatedFriendRequestStore) Execute(
	ctx context.Context,
	fn func(FederatedFriendRequestTransaction) error,
) error {
	if fn == nil {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.execute_friend_request_transaction",
			"callback",
			"is required",
		)
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		outbox, err := delivery.NewGORMRepository(tx, s.clock)
		if err != nil {
			return err
		}
		return fn(&federatedFriendRequestTransaction{
			db:     tx,
			outbox: outbox,
		})
	})
	if err != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.execute_friend_request_transaction",
			err,
		)
	}
	return nil
}

// Projection returns one persisted local projection for query adapters and tests.
func (s *GORMFederatedFriendRequestStore) Projection(
	ctx context.Context,
	requestID string,
) (*domain.FriendRequestProjection, error) {
	transaction := &federatedFriendRequestTransaction{db: s.db}
	return transaction.LoadProjection(ctx, requestID)
}

// Command returns one exact command record for query adapters and tests.
func (s *GORMFederatedFriendRequestStore) Command(
	ctx context.Context,
	role domain.FriendRequestCommandRole,
	authorityStationPeerID string,
	commandID string,
) (*domain.FriendRequestCommandRecord, error) {
	transaction := &federatedFriendRequestTransaction{db: s.db}
	return transaction.LoadCommand(ctx, role, authorityStationPeerID, commandID)
}

// Relationship returns one actor-local relationship projection.
func (s *GORMFederatedFriendRequestStore) Relationship(
	ctx context.Context,
	ownerPTID string,
	peerPTID string,
) (*domain.FriendRequestRelationshipProjection, error) {
	var persisted federatedRelationshipProjectionModel
	err := s.db.WithContext(ctx).
		Where("owner_ptid = ? AND peer_ptid = ?", ownerPTID, peerPTID).
		First(&persisted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, mapFederatedFriendRequestPersistenceError(
			"social.load_relationship_projection",
			err,
		)
	}
	return relationshipProjectionFromModel(persisted), nil
}

// DirectConversationEffect returns one durable post-accept effect.
func (s *GORMFederatedFriendRequestStore) DirectConversationEffect(
	ctx context.Context,
	effectID string,
) (*domain.DirectConversationEffect, string, error) {
	var persisted directConversationEffectModel
	err := s.db.WithContext(ctx).Where("effect_id = ?", effectID).First(&persisted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", mapFederatedFriendRequestPersistenceError(
			"social.load_direct_conversation_effect",
			err,
		)
	}
	effect := directConversationEffectFromModel(persisted)
	return &effect, persisted.ConversationID, nil
}

// ClaimDirectConversationEffect leases at most one due effect.
func (s *GORMFederatedFriendRequestStore) ClaimDirectConversationEffect(
	ctx context.Context,
	workerID string,
	now time.Time,
	leaseDuration time.Duration,
) (DirectConversationEffectClaim, bool, error) {
	const operation = "social.claim_direct_conversation_effect"
	if workerID == "" ||
		workerID != strings.TrimSpace(workerID) ||
		now.IsZero() ||
		leaseDuration <= 0 {
		return DirectConversationEffectClaim{}, false, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"claim",
			"worker, time, and lease duration are required",
		)
	}
	now = now.UTC()
	var claim DirectConversationEffectClaim
	found := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"(state = ? AND next_attempt_at <= ?) OR "+
				"(state = ? AND lease_expires_at <= ?)",
			directConversationEffectPending,
			now,
			directConversationEffectLeased,
			now,
		).Order("next_attempt_at ASC, created_at ASC, effect_id ASC").Limit(1)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		var persisted directConversationEffectModel
		if err := query.First(&persisted).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if persisted.LeaseGeneration == ^uint64(0) {
			return domain.NewFederationError(
				domain.FederationErrorPersistence,
				operation,
				"lease_generation",
				"is exhausted",
			)
		}
		nextGeneration := persisted.LeaseGeneration + 1
		nextAttemptCount := persisted.AttemptCount + 1
		if nextAttemptCount < persisted.AttemptCount {
			nextAttemptCount = persisted.AttemptCount
		}
		leaseExpiresAt := now.Add(leaseDuration)
		result := tx.Model(&directConversationEffectModel{}).
			Where(
				"effect_id = ? AND lease_generation = ?",
				persisted.EffectID,
				persisted.LeaseGeneration,
			).
			Where(
				"(state = ? AND next_attempt_at <= ?) OR "+
					"(state = ? AND lease_expires_at <= ?)",
				directConversationEffectPending,
				now,
				directConversationEffectLeased,
				now,
			).
			Updates(map[string]any{
				"state":            directConversationEffectLeased,
				"attempt_count":    nextAttemptCount,
				"lease_owner":      workerID,
				"lease_generation": nextGeneration,
				"lease_expires_at": leaseExpiresAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		claim = DirectConversationEffectClaim{
			Effect:         directConversationEffectFromModel(persisted),
			WorkerID:       workerID,
			Generation:     nextGeneration,
			AttemptCount:   nextAttemptCount,
			LeaseExpiresAt: leaseExpiresAt,
		}
		found = true
		return nil
	})
	if err != nil {
		return DirectConversationEffectClaim{}, false, mapFederatedFriendRequestPersistenceError(
			operation,
			err,
		)
	}
	return claim, found, nil
}

// CompleteDirectConversationEffect records the idempotent Conversation result.
func (s *GORMFederatedFriendRequestStore) CompleteDirectConversationEffect(
	ctx context.Context,
	claim DirectConversationEffectClaim,
	conversationID string,
	completedAt time.Time,
) error {
	if conversationID == "" || completedAt.IsZero() {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.complete_direct_conversation_effect",
			"result",
			"conversation ID and completion time are required",
		)
	}
	return s.updateClaimedEffect(
		ctx,
		claim,
		completedAt.UTC(),
		map[string]any{
			"state":            directConversationEffectCompleted,
			"conversation_id":  conversationID,
			"completed_at":     completedAt.UTC(),
			"last_failure":     "",
			"lease_owner":      "",
			"lease_expires_at": nil,
		},
	)
}

// RetryDirectConversationEffect releases a failed effect for bounded backoff retry.
func (s *GORMFederatedFriendRequestStore) RetryDirectConversationEffect(
	ctx context.Context,
	claim DirectConversationEffectClaim,
	nextAttemptAt time.Time,
	failure string,
) error {
	if nextAttemptAt.IsZero() || failure == "" || failure != strings.TrimSpace(failure) {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.retry_direct_conversation_effect",
			"retry",
			"next attempt and canonical failure are required",
		)
	}
	return s.updateClaimedEffect(
		ctx,
		claim,
		s.clock.Now().UTC(),
		map[string]any{
			"state":            directConversationEffectPending,
			"next_attempt_at":  nextAttemptAt.UTC(),
			"last_failure":     failure,
			"lease_owner":      "",
			"lease_expires_at": nil,
		},
	)
}

func (s *GORMFederatedFriendRequestStore) updateClaimedEffect(
	ctx context.Context,
	claim DirectConversationEffectClaim,
	transitionAt time.Time,
	updates map[string]any,
) error {
	const operation = "social.update_claimed_direct_conversation_effect"
	if claim.Effect.EffectID == "" ||
		claim.WorkerID == "" ||
		claim.Generation == 0 ||
		claim.LeaseExpiresAt.IsZero() ||
		!claim.LeaseExpiresAt.After(transitionAt) {
		return domain.NewFederationError(
			domain.FederationErrorStateConflict,
			operation,
			"lease",
			"is invalid or expired",
		)
	}
	result := s.db.WithContext(ctx).
		Model(&directConversationEffectModel{}).
		Where(
			"effect_id = ? AND state = ? AND lease_owner = ? AND lease_generation = ?",
			claim.Effect.EffectID,
			directConversationEffectLeased,
			claim.WorkerID,
			claim.Generation,
		).
		Updates(updates)
	if result.Error != nil {
		return mapFederatedFriendRequestPersistenceError(operation, result.Error)
	}
	if result.RowsAffected != 1 {
		return domain.NewFederationError(
			domain.FederationErrorStateConflict,
			operation,
			"lease",
			"no longer owns the effect",
		)
	}
	return nil
}

type federatedFriendRequestTransaction struct {
	db     *gorm.DB
	outbox delivery.OutboxWriter
}

func (t *federatedFriendRequestTransaction) VerifyFriendRequestCommandSignature(
	ctx context.Context,
	device *model.ActorDeviceRef,
	claimedHomeStationPeerID string,
	signingKeyID string,
	canonicalSigningBytes []byte,
	signature []byte,
) error {
	return verifyFriendRequestCommandSignature(
		ctx,
		t.db,
		device,
		claimedHomeStationPeerID,
		signingKeyID,
		canonicalSigningBytes,
		signature,
	)
}

func (t *federatedFriendRequestTransaction) PutCommand(
	ctx context.Context,
	record domain.FriendRequestCommandRecord,
) (domain.FriendRequestCommandRecord, bool, error) {
	if err := validateCommandRecord(record); err != nil {
		return domain.FriendRequestCommandRecord{}, false, err
	}
	model := commandModelFromDomain(record)
	create := t.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if create.Error != nil {
		return domain.FriendRequestCommandRecord{}, false,
			mapFederatedFriendRequestPersistenceError("social.put_friend_request_command", create.Error)
	}
	if create.RowsAffected == 1 {
		return cloneFriendRequestCommandRecord(record), true, nil
	}
	existing, err := t.LoadCommand(
		ctx,
		record.Role,
		record.AuthorityStationPeerID,
		record.CommandID,
	)
	if err != nil {
		return domain.FriendRequestCommandRecord{}, false, err
	}
	if existing == nil {
		return domain.FriendRequestCommandRecord{}, false,
			domain.NewFederationError(
				domain.FederationErrorPersistence,
				"social.put_friend_request_command",
				"command",
				"conflicting row disappeared",
			)
	}
	return *existing, false, nil
}

func (t *federatedFriendRequestTransaction) LoadCommand(
	ctx context.Context,
	role domain.FriendRequestCommandRole,
	authorityStationPeerID string,
	commandID string,
) (*domain.FriendRequestCommandRecord, error) {
	var persisted federatedFriendRequestCommandModel
	query := t.db.WithContext(ctx).
		Where(
			"role = ? AND authority_station_peer_id = ? AND command_id = ?",
			string(role),
			authorityStationPeerID,
			commandID,
		)
	if t.db.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.First(&persisted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, mapFederatedFriendRequestPersistenceError(
			"social.load_friend_request_command",
			err,
		)
	}
	record := commandRecordFromModel(persisted)
	return &record, nil
}

func (t *federatedFriendRequestTransaction) ResolveCommand(
	ctx context.Context,
	role domain.FriendRequestCommandRole,
	authorityStationPeerID string,
	commandID string,
	resultBytes []byte,
	resolvedAt time.Time,
) error {
	if len(resultBytes) == 0 || resolvedAt.IsZero() {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.resolve_friend_request_command",
			"result",
			"exact result bytes and resolution time are required",
		)
	}
	result := t.db.WithContext(ctx).
		Model(&federatedFriendRequestCommandModel{}).
		Where(
			"role = ? AND authority_station_peer_id = ? AND command_id = ?",
			string(role),
			authorityStationPeerID,
			commandID,
		).
		Where("resolved_at IS NULL OR result_bytes = ?", resultBytes).
		Updates(map[string]any{
			"result_bytes": resultBytes,
			"resolved_at":  resolvedAt.UTC(),
		})
	if result.Error != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.resolve_friend_request_command",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return domain.NewFederationError(
			domain.FederationErrorIdempotencyConflict,
			"social.resolve_friend_request_command",
			"command_id",
			"was already resolved with different exact bytes",
		)
	}
	return nil
}

func (t *federatedFriendRequestTransaction) LoadProjection(
	ctx context.Context,
	requestID string,
) (*domain.FriendRequestProjection, error) {
	var persisted federatedFriendRequestProjectionModel
	query := t.db.WithContext(ctx).Where("request_id = ?", requestID)
	if t.db.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.First(&persisted).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, mapFederatedFriendRequestPersistenceError(
			"social.load_friend_request_projection",
			err,
		)
	}
	projection, err := projectionFromModel(persisted)
	if err != nil {
		return nil, err
	}
	return &projection, nil
}

func (t *federatedFriendRequestTransaction) SaveProjection(
	ctx context.Context,
	projection domain.FriendRequestProjection,
	expectedSequence *int64,
) error {
	persisted, err := projectionModelFromDomain(projection)
	if err != nil {
		return err
	}
	if expectedSequence == nil {
		create := t.db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&persisted)
		if create.Error != nil {
			return mapFederatedFriendRequestPersistenceError(
				"social.create_friend_request_projection",
				create.Error,
			)
		}
		if create.RowsAffected != 1 {
			return domain.NewFederationError(
				domain.FederationErrorStateConflict,
				"social.create_friend_request_projection",
				"request_id",
				"already exists",
			)
		}
		return nil
	}
	result := t.db.WithContext(ctx).
		Model(&federatedFriendRequestProjectionModel{}).
		Where("request_id = ? AND sequence = ?", projection.RequestID, *expectedSequence).
		Select("*").
		Updates(&persisted)
	if result.Error != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.update_friend_request_projection",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return domain.NewFederationError(
			domain.FederationErrorStateConflict,
			"social.update_friend_request_projection",
			"sequence",
			"changed concurrently",
		)
	}
	return nil
}

func (t *federatedFriendRequestTransaction) PutRelationship(
	ctx context.Context,
	projection domain.FriendRequestRelationshipProjection,
) error {
	persisted := relationshipProjectionModelFromDomain(projection)
	create := t.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&persisted)
	if create.Error != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.put_relationship_projection",
			create.Error,
		)
	}
	if create.RowsAffected == 1 {
		return nil
	}
	var existing federatedRelationshipProjectionModel
	if err := t.db.WithContext(ctx).
		Where("owner_ptid = ? AND peer_ptid = ?", projection.OwnerPTID, projection.PeerPTID).
		First(&existing).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.load_relationship_projection",
			err,
		)
	}
	if existing.RequestID != projection.RequestID ||
		existing.AcceptedEventID != projection.AcceptedEventID ||
		!bytes.Equal(existing.AcceptedEventHash, projection.AcceptedEventHash) {
		return domain.NewFederationError(
			domain.FederationErrorIdempotencyConflict,
			"social.put_relationship_projection",
			"owner_ptid",
			"already has a different accepted relationship fact",
		)
	}
	return nil
}

func (t *federatedFriendRequestTransaction) PutDirectConversationEffect(
	ctx context.Context,
	effect domain.DirectConversationEffect,
) error {
	persisted := directConversationEffectModel{
		EffectID:        effect.EffectID,
		RequestID:       effect.RequestID,
		ActorAPTID:      effect.ActorAPTID,
		ActorBPTID:      effect.ActorBPTID,
		AcceptedEventID: effect.AcceptedEventID,
		State:           directConversationEffectPending,
		NextAttemptAt:   effect.CreatedAt.UTC(),
		CreatedAt:       effect.CreatedAt.UTC(),
	}
	create := t.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&persisted)
	if create.Error != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.put_direct_conversation_effect",
			create.Error,
		)
	}
	if create.RowsAffected == 1 {
		return nil
	}
	var existing directConversationEffectModel
	if err := t.db.WithContext(ctx).
		Where("effect_id = ?", effect.EffectID).
		First(&existing).Error; err != nil {
		return mapFederatedFriendRequestPersistenceError(
			"social.load_direct_conversation_effect",
			err,
		)
	}
	if existing.RequestID != effect.RequestID ||
		existing.ActorAPTID != effect.ActorAPTID ||
		existing.ActorBPTID != effect.ActorBPTID ||
		existing.AcceptedEventID != effect.AcceptedEventID {
		return domain.NewFederationError(
			domain.FederationErrorIdempotencyConflict,
			"social.put_direct_conversation_effect",
			"effect_id",
			"was reused with different accepted relationship facts",
		)
	}
	return nil
}

func (t *federatedFriendRequestTransaction) Outbox() delivery.OutboxWriter {
	return t.outbox
}

func friendRequestTransactionFromDelivery(
	transaction delivery.Transaction,
) (FederatedFriendRequestTransaction, error) {
	if transaction == nil || transaction.DB() == nil || transaction.Outbox() == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.bind_delivery_transaction",
			"transaction",
			"must expose a database and outbox",
		)
	}
	return &federatedFriendRequestTransaction{
		db:     transaction.DB(),
		outbox: transaction.Outbox(),
	}, nil
}

func commandModelFromDomain(
	record domain.FriendRequestCommandRecord,
) federatedFriendRequestCommandModel {
	return federatedFriendRequestCommandModel{
		Role:                   string(record.Role),
		AuthorityStationPeerID: record.AuthorityStationPeerID,
		CommandID:              record.CommandID,
		RequestID:              record.RequestID,
		CommandBytes:           append([]byte(nil), record.CommandBytes...),
		CommandPayloadSHA256:   append([]byte(nil), record.CommandPayloadSHA256...),
		ResultBytes:            append([]byte(nil), record.ResultBytes...),
		CreatedAt:              record.CreatedAt.UTC(),
		ResolvedAt:             cloneTime(record.ResolvedAt),
	}
}

func commandRecordFromModel(
	persisted federatedFriendRequestCommandModel,
) domain.FriendRequestCommandRecord {
	return domain.FriendRequestCommandRecord{
		Role:                   domain.FriendRequestCommandRole(persisted.Role),
		AuthorityStationPeerID: persisted.AuthorityStationPeerID,
		CommandID:              persisted.CommandID,
		RequestID:              persisted.RequestID,
		CommandBytes:           append([]byte(nil), persisted.CommandBytes...),
		CommandPayloadSHA256:   append([]byte(nil), persisted.CommandPayloadSHA256...),
		ResultBytes:            append([]byte(nil), persisted.ResultBytes...),
		CreatedAt:              persisted.CreatedAt.UTC(),
		ResolvedAt:             cloneTime(persisted.ResolvedAt),
	}
}

func projectionModelFromDomain(
	projection domain.FriendRequestProjection,
) (federatedFriendRequestProjectionModel, error) {
	if projection.Sender == nil || projection.Receiver == nil {
		return federatedFriendRequestProjectionModel{}, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.map_friend_request_projection",
			"actors",
			"sender and receiver are required",
		)
	}
	senderBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(projection.Sender)
	if err != nil {
		return federatedFriendRequestProjectionModel{}, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.map_friend_request_sender",
			err,
		)
	}
	receiverBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(projection.Receiver)
	if err != nil {
		return federatedFriendRequestProjectionModel{}, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.map_friend_request_receiver",
			err,
		)
	}
	return federatedFriendRequestProjectionModel{
		RequestID:                 projection.RequestID,
		AuthorityStationPeerID:    projection.AuthorityStationPeerID,
		SenderPTID:                projection.Sender.GetPtid(),
		ReceiverPTID:              projection.Receiver.GetPtid(),
		SenderActorRefBytes:       senderBytes,
		ReceiverActorRefBytes:     receiverBytes,
		SenderHomeStationPeerID:   projection.SenderHomeStationPeerID,
		ReceiverHomeStationPeerID: projection.ReceiverHomeStationPeerID,
		Message:                   projection.Message,
		State:                     int32(projection.State),
		Sequence:                  projection.Sequence,
		LastEventHash:             append([]byte(nil), projection.LastEventHash...),
		LastEventBytes:            append([]byte(nil), projection.LastEventBytes...),
		AuthorityConfirmed:        projection.AuthorityConfirmed,
		CreatedAt:                 projection.CreatedAt.UTC(),
		RespondedAt:               cloneTime(projection.RespondedAt),
	}, nil
}

func projectionFromModel(
	persisted federatedFriendRequestProjectionModel,
) (domain.FriendRequestProjection, error) {
	sender := &model.ActorRef{}
	if err := proto.Unmarshal(persisted.SenderActorRefBytes, sender); err != nil {
		return domain.FriendRequestProjection{}, domain.WrapFederationError(
			domain.FederationErrorPersistence,
			"social.decode_friend_request_sender",
			err,
		)
	}
	receiver := &model.ActorRef{}
	if err := proto.Unmarshal(persisted.ReceiverActorRefBytes, receiver); err != nil {
		return domain.FriendRequestProjection{}, domain.WrapFederationError(
			domain.FederationErrorPersistence,
			"social.decode_friend_request_receiver",
			err,
		)
	}
	if sender.GetPtid() != persisted.SenderPTID ||
		receiver.GetPtid() != persisted.ReceiverPTID {
		return domain.FriendRequestProjection{}, domain.NewFederationError(
			domain.FederationErrorPersistence,
			"social.decode_friend_request_projection",
			"actor_ref",
			"does not match indexed PTID",
		)
	}
	return domain.FriendRequestProjection{
		RequestID:                 persisted.RequestID,
		AuthorityStationPeerID:    persisted.AuthorityStationPeerID,
		Sender:                    sender,
		Receiver:                  receiver,
		SenderHomeStationPeerID:   persisted.SenderHomeStationPeerID,
		ReceiverHomeStationPeerID: persisted.ReceiverHomeStationPeerID,
		Message:                   persisted.Message,
		State:                     model.FriendRequestState(persisted.State),
		Sequence:                  persisted.Sequence,
		LastEventHash:             append([]byte(nil), persisted.LastEventHash...),
		LastEventBytes:            append([]byte(nil), persisted.LastEventBytes...),
		AuthorityConfirmed:        persisted.AuthorityConfirmed,
		CreatedAt:                 persisted.CreatedAt.UTC(),
		RespondedAt:               cloneTime(persisted.RespondedAt),
	}, nil
}

func relationshipProjectionModelFromDomain(
	projection domain.FriendRequestRelationshipProjection,
) federatedRelationshipProjectionModel {
	return federatedRelationshipProjectionModel{
		OwnerPTID:         projection.OwnerPTID,
		PeerPTID:          projection.PeerPTID,
		RequestID:         projection.RequestID,
		AcceptedEventID:   projection.AcceptedEventID,
		AcceptedEventHash: append([]byte(nil), projection.AcceptedEventHash...),
		AcceptedAt:        projection.AcceptedAt.UTC(),
	}
}

func relationshipProjectionFromModel(
	persisted federatedRelationshipProjectionModel,
) *domain.FriendRequestRelationshipProjection {
	return &domain.FriendRequestRelationshipProjection{
		OwnerPTID:         persisted.OwnerPTID,
		PeerPTID:          persisted.PeerPTID,
		RequestID:         persisted.RequestID,
		AcceptedEventID:   persisted.AcceptedEventID,
		AcceptedEventHash: append([]byte(nil), persisted.AcceptedEventHash...),
		AcceptedAt:        persisted.AcceptedAt.UTC(),
	}
}

func directConversationEffectFromModel(
	persisted directConversationEffectModel,
) domain.DirectConversationEffect {
	return domain.DirectConversationEffect{
		EffectID:        persisted.EffectID,
		RequestID:       persisted.RequestID,
		ActorAPTID:      persisted.ActorAPTID,
		ActorBPTID:      persisted.ActorBPTID,
		AcceptedEventID: persisted.AcceptedEventID,
		CreatedAt:       persisted.CreatedAt.UTC(),
	}
}

func cloneFriendRequestCommandRecord(
	record domain.FriendRequestCommandRecord,
) domain.FriendRequestCommandRecord {
	cloned := record
	cloned.CommandBytes = append([]byte(nil), record.CommandBytes...)
	cloned.CommandPayloadSHA256 = append([]byte(nil), record.CommandPayloadSHA256...)
	cloned.ResultBytes = append([]byte(nil), record.ResultBytes...)
	cloned.ResolvedAt = cloneTime(record.ResolvedAt)
	return cloned
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := value.UTC()
	return &cloned
}

func exactFriendRequestCommand(
	existing domain.FriendRequestCommandRecord,
	candidate domain.FriendRequestCommandRecord,
) bool {
	return existing.Role == candidate.Role &&
		existing.AuthorityStationPeerID == candidate.AuthorityStationPeerID &&
		existing.CommandID == candidate.CommandID &&
		existing.RequestID == candidate.RequestID &&
		bytes.Equal(existing.CommandBytes, candidate.CommandBytes) &&
		bytes.Equal(existing.CommandPayloadSHA256, candidate.CommandPayloadSHA256)
}

func mapFederatedFriendRequestPersistenceError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if domain.FederationErrorCodeOf(err) != "" {
		return err
	}
	return domain.WrapFederationError(domain.FederationErrorPersistence, operation, err)
}

func validateCommandRecord(
	record domain.FriendRequestCommandRecord,
) error {
	if record.Role != domain.FriendRequestCommandRoleOutgoing &&
		record.Role != domain.FriendRequestCommandRoleAuthority {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.validate_friend_request_command_record",
			"role",
			"is unsupported",
		)
	}
	if record.AuthorityStationPeerID == "" ||
		record.CommandID == "" ||
		record.RequestID == "" ||
		len(record.CommandBytes) == 0 ||
		len(record.CommandPayloadSHA256) != 32 ||
		record.CreatedAt.IsZero() {
		return domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.validate_friend_request_command_record",
			"record",
			"is incomplete",
		)
	}
	return nil
}

func describeCommandConflict(
	existing domain.FriendRequestCommandRecord,
	candidate domain.FriendRequestCommandRecord,
) error {
	if exactFriendRequestCommand(existing, candidate) {
		return nil
	}
	return domain.NewFederationError(
		domain.FederationErrorIdempotencyConflict,
		"social.classify_friend_request_command",
		"command_id",
		fmt.Sprintf(
			"authority %q reused command identity with different exact bytes",
			candidate.AuthorityStationPeerID,
		),
	)
}

var _ FederatedFriendRequestUnitOfWork = (*GORMFederatedFriendRequestStore)(nil)
var _ DirectConversationEffectStore = (*GORMFederatedFriendRequestStore)(nil)
