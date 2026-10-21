package federation

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

var ErrSyncStopped = errors.New("sync stopped")

type RemoteLedgerFetcher interface {
	FetchHead(ctx context.Context, endpoint, targetPeerID, federationID string) (headHash []byte, headSeq uint64, err error)
	FetchEvents(ctx context.Context, endpoint, targetPeerID, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error)
}

type RemoteGovernanceClient interface {
	ResolveStationIdentity(
		ctx context.Context,
		endpoint string,
	) (*RemoteStationIdentity, error)
	SubmitProposal(ctx context.Context, endpoint, targetPeerID string, req *pb.SubmitProposalRequest) (*pb.SubmitProposalResponse, error)
}

type LedgerSyncManager struct {
	mu       sync.Mutex
	running  bool
	cancel   context.CancelFunc
	wg       sync.WaitGroup
	interval time.Duration

	ledgerSvc      *application.LedgerService
	federationRepo domain.FederationRepository
	eventRepo      domain.LedgerEventRepository
	syncCursorRepo domain.SyncCursorRepository
	membershipRepo domain.MembershipRepository
	publisher      *LedgerEventPublisher
	fetcher        RemoteLedgerFetcher
	localStationID string
}

func NewLedgerSyncManager(
	ledgerSvc *application.LedgerService,
	federationRepo domain.FederationRepository,
	eventRepo domain.LedgerEventRepository,
	syncCursorRepo domain.SyncCursorRepository,
	membershipRepo domain.MembershipRepository,
	publisher *LedgerEventPublisher,
	fetcher RemoteLedgerFetcher,
	localStationID string,
) *LedgerSyncManager {
	return &LedgerSyncManager{
		interval:       30 * time.Second,
		ledgerSvc:      ledgerSvc,
		federationRepo: federationRepo,
		eventRepo:      eventRepo,
		syncCursorRepo: syncCursorRepo,
		membershipRepo: membershipRepo,
		publisher:      publisher,
		fetcher:        fetcher,
		localStationID: localStationID,
	}
}

func (m *LedgerSyncManager) Start(ctx context.Context) {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return
	}
	m.running = true
	runCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.wg.Add(1)
	m.mu.Unlock()

	go m.run(runCtx)
	log.Infof(ctx, "[federation-sync] started, interval=%s", m.interval)
}

func (m *LedgerSyncManager) Stop() {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	m.running = false
	m.cancel()
	m.mu.Unlock()

	m.wg.Wait()
}

func (m *LedgerSyncManager) run(ctx context.Context) {
	defer m.wg.Done()
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.safeTick(ctx)
		}
	}
}

func (m *LedgerSyncManager) safeTick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Errorf(ctx, "[federation-sync] panic recovered: %v", r)
		}
	}()
	m.syncAllFederations(ctx)
}

func (m *LedgerSyncManager) syncAllFederations(ctx context.Context) {
	if m.localStationID == "" {
		m.localStationID = localStationPeerID()
		if m.localStationID == "" {
			log.Warnf(ctx, "[federation-sync] Station peer identity unavailable, skipping tick")
			return
		}
	}

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
	if fed.SequencerStationPeerID == m.localStationID {
		return nil
	}

	if m.fetcher == nil {
		return nil
	}

	sequencerMembership, err := m.membershipRepo.GetByStation(ctx, fed.FederationID, fed.SequencerStationPeerID)
	if err != nil || sequencerMembership == nil {
		return nil
	}
	endpoint := sequencerMembership.StationURL
	if endpoint == "" {
		return nil
	}

	remoteHeadHash, remoteHeadSeq, err := m.fetcher.FetchHead(ctx, endpoint, fed.SequencerStationPeerID, fed.FederationID)
	if err != nil {
		return fmt.Errorf("fetch head from %s: %w", endpoint, err)
	}

	headEvent, err := m.eventRepo.GetHead(ctx, fed.FederationID)
	if err != nil {
		return err
	}
	var localSeq uint64
	if headEvent != nil {
		localSeq = headEvent.Seq
	}

	if remoteHeadSeq <= localSeq {
		m.updateCursor(ctx, fed, remoteHeadHash, remoteHeadSeq, localSeq, "healthy")
		return nil
	}

	events, err := m.fetcher.FetchEvents(ctx, endpoint, fed.SequencerStationPeerID, fed.FederationID, localSeq+1, 100)
	if err != nil {
		return fmt.Errorf("fetch events from %s: %w", endpoint, err)
	}

	for _, event := range events {
		if err := m.ApplyRemoteEvent(ctx, event); err != nil {
			m.updateCursor(ctx, fed, remoteHeadHash, remoteHeadSeq, localSeq, "fork_detected")
			return fmt.Errorf("apply event seq=%d: %w", event.Seq, err)
		}
		localSeq = event.Seq
	}

	m.updateCursor(ctx, fed, remoteHeadHash, remoteHeadSeq, localSeq, "healthy")
	log.Infof(ctx, "[federation-sync] synced %s: local_seq=%d remote_seq=%d", fed.FederationID, localSeq, remoteHeadSeq)
	return nil
}

func (m *LedgerSyncManager) updateCursor(ctx context.Context, fed *domain.FederationRecord, headHash []byte, headSeq, appliedSeq uint64, status string) {
	cursor := &domain.SyncCursorRecord{
		FederationID:        fed.FederationID,
		RemoteStationPeerID: fed.SequencerStationPeerID,
		LastSeenHeadHash:    headHash,
		LastSeenHeadSeq:     headSeq,
		LastAppliedSeq:      appliedSeq,
		Status:              status,
	}
	if err := m.syncCursorRepo.Upsert(ctx, cursor); err != nil {
		log.Warnf(ctx, "[federation-sync] failed to update cursor for %s: %v", fed.FederationID, err)
	}
}

func (m *LedgerSyncManager) ApplyRemoteEvent(ctx context.Context, event *pb.LedgerEvent) error {
	if event == nil {
		return fmt.Errorf("remote Federation event is required")
	}
	fed, err := m.federationRepo.GetByID(ctx, event.FederationId)
	if err != nil {
		return err
	}
	if fed == nil {
		return fmt.Errorf("federation not found: %s", event.FederationId)
	}

	if err := m.ledgerSvc.ValidateRemoteEvent(ctx, event); err != nil {
		return fmt.Errorf(
			"validate remote Federation event seq=%d: %w",
			event.Seq,
			err,
		)
	}
	mutation, err := application.ProjectionMutationForEvent(event)
	if err != nil {
		return err
	}

	if err := m.ledgerSvc.CommitRemoteEvent(ctx, event, mutation); err != nil {
		if errors.Is(err, domain.ErrForkDetected) {
			if statusErr := m.federationRepo.UpdateStatus(ctx, event.FederationId, "fork_detected"); statusErr != nil {
				log.Warnf(ctx, "[federation-sync] failed to update fork status for %s: %v", event.FederationId, statusErr)
			}
		}
		return err
	}

	return m.publisher.PublishToLocalActors(ctx, event)
}
