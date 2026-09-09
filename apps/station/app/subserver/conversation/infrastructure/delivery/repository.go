package delivery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	application "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	storageStatePending    int32 = 1
	storageStateClaimed    int32 = 2
	storageStateRetryWait  int32 = 3
	storageStateConsumed   int32 = 4
	storageStateAcked      int32 = 5
	storageStateDeadLetter int32 = 6
)

// Repository owns lane allocation, leasing, acknowledgement, retry, and quota
// transitions in the existing canonical Device Inbox tables.
type Repository struct {
	db              *gorm.DB
	limits          application.QueueLimits
	sqliteMutex     sync.Mutex
	serializeSQLite bool
}

// NewRepository constructs a Device Inbox repository over an existing Station database handle.
func NewRepository(
	db *gorm.DB,
	limits application.QueueLimits,
) (*Repository, error) {
	if db == nil {
		return nil, application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.new",
			"database",
			"is required",
		)
	}
	if limits.MaxUnackedItems <= 0 || limits.MaxUnackedBytes <= 0 {
		return nil, application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.new",
			"queue_limits",
			"must be positive",
		)
	}

	return &Repository{
		db:              db,
		limits:          limits,
		serializeSQLite: db.Dialector.Name() == "sqlite",
	}, nil
}

// AutoMigrate creates only the existing canonical Device Inbox tables for isolated composition.
func (r *Repository) AutoMigrate() error {
	if err := r.db.AutoMigrate(&DeviceQueueLaneModel{}, &DeviceQueueItemModel{}); err != nil {
		return application.WrapError(
			application.ErrorCodePersistence,
			"delivery_repository.auto_migrate",
			err,
		)
	}

	return nil
}

// Enqueue atomically allocates a lane sequence and persists one exact delivery.
func (r *Repository) Enqueue(
	ctx context.Context,
	request application.EnqueueRequest,
) (application.Item, error) {
	if err := validateEnqueueRequest(request); err != nil {
		return application.Item{}, err
	}

	var persisted application.Item
	err := r.transaction(ctx, "delivery_repository.enqueue", func(tx *gorm.DB) error {
		if err := requireActiveDeviceForMutation(
			tx,
			request.Recipient,
			"delivery_repository.enqueue",
		); err != nil {
			return err
		}

		lane, err := lockOrCreateLane(tx, request.Recipient)
		if err != nil {
			return err
		}

		existing, found, err := findIdempotentItem(
			tx,
			request.Recipient,
			request.IdempotencyKey,
		)
		if err != nil {
			return err
		}
		if found {
			if !matchesEnqueueRequest(existing, request) {
				return application.NewError(
					application.ErrorCodeIdempotencyConflict,
					"delivery_repository.enqueue",
					"idempotency_key",
					"already identifies a different delivery",
				)
			}
			persisted, err = modelToItem(existing)

			return err
		}
		if err := r.checkQuota(
			tx,
			request.Recipient,
			int64(len(request.OpaquePayload)),
		); err != nil {
			return err
		}
		if lane.NextSequence == math.MaxInt64 {
			return application.NewError(
				application.ErrorCodePersistence,
				"delivery_repository.enqueue",
				"lane_sequence",
				"is exhausted",
			)
		}

		lane.NextSequence++
		if err := tx.Save(lane).Error; err != nil {
			return err
		}
		model := &DeviceQueueItemModel{
			ItemID:            request.ItemID,
			RecipientPTID:     string(request.Recipient.Actor),
			RecipientDeviceID: string(request.Recipient.Device),
			LaneSequence:      lane.NextSequence,
			IdempotencyKey:    request.IdempotencyKey,
			EventID:           string(request.EventID),
			EventSequence:     uint64(request.EventSequence),
			ConversationID:    string(request.ConversationID),
			PayloadType:       int32(request.PayloadType),
			OpaquePayload:     append([]byte(nil), request.OpaquePayload...),
			PayloadSHA256:     request.PayloadHash.Bytes(),
			State:             storageStatePending,
			FirstQueuedAt:     request.CreatedAt.UTC(),
			NextAttemptAt:     request.CreatedAt.UTC(),
		}
		if err := tx.Create(model).Error; err != nil {
			return err
		}
		persisted, err = modelToItem(model)

		return err
	})
	if err != nil {
		return application.Item{}, err
	}

	return persisted, nil
}

