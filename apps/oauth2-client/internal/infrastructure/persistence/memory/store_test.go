package memory

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

func TestRecordAuthorizationFailureDistinguishesOccurrences(t *testing.T) {
	store := NewStore()
	first := time.Date(2026, 9, 1, 1, 0, 0, 0, time.UTC)
	record := func(occurredAt time.Time) {
		t.Helper()
		if err := store.RecordAuthorizationFailure(context.Background(), entity.AuthorizationFailure{
			State:           "repeated-failure-state",
			Provider:        valueobject.ProviderGitHub,
			CodeFingerprint: "code-fingerprint",
			ErrorCode:       "provider_unavailable",
			OccurredAt:      occurredAt,
		}); err != nil {
			t.Fatal(err)
		}
	}
	record(first)
	record(first)
	record(first.Add(time.Second))

	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Events) != 2 ||
		snapshot.Events[0].EventID == snapshot.Events[1].EventID {
		t.Fatalf("distinct failure occurrences were collapsed: %#v", snapshot.Events)
	}
}

func TestRefreshClaimBlocksRetriesUntilCommitted(t *testing.T) {
	store := NewStore()
	now := time.Date(2026, 10, 1, 2, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "refresh-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	identity, err := store.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "login",
		Identity:     entity.ProviderIdentity{ProviderUserID: "42"},
		Tokens: entity.TokenSet{
			AccessToken:  "access-old",
			RefreshToken: "refresh-old",
			ObtainedAt:   now,
		},
		CompletedAt: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	claim, err := store.ClaimCredentialRefresh(
		context.Background(),
		identity.IdentityID,
		"refresh-1",
		now.Add(2*time.Minute),
	)
	if err != nil || claim.State != entity.CredentialRefreshClaimAcquired || claim.ClaimID == "" {
		t.Fatalf("claim was not acquired: claim=%#v err=%v", claim, err)
	}
	retry, err := store.ClaimCredentialRefresh(
		context.Background(),
		identity.IdentityID,
		"refresh-1",
		now.Add(3*time.Minute),
	)
	if err != nil || retry.State != entity.CredentialRefreshClaimUncertain || retry.ClaimID != "" {
		t.Fatalf("retry acquired unresolved claim: claim=%#v err=%v", retry, err)
	}
	if _, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "refresh-1",
		ClaimID:            "wrong-owner",
		ExpectedGeneration: 1,
		Tokens:             entity.TokenSet{AccessToken: "must-not-commit"},
		RefreshedAt:        now.Add(3 * time.Minute),
	}); !errors.Is(err, repository.ErrCredentialRefreshUncertain) {
		t.Fatalf("non-owner completed refresh: %v", err)
	}
	refreshed, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "refresh-1",
		ClaimID:            claim.ClaimID,
		ExpectedGeneration: claim.CredentialGeneration,
		Tokens:             entity.TokenSet{AccessToken: "access-new"},
		RefreshedAt:        now.Add(3 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Generation != 2 || refreshed.LastRefreshOperationID != "refresh-1" {
		t.Fatalf("claim completion did not advance credential: %#v", refreshed)
	}
	committed, err := store.ClaimCredentialRefresh(
		context.Background(),
		identity.IdentityID,
		"refresh-1",
		now.Add(4*time.Minute),
	)
	if err != nil || committed.State != entity.CredentialRefreshClaimCommitted {
		t.Fatalf("committed operation did not converge: claim=%#v err=%v", committed, err)
	}
}

func TestReleasedRefreshClaimCanBeReacquired(t *testing.T) {
	store := NewStore()
	now := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	identity := seedRefreshCredential(t, store, now)

	first, err := store.ClaimCredentialRefresh(
		context.Background(),
		identity.IdentityID,
		"refresh-retry",
		now.Add(time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ReleaseCredentialRefreshClaim(context.Background(), *first); err != nil {
		t.Fatal(err)
	}
	second, err := store.ClaimCredentialRefresh(
		context.Background(),
		identity.IdentityID,
		"refresh-retry",
		now.Add(2*time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if second.State != entity.CredentialRefreshClaimAcquired ||
		second.ClaimID == "" ||
		second.ClaimID == first.ClaimID {
		t.Fatalf("released claim was not reacquired with a new owner: %#v", second)
	}
	if err := store.ReleaseCredentialRefreshClaim(context.Background(), *first); !errors.Is(err, repository.ErrCredentialRefreshUncertain) {
		t.Fatalf("stale claim owner released reacquired operation: %v", err)
	}
}

func seedRefreshCredential(t *testing.T, store *Store, now time.Time) *entity.OAuthIdentity {
	t.Helper()
	session := entity.AuthSession{
		State:     "refresh-release-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	identity, err := store.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "login-release",
		Identity:     entity.ProviderIdentity{ProviderUserID: "release-subject"},
		Tokens: entity.TokenSet{
			AccessToken:  "access-old",
			RefreshToken: "refresh-old",
			ObtainedAt:   now,
		},
		CompletedAt: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	return identity
}
