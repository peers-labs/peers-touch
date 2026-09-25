package events

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	callRingWindow          = 45 * time.Second
	callResolutionRetention = 10 * time.Minute
	callIDPastSkew          = 30 * time.Second
	callIDFutureSkew        = 10 * time.Second

	callStateOpen     = "OPEN"
	callStateAccepted = "ACCEPTED"
	callStateRejected = "REJECTED"
	callStateNoAnswer = "NO_ANSWER"
)

var (
	errCallResolutionConflict = errors.New("call resolution request conflicts with the durable record")
	errCallResolutionExpired  = errors.New("call resolution deadline expired")
	errCallResolutionNotFound = errors.New("call resolution record not found")
)

type callResolutionModel struct {
	CalleeActorPTID string     `gorm:"column:callee_actor_ptid;size:255;primaryKey"`
	CallID          string     `gorm:"column:call_id;size:26;primaryKey"`
	State           string     `gorm:"column:state;size:16;not null;index"`
	CallerActorPTID string     `gorm:"column:caller_actor_ptid;size:255;not null;index"`
	SessionULID     string     `gorm:"column:session_ulid;size:512;not null"`
	RequestSHA256   []byte     `gorm:"column:request_sha256;type:bytea;not null"`
	WinningDeviceID string     `gorm:"column:winning_device_id;size:255"`
	TerminalAction  string     `gorm:"column:terminal_action;size:16"`
	RingDeadline    time.Time  `gorm:"column:ring_deadline;not null;index"`
	ResolvedAt      *time.Time `gorm:"column:resolved_at"`
	ExpiresAt       time.Time  `gorm:"column:expires_at;not null;index"`
	CreatedAt       time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;not null"`
}

func (callResolutionModel) TableName() string {
	return "realtime_call_resolutions"
}

type callResolutionResult struct {
	record         callResolutionModel
	created        bool
	won            bool
	idempotent     bool
	becameNoAnswer bool
}

type callResolutionStore struct {
	db  *gorm.DB
	now func() time.Time
}

