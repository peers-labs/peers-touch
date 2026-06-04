package republisher

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// DefaultInterval is the time between full republishes. Half the
// libp2p kad-DHT republish window (24h) keeps every record at least
// one tick away from expiration.
const DefaultInterval = 12 * time.Hour

// MinInterval is a floor — operators who set the config knob too
// aggressively get clamped here so a misconfiguration cannot
// hot-loop the DHT.
const MinInterval = 30 * time.Second

// Config tunes the republisher. The zero value (DefaultInterval) is
// safe in production; tests pass smaller values via SetInterval.
type Config struct {
	// Interval between full scans. Values < MinInterval are clamped.
	Interval time.Duration

	// PerRowTimeout caps the time spent on a single PublishVisibility
	// call. Defaults to 30s — same ceiling SignUp's async publish uses.
	PerRowTimeout time.Duration

	// SkipInitialRun disables the at-startup republish. Tests use this
	// to assert the ticker behaviour without an immediate execution.
	SkipInitialRun bool
}

// Republisher is the active object that drives periodic republish.
// Its zero value is not usable — callers MUST construct via New.
type Republisher struct {
	cfg    Config
	mu     sync.Mutex
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// stats is intentionally minimal — we surface lastRunAt so an
	// operator can confirm the loop is alive via a future status
	// endpoint without exposing every internal counter.
	statsMu     sync.Mutex
	lastRunAt   time.Time
	lastRunInfo runInfo
}

type runInfo struct {
	scanned   int
	published int
	skipped   int
	failed    int
	error     error
}

// New constructs a Republisher with the supplied config. Defaults are
// applied at construction time so callers can read .Config to inspect
// the effective values.
func New(cfg Config) *Republisher {
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultInterval
	}
	if cfg.Interval < MinInterval {
		cfg.Interval = MinInterval
	}
	if cfg.PerRowTimeout <= 0 {
		cfg.PerRowTimeout = 30 * time.Second
	}
	return &Republisher{cfg: cfg}
}

// Start kicks off the background loop. It returns immediately; the
// republisher runs until Stop is called. Calling Start twice is an
// error — every Republisher owns at most one ticker goroutine.
func (r *Republisher) Start(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		return fmt.Errorf("republisher: already started")
	}

	loopCtx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.wg.Add(1)
	go r.run(loopCtx)
	logger.Infof(ctx, "[republisher] started interval=%s initial=%v", r.cfg.Interval, !r.cfg.SkipInitialRun)
	return nil
}

// Stop cancels the loop and waits for the goroutine to exit. Safe to
// call from a Subserver Stop hook even if Start failed.
func (r *Republisher) Stop() {
	r.mu.Lock()
	cancel := r.cancel
	r.cancel = nil
	r.mu.Unlock()
	if cancel != nil {
		cancel()
		r.wg.Wait()
	}
}

func (r *Republisher) run(ctx context.Context) {
	defer r.wg.Done()

	if !r.cfg.SkipInitialRun {
		// First pass runs immediately so a restart refreshes the DHT
		// without waiting a full interval. We give the bootstrap
		// subserver a short grace period — without active peers in
		// the routing table, PutValue stalls. 5 seconds is plenty for
		// the federation seed connections to come up in test.
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		r.runOnce(ctx)
	}

	tick := time.NewTicker(r.cfg.Interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			r.runOnce(ctx)
		}
	}
}

// runOnce performs one full scan + publish pass. Errors on individual
// rows are logged but do not abort the scan — one failing publish
// must not block the freshness keeper for the rest of the actors.
func (r *Republisher) runOnce(parent context.Context) {
	start := time.Now()
	info := runInfo{}

	rds, err := store.GetRDS(parent)
	if err != nil {
		info.error = fmt.Errorf("get db: %w", err)
		r.recordRun(start, info)
		logger.Warnf(parent, "[republisher] scan aborted: %v", info.error)
		return
	}

	var rows []db.Actor
	if err := rds.Where("origin = ? AND visibility IN ?", touchactor.OriginLocal, []int16{
		touchactor.VisibilityByHandle,
		touchactor.VisibilityIndexed,
	}).Find(&rows).Error; err != nil {
		info.error = fmt.Errorf("scan: %w", err)
		r.recordRun(start, info)
		logger.Warnf(parent, "[republisher] scan failed: %v", info.error)
		return
	}

	info.scanned = len(rows)
	for i := range rows {
		row := rows[i]
		if row.FederatedHandle == "" {
			info.skipped++
			continue
		}
		ctx, cancel := context.WithTimeout(parent, r.cfg.PerRowTimeout)
		// WithoutBroadcast: the periodic republish bumps locator_seq
		// purely to keep the DHT entry from expiring; the underlying
		// envelope content is identical to the previous round, so
		// firing a Tier C1 invalidation broadcast on every actor every
		// Interval would flood the relay channel with no propagation
		// value. Real content changes go through the user-driven path
		// (UpdateProfile / UpdateVisibility / SignUp), which DOES
		// broadcast.
		err := touchactor.PublishVisibility(ctx, row.ID, touchactor.WithoutBroadcast())
		cancel()
		if err != nil {
			info.failed++
			logger.Warnf(parent, "[republisher] publish failed actor_id=%d handle=%s err=%v",
				row.ID, row.FederatedHandle, err)
			continue
		}
		info.published++
	}

	r.recordRun(start, info)
	logger.Infof(parent, "[republisher] scan done in %s scanned=%d published=%d skipped=%d failed=%d",
		time.Since(start), info.scanned, info.published, info.skipped, info.failed)
}

func (r *Republisher) recordRun(start time.Time, info runInfo) {
	r.statsMu.Lock()
	r.lastRunAt = start
	r.lastRunInfo = info
	r.statsMu.Unlock()
}

// LastRun returns a snapshot of the most recent scan's outcome plus
// its start wall-clock. Zero value (lastRunAt.IsZero()) means no scan
// has completed yet. Intended for diagnostic surfaces.
func (r *Republisher) LastRun() (time.Time, int, int, int, int, error) {
	r.statsMu.Lock()
	defer r.statsMu.Unlock()
	return r.lastRunAt,
		r.lastRunInfo.scanned,
		r.lastRunInfo.published,
		r.lastRunInfo.skipped,
		r.lastRunInfo.failed,
		r.lastRunInfo.error
}

// Interval returns the effective scan interval (post-clamp).
func (r *Republisher) Interval() time.Duration {
	return r.cfg.Interval
}