// Claim leases a contiguous prefix that begins at the exact unacknowledged lane head.
func (r *Repository) Claim(
	ctx context.Context,
	request application.ClaimRequest,
) (application.ClaimResult, error) {
	if err := validateClaimRequest(request); err != nil {
		return application.ClaimResult{}, err
	}

	var result application.ClaimResult
	var integrityErr error
	err := r.transaction(ctx, "delivery_repository.claim", func(tx *gorm.DB) error {
		if err := requireActiveDeviceForMutation(
			tx,
			request.Recipient,
			"delivery_repository.claim",
		); err != nil {
			return err
		}

		lane, err := lockOrCreateLane(tx, request.Recipient)
		if err != nil {
			return err
		}
		if request.ExpectedConsumerEpoch != 0 &&
			request.ExpectedConsumerEpoch != lane.ActiveConsumerEpoch {
			return application.NewError(
				application.ErrorCodeConsumerFenced,
				"delivery_repository.claim",
				"expected_consumer_epoch",
				"does not match the active lane epoch",
			)
		}
		if request.AfterLaneSequence > lane.AckedThrough {
			return application.NewError(
				application.ErrorCodeItemNotHead,
				"delivery_repository.claim",
				"after_lane_sequence",
				"would skip the unacknowledged lane head",
			)
		}
		initializedConsumerEpoch := false
		if lane.ActiveConsumerEpoch == 0 {
			if err := advanceConsumerEpoch(tx, lane, request.ConsumerID); err != nil {
				return err
			}
			initializedConsumerEpoch = true
		}
		result.ConsumerEpoch = lane.ActiveConsumerEpoch
		result.LaneHead = lane.NextSequence
		result.AckedThrough = lane.AckedThrough

		var candidates []DeviceQueueItemModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"recipient_ptid = ? AND recipient_device_id = ? AND lane_sequence > ?",
				string(request.Recipient.Actor),
				string(request.Recipient.Device),
				lane.AckedThrough,
			).
			Where(
				"(state = ? OR (state = ? AND next_attempt_at <= ?) OR (state = ? AND lease_expires_at <= ?))",
				storageStatePending,
				storageStateRetryWait,
				request.Now,
				storageStateClaimed,
				request.Now,
			).
			Order("lane_sequence ASC").
			Limit(request.Limit).
			Find(&candidates).Error; err != nil {
			return err
		}
		if len(candidates) == 0 || candidates[0].LaneSequence != lane.AckedThrough+1 {
			return nil
		}

		contiguous := candidates[:1]
		for index := 1; index < len(candidates); index++ {
			if candidates[index].LaneSequence != candidates[index-1].LaneSequence+1 {
				break
			}
			contiguous = candidates[:index+1]
		}
		for index := range contiguous {
			if payloadMatches(&contiguous[index]) {
				continue
			}
			markDeadLetter(&contiguous[index], application.RejectCodeIntegrityFailed)
			if err := tx.Save(&contiguous[index]).Error; err != nil {
				return err
			}
			integrityErr = application.NewError(
				application.ErrorCodePayloadHashMismatch,
				"delivery_repository.claim",
				"payload_sha256",
				"does not match the persisted opaque payload",
			)

			return nil
		}
		// The epoch fences the concrete delivery attempt, not just a consumer ID.
		// Reusing an epoch here would let a delayed outcome mutate this new lease.
		if !initializedConsumerEpoch {
			if err := advanceConsumerEpoch(tx, lane, request.ConsumerID); err != nil {
				return err
			}
		}
		result.ConsumerEpoch = lane.ActiveConsumerEpoch

		leaseExpiresAt := request.Now.Add(request.LeaseDuration)
		for index := range contiguous {
			model := &contiguous[index]
			model.State = storageStateClaimed
			model.LeaseConsumerID = request.ConsumerID
			model.LeaseConsumerEpoch = lane.ActiveConsumerEpoch
			model.LeaseExpiresAt = &leaseExpiresAt
			model.AttemptCount++
			if err := tx.Save(model).Error; err != nil {
				return err
			}
			item, err := modelToItem(model)
			if err != nil {
				return err
			}
			result.Items = append(result.Items, item)
		}

		return nil
	})
	if err != nil {
		return application.ClaimResult{}, err
	}
	if integrityErr != nil {
		return application.ClaimResult{}, integrityErr
	}

	return result, nil
}

