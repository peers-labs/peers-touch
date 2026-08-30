package oauth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const acceptanceTestRunID = "20260829T120000000000Z-0123456789abcdef0123456789abcdef"

type acceptanceAdapterFixture struct {
	adapter *AcceptanceAdapter
	db      *gorm.DB
	lease   *MobileOAuthFixtureLease
	now     time.Time
	target  AcceptanceOperationTarget
}

func TestAcceptanceAdapterBootstrapAndTeardownOwnDisposableStorage(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)

	if !fixture.db.Migrator().HasTable(fixture.adapter.leaseTable) {
		t.Fatal("adapter bootstrap did not create lease table")
	}
	if !fixture.db.Migrator().HasTable(fixture.adapter.journalTable) {
		t.Fatal("adapter bootstrap did not create journal table")
	}

	cleanup := fixture.operationRequest(
		"cleanup-bootstrap-test",
		AcceptanceOperationCleanupRun,
		"",
	)
	if _, err := fixture.adapter.Execute(context.Background(), cleanup); err != nil {
		t.Fatalf("cleanup empty fixture run: %v", err)
	}
	if err := fixture.adapter.Teardown(context.Background()); err != nil {
		t.Fatalf("teardown adapter storage: %v", err)
	}
	if fixture.db.Migrator().HasTable(fixture.adapter.leaseTable) ||
		fixture.db.Migrator().HasTable(fixture.adapter.journalTable) {
		t.Fatal("adapter teardown left disposable storage behind")
	}
}

func TestAcceptanceAdapterIsNotExposedByOAuthHandlers(t *testing.T) {
	subserver := NewOAuthSubServer()
	for _, handler := range subserver.Handlers() {
		if strings.Contains(strings.ToLower(handler.Path()), "acceptance") {
			t.Fatalf("OAuth subserver exposed Acceptance route %q", handler.Path())
		}
	}
}

func TestAcceptanceAdapterProductionConstructorRequiresPostgres(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite database: %v", err)
	}
	if _, err := NewAcceptanceAdapter(database, acceptanceTestDeployment()); !errors.Is(err, ErrAcceptanceUnsupportedStore) {
		t.Fatalf("production constructor error = %v, want ErrAcceptanceUnsupportedStore", err)
	}
}

func TestAcceptanceAdapterLeaseIsFencedAndExpiredLeaseQuarantines(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	stale := AcceptanceLeaseIdentity{
		ResourceKey: fixture.lease.ResourceKey,
		HolderRunID: fixture.lease.HolderRunID,
		FenceToken:  fixture.lease.FenceToken + 1,
	}
	if _, err := fixture.adapter.HeartbeatLease(
		context.Background(),
		stale,
		fixture.now.Add(time.Minute),
		fixture.now.Add(2*time.Minute),
		fixture.now.Add(3*time.Minute),
	); !errors.Is(err, ErrAcceptanceStaleFence) {
		t.Fatalf("stale heartbeat error = %v, want ErrAcceptanceStaleFence", err)
	}

	fixture.adapter.now = func() time.Time { return fixture.now.Add(20 * time.Minute) }
	request := fixture.operationRequest(
		"expire-after-lease-expiry",
		AcceptanceOperationExpireAwaitingAttempt,
		"",
	)
	if _, err := fixture.adapter.Execute(context.Background(), request); !errors.Is(err, ErrAcceptanceLeaseUnavailable) {
		t.Fatalf("expired lease operation error = %v, want ErrAcceptanceLeaseUnavailable", err)
	}
	var record acceptanceLeaseRecord
	if err := fixture.db.Table(fixture.adapter.leaseTable).
		Where("resource_key = ?", fixture.lease.ResourceKey).
		First(&record).Error; err != nil {
		t.Fatalf("read quarantined lease: %v", err)
	}
	if record.State != acceptanceLeaseStateQuarantined {
		t.Fatalf("expired lease state = %q, want QUARANTINED", record.State)
	}
}

