package delivery

import (
	"context"
	"strings"
	"time"
)

// RetryBackoff bounds exponential retry delay without imposing a loss-causing attempt cap.
type RetryBackoff struct {
	Initial time.Duration
	Maximum time.Duration
}

// Delay returns the bounded delay for the one-based attempt number.
func (b RetryBackoff) Delay(attempt uint32) time.Duration {
	if b.Initial <= 0 || b.Maximum < b.Initial {
		return 0
	}
	if attempt <= 1 {
		return b.Initial
	}
	delay := b.Initial
	for count := uint32(1); count < attempt; count++ {
		if delay >= b.Maximum || delay > b.Maximum/2 {
			return b.Maximum
		}
		delay *= 2
	}
	return delay
}

// DispatcherConfig defines bounded claims and retry timing.
type DispatcherConfig struct {
	WorkerID      string
	BatchSize     int
	LeaseDuration time.Duration
	IdleDelay     time.Duration
	RetryBackoff  RetryBackoff
}

// DispatchReport summarizes one bounded claim-and-deliver cycle.
type DispatchReport struct {
	Claimed   int
	Delivered int
	Retried   int
	Terminal  int
	Expired   int
}

// Dispatcher delivers durable outbox rows with lease fencing until immutable expiry.
type Dispatcher struct {
	repository OutboxRepository
	transport  Transport
	config     DispatcherConfig
	clock      Clock
}

// NewDispatcher validates dependencies and creates a bounded dispatcher.
func NewDispatcher(
	repository OutboxRepository,
	transport Transport,
	config DispatcherConfig,
	clock Clock,
) (*Dispatcher, error) {
	if isNil(repository) || isNil(transport) || isNil(clock) {
		return nil, NewError(FailureInvalidArgument, "create dispatcher", errorsText("all dependencies are required"))
	}
	if strings.TrimSpace(config.WorkerID) == "" ||
		config.WorkerID != strings.TrimSpace(config.WorkerID) ||
		config.BatchSize <= 0 ||
		config.BatchSize > MaxClaimBatchSize ||
		config.LeaseDuration <= 0 ||
		config.IdleDelay <= 0 ||
		config.RetryBackoff.Initial <= 0 ||
		config.RetryBackoff.Maximum < config.RetryBackoff.Initial {
		return nil, NewError(FailureInvalidArgument, "create dispatcher", errorsText("dispatcher bounds are invalid"))
	}
	return &Dispatcher{
		repository: repository,
		transport:  transport,
		config:     config,
		clock:      clock,
	}, nil
}

// DispatchOnce claims at most BatchSize rows and resolves every claim with its lease token.
func (d *Dispatcher) DispatchOnce(ctx context.Context) (DispatchReport, error) {
	now := d.clock.Now().UTC()
	claims, err := d.repository.Claim(ctx, ClaimRequest{
		WorkerID:      d.config.WorkerID,
		Limit:         d.config.BatchSize,
		Now:           now,
		LeaseDuration: d.config.LeaseDuration,
	})
	if err != nil {
		return DispatchReport{}, NewError(FailurePersistence, "claim outbox", err)
	}
	report := DispatchReport{Claimed: len(claims)}
	for index := range claims {
		claim := claims[index]
		if err := d.dispatchClaim(ctx, claim, &report); err != nil {
			return report, err
		}
	}
	return report, nil
}

// Run polls until cancellation; context cancellation is a graceful stop.
func (d *Dispatcher) Run(ctx context.Context) error {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timer.C:
			report, err := d.DispatchOnce(ctx)
			if err != nil {
				return err
			}
			delay := time.Duration(0)
			if report.Claimed == 0 {
				delay = d.config.IdleDelay
			}
			timer.Reset(delay)
		}
	}
}

func (d *Dispatcher) dispatchClaim(
	ctx context.Context,
	claim Claim,
	report *DispatchReport,
) error {
	now := d.clock.Now().UTC()
	if claim.Frame == nil {
		return d.markTerminal(ctx, claim.Lease, now, FailureInvalidFrame, report)
	}
	expiresAt := claim.Frame.GetExpiresAt()
	if expiresAt == nil || !expiresAt.AsTime().After(now) {
		if err := d.repository.MarkExpired(ctx, claim.Lease, now); err != nil {
			return NewError(FailurePersistence, "mark outbox expired", err)
		}
		report.Expired++
		return nil
	}

	result, deliveryErr := d.transport.Deliver(ctx, claim.Frame)
	if deliveryErr != nil {
		return d.scheduleRetry(ctx, claim, now, FailureTransportUnavailable, report)
	}
	if err := validateResult(result); err != nil {
		return d.scheduleRetry(ctx, claim, now, FailureInvalidResult, report)
	}
	switch result.Disposition {
	case DispositionAccepted, DispositionDuplicate:
		if err := d.repository.MarkDelivered(ctx, claim.Lease, now); err != nil {
			return NewError(FailurePersistence, "mark outbox delivered", err)
		}
		report.Delivered++
		return nil
	case DispositionRetryable:
		return d.scheduleRetry(ctx, claim, now, failureForFrameCode(result.ErrorCode), report)
	case DispositionTerminal, DispositionPayloadHashConflict:
		return d.markTerminal(ctx, claim.Lease, now, failureForFrameCode(result.ErrorCode), report)
	default:
		return d.scheduleRetry(ctx, claim, now, FailureInvalidResult, report)
	}
}

func (d *Dispatcher) scheduleRetry(
	ctx context.Context,
	claim Claim,
	now time.Time,
	failure FailureCode,
	report *DispatchReport,
) error {
	expiresAt := claim.Frame.ExpiresAt.AsTime()
	nextAttemptAt := now.Add(d.config.RetryBackoff.Delay(claim.AttemptCount))
	if nextAttemptAt.After(expiresAt) {
		nextAttemptAt = expiresAt
	}
	if err := d.repository.ScheduleRetry(ctx, claim.Lease, nextAttemptAt, failure); err != nil {
		return NewError(FailurePersistence, "schedule outbox retry", err)
	}
	report.Retried++
	return nil
}

func (d *Dispatcher) markTerminal(
	ctx context.Context,
	lease Lease,
	now time.Time,
	failure FailureCode,
	report *DispatchReport,
) error {
	if err := d.repository.MarkTerminal(ctx, lease, now, failure); err != nil {
		return NewError(FailurePersistence, "mark outbox terminal", err)
	}
	report.Terminal++
	return nil
}

func failureForFrameCode(code FrameErrorCode) FailureCode {
	switch code {
	case FrameErrorInvalidFrame:
		return FailureInvalidFrame
	case FrameErrorUnauthenticated:
		return FailureUnauthenticated
	case FrameErrorWrongTarget:
		return FailureWrongTarget
	case FrameErrorUnsupportedPayload:
		return FailureUnsupportedPayload
	case FrameErrorPayloadHashConflict:
		return FailurePayloadHashConflict
	case FrameErrorExpired:
		return FailureExpired
	case FrameErrorOverloaded:
		return FailureOverloaded
	case FrameErrorDomainRejected:
		return FailureDomainRejected
	default:
		return FailureInvalidResult
	}
}