// Acknowledge advances only the exact claimed lane head under its live consumer lease.
func (r *Repository) Acknowledge(
	ctx context.Context,
	request application.AcknowledgeRequest,
) (int64, error) {
	if err := validateAcknowledgeRequest(request); err != nil {
		return 0, err
	}

	var ackedThrough int64
	var integrityErr error
	err := r.transaction(ctx, "delivery_repository.acknowledge", func(tx *gorm.DB) error {
		if err := requireActiveDeviceForMutation(
			tx,
			request.Recipient,
			"delivery_repository.acknowledge",
		); err != nil {
			return err
		}

		lane, err := lockOrCreateLane(tx, request.Recipient)
		if err != nil {
			return err
		}
		if request.ConsumerEpoch != lane.ActiveConsumerEpoch {
			return application.NewError(
				application.ErrorCodeConsumerFenced,
				"delivery_repository.acknowledge",
				"consumer_epoch",
				"does not match the active lane epoch",
			)
		}

		item, err := lockItem(tx, request.ItemID)
		if err != nil {
			return err
		}
		if !ownedBy(item, request.Recipient) {
			return application.NewError(
				application.ErrorCodeItemOwnerMismatch,
				"delivery_repository.acknowledge",
				"device",
				"does not own the item",
			)
		}
		if item.LaneSequence != request.LaneSequence {
			return application.NewError(
				application.ErrorCodeItemNotHead,
				"delivery_repository.acknowledge",
				"lane_sequence",
				"does not identify the requested item",
			)
		}
		if !payloadMatches(item) {
			markDeadLetter(item, application.RejectCodeIntegrityFailed)
			if err := tx.Save(item).Error; err != nil {
				return err
			}
			integrityErr = application.NewError(
				application.ErrorCodePayloadHashMismatch,
				"delivery_repository.acknowledge",
				"payload_sha256",
				"does not match the persisted opaque payload",
			)

			return nil
		}
		if !bytes.Equal(item.PayloadSHA256, request.PayloadHash.Bytes()) {
			return application.NewError(
				application.ErrorCodePayloadHashMismatch,
				"delivery_repository.acknowledge",
				"payload_sha256",
				"does not match the claimed item",
			)
		}
		if item.State == storageStateAcked {
			if item.LaneSequence > lane.AckedThrough {
				return application.NewError(
					application.ErrorCodePersistence,
					"delivery_repository.acknowledge",
					"acked_through",
					"is behind an acknowledged item",
				)
			}
			ackedThrough = lane.AckedThrough

			return nil
		}
		if item.LaneSequence != lane.AckedThrough+1 {
			return application.NewError(
				application.ErrorCodeItemNotHead,
				"delivery_repository.acknowledge",
				"lane_sequence",
				"is not the exact unacknowledged lane head",
			)
		}
		if item.State != storageStateClaimed &&
			item.State != storageStateConsumed {
			return application.NewError(
				application.ErrorCodeItemNotClaimed,
				"delivery_repository.acknowledge",
				"state",
				"is not claimed",
			)
		}
		if item.LeaseConsumerEpoch != request.ConsumerEpoch ||
			item.LeaseConsumerID == "" ||
			item.LeaseConsumerID != lane.ActiveConsumerID {
			return application.NewError(
				application.ErrorCodeConsumerFenced,
				"delivery_repository.acknowledge",
				"consumer_epoch",
				"does not own the item lease",
			)
		}
		if item.LeaseExpiresAt == nil ||
			(item.State == storageStateClaimed &&
				!item.LeaseExpiresAt.After(request.Now)) {
			return application.NewError(
				application.ErrorCodeLeaseExpired,
				"delivery_repository.acknowledge",
				"lease",
				"has expired",
			)
		}

		consumedAt := request.Now.UTC()
		item.State = storageStateAcked
		if item.ConsumedAt == nil {
			item.ConsumedAt = &consumedAt
		}
		item.AckedAt = &consumedAt
		item.LeaseConsumerID = ""
		item.LeaseConsumerEpoch = 0
		item.LeaseExpiresAt = nil
		if err := tx.Save(item).Error; err != nil {
			return err
		}
		lane.AckedThrough = item.LaneSequence
		if err := tx.Save(lane).Error; err != nil {
			return err
		}
		ackedThrough = lane.AckedThrough

		return nil
	})
	if err != nil {
		return 0, err
	}
	if integrityErr != nil {
		return 0, integrityErr
	}

	return ackedThrough, nil
}