func TestAcceptanceAdapterPrepareIsAtomicAndIdempotent(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	request := fixture.operationRequest(
		"prepare-following-gate-ios",
		AcceptanceOperationPrepareFollowingGate,
		"INVITE-FOR-ACCEPTANCE",
	)
	first, err := fixture.adapter.Execute(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare following gate: %v", err)
	}
	second, err := fixture.adapter.Execute(context.Background(), request)
	if err != nil {
		t.Fatalf("recover committed prepare: %v", err)
	}
	if first.InputDigest != second.InputDigest || first.OperationID != second.OperationID {
		t.Fatalf("idempotent retry returned a different receipt: first=%+v second=%+v", first, second)
	}

	var policy dbmodel.AccessPolicy
	if err := fixture.db.First(&policy).Error; err != nil {
		t.Fatalf("read installed policy: %v", err)
	}
	if policy.Mode != "invite_only" || policy.EnabledGates != "1,2,5" || !policy.SelfServiceInvite {
		t.Fatalf("unexpected installed policy: %+v", policy)
	}
	var invites int64
	if err := fixture.db.Model(&dbmodel.AccessInviteCode{}).
		Where("created_by = ?", "mobile-oauth-acceptance:"+acceptanceTestRunID).
		Count(&invites).Error; err != nil {
		t.Fatalf("count run-owned invite codes: %v", err)
	}
	if invites != 1 {
		t.Fatalf("idempotent retry created %d invite codes, want 1", invites)
	}

	conflict := request
	conflict.VariantID = "following-gate-android"
	conflict.InputDigest = mustOperationDigest(t, conflict)
	if _, err := fixture.adapter.Execute(context.Background(), conflict); !errors.Is(err, ErrAcceptanceConflict) {
		t.Fatalf("operation ID conflict error = %v, want ErrAcceptanceConflict", err)
	}
}

func TestAcceptanceAdapterRejectsTargetOutsideRunLeaseCreationWindow(t *testing.T) {
	testCases := []struct {
		name      string
		model     any
		id        string
		createdAt func(*acceptanceAdapterFixture) time.Time
	}{
		{
			name:  "OAuth attempt predates run",
			model: &dbmodel.OAuthAttempt{},
			id:    "oauth-attempt-acceptance",
			createdAt: func(fixture *acceptanceAdapterFixture) time.Time {
				return fixture.now.Add(-time.Second)
			},
		},
		{
			name:  "Access attempt predates run",
			model: &dbmodel.AccessAttempt{},
			id:    "access-attempt-acceptance",
			createdAt: func(fixture *acceptanceAdapterFixture) time.Time {
				return fixture.now.Add(-time.Second)
			},
		},
		{
			name:  "OAuth attempt exceeds lease window",
			model: &dbmodel.OAuthAttempt{},
			id:    "oauth-attempt-acceptance",
			createdAt: func(fixture *acceptanceAdapterFixture) time.Time {
				return fixture.lease.ExpiresAt.Add(time.Second)
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newAcceptanceAdapterFixture(t)
			if err := fixture.db.Model(testCase.model).
				Where("id = ?", testCase.id).
				UpdateColumn("created_at", testCase.createdAt(fixture)).Error; err != nil {
				t.Fatalf("move target outside run lease creation window: %v", err)
			}

			request := fixture.operationRequest(
				"expire-outside-window",
				AcceptanceOperationExpireAwaitingAttempt,
				"",
			)
			if _, err := fixture.adapter.Execute(context.Background(), request); !errors.Is(err, ErrAcceptancePrecondition) {
				t.Fatalf("outside-window operation error = %v, want ErrAcceptancePrecondition", err)
			}

			var attempt dbmodel.OAuthAttempt
			if err := fixture.db.First(&attempt, "id = ?", fixture.target.OAuthAttemptRef).Error; err != nil {
				t.Fatalf("read rejected OAuth attempt: %v", err)
			}
			if !attempt.ExpiresAt.Equal(fixture.now.Add(10 * time.Minute)) {
				t.Fatalf("rejected target was mutated: expires_at=%s", attempt.ExpiresAt)
			}
		})
	}
}

