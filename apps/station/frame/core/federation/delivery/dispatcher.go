package delivery

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
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

// DispatchTransition identifies one persisted outbox lifecycle transition.
type DispatchTransition string

const (
	DispatchTransitionDelivered DispatchTransition = "delivered"
	DispatchTransitionRetrying  DispatchTransition = "retrying"
	DispatchTransitionTerminal  DispatchTransition = "terminal"
	DispatchTransitionExpired   DispatchTransition = "expired"
)

// DispatchObservation is emitted only after the corresponding state transition persists.
type DispatchObservation struct {
	PayloadKind PayloadKind
	Transition  DispatchTransition
	Failure     FailureCode
	Attempt     uint32
	Latency     time.Duration
}

// DispatchObserver receives bounded delivery telemetry for one payload kind.
type DispatchObserver interface {
	ObserveDispatch(context.Context, DispatchObservation)
}

// Dispatcher delivers durable outbox rows with lease fencing until immutable expiry.
type Dispatcher struct {
	repository OutboxRepository
	transport  Transport
	config     DispatcherConfig
	clock      Clock
	observers  map[PayloadKind]DispatchObserver
	observerMu sync.RWMutex
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
		observers:  make(map[PayloadKind]DispatchObserver),
	}, nil
}

// RegisterObserver binds one payload kind to exactly one metrics owner.
func (d *Dispatcher) RegisterObserver(
	kind PayloadKind,
	observer DispatchObserver,
) error {
	if kind == PayloadKindUnspecified || isNil(observer) {
		return NewError(
			FailureInvalidArgument,
			"register dispatch observer",
			errorsText("payload kind and observer are required"),
		)
	}
	d.observerMu.Lock()
	defer d.observerMu.Unlock()
	if _, exists := d.observers[kind]; exists {
		return NewError(
			FailureInvalidArgument,
			"register dispatch observer",
			errorsText("payload kind already has an observer"),
		)
	}
	d.observers[kind] = observer
	return nil
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
		return d.markTerminal(ctx, claim, now, FailureInvalidFrame, report)
	}
	if traceID := strings.TrimSpace(claim.Frame.GetTraceId()); traceID != "" {
		ctx = logger.WithTraceID(ctx, traceID)
	}
	expiresAt := claim.Frame.GetExpiresAt()
	if expiresAt == nil || !expiresAt.AsTime().After(now) {
		if err := d.repository.MarkExpired(ctx, claim.Lease, now); err != nil {
			return NewError(FailurePersistence, "mark outbox expired", err)
		}
		report.Expired++
		d.observe(ctx, claim, DispatchTransitionExpired, FailureExpired, now)
		return nil
	}

	result, deliveryErr := d.transport.Deliver(ctx, claim.Frame)
	transitionAt := d.clock.Now().UTC()
	if deliveryErr != nil {
		return d.scheduleRetry(
			ctx,
			claim,
			transitionAt,
			FailureTransportUnavailable,
			report,
		)
	}
	if err := validateResult(result); err != nil {
		return d.scheduleRetry(ctx, claim, transitionAt, FailureInvalidResult, report)
	}
	switch result.Disposition {
	case DispositionAccepted, DispositionDuplicate:
		if err := d.repository.MarkDelivered(ctx, claim.Lease, transitionAt); err != nil {
			return NewError(FailurePersistence, "mark outbox delivered", err)
		}
		report.Delivered++
		d.observe(ctx, claim, DispatchTransitionDelivered, "", transitionAt)
		return nil
	case DispositionRetryable:
		return d.scheduleRetry(
			ctx,
			claim,
			transitionAt,
			failureForFrameCode(result.ErrorCode),
			report,
		)
	case DispositionTerminal, DispositionPayloadHashConflict:
		return d.markTerminal(
			ctx,
			claim,
			transitionAt,
			failureForFrameCode(result.ErrorCode),
			report,
		)
	default:
		return d.scheduleRetry(ctx, claim, transitionAt, FailureInvalidResult, report)
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
	d.observe(ctx, claim, DispatchTransitionRetrying, failure, now)
	return nil
}

func (d *Dispatcher) markTerminal(
	ctx context.Context,
	claim Claim,
	now time.Time,
	failure FailureCode,
	report *DispatchReport,
) error {
	if err := d.repository.MarkTerminal(ctx, claim.Lease, now, failure); err != nil {
		return NewError(FailurePersistence, "mark outbox terminal", err)
	}
	report.Terminal++
	d.observe(ctx, claim, DispatchTransitionTerminal, failure, now)
	return nil
}

func (d *Dispatcher) observe(
	ctx context.Context,
	claim Claim,
	transition DispatchTransition,
	failure FailureCode,
	transitionAt time.Time,
) {
	if claim.Frame == nil {
		return
	}
	d.observerMu.RLock()
	observer := d.observers[claim.Frame.GetPayloadKind()]
	d.observerMu.RUnlock()
	if observer == nil {
		return
	}
	latency := time.Duration(0)
	if !claim.EnqueuedAt.IsZero() && transitionAt.After(claim.EnqueuedAt) {
		latency = transitionAt.Sub(claim.EnqueuedAt)
	}
	observer.ObserveDispatch(ctx, DispatchObservation{
		PayloadKind: claim.Frame.GetPayloadKind(),
		Transition:  transition,
		Failure:     failure,
		Attempt:     claim.AttemptCount,
		Latency:     latency,
	})
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