// Reject schedules bounded retry or moves the exact lane head to dead-letter.
func (r *Repository) Reject(
	ctx context.Context,
	request application.RejectRequest,
) (application.RejectResult, error) {
	if err := validateRejectRequest(request); err != nil {
		return application.RejectResult{}, err
	}

	var result application.RejectResult
	err := r.transaction(ctx, "delivery_repository.reject", func(tx *gorm.DB) error {
		if err := requireActiveDeviceForMutation(
			tx,
			request.Recipient,
			"delivery_repository.reject",
		); err != nil {
			return err
		}

		lane, err := lockOrCreateLane(tx, request.Recipient)
		if err != nil {
			return err
		}

		item, err := lockItem(tx, request.ItemID)
		if err != nil {
			return err
		}
		if !ownedBy(item, request.Recipient) {
			return application.NewError(
				application.ErrorCodeItemOwnerMismatch,
				"delivery_repository.reject",
				"device",
				"does not own the item",
			)
		}
		if item.LaneSequence != request.LaneSequence ||
			item.LaneSequence != lane.AckedThrough+1 {
			return application.NewError(
				application.ErrorCodeItemNotHead,
				"delivery_repository.reject",
				"lane_sequence",
				"is not the exact unacknowledged lane head",
			)
		}
		if item.State == storageStateRetryWait ||
			item.State == storageStateDeadLetter {
			replayed, err := replayRejectResult(item, request)
			if err != nil {
				return err
			}
			result = replayed

			return nil
		}
		if request.ConsumerEpoch != lane.ActiveConsumerEpoch {
			return application.NewError(
				application.ErrorCodeConsumerFenced,
				"delivery_repository.reject",
				"consumer_epoch",
				"does not match the active lane epoch",
			)
		}
		if item.State != storageStateClaimed {
			return application.NewError(
				application.ErrorCodeItemNotClaimed,
				"delivery_repository.reject",
				"state",
				"is not claimed",
			)
		}
		if item.LeaseConsumerEpoch != request.ConsumerEpoch ||
			item.LeaseConsumerID == "" ||
			item.LeaseConsumerID != lane.ActiveConsumerID {
			return application.NewError(
				application.ErrorCodeConsumerFenced,
				"delivery_repository.reject",
				"consumer_epoch",
				"does not own the item lease",
			)
		}
		if item.LeaseExpiresAt == nil || !item.LeaseExpiresAt.After(request.Now) {
			return application.NewError(
				application.ErrorCodeLeaseExpired,
				"delivery_repository.reject",
				"lease",
				"has expired",
			)
		}

		item.LastErrorCode = string(request.Code)
		item.LastRejectConsumerEpoch = request.ConsumerEpoch
		item.LeaseConsumerID = ""
		item.LeaseConsumerEpoch = 0
		item.LeaseExpiresAt = nil
		if request.Retryable && item.AttemptCount < request.MaxAttempts {
			nextAttemptAt := request.Now.Add(retryDelay(
				item.AttemptCount,
				request.BaseRetryDelay,
				request.MaxRetryDelay,
			)).UTC()
			item.State = storageStateRetryWait
			item.NextAttemptAt = nextAttemptAt
			result = application.RejectResult{
				State:         application.ItemStateRetryWait,
				NextAttemptAt: &nextAttemptAt,
			}
		} else {
			item.State = storageStateDeadLetter
			result = application.RejectResult{State: application.ItemStateDeadLetter}
		}
		if err := tx.Save(item).Error; err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return application.RejectResult{}, err
	}

	return result, nil
}

// Stats returns durable per-state counts and unacknowledged payload bytes for one lane.
func (r *Repository) Stats(
	ctx context.Context,
	recipient valueobject.Endpoint,
) (application.QueueStats, error) {
	if !validEndpoint(recipient) {
		return application.QueueStats{}, application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.stats",
			"device",
			"must contain a PTID and device ID",
		)
	}

	var stats application.QueueStats
	err := r.transaction(ctx, "delivery_repository.stats", func(tx *gorm.DB) error {
		lane, err := lockOrCreateLane(tx, recipient)
		if err != nil {
			return err
		}
		stats.NextSequence = lane.NextSequence
		stats.AckedThrough = lane.AckedThrough

		type stateCount struct {
			State int32
			Count int64
		}
		var counts []stateCount
		if err := tx.Model(&DeviceQueueItemModel{}).
			Select("state, COUNT(*) AS count").
			Where(
				"recipient_ptid = ? AND recipient_device_id = ?",
				string(recipient.Actor),
				string(recipient.Device),
			).
			Group("state").
			Scan(&counts).Error; err != nil {
			return err
		}
		for _, count := range counts {
			switch count.State {
			case storageStatePending:
				stats.Pending = count.Count
			case storageStateClaimed:
				stats.Claimed = count.Count
			case storageStateRetryWait:
				stats.RetryWait = count.Count
			case storageStateConsumed:
				stats.Consumed = count.Count
			case storageStateAcked:
				stats.Acked = count.Count
			case storageStateDeadLetter:
				stats.DeadLetter = count.Count
			}
		}

		return tx.Model(&DeviceQueueItemModel{}).
			Select("COALESCE(SUM(LENGTH(opaque_payload)), 0)").
			Where(
				"recipient_ptid = ? AND recipient_device_id = ? AND state != ?",
				string(recipient.Actor),
				string(recipient.Device),
				storageStateAcked,
			).
			Scan(&stats.UnackedBytes).Error
	})
	if err != nil {
		return application.QueueStats{}, err
	}

	return stats, nil
}