func TestAcceptanceAdapterRecoveryRejectsStaleFence(t *testing.T) {
	testCases := []struct {
		name    string
		updates func(*acceptanceAdapterFixture) map[string]any
		wantErr error
	}{
		{
			name: "resource key changed",
			updates: func(fixture *acceptanceAdapterFixture) map[string]any {
				return map[string]any{
					"resource_key": fixture.lease.ResourceKey + "-replacement",
				}
			},
			wantErr: ErrAcceptanceLeaseUnavailable,
		},
		{
			name: "holder changed",
			updates: func(*acceptanceAdapterFixture) map[string]any {
				return map[string]any{
					"holder_run_id": "20260829T120001000000Z-abcdef0123456789abcdef0123456789",
				}
			},
			wantErr: ErrAcceptanceStaleFence,
		},
		{
			name: "fence advanced",
			updates: func(fixture *acceptanceAdapterFixture) map[string]any {
				return map[string]any{
					"fence_token": fixture.lease.FenceToken + 1,
				}
			},
			wantErr: ErrAcceptanceStaleFence,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newAcceptanceAdapterFixture(t)
			request := fixture.operationRequest(
				"expire-before-lease-identity-change",
				AcceptanceOperationExpireAwaitingAttempt,
				"",
			)
			if _, err := fixture.adapter.Execute(context.Background(), request); err != nil {
				t.Fatalf("commit operation before lease identity change: %v", err)
			}
			updates := testCase.updates(fixture)
			updates["updated_at"] = fixture.now.Add(time.Second)
			if err := fixture.db.Table(fixture.adapter.leaseTable).
				Where("resource_key = ?", fixture.lease.ResourceKey).
				Updates(updates).Error; err != nil {
				t.Fatalf("change current fixture lease identity: %v", err)
			}

			if _, err := fixture.adapter.Execute(context.Background(), request); !errors.Is(err, testCase.wantErr) {
				t.Fatalf("stale lease recovery error = %v, want %v", err, testCase.wantErr)
			}
		})
	}
}

func TestAcceptanceAdapterRecoveryRejectsReleasedLeaseAndKeepsCleanupIdempotent(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	prepare := fixture.operationRequest(
		"prepare-before-release",
		AcceptanceOperationPrepareFollowingGate,
		"INVITE-FOR-RELEASE",
	)
	if _, err := fixture.adapter.Execute(context.Background(), prepare); err != nil {
		t.Fatalf("prepare fixture before release: %v", err)
	}
	cleanup := fixture.operationRequest(
		"cleanup-before-recovery",
		AcceptanceOperationCleanupRun,
		"",
	)
	firstCleanup, err := fixture.adapter.Execute(context.Background(), cleanup)
	if err != nil {
		t.Fatalf("cleanup fixture before recovery: %v", err)
	}
	recoveredCleanup, err := fixture.adapter.Execute(context.Background(), cleanup)
	if err != nil {
		t.Fatalf("recover committed cleanup after release: %v", err)
	}
	if recoveredCleanup.OperationID != firstCleanup.OperationID ||
		recoveredCleanup.InputDigest != firstCleanup.InputDigest {
		t.Fatalf("cleanup retry returned a different receipt: first=%+v recovered=%+v", firstCleanup, recoveredCleanup)
	}

	if _, err := fixture.adapter.Execute(context.Background(), prepare); !errors.Is(err, ErrAcceptanceStaleFence) {
		t.Fatalf("released-lease mutation recovery error = %v, want ErrAcceptanceStaleFence", err)
	}
}

