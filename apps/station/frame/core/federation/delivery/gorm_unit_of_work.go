package delivery

import (
	"bytes"
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Receive atomically persists one inbox receipt and the registered domain mutation.
func (r *GORMRepository) Receive(
	ctx context.Context,
	frame *Frame,
	receivedAt time.Time,
	dispatch Dispatch,
) (Result, error) {
	if frame == nil || dispatch == nil {
		return Result{}, NewError(FailureInvalidArgument, "receive frame transaction", errorsText("frame and dispatch are required"))
	}
	if receivedAt.IsZero() {
		return Result{}, NewError(FailureInvalidArgument, "receive frame transaction", errorsText("receive time is required"))
	}
	identity, err := newFrameIdentity(frame)
	if err != nil {
		return Result{}, err
	}
	receivedAt = receivedAt.UTC()
	var outcome Result
	var deliveryTransaction *gormTransaction
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		receipt := &InboxRecord{
			SourceStationPeerID: identity.sourceStationPeerID,
			IdempotencyKey:      identity.idempotencyKey,
			FrameID:             identity.frameID,
			PayloadKind:         int32(frame.PayloadKind),
			PayloadID:           frame.PayloadId,
			PayloadSHA256:       identity.payloadSHA256,
			CanonicalSHA256:     identity.canonicalSHA256,
			Disposition:         DispositionUnspecified,
			ErrorCode:           FrameErrorUnspecified,
			ReceivedAt:          receivedAt,
			CompletedAt:         receivedAt,
		}
		create := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(receipt)
		if create.Error != nil {
			return NewError(FailurePersistence, "insert inbox receipt", create.Error)
		}
		if create.RowsAffected == 0 {
			storedOutcome, classifyErr := classifyInboxConflict(tx, identity)
			if classifyErr != nil {
				return classifyErr
			}
			outcome = storedOutcome
			return nil
		}

		deliveryTransaction = &gormTransaction{db: tx}
		outcome, err = dispatch(ctx, deliveryTransaction, frame)
		if err != nil {
			return err
		}
		if err := validateResult(outcome); err != nil {
			return err
		}
		if outcome.Disposition == DispositionRetryable {
			return rollbackRetryable
		}
		update := tx.Model(&InboxRecord{}).
			Where(
				"source_station_peer_id = ? AND idempotency_key = ?",
				identity.sourceStationPeerID,
				identity.idempotencyKey,
			).
			Updates(map[string]interface{}{
				"disposition":  outcome.Disposition,
				"error_code":   outcome.ErrorCode,
				"completed_at": receivedAt,
			})
		if update.Error != nil {
			return NewError(FailurePersistence, "complete inbox receipt", update.Error)
		}
		if update.RowsAffected != 1 {
			return NewError(FailurePersistence, "complete inbox receipt", errorsText("receipt disappeared"))
		}
		return nil
	})
	var afterCommit []AfterCommitFunc
	if deliveryTransaction != nil {
		afterCommit = deliveryTransaction.close()
	}
	if errors.Is(err, rollbackRetryable) {
		return outcome, nil
	}
	if err != nil {
		return Result{}, err
	}
	var afterCommitErrors []error
	for _, callback := range afterCommit {
		if callbackErr := callback(ctx); callbackErr != nil {
			afterCommitErrors = append(afterCommitErrors, callbackErr)
		}
	}
	if afterCommitErr := errors.Join(afterCommitErrors...); afterCommitErr != nil {
		return outcome, NewError(
			FailureDomainDispatch,
			"run post-commit callback",
			afterCommitErr,
		)
	}
	return outcome, nil
}

func classifyInboxConflict(db *gorm.DB, identity frameIdentity) (Result, error) {
	var byIdempotency InboxRecord
	idempotencyErr := db.Where(
		"source_station_peer_id = ? AND idempotency_key = ?",
		identity.sourceStationPeerID,
		identity.idempotencyKey,
	).First(&byIdempotency).Error
	if idempotencyErr == nil {
		return replayResult(byIdempotency, identity)
	}
	if !errors.Is(idempotencyErr, gorm.ErrRecordNotFound) {
		return Result{}, NewError(FailurePersistence, "load inbox idempotency receipt", idempotencyErr)
	}

	var byFrame InboxRecord
	frameErr := db.Where("frame_id = ?", identity.frameID).First(&byFrame).Error
	if frameErr == nil {
		return replayResult(byFrame, identity)
	}
	if !errors.Is(frameErr, gorm.ErrRecordNotFound) {
		return Result{}, NewError(FailurePersistence, "load inbox frame receipt", frameErr)
	}
	return Result{}, NewError(FailurePersistence, "classify inbox conflict", errorsText("conflicting row was not found"))
}

func replayResult(record InboxRecord, identity frameIdentity) (Result, error) {
	if !inboxIdentityMatches(record, identity) {
		return PayloadHashConflictResult(), nil
	}
	switch record.Disposition {
	case DispositionAccepted, DispositionDuplicate:
		return DuplicateResult(), nil
	case DispositionTerminal:
		return TerminalResult(record.ErrorCode), nil
	case DispositionPayloadHashConflict:
		return PayloadHashConflictResult(), nil
	default:
		return Result{}, NewError(
			FailurePersistence,
			"classify inbox replay",
			errorsText("stored receipt has a nonterminal disposition"),
		)
	}
}

func inboxIdentityMatches(record InboxRecord, identity frameIdentity) bool {
	return record.SourceStationPeerID == identity.sourceStationPeerID &&
		record.IdempotencyKey == identity.idempotencyKey &&
		record.FrameID == identity.frameID &&
		bytes.Equal(record.PayloadSHA256, identity.payloadSHA256) &&
		bytes.Equal(record.CanonicalSHA256, identity.canonicalSHA256)
}

type gormTransaction struct {
	db          *gorm.DB
	afterCommit []AfterCommitFunc
	closed      bool
}

func (t *gormTransaction) DB() *gorm.DB {
	return t.db
}

func (t *gormTransaction) Outbox() OutboxWriter {
	return &gormOutboxWriter{db: t.db}
}

func (t *gormTransaction) AfterCommit(callback AfterCommitFunc) error {
	if t == nil || callback == nil {
		return NewError(
			FailureInvalidArgument,
			"register post-commit callback",
			errorsText("transaction and callback are required"),
		)
	}
	if t.closed {
		return NewError(
			FailureInvalidArgument,
			"register post-commit callback",
			errorsText("transaction is already closed"),
		)
	}
	t.afterCommit = append(t.afterCommit, callback)

	return nil
}

func (t *gormTransaction) close() []AfterCommitFunc {
	if t == nil || t.closed {
		return nil
	}
	t.closed = true
	callbacks := append([]AfterCommitFunc(nil), t.afterCommit...)
	t.afterCommit = nil

	return callbacks
}

type gormOutboxWriter struct {
	db *gorm.DB
}

func (w *gormOutboxWriter) Enqueue(
	ctx context.Context,
	frame *Frame,
	now time.Time,
) (EnqueueResult, error) {
	return enqueueFrame(ctx, w.db, frame, now)
}

var (
	rollbackRetryable            = errors.New("rollback retryable frame")
	_                 UnitOfWork = (*GORMRepository)(nil)
)
