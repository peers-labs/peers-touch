package delivery

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const (
	// MaximumClaimBatchSize bounds one durable resume response.
	MaximumClaimBatchSize uint32 = 100
	// MaximumRetryAttempts prevents an unbounded poison-item retry loop.
	MaximumRetryAttempts uint32 = 100
	// MaximumLeaseDuration prevents a consumer from monopolizing a lane indefinitely.
	MaximumLeaseDuration = 24 * time.Hour
)

// Service authorizes and orchestrates canonical Device Inbox state transitions.
type Service struct {
	repository Repository
	devices    DeviceAccess
	policy     Policy
	clock      Clock
}

// NewService constructs a Device Inbox application service with bounded policy.
func NewService(
	repository Repository,
	devices DeviceAccess,
	policy Policy,
	clock Clock,
) (*Service, error) {
	if repository == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"repository",
			"is required",
		)
	}
	if devices == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"devices",
			"is required",
		)
	}
	if clock == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"clock",
			"is required",
		)
	}
	if policy.LeaseDuration <= 0 || policy.LeaseDuration > MaximumLeaseDuration {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"lease_duration",
			"must be positive and bounded",
		)
	}
	if policy.MaxBatchSize == 0 || policy.MaxBatchSize > MaximumClaimBatchSize {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"max_batch_size",
			"must be between 1 and 100",
		)
	}
	if policy.MaxAttempts == 0 || policy.MaxAttempts > MaximumRetryAttempts {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"max_attempts",
			"must be between 1 and 100",
		)
	}
	if policy.BaseRetryDelay <= 0 || policy.MaxRetryDelay < policy.BaseRetryDelay {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"delivery.new_service",
			"retry_delay",
			"must define positive ordered bounds",
		)
	}

	return &Service{
		repository: repository,
		devices:    devices,
		policy:     policy,
		clock:      clock,
	}, nil
}

// Claim leases a bounded contiguous prefix beginning at the exact unacknowledged head.
func (s *Service) Claim(
	ctx context.Context,
	recipient valueobject.Endpoint,
	consumerID string,
	expectedConsumerEpoch uint64,
	afterLaneSequence int64,
	batchLimit uint32,
) (ClaimResult, error) {
	if err := validateEndpoint(recipient, "delivery.claim"); err != nil {
		return ClaimResult{}, err
	}
	if strings.TrimSpace(consumerID) == "" {
		return ClaimResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.claim",
			"consumer_id",
			"is required",
		)
	}
	if afterLaneSequence < 0 {
		return ClaimResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.claim",
			"after_lane_sequence",
			"must not be negative",
		)
	}
	if batchLimit == 0 || batchLimit > s.policy.MaxBatchSize {
		return ClaimResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.claim",
			"batch_limit",
			"exceeds the configured bound",
		)
	}
	if err := s.authorize(ctx, recipient, "delivery.claim"); err != nil {
		return ClaimResult{}, err
	}

	result, err := s.repository.Claim(ctx, ClaimRequest{
		Recipient:             recipient,
		ConsumerID:            consumerID,
		ExpectedConsumerEpoch: expectedConsumerEpoch,
		AfterLaneSequence:     afterLaneSequence,
		Limit:                 int(batchLimit),
		Now:                   s.clock.Now().UTC(),
		LeaseDuration:         s.policy.LeaseDuration,
	})
	if err != nil {
		return ClaimResult{}, err
	}

	return result, nil
}

// Acknowledge advances exactly one lane head after durable device consumption.
func (s *Service) Acknowledge(
	ctx context.Context,
	request AcknowledgeRequest,
) (int64, error) {
	if err := validateEndpoint(request.Recipient, "delivery.acknowledge"); err != nil {
		return 0, err
	}
	if strings.TrimSpace(request.ItemID) == "" {
		return 0, NewError(
			ErrorCodeInvalidArgument,
			"delivery.acknowledge",
			"item_id",
			"is required",
		)
	}
	if request.LaneSequence <= 0 {
		return 0, NewError(
			ErrorCodeInvalidArgument,
			"delivery.acknowledge",
			"lane_sequence",
			"must be positive",
		)
	}
	if request.ConsumerEpoch == 0 {
		return 0, NewError(
			ErrorCodeInvalidArgument,
			"delivery.acknowledge",
			"consumer_epoch",
			"must be positive",
		)
	}
	if request.PayloadHash.IsZero() {
		return 0, NewError(
			ErrorCodeInvalidArgument,
			"delivery.acknowledge",
			"payload_sha256",
			"is required",
		)
	}
	if err := s.authorize(ctx, request.Recipient, "delivery.acknowledge"); err != nil {
		return 0, err
	}
	request.Now = s.clock.Now().UTC()

	ackedThrough, err := s.repository.Acknowledge(ctx, request)
	if err != nil {
		return 0, err
	}

	return ackedThrough, nil
}

// Reject applies canonical retryability and bounded backoff to the exact lane head.
func (s *Service) Reject(
	ctx context.Context,
	request RejectRequest,
) (RejectResult, error) {
	if err := validateEndpoint(request.Recipient, "delivery.reject"); err != nil {
		return RejectResult{}, err
	}
	if strings.TrimSpace(request.ItemID) == "" {
		return RejectResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.reject",
			"item_id",
			"is required",
		)
	}
	if request.LaneSequence <= 0 {
		return RejectResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.reject",
			"lane_sequence",
			"must be positive",
		)
	}
	if request.ConsumerEpoch == 0 {
		return RejectResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.reject",
			"consumer_epoch",
			"must be positive",
		)
	}
	if !request.Code.Valid() {
		return RejectResult{}, NewError(
			ErrorCodeInvalidArgument,
			"delivery.reject",
			"error_code",
			"is not supported",
		)
	}
	if err := s.authorize(ctx, request.Recipient, "delivery.reject"); err != nil {
		return RejectResult{}, err
	}
	request.Retryable = request.Code.Retryable()
	request.MaxAttempts = s.policy.MaxAttempts
	request.BaseRetryDelay = s.policy.BaseRetryDelay
	request.MaxRetryDelay = s.policy.MaxRetryDelay
	request.Now = s.clock.Now().UTC()

	result, err := s.repository.Reject(ctx, request)
	if err != nil {
		return RejectResult{}, err
	}

	return result, nil
}

func (s *Service) authorize(
	ctx context.Context,
	recipient valueobject.Endpoint,
	operation string,
) error {
	active, err := s.devices.IsActive(ctx, recipient)
	if err != nil {
		return WrapError(ErrorCodePersistence, operation+".authorize_device", err)
	}
	if !active {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"device",
			"is not active for the authenticated actor",
		)
	}

	return nil
}

func validateEndpoint(endpoint valueobject.Endpoint, operation string) error {
	actor := string(endpoint.Actor)
	device := string(endpoint.Device)
	if err := endpoint.Validate(); err != nil ||
		strings.TrimSpace(actor) != actor ||
		strings.TrimSpace(device) != device {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"device",
			"must contain a PTID and device ID",
		)
	}

	return nil
}