func newCallResolutionStore(db *gorm.DB) *callResolutionStore {
	return &callResolutionStore{
		db:  db,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (s *callResolutionStore) AutoMigrate() error {
	if s == nil || s.db == nil {
		return errors.New("events: call resolution database is required")
	}
	return s.db.AutoMigrate(&callResolutionModel{})
}

func (s *callResolutionStore) open(
	ctx context.Context,
	callerActorPTID string,
	calleeActorPTID string,
	sessionULID string,
	callID string,
	requestSHA256 []byte,
) (callResolutionResult, error) {
	now := s.now()
	if callerActorPTID == "" || calleeActorPTID == "" || sessionULID == "" ||
		callID == "" || len(requestSHA256) != sha256.Size {
		return callResolutionResult{}, errors.New(
			"events: invalid call resolution request",
		)
	}
	existing, existingErr := s.load(ctx, calleeActorPTID, callID)
	if existingErr == nil {
		if existing.CallerActorPTID != callerActorPTID ||
			existing.SessionULID != sessionULID ||
			!bytes.Equal(existing.RequestSHA256, requestSHA256) ||
			existing.State != callStateOpen {
			return callResolutionResult{
				record: existing,
			}, errCallResolutionConflict
		}
		return callResolutionResult{
			record:     existing,
			idempotent: true,
		}, nil
	}
	if !errors.Is(existingErr, errCallResolutionNotFound) {
		return callResolutionResult{}, existingErr
	}
	issuedAt, err := validateCallID(callID, now)
	if err != nil {
		return callResolutionResult{}, err
	}
	record := callResolutionModel{
		CalleeActorPTID: calleeActorPTID,
		CallID:          callID,
		State:           callStateOpen,
		CallerActorPTID: callerActorPTID,
		SessionULID:     sessionULID,
		RequestSHA256:   append([]byte(nil), requestSHA256...),
		RingDeadline:    issuedAt.Add(callRingWindow),
		ExpiresAt:       issuedAt.Add(callRingWindow + callResolutionRetention),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	result := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&record)
	if result.Error != nil {
		return callResolutionResult{}, fmt.Errorf("create call resolution: %w", result.Error)
	}
	if result.RowsAffected == 1 {
		return callResolutionResult{record: record, created: true}, nil
	}
	existing, err = s.load(ctx, calleeActorPTID, callID)
	if err != nil {
		return callResolutionResult{}, err
	}
	if existing.CallerActorPTID != callerActorPTID ||
		existing.SessionULID != sessionULID ||
		!bytes.Equal(existing.RequestSHA256, requestSHA256) {
		return callResolutionResult{record: existing}, errCallResolutionConflict
	}
	if existing.State != callStateOpen {
		return callResolutionResult{record: existing}, errCallResolutionConflict
	}
	return callResolutionResult{record: existing, idempotent: true}, nil
}

func (s *callResolutionStore) resolve(
	ctx context.Context,
	calleeActorPTID string,
	callerActorPTID string,
	sessionULID string,
	callID string,
	deviceID string,
	action string,
) (callResolutionResult, error) {
	if action != "accept" && action != "reject" {
		return callResolutionResult{}, errors.New("events: invalid terminal call action")
	}
	if calleeActorPTID == "" || callerActorPTID == "" || sessionULID == "" || callID == "" || deviceID == "" {
		return callResolutionResult{}, errors.New("events: incomplete terminal call action")
	}
	now := s.now()
	state := callStateAccepted
	if action == "reject" {
		state = callStateRejected
	}

	var resolved callResolutionModel
	won := false
	becameNoAnswer := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		update := tx.Model(&callResolutionModel{}).
			Where(
				"callee_actor_ptid = ? AND call_id = ? AND caller_actor_ptid = ? AND session_ulid = ? AND state = ? AND ring_deadline > ?",
				calleeActorPTID,
				callID,
				callerActorPTID,
				sessionULID,
				callStateOpen,
				now,
			).
			Updates(map[string]any{
				"state":             state,
				"winning_device_id": deviceID,
				"terminal_action":   action,
				"resolved_at":       now,
				"updated_at":        now,
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected == 1 {
			won = true
			return tx.Where(
				"callee_actor_ptid = ? AND call_id = ?",
				calleeActorPTID,
				callID,
			).First(&resolved).Error
		}

		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"callee_actor_ptid = ? AND call_id = ?",
				calleeActorPTID,
				callID,
			).
			First(&resolved).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCallResolutionNotFound
			}
			return err
		}
		if resolved.State == callStateOpen && !resolved.RingDeadline.After(now) {
			resolvedAt := now
			update := tx.Model(&resolved).
				Where("state = ?", callStateOpen).
				Updates(map[string]any{
					"state":           callStateNoAnswer,
					"terminal_action": "no_answer",
					"resolved_at":     resolvedAt,
					"updated_at":      resolvedAt,
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected == 1 {
				resolved.State = callStateNoAnswer
				resolved.TerminalAction = "no_answer"
				resolved.ResolvedAt = &resolvedAt
				becameNoAnswer = true
			}
		}
		return nil
	})
	if err != nil {
		return callResolutionResult{}, fmt.Errorf("resolve call: %w", err)
	}
	if resolved.CallerActorPTID != callerActorPTID || resolved.SessionULID != sessionULID {
		return callResolutionResult{}, errCallResolutionConflict
	}
	if won {
		return callResolutionResult{record: resolved, won: true}, nil
	}
	if resolved.State == state &&
		resolved.WinningDeviceID == deviceID &&
		resolved.TerminalAction == action {
		return callResolutionResult{record: resolved, idempotent: true}, nil
	}
	if resolved.State == callStateNoAnswer {
		return callResolutionResult{
			record:         resolved,
			becameNoAnswer: becameNoAnswer,
		}, errCallResolutionExpired
	}
	if resolved.State != state || resolved.WinningDeviceID != deviceID {
		return callResolutionResult{record: resolved}, errCallResolutionConflict
	}
	return callResolutionResult{record: resolved, won: true}, nil
}

func (s *callResolutionStore) getForActor(
	ctx context.Context,
	actorPTID string,
	callID string,
) (callResolutionResult, error) {
	if actorPTID == "" || callID == "" {
		return callResolutionResult{}, errCallResolutionNotFound
	}
	now := s.now()
	var record callResolutionModel
	becameNoAnswer := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"call_id = ? AND (caller_actor_ptid = ? OR callee_actor_ptid = ?)",
			callID,
			actorPTID,
			actorPTID,
		)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&record).Error; err != nil {
			return err
		}
		if record.State != callStateOpen || record.RingDeadline.After(now) {
			return nil
		}
		resolvedAt := now
		update := tx.Model(&callResolutionModel{}).
			Where(
				"callee_actor_ptid = ? AND call_id = ? AND state = ?",
				record.CalleeActorPTID,
				record.CallID,
				callStateOpen,
			).
			Updates(map[string]any{
				"state":           callStateNoAnswer,
				"terminal_action": "no_answer",
				"resolved_at":     resolvedAt,
				"updated_at":      resolvedAt,
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected == 1 {
			record.State = callStateNoAnswer
			record.TerminalAction = "no_answer"
			record.ResolvedAt = &resolvedAt
			becameNoAnswer = true
		}
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return callResolutionResult{}, errCallResolutionNotFound
	}
	if err != nil {
		return callResolutionResult{}, fmt.Errorf("load call resolution for actor: %w", err)
	}
	return callResolutionResult{
		record:         record,
		becameNoAnswer: becameNoAnswer,
	}, nil
}