func (r *Repository) transaction(
	ctx context.Context,
	operation string,
	fn func(*gorm.DB) error,
) error {
	if r.serializeSQLite {
		r.sqliteMutex.Lock()
		defer r.sqliteMutex.Unlock()
	}
	err := r.db.WithContext(ctx).Transaction(fn)
	if err == nil || application.CodeOf(err) != "" {
		return err
	}

	return application.WrapError(application.ErrorCodePersistence, operation, err)
}

func requireActiveDeviceForMutation(
	tx *gorm.DB,
	recipient valueobject.Endpoint,
	operation string,
) error {
	err := actoridentitypersistence.RequireActiveDeviceForMutation(
		tx,
		actoridentitypersistence.DeviceLocator{
			PTID:     string(recipient.Actor),
			DeviceID: string(recipient.Device),
		},
	)
	if err == nil {
		return nil
	}
	if actoridentitydomain.IsCode(
		err,
		actoridentitydomain.ErrorCodeUnauthorized,
	) {
		return application.NewError(
			application.ErrorCodeUnauthorized,
			operation,
			"device",
			"is not an active verified actor device",
		)
	}

	return application.WrapError(
		application.ErrorCodePersistence,
		operation+".authorize_device",
		err,
	)
}

func validateEnqueueRequest(request application.EnqueueRequest) error {
	if !validEndpoint(request.Recipient) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.enqueue",
			"recipient",
			"must contain a PTID and device ID",
		)
	}
	if strings.TrimSpace(request.ItemID) == "" {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.enqueue",
			"item_id",
			"is required",
		)
	}
	if request.EventID == "" ||
		request.EventSequence == 0 ||
		request.ConversationID == "" {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.enqueue",
			"event",
			"requires event and conversation identities",
		)
	}
	if !validPayloadType(request.PayloadType) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.enqueue",
			"payload_type",
			"is not supported",
		)
	}
	if !validSHA256Hex(request.IdempotencyKey) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.enqueue",
			"idempotency_key",
			"must be a complete SHA-256 hex digest",
		)
	}
	if request.CreatedAt.IsZero() {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.enqueue",
			"created_at",
			"is required",
		)
	}
	if valueobject.HashBytes(request.OpaquePayload) != request.PayloadHash {
		return application.NewError(
			application.ErrorCodePayloadHashMismatch,
			"delivery_repository.enqueue",
			"payload_sha256",
			"does not match the opaque payload",
		)
	}

	return nil
}

