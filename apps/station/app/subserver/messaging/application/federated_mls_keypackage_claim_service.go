package application

import (
	"context"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const maxFederatedMlsKeyPackageClaimTTL = 5 * time.Minute

type FederatedMlsKeyPackageClaimService struct {
	repository     messaging.FederatedMlsKeyPackageClaimRepository
	devices        messaging.DeviceDirectory
	localStationID string
	clock          func() time.Time
}

func NewFederatedMlsKeyPackageClaimService(
	repository messaging.FederatedMlsKeyPackageClaimRepository,
	devices messaging.DeviceDirectory,
	localStationID string,
	clock func() time.Time,
) (*FederatedMlsKeyPackageClaimService, error) {
	if repository == nil || devices == nil || localStationID == "" || clock == nil {
		return nil, fmt.Errorf("messaging: federated MLS KeyPackage claim dependencies are invalid")
	}
	return &FederatedMlsKeyPackageClaimService{
		repository:     repository,
		devices:        devices,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

func (s *FederatedMlsKeyPackageClaimService) Claim(
	ctx context.Context,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
) (*chat.ClaimFederatedMlsKeyPackageResponse, error) {
	if request == nil || request.Target == nil {
		return nil, fmt.Errorf("messaging: federated MLS KeyPackage claim target is required")
	}
	now := s.clock().UTC().Truncate(time.Microsecond)
	if request.PlanExpiresAt == nil ||
		!request.PlanExpiresAt.AsTime().After(now) ||
		request.PlanExpiresAt.AsTime().After(now.Add(maxFederatedMlsKeyPackageClaimTTL)) {
		return nil, messaging.ErrAuthorityPlanExpired
	}
	homeStationID, err := s.devices.HomeStationID(ctx, request.Target)
	if err != nil {
		return nil, err
	}
	if homeStationID != s.localStationID {
		return nil, messaging.ErrSenderUnauthorized
	}
	return s.repository.ClaimIrreversibly(
		ctx,
		request,
		s.localStationID,
		now,
	)
}