func (s *callResolutionStore) load(
	ctx context.Context,
	calleeActorPTID string,
	callID string,
) (callResolutionModel, error) {
	var record callResolutionModel
	err := s.db.WithContext(ctx).
		Where(
			"callee_actor_ptid = ? AND call_id = ?",
			calleeActorPTID,
			callID,
		).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return callResolutionModel{}, errCallResolutionNotFound
	}
	if err != nil {
		return callResolutionModel{}, fmt.Errorf("load call resolution: %w", err)
	}
	return record, nil
}

func (s *callResolutionStore) sweep(
	ctx context.Context,
) ([]callResolutionModel, error) {
	now := s.now()
	expired, err := s.expireOpen(ctx, now)
	if err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).
		Where("expires_at <= ?", now).
		Delete(&callResolutionModel{}).Error; err != nil {
		return nil, fmt.Errorf("delete expired call resolutions: %w", err)
	}
	return expired, nil
}

func (s *callResolutionStore) expireOpen(
	ctx context.Context,
	now time.Time,
) ([]callResolutionModel, error) {
	expired := make([]callResolutionModel, 0)
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"state = ? AND ring_deadline <= ?",
			callStateOpen,
			now,
		).Order("ring_deadline ASC, callee_actor_ptid ASC, call_id ASC")
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{
				Strength: "UPDATE",
				Options:  "SKIP LOCKED",
			})
		}
		var due []callResolutionModel
		if err := query.Find(&due).Error; err != nil {
			return err
		}
		for index := range due {
			record := due[index]
			resolvedAt := now
			update := tx.Model(&callResolutionModel{}).
				Where(
					"callee_actor_ptid = ? AND call_id = ? AND state = ?",
					record.CalleeActorPTID,
					record.CallID,
					callStateOpen,
				).
				Updates(map[string]any{
					"state":           callStateNoAnswer,
					"terminal_action": "no_answer",
					"resolved_at":     resolvedAt,
					"updated_at":      resolvedAt,
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected == 0 {
				continue
			}
			record.State = callStateNoAnswer
			record.TerminalAction = "no_answer"
			record.ResolvedAt = &resolvedAt
			record.UpdatedAt = resolvedAt
			expired = append(expired, record)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("expire unanswered calls: %w", err)
	}
	return expired, nil
}

func validateCallID(callID string, now time.Time) (time.Time, error) {
	parsed, err := ulid.ParseStrict(callID)
	if err != nil {
		return time.Time{}, errors.New("events: call_id must be a ULID")
	}
	issuedAt := time.UnixMilli(int64(parsed.Time())).UTC()
	if issuedAt.Before(now.Add(-callIDPastSkew)) || issuedAt.After(now.Add(callIDFutureSkew)) {
		return time.Time{}, errCallResolutionExpired
	}
	return issuedAt, nil
}

func callRequestDigest(
	callerActorPTID string,
	calleeActorPTID string,
	sessionULID string,
	callID string,
	payload []byte,
) []byte {
	hash := sha256.New()
	for _, value := range []string{
		callerActorPTID,
		calleeActorPTID,
		sessionULID,
		callID,
	} {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	_, _ = hash.Write(payload)
	return hash.Sum(nil)
}
