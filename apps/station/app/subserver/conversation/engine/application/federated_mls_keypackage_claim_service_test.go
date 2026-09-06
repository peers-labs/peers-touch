package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestFederatedMlsKeyPackageClaimAllowsBoundedClockSkew(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	repository := &mlsClaimRepositorySpy{}
	service, err := application.NewFederatedMlsKeyPackageClaimService(
		repository,
		mlsClaimDeviceDirectory{},
		"station-home",
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	request := &chat.ClaimFederatedMlsKeyPackageRequest{
		AuthorityPlanId:    "plan-1",
		AuthorityStationId: "station-authority",
		Target: &chat.CryptoEndpoint{
			Ptid:     "bob",
			DeviceId: "bob-1",
		},
		PlanExpiresAt: timestamppb.New(now.Add(-30 * time.Second)),
	}
	if _, err := service.Claim(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if repository.calls != 1 {
		t.Fatalf("repository calls=%d, want 1", repository.calls)
	}

	request.PlanExpiresAt = timestamppb.New(
		now.Add(-messaging.FederationClockSkewBudget),
	)
	if _, err := service.Claim(context.Background(), request); !errors.Is(
		err,
		messaging.ErrAuthorityPlanExpired,
	) {
		t.Fatalf("expired skew error=%v, want ErrAuthorityPlanExpired", err)
	}
	request.PlanExpiresAt = timestamppb.New(
		now.
			Add(5 * time.Minute).
			Add(messaging.FederationClockSkewBudget).
			Add(time.Microsecond),
	)
	if _, err := service.Claim(context.Background(), request); !errors.Is(
		err,
		messaging.ErrAuthorityPlanExpired,
	) {
		t.Fatalf("future skew error=%v, want ErrAuthorityPlanExpired", err)
	}
}

type mlsClaimRepositorySpy struct {
	calls int
}

func (r *mlsClaimRepositorySpy) ClaimIrreversibly(
	_ context.Context,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
	homeStationID string,
	_ time.Time,
) (*chat.ClaimFederatedMlsKeyPackageResponse, error) {
	r.calls++
	return &chat.ClaimFederatedMlsKeyPackageResponse{
		Target:               request.Target,
		PackageId:            "package-1",
		KeyPackage:           []byte("material"),
		KeyPackageSha256:     make([]byte, 32),
		HomeStationId:        homeStationID,
		IrreversiblyConsumed: true,
	}, nil
}

type mlsClaimDeviceDirectory struct{}

func (mlsClaimDeviceDirectory) IsActive(
	context.Context,
	*chat.CryptoEndpoint,
) (bool, error) {
	return true, nil
}

func (mlsClaimDeviceDirectory) ActorIdentityPublicKey(context.Context, string) ([]byte, error) {
	return make([]byte, 32), nil
}

func (mlsClaimDeviceDirectory) ActorHomeStationID(context.Context, string) (string, error) {
	return "station-home", nil
}

func (mlsClaimDeviceDirectory) HomeStationID(
	context.Context,
	*chat.CryptoEndpoint,
) (string, error) {
	return "station-home", nil
}

func (mlsClaimDeviceDirectory) ListActiveEndpoints(
	context.Context,
	string,
) ([]*chat.CryptoEndpoint, error) {
	return nil, nil
}
