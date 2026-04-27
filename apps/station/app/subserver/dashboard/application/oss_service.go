// Package application — OSSService is the dashboard-side application
// service for the `/oss/*` family of endpoints. It is a thin facade
// over the read-only OSSRepository: pagination defaults and input
// validation live here, but no business policy (the OSS subserver
// itself is the source of truth for OSS-side rules). Mutating
// operations (today: pin / unpin a peer station's federation key)
// pass through unchanged — the handler records the dashboard audit
// row alongside the call so it stays consistent with the
// `handleResetActorPassword`-style pattern used elsewhere.
package application

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
)

// OSSService binds the dashboard handler layer to the OSS-facing
// repo. Construction is intentionally minimal so tests can wire a
// fake repo without a database.
type OSSService struct {
	repo infrastructure.OSSRepository
}

// NewOSSService builds an OSSService bound to the given repo.
func NewOSSService(repo infrastructure.OSSRepository) *OSSService {
	return &OSSService{repo: repo}
}

// ---------------------------------------------------------------------------
// Read paths — direct delegation to the repo. Kept here (rather
// than letting the handler talk to the repo directly) so future
// per-admin scope checks have a single insertion point.
// ---------------------------------------------------------------------------

func (s *OSSService) ListBuckets(ctx context.Context) (*domain.OSSBucketListResponse, error) {
	rows, err := s.repo.ListBuckets(ctx)
	if err != nil {
		return nil, err
	}
	return &domain.OSSBucketListResponse{Items: rows, Total: len(rows)}, nil
}

func (s *OSSService) GetBucket(ctx context.Context, id string) (*domain.OSSBucketSummary, error) {
	if id == "" {
		return nil, errors.New("bucket id is required")
	}
	return s.repo.GetBucket(ctx, id)
}

func (s *OSSService) ListObjects(ctx context.Context, q infrastructure.OSSObjectQuery) (*domain.OSSObjectListResponse, error) {
	if q.PageSize <= 0 {
		q.PageSize = 50
	}
	rows, total, err := s.repo.ListObjects(ctx, q)
	if err != nil {
		return nil, err
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	return &domain.OSSObjectListResponse{Items: rows, Total: total, Page: page}, nil
}

func (s *OSSService) ListAudit(ctx context.Context, q infrastructure.OSSAuditQuery) (*domain.OSSAuditListResponse, error) {
	if q.PageSize <= 0 {
		q.PageSize = 50
	}
	rows, total, err := s.repo.ListAudit(ctx, q)
	if err != nil {
		return nil, err
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	return &domain.OSSAuditListResponse{Items: rows, Total: total, Page: page}, nil
}

func (s *OSSService) Usage(ctx context.Context) (*domain.OSSUsageSummary, error) {
	return s.repo.Usage(ctx)
}

func (s *OSSService) GetFederationLocal(ctx context.Context) (*domain.OSSFederationLocalKey, error) {
	return s.repo.GetFederationLocal(ctx)
}

func (s *OSSService) ListFederationPeers(ctx context.Context) (*domain.OSSFederationPeersResponse, error) {
	rows, err := s.repo.ListFederationPeers(ctx)
	if err != nil {
		return nil, err
	}
	return &domain.OSSFederationPeersResponse{Items: rows}, nil
}

// ---------------------------------------------------------------------------
// Mutating paths
// ---------------------------------------------------------------------------

// SetPeerPin is the operator-driven trust action: a pinned peer
// row freezes the kid, so a future silent rotation by the peer
// will be rejected at verify time. Unpinning falls back to TOFU
// semantics (still rejects mismatch in v1; future: re-TOFU).
func (s *OSSService) SetPeerPin(ctx context.Context, peerStationID string, pinned bool) error {
	if peerStationID == "" {
		return errors.New("peer_station_id is required")
	}
	return s.repo.SetPeerPin(ctx, peerStationID, pinned)
}