func validateClaimRequest(request application.ClaimRequest) error {
	if !validEndpoint(request.Recipient) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.claim",
			"recipient",
			"must contain a PTID and device ID",
		)
	}
	if strings.TrimSpace(request.ConsumerID) == "" ||
		request.Limit <= 0 ||
		request.Limit > int(application.MaximumClaimBatchSize) ||
		request.AfterLaneSequence < 0 ||
		request.Now.IsZero() ||
		request.LeaseDuration <= 0 ||
		request.LeaseDuration > application.MaximumLeaseDuration {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.claim",
			"claim",
			"contains an invalid consumer, cursor, limit, time, or lease",
		)
	}

	return nil
}

func validateAcknowledgeRequest(request application.AcknowledgeRequest) error {
	if !validEndpoint(request.Recipient) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.acknowledge",
			"recipient",
			"must contain a PTID and device ID",
		)
	}
	if strings.TrimSpace(request.ItemID) == "" ||
		request.LaneSequence <= 0 ||
		request.ConsumerEpoch == 0 ||
		request.PayloadHash.IsZero() ||
		request.Now.IsZero() {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.acknowledge",
			"acknowledgement",
			"contains an invalid item, sequence, epoch, hash, or time",
		)
	}

	return nil
}

func validateRejectRequest(request application.RejectRequest) error {
	if !validEndpoint(request.Recipient) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.reject",
			"recipient",
			"must contain a PTID and device ID",
		)
	}
	if strings.TrimSpace(request.ItemID) == "" ||
		request.LaneSequence <= 0 ||
		request.ConsumerEpoch == 0 ||
		!request.Code.Valid() ||
		request.Retryable != request.Code.Retryable() ||
		request.MaxAttempts == 0 ||
		request.MaxAttempts > application.MaximumRetryAttempts ||
		request.Now.IsZero() {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.reject",
			"rejection",
			"contains an invalid item, sequence, epoch, code, retry bound, or time",
		)
	}
	if request.Retryable &&
		(request.BaseRetryDelay <= 0 ||
			request.MaxRetryDelay < request.BaseRetryDelay) {
		return application.NewError(
			application.ErrorCodeInvalidArgument,
			"delivery_repository.reject",
			"retry_delay",
			"must define positive ordered bounds",
		)
	}

	return nil
}

func lockOrCreateLane(
	tx *gorm.DB,
	recipient valueobject.Endpoint,
) (*DeviceQueueLaneModel, error) {
	lane := &DeviceQueueLaneModel{
		RecipientPTID:     string(recipient.Actor),
		RecipientDeviceID: string(recipient.Device),
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(lane).Error; err != nil {
		return nil, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ?",
			string(recipient.Actor),
			string(recipient.Device),
		).
		First(lane).Error; err != nil {
		return nil, err
	}

	return lane, nil
}

func findIdempotentItem(
	tx *gorm.DB,
	recipient valueobject.Endpoint,
	idempotencyKey string,
) (*DeviceQueueItemModel, bool, error) {
	var model DeviceQueueItemModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND idempotency_key = ?",
			string(recipient.Actor),
			string(recipient.Device),
			idempotencyKey,
		).
		First(&model).Error
	switch {
	case err == nil:
		return &model, true, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil, false, nil
	default:
		return nil, false, err
	}
}

func lockItem(tx *gorm.DB, itemID string) (*DeviceQueueItemModel, error) {
	var item DeviceQueueItemModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("item_id = ?", itemID).
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, application.NewError(
			application.ErrorCodeItemNotFound,
			"delivery_repository.lock_item",
			"item_id",
			"was not found",
		)
	}
	if err != nil {
		return nil, err
	}

	return &item, nil
}

func (r *Repository) checkQuota(
	tx *gorm.DB,
	recipient valueobject.Endpoint,
	incomingBytes int64,
) error {
	var usage struct {
		Items int64
		Bytes int64
	}
	if err := tx.Model(&DeviceQueueItemModel{}).
		Select("COUNT(*) AS items, COALESCE(SUM(LENGTH(opaque_payload)), 0) AS bytes").
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND state != ?",
			string(recipient.Actor),
			string(recipient.Device),
			storageStateAcked,
		).
		Scan(&usage).Error; err != nil {
		return err
	}
	if usage.Items+1 > r.limits.MaxUnackedItems ||
		usage.Bytes+incomingBytes > r.limits.MaxUnackedBytes {
		return application.NewError(
			application.ErrorCodeQuotaExceeded,
			"delivery_repository.enqueue",
			"queue",
			"would exceed the per-device unacknowledged quota",
		)
	}

	return nil
}

