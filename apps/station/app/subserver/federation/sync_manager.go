package federation

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

var ErrSyncStopped = errors.New("sync stopped")

// LedgerSyncManager manages sync connections to remote sequencer stations.
// For each joined federation where this station is NOT the sequencer,
// it maintains a polling loop that fetches new events and applies them locally.
type LedgerSyncManager struct {
	mu        sync.RWMutex
	running   bool
	stopCh    chan struct{}
	interval  time.Duration

	ledgerSvc     *application.LedgerService
	federationRepo domain.FederationRepository
	eventRepo      domain.LedgerEventRepository
	syncCursorRepo domain.SyncCursorRepository
	publisher      *LedgerEventPublisher
	hashSvc        *domain.HashService
}

func NewLedgerSyncManager(
	ledgerSvc *application.LedgerService,
	federationRepo domain.FederationRepository,
	eventRepo domain.LedgerEventRepository,
	syncCursorRepo domain.SyncCursorRepository,
	publisher *LedgerEventPublisher,
	hashSvc *domain.HashService,
) *LedgerSyncManager {
	return &LedgerSyncManager{
		interval:       30 * time.Second,
		ledgerSvc:      ledgerSvc,
		federationRepo: federationRepo,
		eventRepo:      eventRepo,
		syncCursorRepo: syncCursorRepo,
		publisher:      publisher,
		hashSvc:        hashSvc,
	}
}

func (m *LedgerSyncManager) Start(ctx context.Context) {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return
	}
	m.running = true
	m.stopCh = make(chan struct{})
	m.mu.Unlock()

	go m.syncLoop(ctx)
	log.Infof(ctx, "[federation-sync] started, interval=%s", m.interval)
}

func (m *LedgerSyncManager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.running {
		return
	}
	m.running = false
	close(m.stopCh)
}

func (m *LedgerSyncManager) syncLoop(ctx context.Context) {
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stopCh:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.syncAllFederations(ctx)
		}
	}
}

func (m *LedgerSyncManager) syncAllFederations(ctx context.Context) {
	// List all federations this station is a member of
	feds, err := m.federationRepo.ListByStation(ctx, "")
	if err != nil {
		log.Warnf(ctx, "[federation-sync] failed to list federations: %v", err)
		return
	}

	for _, fed := range feds {
		if err := m.syncFederation(ctx, fed); err != nil {
			log.Warnf(ctx, "[federation-sync] sync failed for %s: %v", fed.FederationID, err)
		}
	}
}

func (m *LedgerSyncManager) syncFederation(ctx context.Context, fed *domain.FederationRecord) error {
	// Get current local head
	headEvent, err := m.eventRepo.GetHead(ctx, fed.FederationID)
	if err != nil {
		return err
	}

	var localSeq uint64
	if headEvent != nil {
		localSeq = headEvent.Seq
	}

	// In a full implementation, this would call FetchHead on the remote sequencer
	// to check if remote_head_seq > local_seq, then FetchEvents to pull missing events.
	// For Phase 1 single-station MVP, sync is a no-op when this station IS the sequencer.
	if fed.SequencerStationPeerID == "" {
		return nil
	}

	// Update sync cursor
	cursor := &domain.SyncCursorRecord{
		FederationID:        fed.FederationID,
		RemoteStationPeerID: fed.SequencerStationPeerID,
		LastSeenHeadHash:    fed.HeadHash,
		LastSeenHeadSeq:     fed.HeadSeq,
		LastAppliedSeq:      localSeq,
		Status:              "healthy",
	}
	return m.syncCursorRepo.Upsert(ctx, cursor)
}

// ApplyRemoteEvent validates and applies a ledger event received from a remote sequencer.
// Used both by the SSE receiver and the FetchEvents catch-up path.
func (m *LedgerSyncManager) ApplyRemoteEvent(ctx context.Context, event *pb.LedgerEvent) error {
	// Verify hash chain
	fed, err := m.federationRepo.GetByID(ctx, event.FederationId)
	if err != nil {
		return err
	}
	if fed == nil {
		return errors.New("federation not found")
	}

	expectedPrevHash := fed.HeadHash
	if !bytesEqual(event.PrevHash, expectedPrevHash) {
		// Fork detected
		_ = m.federationRepo.UpdateStatus(ctx, event.FederationId, "fork_detected")
		return domain.ErrForkDetected
	}

	// Verify event hash
	payloadHash := event.PayloadHash
	valid, err := m.hashSvc.VerifyEventHash(event, payloadHash)
	if err != nil {
		return err
	}
	if !valid {
		return errors.New("event hash verification failed")
	}

	// Append to local ledger
	if err := m.eventRepo.Append(ctx, event); err != nil {
		return err
	}

	// Update federation head
	if err := m.federationRepo.UpdateHead(ctx, event.FederationId, event.EventHash, event.Seq); err != nil {
		return err
	}

	// Publish to local actors via SSE
	return m.publisher.PublishToLocalActors(ctx, event)
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
