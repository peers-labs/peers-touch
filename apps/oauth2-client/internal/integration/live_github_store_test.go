package integration_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/bootstrap"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

func TestLiveGitHubStorePersistsRefreshClaimAcrossInstances(t *testing.T) {
	if os.Getenv("OAUTH2_CLIENT_LIVE") != "1" {
		t.Skip("requires the isolated oauth2-client-test environment")
	}

	ctx := context.Background()
	first := liveContainer(t)
	snapshot, err := first.Store.AdminSnapshot(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	identityID := ""
	for _, identity := range snapshot.Identities {
		if identity.Provider == "google" && identity.HasRefreshToken {
			identityID = identity.IdentityID
			break
		}
	}
	if identityID == "" {
		t.Fatal("live Google identity with a refresh token is required")
	}

	operationID := fmt.Sprintf("live-repository-%d", time.Now().UTC().UnixNano())
	claimedAt := time.Now().UTC()
	claim, err := first.Store.ClaimCredentialRefresh(
		ctx,
		identityID,
		operationID,
		claimedAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	if claim.State != entity.CredentialRefreshClaimAcquired {
		t.Fatalf("initial claim state = %q", claim.State)
	}

	second := liveContainer(t)
	observed, err := second.Store.ClaimCredentialRefresh(
		ctx,
		identityID,
		operationID,
		claimedAt.Add(time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	if observed.State != entity.CredentialRefreshClaimUncertain {
		t.Fatalf("cross-instance claim state = %q", observed.State)
	}

	if err := first.Store.ReleaseCredentialRefreshClaim(ctx, *claim); err != nil {
		t.Fatal(err)
	}
	third := liveContainer(t)
	reacquired, err := third.Store.ClaimCredentialRefresh(
		ctx,
		identityID,
		operationID,
		claimedAt.Add(2*time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	if reacquired.State != entity.CredentialRefreshClaimAcquired ||
		reacquired.ClaimID == claim.ClaimID {
		t.Fatalf("released claim was not reacquired: %#v", reacquired)
	}
	if err := third.Store.ReleaseCredentialRefreshClaim(ctx, *reacquired); err != nil {
		t.Fatal(err)
	}
}

func liveContainer(t *testing.T) *bootstrap.Container {
	t.Helper()
	container, err := bootstrap.BuildContainer()
	if err != nil {
		t.Fatal(err)
	}
	return container
}