func TestAcceptanceAdapterMutationAndJournalRollbackTogether(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	request := fixture.operationRequest(
		"expire-awaiting-ios",
		AcceptanceOperationExpireAwaitingAttempt,
		"",
	)
	var before dbmodel.OAuthAttempt
	if err := fixture.db.First(&before, "id = ?", fixture.target.OAuthAttemptRef).Error; err != nil {
		t.Fatalf("read OAuth attempt before rollback test: %v", err)
	}
	fixture.adapter.hooks.afterBusinessMutation = func() error {
		return errors.New("injected failure before journal commit")
	}
	if _, err := fixture.adapter.Execute(context.Background(), request); err == nil {
		t.Fatal("expected injected transaction failure")
	}
	var after dbmodel.OAuthAttempt
	if err := fixture.db.First(&after, "id = ?", fixture.target.OAuthAttemptRef).Error; err != nil {
		t.Fatalf("read OAuth attempt after rollback test: %v", err)
	}
	if !after.ExpiresAt.Equal(before.ExpiresAt) {
		t.Fatalf("business mutation committed without journal: before=%s after=%s", before.ExpiresAt, after.ExpiresAt)
	}
	var journalCount int64
	if err := fixture.db.Table(fixture.adapter.journalTable).
		Where("operation_id = ?", request.OperationID).
		Count(&journalCount).Error; err != nil {
		t.Fatalf("count rolled-back journal: %v", err)
	}
	if journalCount != 0 {
		t.Fatalf("rolled-back operation left %d journal rows", journalCount)
	}

	fixture.adapter.hooks.afterBusinessMutation = nil
	if _, err := fixture.adapter.Execute(context.Background(), request); err != nil {
		t.Fatalf("execute expiry after rollback: %v", err)
	}
	if err := fixture.db.First(&after, "id = ?", fixture.target.OAuthAttemptRef).Error; err != nil {
		t.Fatalf("read expired OAuth attempt: %v", err)
	}
	if !after.ExpiresAt.Before(fixture.now) {
		t.Fatalf("OAuth attempt expiry was not moved behind observation time: %s", after.ExpiresAt)
	}
}

