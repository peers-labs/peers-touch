// OSSService is a thin adapter, but the small amount of logic it
// owns (input validation, pagination defaults, "missing bucket"
// vs "empty bucket" semantics) is the kind of glue that breaks
// silently. These tests pin its observable behaviour against a
// fake repo, independent of GORM/sqlite.
package application

import (
	"context"
	"errors"
	"io"
	"mime/multipart"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossservice "github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	ossstorage "github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
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

	rotateCalls  int
	rotateReturn *domain.OSSFederationRotateResponse
	rotateErr    error

	forgetCalls []string
	forgetErr   error

	workersCalls    int
	workersLastSpan time.Duration
	workersReturn   *domain.OSSWorkersSummary
	workersErr      error
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

func (f *fakeOSSRepo) RotateFederationLocalKey(_ context.Context) (*domain.OSSFederationRotateResponse, error) {
	f.rotateCalls++
	if f.rotateErr != nil {
		return nil, f.rotateErr
	}
	if f.rotateReturn != nil {
		return f.rotateReturn, nil
	}
	return &domain.OSSFederationRotateResponse{NewKID: "kid-new"}, nil
}

func (f *fakeOSSRepo) ForgetPeer(_ context.Context, peerStationID string) error {
	f.forgetCalls = append(f.forgetCalls, peerStationID)
	return f.forgetErr
}

func (f *fakeOSSRepo) ListWorkers(_ context.Context, lookback time.Duration) (*domain.OSSWorkersSummary, error) {
	f.workersCalls++
	f.workersLastSpan = lookback
	if f.workersErr != nil {
		return nil, f.workersErr
	}
	if f.workersReturn != nil {
		return f.workersReturn, nil
	}
	return &domain.OSSWorkersSummary{LookbackHours: lookback.Hours()}, nil
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

func TestOSSService_RotateFederationLocalKey_DelegatesAndReturns(t *testing.T) {
	want := &domain.OSSFederationRotateResponse{
		NewKID:            "kid-new",
		PreviousKID:       "kid-old",
		CapabilityVersion: "cv-1",
	}
	repo := &fakeOSSRepo{rotateReturn: want}
	svc := NewOSSService(repo)

	got, err := svc.RotateFederationLocalKey(context.Background())
	if err != nil {
		t.Fatalf("RotateFederationLocalKey: %v", err)
	}
	if got != want {
		t.Errorf("response: got %+v want %+v", got, want)
	}
	if repo.rotateCalls != 1 {
		t.Errorf("expected 1 rotate call, got %d", repo.rotateCalls)
	}
}

func TestOSSService_RotateFederationLocalKey_PropagatesError(t *testing.T) {
	boom := errors.New("rotation boom")
	repo := &fakeOSSRepo{rotateErr: boom}
	svc := NewOSSService(repo)

	_, err := svc.RotateFederationLocalKey(context.Background())
	if err == nil || err.Error() != "rotation boom" {
		t.Errorf("expected propagated error, got %v", err)
	}
}

func TestOSSService_ForgetPeer_RequiresPeerID(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)
	if err := svc.ForgetPeer(context.Background(), ""); err == nil {
		t.Errorf("empty peer id should be rejected at the service layer")
	}
	if len(repo.forgetCalls) != 0 {
		t.Errorf("repo should not be called on validation failure: %+v", repo.forgetCalls)
	}
}

func TestOSSService_ForgetPeer_DelegatesToRepo(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)
	if err := svc.ForgetPeer(context.Background(), "peer-x"); err != nil {
		t.Fatalf("ForgetPeer: %v", err)
	}
	if len(repo.forgetCalls) != 1 || repo.forgetCalls[0] != "peer-x" {
		t.Errorf("repo forget calls: %+v", repo.forgetCalls)
	}
}

