package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/gorm"
)

const (
	defaultAgentRealtimeRelayPollInterval = 100 * time.Millisecond
	defaultAgentRealtimeRelayLeaseTTL     = 30 * time.Second
	maxAgentRealtimeRelayRetryDelay       = 30 * time.Second
)

type AgentRealtimePublisher interface {
	Publish(actorPTID string, event *realtime.StreamEvent) (string, error)
}

type AgentRealtimePublisherResolver func() AgentRealtimePublisher

// AgentRealtimeRelay is the sole Agent adapter into the shared realtime bus.
// It claims one per-actor head row at a time so a failed predecessor cannot be
// overtaken by later progress.
type AgentRealtimeRelay struct {
	db               *gorm.DB
	resolvePublisher AgentRealtimePublisherResolver
	leaseOwner       string
	now              func() time.Time
	pollInterval     time.Duration
	leaseTTL         time.Duration
	retryDelay       func(uint32) time.Duration
}

func NewAgentRealtimeRelay(
	db *gorm.DB,
	resolvePublisher AgentRealtimePublisherResolver,
) *AgentRealtimeRelay {
	return &AgentRealtimeRelay{
		db:               db,
		resolvePublisher: resolvePublisher,
		leaseOwner:       generateID("relay"),
		now:              func() time.Time { return time.Now().UTC() },
		pollInterval:     defaultAgentRealtimeRelayPollInterval,
		leaseTTL:         defaultAgentRealtimeRelayLeaseTTL,
		retryDelay:       agentRealtimeRetryDelay,
	}
}

func (r *AgentRealtimeRelay) Run(ctx context.Context) {
	if r == nil || r.db == nil {
		return
	}
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		attempted, err := r.DeliverNext(ctx)
		if err != nil {
			logger.Warnf(ctx, "agent realtime relay delivery failed: %v", err)
		}
		delay := r.pollInterval
		if attempted && err == nil {
			delay = 0
		}
		timer.Reset(delay)
	}
}

// DeliverNext claims and attempts one delivery. attempted reports whether a
// row was claimed; a publish error leaves that row pending with the same
// realtime event id and actor sequence.
func (r *AgentRealtimeRelay) DeliverNext(ctx context.Context) (attempted bool, err error) {
	if r == nil || r.db == nil {
		return false, fmt.Errorf("agent realtime relay database is unavailable")
	}
	now := r.now().UTC()
	row, err := r.claimNext(ctx, now)
	if err != nil || row == nil {
		return false, err
	}

	envelope := agentRealtimeEnvelope(row)
	if envelope.GetEventId() == "" {
		err := fmt.Errorf(
			"agent realtime envelope cursor is empty: row=%s envelope=%s",
			row.RealtimeEventID,
			envelope.GetEventId(),
		)
		if releaseErr := r.releaseForRetry(ctx, row, now, err); releaseErr != nil {
			return true, releaseErr
		}
		return true, err
	}

	var publisher AgentRealtimePublisher
	if r.resolvePublisher != nil {
		publisher = r.resolvePublisher()
	}
	if publisher == nil {
		err := fmt.Errorf("shared realtime EventBus is unavailable")
		if releaseErr := r.releaseForRetry(ctx, row, now, err); releaseErr != nil {
			return true, releaseErr
		}
		return true, err
	}
	cursor, publishErr := publisher.Publish(row.TargetActorPTID, envelope)
	if publishErr != nil {
		if releaseErr := r.releaseForRetry(
			ctx,
			row,
			now,
			publishErr,
		); releaseErr != nil {
			return true, releaseErr
		}
		return true, publishErr
	}
	if cursor != row.RealtimeEventID {
		err := fmt.Errorf(
			"shared realtime EventBus changed committed cursor: got=%s want=%s",
			cursor,
			row.RealtimeEventID,
		)
		if releaseErr := r.releaseForRetry(ctx, row, now, err); releaseErr != nil {
			return true, releaseErr
		}
		return true, err
	}
	if err := r.markDelivered(ctx, row, now, cursor); err != nil {
		return true, err
	}
	return true, nil
}

func agentRealtimeEnvelope(
	row *persistence.AgentRealtimeOutbox,
) *realtime.StreamEvent {
	if row == nil {
		return &realtime.StreamEvent{}
	}
	return &realtime.StreamEvent{
		EventId:  row.RealtimeEventID,
		TsUnixMs: row.CommittedAt.UnixMilli(),
		Kind: &realtime.StreamEvent_AgentDomainEvent{
			AgentDomainEvent: &realtime.AgentDomainEvent{
				DomainEventId:     row.DomainEventID,
				DomainSequence:    row.DomainSequence,
				SchemaVersion:     1,
				EventType:         row.EventType,
				GoalId:            row.GoalID,
				TaskId:            row.TaskID,
				GoalRevision:      row.GoalRevision,
				CommittedTsUnixMs: row.CommittedAt.UnixMilli(),
			},
		},
	}
}

