package envelope

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// FederationTransport sends an envelope to a remote Station via relay.
type FederationTransport interface {
	// Forward relay-forwards an envelope to the target Station.
	// Returns nil on success (target Station accepted delivery).
	Forward(ctx context.Context, targetStationPeerID string, env *chat.StationEnvelope) error
}

// DefaultDispatcher polls the outbox and relay-forwards pending envelopes.
type DefaultDispatcher struct {
	repo      Repository
	transport FederationTransport
	interval  time.Duration
	maxRetry  int
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

func NewDispatcher(repo Repository, transport FederationTransport) *DefaultDispatcher {
	return &DefaultDispatcher{
		repo:      repo,
		transport: transport,
		interval:  2 * time.Second,
		maxRetry:  20,
	}
}

func (d *DefaultDispatcher) Start(ctx context.Context) error {
	ctx, d.cancel = context.WithCancel(ctx)
	d.wg.Add(1)
	go d.loop(ctx)
	return nil
}

func (d *DefaultDispatcher) Stop() {
	if d.cancel != nil {
		d.cancel()
	}
	d.wg.Wait()
}

func (d *DefaultDispatcher) loop(ctx context.Context) {
	defer d.wg.Done()
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.dispatchBatch(ctx)
		}
	}
}

func (d *DefaultDispatcher) dispatchBatch(ctx context.Context) {
	items, err := d.repo.PendingOutboxItems(ctx, 50)
	if err != nil {
		return
	}
	for _, item := range items {
		if ctx.Err() != nil {
			return
		}
		d.dispatchOne(ctx, item)
	}
}

func (d *DefaultDispatcher) dispatchOne(ctx context.Context, item *chat.OutboxItem) {
	_ = d.repo.MarkOutboxInFlight(ctx, item.OutboxItemId)

	err := d.transport.Forward(ctx, item.TargetStationPeerId, item.Envelope)
	if err == nil {
		_ = d.repo.MarkOutboxDelivered(ctx, item.OutboxItemId, time.Now())
		return
	}

	retryCount := int(item.RetryCount) + 1
	if retryCount >= d.maxRetry {
		_ = d.repo.MarkOutboxDeadLetter(ctx, item.OutboxItemId, fmt.Sprintf("max retries exceeded: %v", err))
		return
	}

	backoff := time.Duration(math.Min(float64(time.Second)*math.Pow(2, float64(retryCount)), float64(5*time.Minute)))
	nextRetry := time.Now().Add(backoff)
	_ = d.repo.SetOutboxNextRetry(ctx, item.OutboxItemId, nextRetry, err.Error())
}