func TestOSSService_ListWorkers_RejectsNegativeLookback(t *testing.T) {
	repo := &fakeOSSRepo{}
	svc := NewOSSService(repo)
	if _, err := svc.ListWorkers(context.Background(), -time.Second); err == nil {
		t.Errorf("negative lookback should be rejected")
	}
	if repo.workersCalls != 0 {
		t.Errorf("repo should not be called on validation failure")
	}
}

func TestOSSService_ListWorkers_DelegatesAndPassesLookback(t *testing.T) {
	want := &domain.OSSWorkersSummary{
		Items: []domain.OSSWorkerHeartbeat{
			{Name: "ttl_sweeper", RunCount: 4, ErrorCount: 1, LastOutcome: "ok"},
		},
		LookbackHours: 12,
	}
	repo := &fakeOSSRepo{workersReturn: want}
	svc := NewOSSService(repo)

	got, err := svc.ListWorkers(context.Background(), 12*time.Hour)
	if err != nil {
		t.Fatalf("ListWorkers: %v", err)
	}
	if got != want {
		t.Errorf("response: got %+v want %+v", got, want)
	}
	if repo.workersLastSpan != 12*time.Hour {
		t.Errorf("lookback should pass through unchanged: got %v", repo.workersLastSpan)
	}
}

// ---------------------------------------------------------------------------
// AdminUploadObject
// ---------------------------------------------------------------------------

// stubFileService captures the SaveFile attribution and returns a
// canned FileMeta. The other two interface methods (`PrepareUpload`
// / `CompleteUpload` / `GetFileMeta`) are unused on this code path
// so they panic — the tests are an explicit guard against the
// service trying to take a presigned route for an admin upload.
type stubFileService struct {
	lastAttr ossservice.UploadAttribution
	saveErr  error
	saveMeta *ossmodel.FileMeta
}

func (s *stubFileService) SaveFile(_ context.Context, attr ossservice.UploadAttribution, _ multipart.File, _ *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	s.lastAttr = attr
	if s.saveErr != nil {
		return nil, s.saveErr
	}
	if s.saveMeta != nil {
		return s.saveMeta, nil
	}
	return &ossmodel.FileMeta{ID: "f1", Key: "cas/aa/bb"}, nil
}
func (s *stubFileService) GetFileMeta(_ context.Context, _ string) (*ossmodel.FileMeta, error) {
	panic("admin upload should not call GetFileMeta")
}
func (s *stubFileService) PrepareUpload(_ context.Context, _ ossstorage.PresignedBackend, _ ossservice.UploadAttribution, _ ossservice.PrepareUploadRequest, _ time.Duration) (ossservice.PrepareUploadResult, error) {
	panic("admin upload should not call PrepareUpload")
}
func (s *stubFileService) CompleteUpload(_ context.Context, _ ossstorage.PresignedBackend, _ ossservice.UploadAttribution, _ ossservice.CompleteUploadRequest) (*ossmodel.FileMeta, error) {
	panic("admin upload should not call CompleteUpload")
}
func (s *stubFileService) DeleteFile(_ context.Context, _, _ string) (*ossservice.DeleteResult, error) {
	panic("admin upload should not call DeleteFile")
}
func (s *stubFileService) RestoreFile(_ context.Context, _, _ string, _ time.Duration) (*ossservice.RestoreResult, error) {
	panic("admin upload should not call RestoreFile")
}
func (s *stubFileService) PatchFile(_ context.Context, _, _ string, _ ossservice.PatchRequest) (*ossservice.PatchResult, error) {
	panic("admin upload should not call PatchFile")
}
func (s *stubFileService) ListMyFiles(_ context.Context, _ string, _ ossservice.ListMyFilesRequest) (*ossservice.ListMyFilesResult, error) {
	panic("admin upload should not call ListMyFiles")
}

// stubProvider hands the OSSService a minimal FileServiceProvider.
// We bake in a sentinel `MaxFileSize` so the handler-side check
// (when added) round-trips a non-zero budget.
type stubProvider struct {
	fs  ossservice.FileService
	max int64
}

func (s *stubProvider) FileService() ossservice.FileService { return s.fs }
func (s *stubProvider) MaxFileSize() int64                  { return s.max }

