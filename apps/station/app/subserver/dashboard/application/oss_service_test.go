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
	"time"

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

	// ----- S9: bucket lifecycle hooks -----
	createCalls  []infrastructure.BucketCreateInput
	createReturn *domain.OSSBucketSummary
	createErr    error

	updateCalls []struct {
		ID    string
		Patch infrastructure.BucketUpdateInput
	}
	updateReturn *domain.OSSBucketSummary
	updateErr    error

	deleteCalls []struct {
		ID    string
		Force bool
	}
	deleteErr error

	auditAppends []infrastructure.OSSAuditAppend
	auditAppendErr error

	adminObjects []domain.OSSObjectAdminDetail

	adminPatchCalls []struct {
		ID string
		In infrastructure.AdminPatchObjectInput
	}
	adminPatchReturn *domain.OSSObjectAdminDetail
	adminPatchErr    error

	adminDeleteCalls  []string
	adminDeleteReturn *domain.OSSObjectAdminDetail
	adminDeleteErr    error
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

func (f *fakeOSSRepo) CreateBucket(_ context.Context, in infrastructure.BucketCreateInput) (*domain.OSSBucketSummary, error) {
	f.createCalls = append(f.createCalls, in)
	if f.createErr != nil {
		return nil, f.createErr
	}
	if f.createReturn != nil {
		return f.createReturn, nil
	}
	return &domain.OSSBucketSummary{
		ID: "bucket-new", Name: in.Name, OwnerActorID: in.OwnerActorID,
		Kind: "user", DefaultVisibility: in.DefaultVisibility,
		QuotaBytes: in.QuotaBytes, TTLDays: 0,
	}, nil
}

func (f *fakeOSSRepo) UpdateBucket(_ context.Context, id string, in infrastructure.BucketUpdateInput) (*domain.OSSBucketSummary, error) {
	f.updateCalls = append(f.updateCalls, struct {
		ID    string
		Patch infrastructure.BucketUpdateInput
	}{id, in})
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	if f.updateReturn != nil {
		return f.updateReturn, nil
	}
	return &domain.OSSBucketSummary{ID: id, Name: "x", OwnerActorID: "owner"}, nil
}

func (f *fakeOSSRepo) DeleteBucket(_ context.Context, id string, force bool) error {
	f.deleteCalls = append(f.deleteCalls, struct {
		ID    string
		Force bool
	}{id, force})
	return f.deleteErr
}

func (f *fakeOSSRepo) RecordOSSAudit(_ context.Context, evt infrastructure.OSSAuditAppend) error {
	f.auditAppends = append(f.auditAppends, evt)
	return f.auditAppendErr
}

// ----- S10: object admin hooks ----------------------------------------------