func TestAcceptanceAdapterSnapshotAndZeroResidueCleanup(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	prepare := fixture.operationRequest(
		"prepare-proof-ios",
		AcceptanceOperationPrepareFollowingGate,
		"INVITE-FOR-PROOF",
	)
	if _, err := fixture.adapter.Execute(context.Background(), prepare); err != nil {
		t.Fatalf("prepare following gate: %v", err)
	}

	candidate := dbmodel.OAuthSessionCandidate{
		ID:                  "oauth-candidate-acceptance",
		OAuthAttemptID:      fixture.target.OAuthAttemptRef,
		AccessAttemptID:     fixture.target.AccessAttemptRef,
		StationPeerID:       fixture.adapter.deployment.StationPeerID,
		DeviceID:            fixture.target.DeviceAlias,
		LifecycleGeneration: fixture.target.LifecycleGeneration,
		ActorID:             41,
		ActorPTID:           "ptid:fixture-alice",
		ActorKind:           1,
		State:               candidateStateInactive,
		ExpiresAt:           fixture.now.Add(5 * time.Minute),
	}
	if err := fixture.db.Create(&candidate).Error; err != nil {
		t.Fatalf("seed OAuth candidate: %v", err)
	}
	if err := fixture.db.Model(&dbmodel.OAuthAttempt{}).
		Where("id = ?", fixture.target.OAuthAttemptRef).
		Updates(map[string]any{
			"candidate_id": candidate.ID,
			"state":        oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FOLLOWING_GATE,
			"result":       oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED,
		}).Error; err != nil {
		t.Fatalf("bind OAuth candidate: %v", err)
	}
	if err := fixture.db.Create(&dbmodel.OAuth2IdentityBinding{
		ActorID:        candidate.ActorID,
		ProviderID:     "github",
		ProviderUserID: "provider-user-not-emitted",
	}).Error; err != nil {
		t.Fatalf("seed provider binding: %v", err)
	}

	fixture.adapter.hooks.snapshotIdentifier = func(*gorm.DB) (string, error) {
		return "sqlite-repeatable-read-test-snapshot", nil
	}
	snapshot, err := fixture.adapter.ReadProofSnapshot(context.Background(), StationOAuthProofRequest{
		OperationID:            prepare.OperationID,
		Lease:                  fixture.leaseIdentity(),
		VariantID:              prepare.VariantID,
		SnapshotPhase:          "post_action",
		Target:                 fixture.target,
		ExpectedProvider:       "github",
		ProviderCorrelationKey: []byte("0123456789abcdef0123456789abcdef"),
	})
	if err != nil {
		t.Fatalf("read post-action proof snapshot: %v", err)
	}
	if snapshot.Observation.Isolation != "postgresql-repeatable-read-read-only" ||
		snapshot.Candidate.Count != 1 ||
		!snapshot.ProviderBinding.CandidateCorrelationPresent ||
		snapshot.ProviderBinding.ProviderSubjectFingerprint == "" {
		t.Fatalf("snapshot lacks authoritative joined proof: %+v", snapshot)
	}
	if snapshot.ProviderBinding.ProviderSubjectFingerprint == "provider-user-not-emitted" {
		t.Fatal("snapshot exposed provider subject instead of run-scoped HMAC")
	}

	cleanup := fixture.operationRequest(
		"cleanup-proof-ios",
		AcceptanceOperationCleanupRun,
		"",
	)
	cleanup.OAuthState = oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_FOLLOWING_GATE.String()
	cleanup.InputDigest = mustOperationDigest(t, cleanup)
	if _, err := fixture.adapter.Execute(context.Background(), cleanup); err != nil {
		t.Fatalf("cleanup fixture run: %v", err)
	}

	postCleanup, err := fixture.adapter.ReadProofSnapshot(context.Background(), StationOAuthProofRequest{
		OperationID:      cleanup.OperationID,
		Lease:            fixture.leaseIdentity(),
		VariantID:        cleanup.VariantID,
		SnapshotPhase:    "post_cleanup",
		Target:           fixture.target,
		ExpectedProvider: "github",
	})
	if err != nil {
		t.Fatalf("read post-cleanup proof snapshot: %v", err)
	}
	if !postCleanup.Fixture.PolicyRestored {
		t.Fatal("post-cleanup snapshot did not prove exact policy restoration")
	}
	if postCleanup.RunOwnedResidue != (StationOAuthProofResidue{}) {
		t.Fatalf("post-cleanup residue = %+v, want zero", postCleanup.RunOwnedResidue)
	}
	var policy dbmodel.AccessPolicy
	if err := fixture.db.First(&policy).Error; err != nil {
		t.Fatalf("read restored policy: %v", err)
	}
	if policy.Mode != "open" || policy.EnabledGates != "" || policy.SelfServiceInvite {
		t.Fatalf("policy was not restored exactly: %+v", policy)
	}
}

func TestAcceptanceAdapterCleanupRejectsConcurrentPolicyRevision(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	prepare := fixture.operationRequest(
		"prepare-conflict-ios",
		AcceptanceOperationPrepareFollowingGate,
		"INVITE-FOR-CONFLICT",
	)
	if _, err := fixture.adapter.Execute(context.Background(), prepare); err != nil {
		t.Fatalf("prepare following gate: %v", err)
	}
	if err := fixture.db.Model(&dbmodel.AccessPolicy{}).
		Where("id = ?", 1).
		Updates(map[string]any{
			"mode":       "closed",
			"updated_by": "operator",
			"updated_at": fixture.now.Add(time.Minute),
		}).Error; err != nil {
		t.Fatalf("simulate operator policy update: %v", err)
	}

	cleanup := fixture.operationRequest(
		"cleanup-conflict-ios",
		AcceptanceOperationCleanupRun,
		"",
	)
	if _, err := fixture.adapter.Execute(context.Background(), cleanup); !errors.Is(err, ErrAcceptanceCleanupConflict) {
		t.Fatalf("cleanup conflict error = %v, want ErrAcceptanceCleanupConflict", err)
	}
	var policy dbmodel.AccessPolicy
	if err := fixture.db.First(&policy).Error; err != nil {
		t.Fatalf("read operator policy after conflict: %v", err)
	}
	if policy.Mode != "closed" || policy.UpdatedBy != "operator" {
		t.Fatalf("cleanup overwrote concurrent operator policy: %+v", policy)
	}
}