// nopMultipartFile is a near-empty `multipart.File` that satisfies
// the interface without doing real I/O. The stub FileService never
// reads from it; it exists only to populate `AdminUploadInput.File`
// since the service rejects nil there.
type nopMultipartFile struct{}

func (nopMultipartFile) Read(_ []byte) (int, error)                 { return 0, io.EOF }
func (nopMultipartFile) Close() error                               { return nil }
func (nopMultipartFile) Seek(_ int64, _ int) (int64, error)         { return 0, nil }
func (nopMultipartFile) ReadAt(_ []byte, _ int64) (int, error)      { return 0, io.EOF }

func newAdminUploadFixture(t *testing.T, bucket domain.OSSBucketSummary, fileMeta *ossmodel.FileMeta) (*OSSService, *stubFileService, *fakeOSSRepo) {
	t.Helper()
	fs := &stubFileService{saveMeta: fileMeta}
	repo := &fakeOSSRepo{
		buckets: []domain.OSSBucketSummary{bucket},
		adminObjects: []domain.OSSObjectAdminDetail{{
			ID:           fileMeta.ID,
			Key:          fileMeta.Key,
			BucketID:     bucket.ID,
			OwnerActorID: bucket.OwnerActorID,
			Visibility:   bucket.DefaultVisibility,
		}},
	}
	svc := NewOSSService(repo)
	svc.SetFileServiceProvider(&stubProvider{fs: fs, max: 16 << 20})
	return svc, fs, repo
}

func adminUploadInput(bucketID string) AdminUploadInput {
	return AdminUploadInput{
		BucketID: bucketID,
		File:     nopMultipartFile{},
		Header:   &multipart.FileHeader{Filename: "from-multipart.bin", Size: 1024},
	}
}

func TestOSSService_AdminUpload_RejectsWithoutFileService(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	_, err := svc.AdminUploadObject(context.Background(), adminUploadInput("b1"))
	if !errors.Is(err, ErrAdminUploadUnavailable) {
		t.Fatalf("expected ErrAdminUploadUnavailable, got %v", err)
	}
}

func TestOSSService_AdminUpload_RequiresBucketID(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{})
	svc.SetFileServiceProvider(&stubProvider{fs: &stubFileService{}, max: 1024})
	_, err := svc.AdminUploadObject(context.Background(), adminUploadInput("   "))
	if !errors.Is(err, ErrAdminUploadBucketRequired) {
		t.Fatalf("expected ErrAdminUploadBucketRequired, got %v", err)
	}
}

func TestOSSService_AdminUpload_RejectsMissingBucket(t *testing.T) {
	svc := NewOSSService(&fakeOSSRepo{}) // no buckets seeded
	svc.SetFileServiceProvider(&stubProvider{fs: &stubFileService{}, max: 1024})
	_, err := svc.AdminUploadObject(context.Background(), adminUploadInput("missing-bucket"))
	if err == nil || !contains(err.Error(), "bucket not found") {
		t.Fatalf("expected `bucket not found`, got %v", err)
	}
}

func TestOSSService_AdminUpload_RejectsBucketWithoutOwner(t *testing.T) {
	bucket := domain.OSSBucketSummary{ID: "sys", Name: "chat", OwnerActorID: "", DefaultVisibility: "chat"}
	svc, _, _ := newAdminUploadFixture(t, bucket, &ossmodel.FileMeta{ID: "f1"})
	_, err := svc.AdminUploadObject(context.Background(), adminUploadInput("sys"))
	if err == nil || !contains(err.Error(), "owner_actor_id") {
		t.Fatalf("expected owner_actor_id rejection, got %v", err)
	}
}

