// OSSService is a thin adapter, but the small amount of logic it
// owns (input validation, pagination defaults, "missing bucket"
// vs "empty bucket" semantics) is the kind of glue that breaks
// silently. These tests pin its observable behaviour against a
// fake repo, independent of GORM/sqlite.
package application

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
)

// ---------------------------------------------------------------------------
// Fake repo — captures the args the service passes through and
// returns canned responses. We deliberately do NOT mock GORM here;
// the repo's own tests cover SQL semantics.
// ---------------------------------------------------------------------------

type fakeOSSRepo struct {
	buckets []domain.OSSBucketSummary

	objectsCalled  bool
	objectsLastQ   infrastructure.OSSObjectQuery
	objectsRows    []domain.OSSObjectSummary
	objectsTotal   int64
	objectsErr     error

	auditCalled bool
	auditLastQ  infrastructure.OSSAuditQuery
	auditRows   []domain.OSSAuditEvent
	auditTotal  int64

	usage *domain.OSSUsageSummary

	fedLocal *domain.OSSFederationLocalKey
	peers    []domain.OSSFederationPeer

	pinCalls []struct {
		ID     string
		Pinned bool
	}
	pinErr error
}

func (f *fakeOSSRepo) ListBuckets(_ context.Context) ([]domain.OSSBucketSummary, error) {
	return f.buckets, nil
}
func (f *fakeOSSRepo) GetBucket(_ context.Context, id string) (*domain.OSSBucketSummary, error) {
	for i := range f.buckets {
		if f.buckets[i].ID == id {
			return &f.buckets[i], nil
		}
	}
	return nil, nil
}
func (f *fakeOSSRepo) ListObjects(_ context.Context, q infrastructure.OSSObjectQuery) ([]domain.OSSObjectSummary, int64, error) {
	f.objectsCalled = true
	f.objectsLastQ = q
	return f.objectsRows, f.objectsTotal, f.objectsErr
}
func (f *fakeOSSRepo) ListAudit(_ context.Context, q infrastructure.OSSAuditQuery) ([]domain.OSSAuditEvent, int64, error) {
	f.auditCalled = true
	f.auditLastQ = q
	return f.auditRows, f.auditTotal, nil
}
func (f *fakeOSSRepo) Usage(_ context.Context) (*domain.OSSUsageSummary, error) {
	if f.usage == nil {
		return &domain.OSSUsageSummary{}, nil
	}
	return f.usage, nil
}
func (f *fakeOSSRepo) GetFederationLocal(_ context.Context) (*domain.OSSFederationLocalKey, error) {
	return f.fedLocal, nil
}
func (f *fakeOSSRepo) ListFederationPeers(_ context.Context) ([]domain.OSSFederationPeer, error) {
	return f.peers, nil
}
func (f *fakeOSSRepo) SetPeerPin(_ context.Context, peerStationID string, pinned bool) error {
	if f.pinErr != nil {
		return f.pinErr
	}
	f.pinCalls = append(f.pinCalls, struct {
		ID     string
		Pinned bool
	}{peerStationID, pinned})
	return nil
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestOSSService_ListBuckets_PassThroughTotal(t *testing.T) {
	repo := &fakeOSSRepo{
		buckets: []domain.OSSBucketSummary{{ID: "b1"}, {ID: "b2"}},
	}
	svc := NewOSSService(repo)

	resp, err := svc.ListBuckets(context.Background())
	if err != nil {
		t.Fatalf("ListBuckets: %v", err)
	}
	if resp.Total != 2 || len(resp.Items) != 2 {
		t.Fatalf("envelope: %+v", resp)
	}
}

func TestOSSService_GetBucket_RequiresID(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	if _, err := svc.GetBucket(context.Background(), ""); err == nil {
		t.Fatalf("empty id should error")
	}
}

func TestOSSService_ListObjects_PaginationDefaults(t *testing.T) {
	repo := &fakeOSSRepo{
		objectsRows:  []domain.OSSObjectSummary{{ID: "o1"}},
		objectsTotal: 1,
	}
	svc := NewOSSService(repo)

	// Empty query: service must clamp PageSize to its default (50)
	// and treat Page<1 as Page=1 in the response.
	resp, err := svc.ListObjects(context.Background(), infrastructure.OSSObjectQuery{Page: 0})
	if err != nil {
		t.Fatalf("ListObjects: %v", err)
	}
	if !repo.objectsCalled || repo.objectsLastQ.PageSize != 50 {
		t.Fatalf("page_size default: q=%+v", repo.objectsLastQ)
	}
	if resp.Page != 1 {
		t.Fatalf("page should be normalised to 1, got %d", resp.Page)
	}
	if resp.Total != 1 {
		t.Fatalf("total: %d", resp.Total)
	}

	// Non-default values must pass through verbatim.
	q := infrastructure.OSSObjectQuery{
		BucketID: "b1", Visibility: "private",
		Page: 3, PageSize: 25,
	}
	if _, err := svc.ListObjects(context.Background(), q); err != nil {
		t.Fatalf("ListObjects custom: %v", err)
	}
	if repo.objectsLastQ.PageSize != 25 || repo.objectsLastQ.Page != 3 ||
		repo.objectsLastQ.BucketID != "b1" || repo.objectsLastQ.Visibility != "private" {
		t.Fatalf("query passthrough: %+v", repo.objectsLastQ)
	}
}

func TestOSSService_ListAudit_PaginationDefaults(t *testing.T) {
	repo := &fakeOSSRepo{auditTotal: 0}
	svc := NewOSSService(repo)

	resp, err := svc.ListAudit(context.Background(), infrastructure.OSSAuditQuery{})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if !repo.auditCalled || repo.auditLastQ.PageSize != 50 {
		t.Fatalf("audit page_size default: q=%+v", repo.auditLastQ)
	}
	if resp.Page != 1 {
		t.Fatalf("audit page should be 1, got %d", resp.Page)
	}
}

func TestOSSService_SetPeerPin_RequiresID(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	if err := svc.SetPeerPin(context.Background(), "", true); err == nil {
		t.Fatalf("empty peer_station_id should error")
	}
	if len(repo.pinCalls) != 0 {
		t.Fatalf("repo should not be called on bad input: %+v", repo.pinCalls)
	}
}

func TestOSSService_SetPeerPin_PassThrough(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	if err := svc.SetPeerPin(context.Background(), "peer-1", true); err != nil {
		t.Fatalf("pin: %v", err)
	}
	if err := svc.SetPeerPin(context.Background(), "peer-1", false); err != nil {
		t.Fatalf("unpin: %v", err)
	}
	if len(repo.pinCalls) != 2 ||
		repo.pinCalls[0].ID != "peer-1" || !repo.pinCalls[0].Pinned ||
		repo.pinCalls[1].ID != "peer-1" || repo.pinCalls[1].Pinned {
		t.Fatalf("pin call sequence: %+v", repo.pinCalls)
	}
}

func TestOSSService_SetPeerPin_PropagatesNotFound(t *testing.T) {
	repo := &fakeOSSRepo{pinErr: infrastructure.ErrPeerNotFound}
	svc := NewOSSService(repo)

	err := svc.SetPeerPin(context.Background(), "peer-x", true)
	if !errors.Is(err, infrastructure.ErrPeerNotFound) {
		t.Fatalf("want ErrPeerNotFound, got %v", err)
	}
}

func TestOSSService_FederationPassThrough(t *testing.T) {
	repo := &fakeOSSRepo{
		fedLocal: &domain.OSSFederationLocalKey{KID: "kid-x", PublicKeyPEM: "PEM", Generated: true},
		peers: []domain.OSSFederationPeer{
			{PeerStationID: "p1", KID: "kid-1"},
			{PeerStationID: "p2", KID: "kid-2"},
		},
	}
	svc := NewOSSService(repo)

	local, err := svc.GetFederationLocal(context.Background())
	if err != nil || local == nil || local.KID != "kid-x" {
		t.Fatalf("local: err=%v row=%+v", err, local)
	}

	resp, err := svc.ListFederationPeers(context.Background())
	if err != nil {
		t.Fatalf("peers: %v", err)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("peers count: %d", len(resp.Items))
	}
}