func matchesEnqueueRequest(
	model *DeviceQueueItemModel,
	request application.EnqueueRequest,
) bool {
	return model.ItemID == request.ItemID &&
		model.EventID == string(request.EventID) &&
		model.EventSequence == uint64(request.EventSequence) &&
		model.ConversationID == string(request.ConversationID) &&
		model.PayloadType == int32(request.PayloadType) &&
		bytes.Equal(model.OpaquePayload, request.OpaquePayload) &&
		bytes.Equal(model.PayloadSHA256, request.PayloadHash.Bytes())
}

func payloadMatches(model *DeviceQueueItemModel) bool {
	if len(model.PayloadSHA256) != sha256.Size {
		return false
	}
	actual := sha256.Sum256(model.OpaquePayload)

	return bytes.Equal(model.PayloadSHA256, actual[:])
}

func markDeadLetter(model *DeviceQueueItemModel, code application.RejectCode) {
	model.State = storageStateDeadLetter
	model.LastErrorCode = string(code)
	model.LeaseConsumerID = ""
	model.LeaseConsumerEpoch = 0
	model.LeaseExpiresAt = nil
}

func advanceConsumerEpoch(
	tx *gorm.DB,
	lane *DeviceQueueLaneModel,
	consumerID string,
) error {
	if lane.ActiveConsumerEpoch == math.MaxUint64 {
		return application.NewError(
			application.ErrorCodePersistence,
			"delivery_repository.claim",
			"consumer_epoch",
			"is exhausted",
		)
	}
	lane.ActiveConsumerID = consumerID
	lane.ActiveConsumerEpoch++

	return tx.Save(lane).Error
}

func replayRejectResult(
	item *DeviceQueueItemModel,
	request application.RejectRequest,
) (application.RejectResult, error) {
	if item.LastRejectConsumerEpoch != request.ConsumerEpoch ||
		item.LastErrorCode != string(request.Code) {
		return application.RejectResult{}, application.NewError(
			application.ErrorCodeIdempotencyConflict,
			"delivery_repository.reject",
			"rejection",
			"conflicts with the persisted rejection outcome",
		)
	}

	switch item.State {
	case storageStateRetryWait:
		nextAttemptAt := item.NextAttemptAt.UTC()

		return application.RejectResult{
			State:         application.ItemStateRetryWait,
			NextAttemptAt: &nextAttemptAt,
		}, nil
	case storageStateDeadLetter:
		return application.RejectResult{
			State: application.ItemStateDeadLetter,
		}, nil
	default:
		return application.RejectResult{}, application.NewError(
			application.ErrorCodePersistence,
			"delivery_repository.reject",
			"state",
			"is not a persisted rejection outcome",
		)
	}
}

func retryDelay(attempt uint32, base time.Duration, maximum time.Duration) time.Duration {
	delay := base
	for current := uint32(1); current < attempt; current++ {
		if delay >= maximum/2 {
			return maximum
		}
		delay *= 2
	}
	if delay > maximum {
		return maximum
	}

	return delay
}