func TestOSSService_AdminUpload_RejectsUnknownVisibility(t *testing.T) {
	bucket := domain.OSSBucketSummary{ID: "u1", Name: "attachments", OwnerActorID: "actor-A", DefaultVisibility: "private"}
	svc, fs, _ := newAdminUploadFixture(t, bucket, &ossmodel.FileMeta{ID: "f1"})

	in := adminUploadInput("u1")
	in.Visibility = "weird"
	_, err := svc.AdminUploadObject(context.Background(), in)
	if err == nil || !contains(err.Error(), "visibility") {
		t.Fatalf("expected visibility rejection, got %v", err)
	}
	if fs.lastAttr.ActorID != "" {
		t.Errorf("file service should NOT be called when validation fails")
	}
}

func TestOSSService_AdminUpload_DefaultsVisibilityFromBucket(t *testing.T) {
	bucket := domain.OSSBucketSummary{ID: "u1", Name: "attachments", OwnerActorID: "actor-A", DefaultVisibility: "public"}
	meta := &ossmodel.FileMeta{ID: "f1", Key: "cas/aa/bb"}
	svc, fs, _ := newAdminUploadFixture(t, bucket, meta)

	row, err := svc.AdminUploadObject(context.Background(), adminUploadInput("u1"))
	if err != nil {
		t.Fatalf("AdminUploadObject: %v", err)
	}
	if row.ID != "f1" {
		t.Errorf("ID: got %q want %q", row.ID, "f1")
	}
	if fs.lastAttr.ActorID != "actor-A" {
		t.Errorf("ActorID: got %q want %q", fs.lastAttr.ActorID, "actor-A")
	}
	if fs.lastAttr.BucketName != "attachments" {
		t.Errorf("BucketName: got %q want %q", fs.lastAttr.BucketName, "attachments")
	}
	if fs.lastAttr.Visibility != "public" {
		t.Errorf("Visibility (default): got %q want %q", fs.lastAttr.Visibility, "public")
	}
}

func TestOSSService_AdminUpload_HonorsExplicitVisibilityAndChatSession(t *testing.T) {
	bucket := domain.OSSBucketSummary{ID: "u1", Name: "attachments", OwnerActorID: "actor-A", DefaultVisibility: "private"}
	meta := &ossmodel.FileMeta{ID: "f1", Key: "cas/aa/bb"}
	svc, fs, _ := newAdminUploadFixture(t, bucket, meta)

	in := adminUploadInput("u1")
	in.Visibility = "chat"
	in.ChatSessionID = " session-XYZ "
	if _, err := svc.AdminUploadObject(context.Background(), in); err != nil {
		t.Fatalf("AdminUploadObject: %v", err)
	}
	if fs.lastAttr.Visibility != "chat" {
		t.Errorf("Visibility: got %q want %q", fs.lastAttr.Visibility, "chat")
	}
	if fs.lastAttr.ChatSessionID != "session-XYZ" {
		t.Errorf("ChatSessionID: got %q (expected trimmed `session-XYZ`)", fs.lastAttr.ChatSessionID)
	}
}

func TestOSSService_AdminUpload_HonorsFilenameOverride(t *testing.T) {
	bucket := domain.OSSBucketSummary{ID: "u1", Name: "attachments", OwnerActorID: "actor-A", DefaultVisibility: "private"}
	meta := &ossmodel.FileMeta{ID: "f1", Key: "cas/aa/bb"}
	svc, fs, _ := newAdminUploadFixture(t, bucket, meta)

	in := adminUploadInput("u1")
	in.Filename = "operator-renamed.bin"
	if _, err := svc.AdminUploadObject(context.Background(), in); err != nil {
		t.Fatalf("AdminUploadObject: %v", err)
	}
	if fs.lastAttr.ActorID != "actor-A" {
		t.Errorf("ActorID: got %q want %q", fs.lastAttr.ActorID, "actor-A")
	}
	// Header rewrite happens inside the service; we cannot inspect
	// it here without exporting the call, but we can verify that
	// the upload succeeded — the stub ignores the header.
}

// contains is a tiny helper to keep error-substring assertions
// readable without pulling in a third-party matcher library.
func contains(s, substr string) bool { return strings.Contains(s, substr) }