func TestFinalizeAcceptanceOperationProducesFrozenE2Payload(t *testing.T) {
	fixture := newAcceptanceAdapterFixture(t)
	request := fixture.operationRequest(
		"expire-finalize-ios",
		AcceptanceOperationExpireAwaitingAttempt,
		"",
	)
	receipt, err := fixture.adapter.Execute(context.Background(), request)
	if err != nil {
		t.Fatalf("execute operation for finalization: %v", err)
	}
	ref := func(path, digest string) AcceptanceArtifactRef {
		return AcceptanceArtifactRef{
			ArtifactKind: "acceptance-artifact-ref",
			WorkspaceID:  "workspace-id",
			GateID:       MobileOAuthAcceptanceGateID,
			RunID:        acceptanceTestRunID,
			Path:         path,
			SHA256:       digest,
			MediaType:    "application/json",
		}
	}
	artifact, err := FinalizeAcceptanceOperation(receipt, AcceptanceOperationArtifactRefs{
		Before:      ref("runtime/mobile/fixtures/station-primary/before.json", strings.Repeat("a", 64)),
		After:       ref("runtime/mobile/fixtures/station-primary/after.json", strings.Repeat("b", 64)),
		PostCleanup: ref("runtime/mobile/fixtures/station-primary/post-cleanup.json", strings.Repeat("c", 64)),
	})
	if err != nil {
		t.Fatalf("finalize E2 operation artifact: %v", err)
	}
	if artifact.ArtifactKind != "mobile-oauth-fixture-operation" ||
		artifact.Precondition.OAuthState != request.OAuthState ||
		!artifact.Precondition.RunOwned ||
		artifact.Result.JournalState != acceptanceJournalStateCommitted ||
		artifact.Result.AffectedRows != 1 {
		t.Fatalf("finalized artifact does not match frozen E2 shape: %+v", artifact)
	}
}

func newAcceptanceAdapterFixture(t *testing.T) *acceptanceAdapterFixture {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared&_busy_timeout=10000", uuid.NewString())
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open Acceptance adapter test database: %v", err)
	}
	if err := database.AutoMigrate(
		&dbmodel.AccessPolicy{},
		&dbmodel.AccessAttempt{},
		&dbmodel.AccessInviteCode{},
		&dbmodel.OAuthAttempt{},
		&dbmodel.OAuthSessionCandidate{},
		&dbmodel.OAuthCredentialEnvelope{},
		&dbmodel.OAuth2IdentityBinding{},
		&session.SessionRecord{},
	); err != nil {
		t.Fatalf("migrate production fixture tables: %v", err)
	}
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	policy := dbmodel.AccessPolicy{
		ID:        1,
		Mode:      "open",
		UpdatedBy: "operator-before-run",
		CreatedAt: now.Add(-time.Hour),
		UpdatedAt: now.Add(-time.Hour),
	}
	if err := database.Create(&policy).Error; err != nil {
		t.Fatalf("seed Access policy: %v", err)
	}

	deployment := acceptanceTestDeployment()
	adapter, err := newAcceptanceAdapter(database, deployment, true)
	if err != nil {
		t.Fatalf("construct Acceptance adapter: %v", err)
	}
	adapter.now = func() time.Time { return now }
	if err := adapter.Bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap Acceptance adapter: %v", err)
	}
	lease, err := adapter.AcquireLease(context.Background(), AcceptanceLeaseRequest{
		RunID:       acceptanceTestRunID,
		GateID:      MobileOAuthAcceptanceGateID,
		ResourceKey: "station/station-primary/mobile-oauth-fixture",
		HeartbeatAt: now,
		RenewBefore: now.Add(5 * time.Minute),
		ExpiresAt:   now.Add(10 * time.Minute),
	})
	if err != nil {
		t.Fatalf("acquire Acceptance fixture lease: %v", err)
	}

	target := AcceptanceOperationTarget{
		ServiceID:           "station-primary",
		OAuthAttemptRef:     "oauth-attempt-acceptance",
		AccessAttemptRef:    "access-attempt-acceptance",
		DeviceAlias:         "alice-ios",
		LifecycleGeneration: 7,
	}
	if err := database.Create(&dbmodel.AccessAttempt{
		ID:               target.AccessAttemptRef,
		Status:           "action_required",
		StationPeerID:    deployment.StationPeerID,
		DeviceID:         target.DeviceAlias,
		CurrentGateID:    "auth.login",
		DecisionRevision: 3,
		CreatedAt:        now,
		UpdatedAt:        now,
		ExpiresAt:        now.Add(15 * time.Minute),
	}).Error; err != nil {
		t.Fatalf("seed Access attempt: %v", err)
	}
	liveBinding := "acceptance-live-binding"
	if err := database.Create(&dbmodel.OAuthAttempt{
		ID:                          target.OAuthAttemptRef,
		Provider:                    "github",
		StationPeerID:               deployment.StationPeerID,
		AccessAttemptID:             target.AccessAttemptRef,
		GateID:                      "auth.login",
		RedirectURI:                 "peers-touch://oauth/callback",
		PKCEChallenge:               "pkce-challenge",
		NonceHash:                   "nonce-hash",
		StateHash:                   "state-hash",
		DeviceID:                    target.DeviceAlias,
		LifecycleGeneration:         target.LifecycleGeneration,
		AttemptSecretHash:           []byte("attempt-secret-hash"),
		CredentialDeliveryPublicKey: []byte("credential-delivery-public-key"),
		LiveBindingKey:              &liveBinding,
		State:                       int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER),
		Result:                      int32(oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_PENDING),
		CreatedAt:                   now,
		UpdatedAt:                   now,
		ExpiresAt:                   now.Add(10 * time.Minute),
	}).Error; err != nil {
		t.Fatalf("seed OAuth attempt: %v", err)
	}
	return &acceptanceAdapterFixture{
		adapter: adapter,
		db:      database,
		lease:   lease,
		now:     now,
		target:  target,
	}
}

