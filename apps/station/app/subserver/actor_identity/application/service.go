package application

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	domainrepository "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain/repository"
)

// Clock supplies deterministic lifecycle timestamps.
type Clock func() time.Time

// EnrollRequest binds a signed enrollment to the authenticated endpoint.
type EnrollRequest struct {
	AuthenticatedPTID     string
	AuthenticatedDeviceID string
	Enrollment            domain.Enrollment
}

// RevokeRequest fences a device revocation against the actor profile version.
type RevokeRequest struct {
	AuthenticatedPTID      string
	DeviceID               string
	ObservedProfileVersion uint64
}

// Service orchestrates Actor Device lifecycle use cases.
type Service struct {
	repository     domainrepository.DeviceRepository
	localStationID string
	clock          Clock
}

// NewService constructs the Actor Identity application service.
func NewService(
	repository domainrepository.DeviceRepository,
	localStationID string,
	clock Clock,
) (*Service, error) {
	const operation = "actor_identity.new_service"

	if repository == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"repository",
			"is required",
		)
	}
	if localStationID == "" || localStationID != strings.TrimSpace(localStationID) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"local_station_id",
			"is required and must be canonical",
		)
	}
	if clock == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"clock",
			"is required",
		)
	}

	return &Service{
		repository:     repository,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

// Enroll verifies actor authorization before committing one active device.
func (s *Service) Enroll(
	ctx context.Context,
	request EnrollRequest,
) (domain.Device, error) {
	request.Enrollment.HomeStationPeerID = s.localStationID
	if err := domain.VerifyEnrollment(
		request.AuthenticatedPTID,
		request.AuthenticatedDeviceID,
		request.Enrollment,
	); err != nil {
		return domain.Device{}, err
	}

	device, err := s.repository.Enroll(ctx, request.Enrollment, s.clock().UTC())
	if err != nil {
		return domain.Device{}, err
	}

	return device.Clone(), nil
}

// List returns the complete actor-owned device lifecycle in activation order.
func (s *Service) List(ctx context.Context, authenticatedPTID string) ([]domain.Device, error) {
	const operation = "actor_identity.list_devices"

	if err := domain.ValidatePTID(operation, authenticatedPTID); err != nil {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"authenticated_ptid",
			"is required",
		)
	}

	devices, err := s.repository.List(ctx, authenticatedPTID)
	if err != nil {
		return nil, err
	}
	cloned := make([]domain.Device, 0, len(devices))
	for _, device := range devices {
		cloned = append(cloned, device.Clone())
	}

	return cloned, nil
}

// Revoke transitions one actor-owned device to its terminal revoked state.
func (s *Service) Revoke(
	ctx context.Context,
	request RevokeRequest,
) (domain.Device, error) {
	const operation = "actor_identity.revoke_device"

	if err := domain.ValidatePTID(operation, request.AuthenticatedPTID); err != nil {
		return domain.Device{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"authenticated_ptid",
			"is required",
		)
	}
	if err := domain.ValidateDeviceID(operation, request.DeviceID); err != nil {
		return domain.Device{}, err
	}
	if err := domain.ValidateProfileVersion(
		operation,
		request.ObservedProfileVersion,
	); err != nil {
		return domain.Device{}, err
	}

	device, err := s.repository.Revoke(
		ctx,
		request.AuthenticatedPTID,
		request.DeviceID,
		request.ObservedProfileVersion,
		s.clock().UTC(),
	)
	if err != nil {
		return domain.Device{}, err
	}

	return device.Clone(), nil
}