func (r *AgentRealtimeRelay) claimNext(
	ctx context.Context,
	now time.Time,
) (*persistence.AgentRealtimeOutbox, error) {
	var claimed *persistence.AgentRealtimeOutbox
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		heads := tx.Model(&persistence.AgentRealtimeOutbox{}).
			Select("target_actor_ptid, MIN(actor_sequence) AS actor_sequence").
			Where("state <> ?", persistence.AgentRealtimeOutboxDelivered).
			Group("target_actor_ptid")

		var candidate persistence.AgentRealtimeOutbox
		result := tx.Table("agent_realtime_outbox AS candidate").
			Select("candidate.*").
			Joins(
				"JOIN (?) AS heads ON heads.target_actor_ptid = candidate.target_actor_ptid AND heads.actor_sequence = candidate.actor_sequence",
				heads,
			).
			Where(
				"(candidate.state = ? AND candidate.next_attempt_at <= ?) OR (candidate.state = ? AND candidate.lease_expires_at <= ?)",
				persistence.AgentRealtimeOutboxPending,
				now,
				persistence.AgentRealtimeOutboxLeased,
				now,
			).
			Order("candidate.created_at ASC, candidate.target_actor_ptid ASC").
			Limit(1).
			Find(&candidate)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}

		leaseExpiresAt := now.Add(r.leaseTTL)
		nextGeneration := candidate.LeaseGeneration + 1
		result = tx.Model(&persistence.AgentRealtimeOutbox{}).
			Where(
				"outbox_id = ? AND state = ? AND lease_generation = ?",
				candidate.OutboxID,
				candidate.State,
				candidate.LeaseGeneration,
			).
			Updates(map[string]any{
				"state":            persistence.AgentRealtimeOutboxLeased,
				"lease_owner":      r.leaseOwner,
				"lease_generation": nextGeneration,
				"lease_expires_at": leaseExpiresAt,
				"updated_at":       now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		candidate.State = persistence.AgentRealtimeOutboxLeased
		candidate.LeaseOwner = r.leaseOwner
		candidate.LeaseGeneration = nextGeneration
		candidate.LeaseExpiresAt = &leaseExpiresAt
		candidate.UpdatedAt = now
		claimed = &candidate
		return nil
	})
	return claimed, err
}

func (r *AgentRealtimeRelay) releaseForRetry(
	ctx context.Context,
	row *persistence.AgentRealtimeOutbox,
	now time.Time,
	deliveryErr error,
) error {
	nextAttempt := now.Add(r.retryDelay(row.AttemptCount + 1))
	lastError := strings.TrimSpace(deliveryErr.Error())
	if len(lastError) > 2048 {
		lastError = lastError[:2048]
	}
	result := r.db.WithContext(ctx).
		Model(&persistence.AgentRealtimeOutbox{}).
		Where(
			"outbox_id = ? AND state = ? AND lease_owner = ? AND lease_generation = ?",
			row.OutboxID,
			persistence.AgentRealtimeOutboxLeased,
			r.leaseOwner,
			row.LeaseGeneration,
		).
		Updates(map[string]any{
			"state":            persistence.AgentRealtimeOutboxPending,
			"attempt_count":    row.AttemptCount + 1,
			"next_attempt_at":  nextAttempt,
			"lease_owner":      "",
			"lease_expires_at": nil,
			"last_error":       lastError,
			"updated_at":       now,
		})
	if result.Error != nil {
		return fmt.Errorf("release agent realtime outbox retry: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("agent realtime relay lost lease before retry")
	}
	return nil
}

func (r *AgentRealtimeRelay) markDelivered(
	ctx context.Context,
	row *persistence.AgentRealtimeOutbox,
	now time.Time,
	cursor string,
) error {
	result := r.db.WithContext(ctx).
		Model(&persistence.AgentRealtimeOutbox{}).
		Where(
			"outbox_id = ? AND state = ? AND lease_owner = ? AND lease_generation = ?",
			row.OutboxID,
			persistence.AgentRealtimeOutboxLeased,
			r.leaseOwner,
			row.LeaseGeneration,
		).
		Updates(map[string]any{
			"state":            persistence.AgentRealtimeOutboxDelivered,
			"realtime_cursor":  cursor,
			"lease_owner":      "",
			"lease_expires_at": nil,
			"last_error":       "",
			"delivered_at":     now,
			"updated_at":       now,
		})
	if result.Error != nil {
		return fmt.Errorf("mark agent realtime outbox delivered: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("agent realtime relay lost lease before delivery marker")
	}
	return nil
}

func agentRealtimeRetryDelay(attempt uint32) time.Duration {
	if attempt == 0 {
		attempt = 1
	}
	shift := attempt - 1
	if shift > 8 {
		shift = 8
	}
	delay := 100 * time.Millisecond * time.Duration(1<<shift)
	if delay > maxAgentRealtimeRelayRetryDelay {
		return maxAgentRealtimeRelayRetryDelay
	}
	return delay
}