func acceptanceTestDeployment() AcceptanceDeployment {
	return AcceptanceDeployment{
		ServiceID:                "station-primary",
		StationPeerID:            "12D3KooWAcceptanceStation",
		DeploymentEnvironment:    "mobile-native",
		LiveCommit:               "1111111111111111111111111111111111111111",
		WorkspaceDigest:          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
		ProtocolDigest:           "sha256:3333333333333333333333333333333333333333333333333333333333333333",
		DeploymentLeaseMatched:   true,
		DisposableTargetVerified: true,
		DestructiveResetApproved: true,
		ServiceAttestation: AcceptanceArtifactRef{
			ArtifactKind: "acceptance-artifact-ref",
			WorkspaceID:  "workspace-id",
			GateID:       MobileOAuthAcceptanceGateID,
			RunID:        acceptanceTestRunID,
			Path:         "runtime/services/station-primary/attestation.json",
			SHA256:       "4444444444444444444444444444444444444444444444444444444444444444",
			MediaType:    "application/json",
		},
	}
}

func (f *acceptanceAdapterFixture) leaseIdentity() AcceptanceLeaseIdentity {
	return AcceptanceLeaseIdentity{
		ResourceKey: f.lease.ResourceKey,
		HolderRunID: f.lease.HolderRunID,
		FenceToken:  f.lease.FenceToken,
	}
}

func (f *acceptanceAdapterFixture) operationRequest(
	operationID, operation, inviteCode string,
) AcceptanceOperationRequest {
	request := AcceptanceOperationRequest{
		OperationID: operationID,
		Lease:       f.leaseIdentity(),
		VariantID:   "following-gate-ios",
		Operation:   operation,
		Target:      f.target,
		OAuthState:  oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER.String(),
		InviteCode:  inviteCode,
	}
	request.InputDigest = mustOperationDigest(nil, request)
	return request
}

func mustOperationDigest(t *testing.T, request AcceptanceOperationRequest) string {
	digest, err := operationInputDigest(request)
	if err != nil {
		if t != nil {
			t.Fatalf("compute operation input digest: %v", err)
		}
		panic(err)
	}
	return digest
}