func (f *fakeOSSRepo) GetObject(_ context.Context, id string) (*domain.OSSObjectAdminDetail, error) {
	for i := range f.adminObjects {
		if f.adminObjects[i].ID == id {
			cp := f.adminObjects[i]
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeOSSRepo) AdminPatchObject(_ context.Context, id string, in infrastructure.AdminPatchObjectInput) (*domain.OSSObjectAdminDetail, error) {
	f.adminPatchCalls = append(f.adminPatchCalls, struct {
		ID string
		In infrastructure.AdminPatchObjectInput
	}{id, in})
	if f.adminPatchErr != nil {
		return nil, f.adminPatchErr
	}
	if f.adminPatchReturn != nil {
		return f.adminPatchReturn, nil
	}
	return &domain.OSSObjectAdminDetail{ID: id, Visibility: "private"}, nil
}

func (f *fakeOSSRepo) AdminDeleteObject(_ context.Context, id string) (*domain.OSSObjectAdminDetail, error) {
	f.adminDeleteCalls = append(f.adminDeleteCalls, id)
	if f.adminDeleteErr != nil {
		return f.adminDeleteReturn, f.adminDeleteErr
	}
	if f.adminDeleteReturn != nil {
		return f.adminDeleteReturn, nil
	}
	return &domain.OSSObjectAdminDetail{ID: id}, nil
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

// ---------------------------------------------------------------------------
// S9: bucket lifecycle (admin) — service-layer validation
// ---------------------------------------------------------------------------

func TestOSSService_CreateBucket_ValidationErrors(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	ctx := context.Background()

	cases := []struct {
		name string
		req  domain.OSSBucketCreateRequest
	}{
		{"missing owner", domain.OSSBucketCreateRequest{Name: "x"}},
		{"missing name", domain.OSSBucketCreateRequest{OwnerActorID: "actor"}},
		{"unknown visibility", domain.OSSBucketCreateRequest{OwnerActorID: "a", Name: "x", DefaultVisibility: "world"}},
		{"negative quota", domain.OSSBucketCreateRequest{OwnerActorID: "a", Name: "x", QuotaBytes: -1}},
		{"negative ttl", domain.OSSBucketCreateRequest{OwnerActorID: "a", Name: "x", TTLDays: -7}},
	}
	for _, c := range cases {
		if _, err := svc.CreateBucket(ctx, c.req); err == nil {
			t.Errorf("%s: want validation error", c.name)
		}
	}
}

func TestOSSService_CreateBucket_DefaultsToPrivateVisibility(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	if _, err := svc.CreateBucket(context.Background(), domain.OSSBucketCreateRequest{
		OwnerActorID: "actor-a",
		Name:         "photos",
	}); err != nil {
		t.Fatalf("CreateBucket: %v", err)
	}
	if len(repo.createCalls) != 1 {
		t.Fatalf("repo not called")
	}
	if repo.createCalls[0].DefaultVisibility != "private" {
		t.Errorf("default visibility: want private, got %q", repo.createCalls[0].DefaultVisibility)
	}
}

func TestOSSService_CreateBucket_PropagatesRepoConflict(t *testing.T) {
	repo := &fakeOSSRepo{createErr: infrastructure.ErrBucketExists}
	svc := NewOSSService(repo)

	_, err := svc.CreateBucket(context.Background(), domain.OSSBucketCreateRequest{
		OwnerActorID: "actor-a", Name: "photos",
	})
	if !errors.Is(err, infrastructure.ErrBucketExists) {
		t.Fatalf("want ErrBucketExists, got %v", err)
	}
}

func TestOSSService_UpdateBucket_RejectsEmptyPatch(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	if _, err := svc.UpdateBucket(context.Background(), "b1", domain.OSSBucketUpdateRequest{}); err == nil {
		t.Fatalf("empty patch should be rejected")
	}
	if len(repo.updateCalls) != 0 {
		t.Errorf("repo should not be called on empty patch: %+v", repo.updateCalls)
	}
}

func TestOSSService_UpdateBucket_PassesPointersThrough(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	vis := "chat"
	quota := int64(2048)
	ttl := int32(14)
	desc := "  refreshed  "
	if _, err := svc.UpdateBucket(context.Background(), "b1", domain.OSSBucketUpdateRequest{
		DefaultVisibility: &vis,
		QuotaBytes:        &quota,
		TTLDays:           &ttl,
		Description:       &desc,
	}); err != nil {
		t.Fatalf("UpdateBucket: %v", err)
	}
	if len(repo.updateCalls) != 1 {
		t.Fatalf("repo call count: %d", len(repo.updateCalls))
	}
	got := repo.updateCalls[0].Patch
	if got.DefaultVisibility == nil || *got.DefaultVisibility != "chat" ||
		got.QuotaBytes == nil || *got.QuotaBytes != 2048 ||
		got.TTLDays == nil || *got.TTLDays != 14 ||
		got.Description == nil || *got.Description != "refreshed" { // trimmed
		t.Errorf("patch round-trip drift: %+v", got)
	}
}

func TestOSSService_UpdateBucket_RejectsBadVisibilityAndNegatives(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	ctx := context.Background()

	bad := "world"
	if _, err := svc.UpdateBucket(ctx, "b1", domain.OSSBucketUpdateRequest{DefaultVisibility: &bad}); err == nil {
		t.Errorf("bad visibility accepted")
	}
	negQuota := int64(-1)
	if _, err := svc.UpdateBucket(ctx, "b1", domain.OSSBucketUpdateRequest{QuotaBytes: &negQuota}); err == nil {
		t.Errorf("negative quota accepted")
	}
	negTTL := int32(-1)
	if _, err := svc.UpdateBucket(ctx, "b1", domain.OSSBucketUpdateRequest{TTLDays: &negTTL}); err == nil {
		t.Errorf("negative ttl accepted")
	}
}

func TestOSSService_DeleteBucket_PassThroughForce(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	if err := svc.DeleteBucket(context.Background(), "b1", true); err != nil {
		t.Fatalf("DeleteBucket: %v", err)
	}
	if len(repo.deleteCalls) != 1 || repo.deleteCalls[0].ID != "b1" || !repo.deleteCalls[0].Force {
		t.Errorf("delete pass-through: %+v", repo.deleteCalls)
	}
}

func TestOSSService_DeleteBucket_RequiresID(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	if err := svc.DeleteBucket(context.Background(), "", false); err == nil {
		t.Fatalf("empty id should error")
	}
}

func TestOSSService_RecordOSSAudit_PassThrough(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	evt := infrastructure.OSSAuditAppend{
		Action: "bucket_create", BucketID: "b-1", DashboardActorID: "42", Outcome: "ok",
	}
	if err := svc.RecordOSSAudit(context.Background(), evt); err != nil {
		t.Fatalf("RecordOSSAudit: %v", err)
	}
	if len(repo.auditAppends) != 1 || repo.auditAppends[0].Action != "bucket_create" {
		t.Errorf("audit append not propagated: %+v", repo.auditAppends)
	}
}

// ---------------------------------------------------------------------------
// S10: object admin endpoints — service-layer translation
// ---------------------------------------------------------------------------

func TestOSSService_GetObject_RequiresID(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	if _, err := svc.GetObject(context.Background(), ""); err == nil {
		t.Fatalf("empty id should error")
	}
}

func TestOSSService_AdminPatchObject_RejectsEmptyPatch(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)
	if _, err := svc.AdminPatchObject(context.Background(), "f1", domain.OSSObjectAdminPatchRequest{}); err == nil {
		t.Fatalf("empty patch should be rejected")
	}
	if len(repo.adminPatchCalls) != 0 {
		t.Errorf("repo should not be called on empty patch: %+v", repo.adminPatchCalls)
	}
}

func TestOSSService_AdminPatchObject_TranslatesEmptyChatSessionAsClear(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	empty := ""
	if _, err := svc.AdminPatchObject(context.Background(), "f1", domain.OSSObjectAdminPatchRequest{
		ChatSessionID: &empty,
	}); err != nil {
		t.Fatalf("AdminPatchObject: %v", err)
	}
	if len(repo.adminPatchCalls) != 1 {
		t.Fatalf("repo not called once")
	}
	got := repo.adminPatchCalls[0].In
	if !got.ChatSessionIDSet || got.ChatSessionID != nil {
		t.Errorf("empty chat_session_id should clear: got Set=%v Ptr=%v", got.ChatSessionIDSet, got.ChatSessionID)
	}
}

func TestOSSService_AdminPatchObject_TranslatesNonEmptyChatSession(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	id := "  sess-123  "
	if _, err := svc.AdminPatchObject(context.Background(), "f1", domain.OSSObjectAdminPatchRequest{
		ChatSessionID: &id,
	}); err != nil {
		t.Fatalf("AdminPatchObject: %v", err)
	}
	got := repo.adminPatchCalls[0].In
	if !got.ChatSessionIDSet || got.ChatSessionID == nil || *got.ChatSessionID != "sess-123" {
		t.Errorf("non-empty session should set + trim: %+v", got)
	}
}

func TestOSSService_AdminPatchObject_ClearExpiresAtWins(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)

	now := time.Now()
	if _, err := svc.AdminPatchObject(context.Background(), "f1", domain.OSSObjectAdminPatchRequest{
		ExpiresAt:      &now, // would set, but...
		ClearExpiresAt: true, // ... clear flag wins
	}); err != nil {
		t.Fatalf("AdminPatchObject: %v", err)
	}
	got := repo.adminPatchCalls[0].In
	if !got.ExpiresAtSet || got.ExpiresAt != nil {
		t.Errorf("clear flag should win over set: %+v", got)
	}
}

func TestOSSService_AdminPatchObject_RejectsBadVisibility(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	bad := "world"
	if _, err := svc.AdminPatchObject(context.Background(), "f1", domain.OSSObjectAdminPatchRequest{
		Visibility: &bad,
	}); err == nil {
		t.Fatalf("bad visibility accepted")
	}
}

func TestOSSService_AdminDeleteObject_PassThrough(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)
	if _, err := svc.AdminDeleteObject(context.Background(), "f1"); err != nil {
		t.Fatalf("AdminDeleteObject: %v", err)
	}
	if len(repo.adminDeleteCalls) != 1 || repo.adminDeleteCalls[0] != "f1" {
		t.Errorf("delete call: %+v", repo.adminDeleteCalls)
	}
}

func TestOSSService_AdminDeleteObject_PropagatesAlreadyDeleted(t *testing.T) {
	repo := &fakeOSSRepo{
		adminDeleteErr:    infrastructure.ErrFileAlreadyDeleted,
		adminDeleteReturn: &domain.OSSObjectAdminDetail{ID: "f1"},
	}
	svc := NewOSSService(repo)

	row, err := svc.AdminDeleteObject(context.Background(), "f1")
	if !errors.Is(err, infrastructure.ErrFileAlreadyDeleted) {
		t.Fatalf("want ErrFileAlreadyDeleted, got %v", err)
	}
	if row == nil || row.ID != "f1" {
		t.Errorf("row should still be returned for idempotent path: %+v", row)
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