func modelToItem(model *DeviceQueueItemModel) (application.Item, error) {
	if !validEndpoint(valueobject.Endpoint{
		Actor:  valueobject.PTID(model.RecipientPTID),
		Device: valueobject.DeviceID(model.RecipientDeviceID),
	}) ||
		model.LaneSequence <= 0 ||
		model.EventSequence == 0 ||
		!validPayloadType(application.PayloadType(model.PayloadType)) ||
		model.FirstQueuedAt.IsZero() ||
		model.NextAttemptAt.IsZero() {
		return application.Item{}, application.NewError(
			application.ErrorCodePersistence,
			"delivery_repository.model_to_item",
			"item",
			"violates the canonical durable item contract",
		)
	}
	payloadHash, err := valueobject.NewHash(model.PayloadSHA256)
	if err != nil {
		return application.Item{}, application.NewError(
			application.ErrorCodePayloadHashMismatch,
			"delivery_repository.model_to_item",
			"payload_sha256",
			"is not a complete SHA-256 digest",
		)
	}
	state, err := applicationState(model.State)
	if err != nil {
		return application.Item{}, err
	}
	lastRejectCode := application.RejectCode(model.LastErrorCode)
	if lastRejectCode != "" && !lastRejectCode.Valid() {
		return application.Item{}, application.NewError(
			application.ErrorCodePersistence,
			"delivery_repository.model_to_item",
			"last_error_code",
			"is not supported",
		)
	}
	if state == application.ItemStateClaimed &&
		(model.LeaseConsumerID == "" ||
			model.LeaseConsumerEpoch == 0 ||
			model.LeaseExpiresAt == nil) {
		return application.Item{}, application.NewError(
			application.ErrorCodePersistence,
			"delivery_repository.model_to_item",
			"lease",
			"is incomplete for a claimed item",
		)
	}
	item := application.Item{
		ItemID: model.ItemID,
		Recipient: valueobject.Endpoint{
			Actor:  valueobject.PTID(model.RecipientPTID),
			Device: valueobject.DeviceID(model.RecipientDeviceID),
		},
		LaneSequence:   model.LaneSequence,
		EventID:        valueobject.EventID(model.EventID),
		EventSequence:  valueobject.Sequence(model.EventSequence),
		ConversationID: valueobject.ConversationID(model.ConversationID),
		IdempotencyKey: model.IdempotencyKey,
		PayloadType:    application.PayloadType(model.PayloadType),
		OpaquePayload:  append([]byte(nil), model.OpaquePayload...),
		PayloadHash:    payloadHash,
		State:          state,
		AttemptCount:   model.AttemptCount,
		FirstQueuedAt:  model.FirstQueuedAt,
		NextAttemptAt:  model.NextAttemptAt,
		LastRejectCode: lastRejectCode,
	}
	if model.LeaseExpiresAt != nil {
		item.Lease = &application.Lease{
			ConsumerID:    model.LeaseConsumerID,
			ConsumerEpoch: model.LeaseConsumerEpoch,
			ExpiresAt:     *model.LeaseExpiresAt,
		}
	}
	item.ExpiresAt = cloneTime(model.ExpiresAt)
	item.ConsumedAt = cloneTime(model.ConsumedAt)
	item.AckedAt = cloneTime(model.AckedAt)

	return item, nil
}

func applicationState(storageState int32) (application.ItemState, error) {
	switch storageState {
	case storageStatePending:
		return application.ItemStatePending, nil
	case storageStateClaimed:
		return application.ItemStateClaimed, nil
	case storageStateRetryWait:
		return application.ItemStateRetryWait, nil
	case storageStateConsumed:
		return application.ItemStateConsumed, nil
	case storageStateAcked:
		return application.ItemStateAcked, nil
	case storageStateDeadLetter:
		return application.ItemStateDeadLetter, nil
	default:
		return "", application.NewError(
			application.ErrorCodePersistence,
			"delivery_repository.application_state",
			"state",
			fmt.Sprintf("contains unsupported durable value %d", storageState),
		)
	}
}

func validPayloadType(payloadType application.PayloadType) bool {
	switch payloadType {
	case application.PayloadTypeConversationEvent,
		application.PayloadTypeDirectSessionInit,
		application.PayloadTypeMLSTransition,
		application.PayloadTypeCommandResult,
		application.PayloadTypeDeviceReceipt:
		return true
	default:
		return false
	}
}

func validEndpoint(endpoint valueobject.Endpoint) bool {
	actor := string(endpoint.Actor)
	device := string(endpoint.Device)
	if endpoint.Validate() != nil {
		return false
	}

	return strings.TrimSpace(actor) == actor &&
		strings.TrimSpace(device) == device
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)

	return err == nil && len(decoded) == sha256.Size
}

func ownedBy(model *DeviceQueueItemModel, recipient valueobject.Endpoint) bool {
	return model.RecipientPTID == string(recipient.Actor) &&
		model.RecipientDeviceID == string(recipient.Device)
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value

	return &cloned
}

var _ application.Repository = (*Repository)(nil)
