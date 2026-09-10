package delivery

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GORMRepository implements Repository and UnitOfWork over one GORM database.
type GORMRepository struct {
	db    *gorm.DB
	clock Clock
}

// NewGORMRepository creates the shared delivery persistence adapter.
func NewGORMRepository(db *gorm.DB, clock Clock) (*GORMRepository, error) {
	if db == nil || isNil(clock) {
		return nil, NewError(FailureInvalidArgument, "create GORM repository", errorsText("database and clock are required"))
	}
	return &GORMRepository{db: db, clock: clock}, nil
}

// Migrate creates the explicit inbox and outbox tables.
func (r *GORMRepository) Migrate(ctx context.Context) error {
	if err := r.db.WithContext(ctx).AutoMigrate(&InboxRecord{}, &OutboxRecord{}); err != nil {
		return NewError(FailurePersistence, "migrate delivery tables", err)
	}
	return nil
}

// Enqueue inserts a new immutable frame or classifies an exact replay/conflict.
func (r *GORMRepository) Enqueue(
	ctx context.Context,
	frame *Frame,
	now time.Time,
) (EnqueueResult, error) {
	return enqueueFrame(ctx, r.db, frame, now)
}

// Claim leases a bounded set of due frames and reclaims expired leases.
func (r *GORMRepository) Claim(
	ctx context.Context,
	request ClaimRequest,
) ([]Claim, error) {
	if err := validateClaimRequest(request); err != nil {
		return nil, err
	}
	request.Now = request.Now.UTC()
	claims := make([]Claim, 0, request.Limit)
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := expireDueRows(tx, request.Now); err != nil {
			return err
		}
		query := tx.Where(
			"((state IN ? AND next_attempt_at <= ?) OR "+
				"(state = ? AND lease_expires_at <= ?)) AND expires_at > ?",
			[]OutboxState{OutboxStatePending, OutboxStateRetryWait},
			request.Now,
			OutboxStateLeased,
			request.Now,
			request.Now,
		).Where(
			"ordering_sequence <= 0 OR NOT EXISTS ("+
				"SELECT 1 FROM federation_delivery_outbox AS predecessor "+
				"WHERE predecessor.source_station_peer_id = federation_delivery_outbox.source_station_peer_id "+
				"AND predecessor.target_station_peer_id = federation_delivery_outbox.target_station_peer_id "+
				"AND predecessor.ordering_key = federation_delivery_outbox.ordering_key "+
				"AND predecessor.ordering_sequence > 0 "+
				"AND predecessor.ordering_sequence < federation_delivery_outbox.ordering_sequence "+
				"AND predecessor.state NOT IN ?)",
			[]OutboxState{OutboxStateDelivered, OutboxStateTerminal, OutboxStateExpired},
		).Order(
			"next_attempt_at ASC, created_at ASC, target_station_peer_id ASC, " +
				"ordering_key ASC, ordering_sequence ASC, frame_id ASC",
		).Limit(request.Limit)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}

		var records []OutboxRecord
		if err := query.Find(&records).Error; err != nil {
			return NewError(FailurePersistence, "select outbox claims", err)
		}
		for index := range records {
			record := &records[index]
			frame, err := decodeOutboxRecord(record)
			if err != nil {
				if markErr := markCorruptRecord(tx, record.FrameID, request.Now); markErr != nil {
					return markErr
				}
				continue
			}
			if record.LeaseGeneration == ^uint64(0) {
				return NewError(
					FailurePersistence,
					"lease outbox frame",
					errorsText("lease generation exhausted"),
				)
			}
			leaseExpiresAt := request.Now.Add(request.LeaseDuration)
			if record.ExpiresAt.Before(leaseExpiresAt) {
				leaseExpiresAt = record.ExpiresAt
			}
			nextGeneration := record.LeaseGeneration + 1
			nextAttemptCount := record.AttemptCount + 1
			if nextAttemptCount < record.AttemptCount {
				nextAttemptCount = record.AttemptCount
			}
			result := tx.Model(&OutboxRecord{}).
				Where("frame_id = ? AND lease_generation = ?", record.FrameID, record.LeaseGeneration).
				Where(
					"(state IN ? AND next_attempt_at <= ?) OR "+
						"(state = ? AND lease_expires_at <= ?)",
					[]OutboxState{OutboxStatePending, OutboxStateRetryWait},
					request.Now,
					OutboxStateLeased,
					request.Now,
				).
				Updates(map[string]interface{}{
					"state":            OutboxStateLeased,
					"attempt_count":    nextAttemptCount,
					"lease_owner":      request.WorkerID,
					"lease_generation": nextGeneration,
					"lease_expires_at": leaseExpiresAt,
				})
			if result.Error != nil {
				return NewError(FailurePersistence, "lease outbox frame", result.Error)
			}
			if result.RowsAffected == 0 {
				continue
			}
			claims = append(claims, Claim{
				Frame: frame,
				Lease: Lease{
					FrameID:    record.FrameID,
					Owner:      request.WorkerID,
					Generation: nextGeneration,
					ExpiresAt:  leaseExpiresAt,
				},
				AttemptCount: nextAttemptCount,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// MarkDelivered commits successful or duplicate receiver acknowledgement.
func (r *GORMRepository) MarkDelivered(
	ctx context.Context,
	lease Lease,
	deliveredAt time.Time,
) error {
	if deliveredAt.IsZero() {
		return NewError(FailureInvalidArgument, "mark outbox delivered", errorsText("delivery time is required"))
	}
	return r.updateLeased(ctx, lease, deliveredAt, map[string]interface{}{
		"state":            OutboxStateDelivered,
		"delivered_at":     deliveredAt.UTC(),
		"last_failure":     FailureCode(""),
		"lease_owner":      "",
		"lease_expires_at": nil,
	})
}

// ScheduleRetry returns a retryable frame to the due queue without an attempt cap.
func (r *GORMRepository) ScheduleRetry(
	ctx context.Context,
	lease Lease,
	nextAttemptAt time.Time,
	failure FailureCode,
) error {
	if nextAttemptAt.IsZero() || failure == "" {
		return NewError(FailureInvalidArgument, "schedule outbox retry", errorsText("retry time and failure are required"))
	}
	return r.updateLeased(ctx, lease, r.clock.Now().UTC(), map[string]interface{}{
		"state":            OutboxStateRetryWait,
		"next_attempt_at":  nextAttemptAt.UTC(),
		"last_failure":     failure,
		"lease_owner":      "",
		"lease_expires_at": nil,
	})
}

// MarkTerminal records a non-retryable receiver outcome.
func (r *GORMRepository) MarkTerminal(
	ctx context.Context,
	lease Lease,
	terminalAt time.Time,
	failure FailureCode,
) error {
	if terminalAt.IsZero() || failure == "" {
		return NewError(FailureInvalidArgument, "mark outbox terminal", errorsText("terminal time and failure are required"))
	}
	return r.updateLeased(ctx, lease, terminalAt, map[string]interface{}{
		"state":            OutboxStateTerminal,
		"terminal_at":      terminalAt.UTC(),
		"last_failure":     failure,
		"lease_owner":      "",
		"lease_expires_at": nil,
	})
}

// MarkExpired closes a frame only after its immutable expiry.
func (r *GORMRepository) MarkExpired(
	ctx context.Context,
	lease Lease,
	expiredAt time.Time,
) error {
	if err := validateLease(lease); err != nil {
		return err
	}
	if expiredAt.IsZero() {
		return NewError(FailureInvalidArgument, "mark outbox expired", errorsText("expiry time is required"))
	}
	expiredAt = expiredAt.UTC()
	result := r.db.WithContext(ctx).
		Model(&OutboxRecord{}).
		Where(
			"frame_id = ? AND state = ? AND lease_owner = ? AND "+
				"lease_generation = ? AND expires_at <= ?",
			lease.FrameID,
			OutboxStateLeased,
			lease.Owner,
			lease.Generation,
			expiredAt,
		).
		Updates(map[string]interface{}{
			"state":            OutboxStateExpired,
			"terminal_at":      expiredAt,
			"last_failure":     FailureExpired,
			"lease_owner":      "",
			"lease_expires_at": nil,
		})
	if result.Error != nil {
		return NewError(FailurePersistence, "mark outbox expired", result.Error)
	}
	if result.RowsAffected != 1 {
		return NewError(FailureLeaseFenced, "mark outbox expired", errorsText("lease no longer owns frame"))
	}
	return nil
}

func (r *GORMRepository) updateLeased(
	ctx context.Context,
	lease Lease,
	transitionAt time.Time,
	updates map[string]interface{},
) error {
	if err := validateLease(lease); err != nil {
		return err
	}
	transitionAt = transitionAt.UTC()
	effectiveNow := r.clock.Now().UTC()
	if transitionAt.After(effectiveNow) {
		effectiveNow = transitionAt
	}
	if !lease.ExpiresAt.After(effectiveNow) {
		return NewError(FailureLeaseFenced, "update leased outbox frame", errorsText("lease expired"))
	}
	result := r.db.WithContext(ctx).
		Model(&OutboxRecord{}).
		Where(
			"frame_id = ? AND state = ? AND lease_owner = ? AND "+
				"lease_generation = ?",
			lease.FrameID,
			OutboxStateLeased,
			lease.Owner,
			lease.Generation,
		).
		Updates(updates)
	if result.Error != nil {
		return NewError(FailurePersistence, "update leased outbox frame", result.Error)
	}
	if result.RowsAffected != 1 {
		return NewError(FailureLeaseFenced, "update leased outbox frame", errorsText("lease no longer owns frame"))
	}
	return nil
}

type frameIdentity struct {
	sourceStationPeerID string
	targetStationPeerID string
	idempotencyKey      string
	frameID             string
	orderingKey         string
	orderingSequence    int64
	payloadSHA256       []byte
	canonicalSHA256     []byte
}

func newFrameIdentity(frame *Frame) (frameIdentity, error) {
	if frame == nil ||
		strings.TrimSpace(frame.SourceStationPeerId) == "" ||
		frame.SourceStationPeerId != strings.TrimSpace(frame.SourceStationPeerId) ||
		strings.TrimSpace(frame.IdempotencyKey) == "" ||
		frame.IdempotencyKey != strings.TrimSpace(frame.IdempotencyKey) ||
		strings.TrimSpace(frame.FrameId) == "" ||
		frame.FrameId != strings.TrimSpace(frame.FrameId) {
		return frameIdentity{}, NewError(FailureInvalidFrame, "identify frame", errorsText("frame identity is incomplete"))
	}
	if !bytes.Equal(frame.PayloadSha256, PayloadSHA256(frame.OpaquePayload)) {
		return frameIdentity{}, NewError(FailureInvalidFrame, "identify frame", errorsText("payload SHA-256 mismatch"))
	}
	canonicalSHA256, err := CanonicalFrameSHA256(frame)
	if err != nil {
		return frameIdentity{}, err
	}
	return frameIdentity{
		sourceStationPeerID: frame.SourceStationPeerId,
		targetStationPeerID: frame.TargetStationPeerId,
		idempotencyKey:      frame.IdempotencyKey,
		frameID:             frame.FrameId,
		orderingKey:         frame.OrderingKey,
		orderingSequence:    frame.OrderingSequence,
		payloadSHA256:       append([]byte(nil), frame.PayloadSha256...),
		canonicalSHA256:     canonicalSHA256,
	}, nil
}

func enqueueFrame(
	ctx context.Context,
	db *gorm.DB,
	frame *Frame,
	now time.Time,
) (EnqueueResult, error) {
	if now.IsZero() {
		return EnqueueResult{}, NewError(FailureInvalidArgument, "enqueue frame", errorsText("enqueue time is required"))
	}
	if err := validateEnqueueFrame(frame, now); err != nil {
		return EnqueueResult{}, err
	}
	identity, err := newFrameIdentity(frame)
	if err != nil {
		return EnqueueResult{}, err
	}
	if frame.ExpiresAt == nil {
		return EnqueueResult{}, NewError(FailureInvalidFrame, "enqueue frame", errorsText("valid expiry is required"))
	}
	if err := frame.ExpiresAt.CheckValid(); err != nil {
		return EnqueueResult{}, NewError(FailureInvalidFrame, "enqueue frame", err)
	}
	frameBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return EnqueueResult{}, NewError(FailureInvalidFrame, "serialize outbox frame", err)
	}
	record := &OutboxRecord{
		FrameID:             identity.frameID,
		SourceStationPeerID: identity.sourceStationPeerID,
		TargetStationPeerID: frame.TargetStationPeerId,
		IdempotencyKey:      identity.idempotencyKey,
		PayloadKind:         int32(frame.PayloadKind),
		PayloadID:           frame.PayloadId,
		OrderingKey:         frame.OrderingKey,
		OrderingSequence:    frame.OrderingSequence,
		FrameBytes:          frameBytes,
		PayloadSHA256:       identity.payloadSHA256,
		CanonicalSHA256:     identity.canonicalSHA256,
		State:               OutboxStatePending,
		NextAttemptAt:       now.UTC(),
		ExpiresAt:           frame.ExpiresAt.AsTime(),
		CreatedAt:           now.UTC(),
	}
	create := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if create.Error != nil {
		return EnqueueResult{}, NewError(FailurePersistence, "insert outbox frame", create.Error)
	}
	if create.RowsAffected == 1 {
		return EnqueueResult{}, nil
	}

	exact, err := classifyOutboxConflict(db.WithContext(ctx), identity)
	if err != nil {
		return EnqueueResult{}, err
	}
	if !exact {
		return EnqueueResult{}, NewError(FailurePayloadHashConflict, "enqueue frame", errorsText("frame identity reused with different bytes"))
	}
	return EnqueueResult{Duplicate: true}, nil
}

func validateEnqueueFrame(frame *Frame, now time.Time) error {
	if frame == nil {
		return NewError(FailureInvalidFrame, "enqueue frame", errorsText("frame is nil"))
	}
	policy := DefaultFramePolicy(frame.TargetStationPeerId)
	return validateFrame(frame, policy, now.UTC(), true, true)
}

func classifyOutboxConflict(db *gorm.DB, identity frameIdentity) (bool, error) {
	var byIdempotency OutboxRecord
	idempotencyErr := db.Where(
		"source_station_peer_id = ? AND idempotency_key = ?",
		identity.sourceStationPeerID,
		identity.idempotencyKey,
	).First(&byIdempotency).Error
	if idempotencyErr == nil {
		return outboxIdentityMatches(byIdempotency, identity), nil
	}
	if !errors.Is(idempotencyErr, gorm.ErrRecordNotFound) {
		return false, NewError(FailurePersistence, "load outbox idempotency row", idempotencyErr)
	}

	var byFrame OutboxRecord
	frameErr := db.Where("frame_id = ?", identity.frameID).First(&byFrame).Error
	if frameErr == nil {
		return outboxIdentityMatches(byFrame, identity), nil
	}
	if !errors.Is(frameErr, gorm.ErrRecordNotFound) {
		return false, NewError(FailurePersistence, "load outbox frame row", frameErr)
	}
	if identity.orderingSequence > 0 {
		var candidate OutboxRecord
		laneErr := db.Where(
			"source_station_peer_id = ? AND target_station_peer_id = ? "+
				"AND ordering_key = ? AND ordering_sequence = ?",
			identity.sourceStationPeerID,
			identity.targetStationPeerID,
			identity.orderingKey,
			identity.orderingSequence,
		).First(&candidate).Error
		if laneErr == nil {
			return false, nil
		}
		if !errors.Is(laneErr, gorm.ErrRecordNotFound) {
			return false, NewError(FailurePersistence, "load outbox ordering row", laneErr)
		}
	}
	return false, NewError(FailurePersistence, "classify outbox conflict", errorsText("conflicting row was not found"))
}

func outboxIdentityMatches(record OutboxRecord, identity frameIdentity) bool {
	return record.SourceStationPeerID == identity.sourceStationPeerID &&
		record.IdempotencyKey == identity.idempotencyKey &&
		record.FrameID == identity.frameID &&
		bytes.Equal(record.PayloadSHA256, identity.payloadSHA256) &&
		bytes.Equal(record.CanonicalSHA256, identity.canonicalSHA256)
}

func decodeOutboxRecord(record *OutboxRecord) (*Frame, error) {
	frame := &Frame{}
	if err := proto.Unmarshal(record.FrameBytes, frame); err != nil {
		return nil, NewError(FailureInvalidFrame, "decode outbox frame", err)
	}
	identity, err := newFrameIdentity(frame)
	if err != nil {
		return nil, err
	}
	if !outboxIdentityMatches(*record, identity) {
		return nil, NewError(FailureInvalidFrame, "decode outbox frame", errorsText("persisted frame identity mismatch"))
	}
	return frame, nil
}

func expireDueRows(db *gorm.DB, now time.Time) error {
	result := db.Model(&OutboxRecord{}).
		Where(
			"state IN ? AND expires_at <= ?",
			[]OutboxState{OutboxStatePending, OutboxStateRetryWait, OutboxStateLeased},
			now,
		).
		Updates(map[string]interface{}{
			"state":            OutboxStateExpired,
			"terminal_at":      now,
			"last_failure":     FailureExpired,
			"lease_owner":      "",
			"lease_expires_at": nil,
		})
	if result.Error != nil {
		return NewError(FailurePersistence, "expire due outbox frames", result.Error)
	}
	return nil
}

func markCorruptRecord(db *gorm.DB, frameID string, now time.Time) error {
	result := db.Model(&OutboxRecord{}).
		Where("frame_id = ?", frameID).
		Updates(map[string]interface{}{
			"state":            OutboxStateTerminal,
			"terminal_at":      now,
			"last_failure":     FailureInvalidFrame,
			"lease_owner":      "",
			"lease_expires_at": nil,
		})
	if result.Error != nil {
		return NewError(FailurePersistence, "mark corrupt outbox frame", result.Error)
	}
	if result.RowsAffected != 1 {
		return NewError(FailurePersistence, "mark corrupt outbox frame", errorsText("outbox row disappeared"))
	}
	return nil
}

func validateClaimRequest(request ClaimRequest) error {
	if strings.TrimSpace(request.WorkerID) == "" ||
		request.WorkerID != strings.TrimSpace(request.WorkerID) ||
		request.Limit <= 0 ||
		request.Limit > MaxClaimBatchSize ||
		request.Now.IsZero() ||
		request.LeaseDuration <= 0 {
		return NewError(FailureInvalidArgument, "validate claim request", errorsText("claim bounds are invalid"))
	}
	return nil
}

func validateLease(lease Lease) error {
	if strings.TrimSpace(lease.FrameID) == "" ||
		strings.TrimSpace(lease.Owner) == "" ||
		lease.Generation == 0 ||
		lease.ExpiresAt.IsZero() {
		return NewError(FailureInvalidArgument, "validate lease", errorsText("lease is incomplete"))
	}
	return nil
}

var _ Repository = (*GORMRepository)(nil)
