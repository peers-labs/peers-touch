package delivery

import (
	"context"
	"time"

	"gorm.io/gorm"
)

const MaxClaimBatchSize = 100

// EnqueueResult distinguishes a new durable row from an exact idempotent replay.
type EnqueueResult struct {
	Duplicate bool
}

// ClaimRequest bounds one restart-safe dispatcher claim operation.
type ClaimRequest struct {
	WorkerID      string
	Limit         int
	Now           time.Time
	LeaseDuration time.Duration
}

// Lease is the fencing token required by every post-claim state transition.
type Lease struct {
	FrameID    string
	Owner      string
	Generation uint64
	ExpiresAt  time.Time
}

// Claim carries one immutable frame and its current lease fencing token.
type Claim struct {
	Frame        *Frame
	Lease        Lease
	AttemptCount uint32
	EnqueuedAt   time.Time
}

// OutboxStatus is the bounded delivery lifecycle projection exposed to domain owners.
type OutboxStatus struct {
	FrameID       string
	State         OutboxState
	AttemptCount  uint32
	NextAttemptAt time.Time
	ExpiresAt     time.Time
	LastFailure   FailureCode
}

// OutboxWriter appends an immutable frame in the caller's transaction.
type OutboxWriter interface {
	Enqueue(ctx context.Context, frame *Frame, now time.Time) (EnqueueResult, error)
}

// OutboxStatusReader reads immutable-frame lifecycle without transferring ownership.
type OutboxStatusReader interface {
	ReadOutboxStatuses(
		ctx context.Context,
		frameIDs []string,
		now time.Time,
	) ([]OutboxStatus, error)
}

// AfterCommitFunc runs only after the shared inbox transaction commits.
type AfterCommitFunc func(context.Context) error

// AfterCommitRegistrar defers non-durable effects until durable state is visible.
type AfterCommitRegistrar interface {
	AfterCommit(AfterCommitFunc) error
}

// OutboxRepository owns durable claims and lease-fenced terminal transitions.
type OutboxRepository interface {
	OutboxWriter
	Claim(ctx context.Context, request ClaimRequest) ([]Claim, error)
	MarkDelivered(ctx context.Context, lease Lease, deliveredAt time.Time) error
	ScheduleRetry(
		ctx context.Context,
		lease Lease,
		nextAttemptAt time.Time,
		failure FailureCode,
	) error
	MarkTerminal(
		ctx context.Context,
		lease Lease,
		terminalAt time.Time,
		failure FailureCode,
	) error
	MarkExpired(ctx context.Context, lease Lease, expiredAt time.Time) error
}

// Repository combines schema ownership with the dispatcher-facing outbox contract.
type Repository interface {
	OutboxRepository
	Migrate(ctx context.Context) error
}

// Transaction exposes the shared SQL transaction and an outbox writer bound to it.
// Domain receivers use DB only from their infrastructure adapter, never from domain code.
type Transaction interface {
	DB() *gorm.DB
	Outbox() OutboxWriter
}

// Dispatch executes a typed domain receiver inside the inbox transaction.
type Dispatch func(context.Context, Transaction, *Frame) (Result, error)

// UnitOfWork atomically records the inbox identity and the receiver's domain mutation.
type UnitOfWork interface {
	Receive(
		ctx context.Context,
		frame *Frame,
		receivedAt time.Time,
		dispatch Dispatch,
	) (Result, error)
}
