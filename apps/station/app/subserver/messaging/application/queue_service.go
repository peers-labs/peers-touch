package application

import (
	"context"
	"errors"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrDeviceUnauthorized = errors.New("messaging: device is not active for actor")

type DeviceAccess interface {
	IsActiveDevice(ctx context.Context, ptid string, deviceID string) (bool, error)
}

type QueuePolicy struct {
	LeaseDuration  time.Duration
	MaxBatchSize   uint32
	MaxAttempts    uint32
	BaseRetryDelay time.Duration
	MaxRetryDelay  time.Duration
}

type QueueService struct {
	repository messaging.QueueRepository
	devices    DeviceAccess
	policy     QueuePolicy
	clock      func() time.Time
}

func NewQueueService(
	repository messaging.QueueRepository,
	devices DeviceAccess,
	policy QueuePolicy,
	clock func() time.Time,
) (*QueueService, error) {
	if repository == nil {
		return nil, fmt.Errorf("messaging: queue repository is required")
	}
	if devices == nil {
		return nil, fmt.Errorf("messaging: device access is required")
	}
	if policy.LeaseDuration <= 0 {
		return nil, fmt.Errorf("messaging: lease duration must be positive")
	}
	if policy.MaxBatchSize == 0 || policy.MaxBatchSize > 100 {
		return nil, fmt.Errorf("messaging: max batch size must be between 1 and 100")
	}
	if policy.MaxAttempts == 0 {
		return nil, fmt.Errorf("messaging: max attempts must be positive")
	}
	if policy.BaseRetryDelay <= 0 || policy.MaxRetryDelay < policy.BaseRetryDelay {
		return nil, fmt.Errorf("messaging: retry backoff limits are invalid")
	}
	if clock == nil {
		return nil, fmt.Errorf("messaging: queue clock is required")
	}

	return &QueueService{
		repository: repository,
		devices:    devices,
		policy:     policy,
		clock:      clock,
	}, nil
}

func (s *QueueService) Claim(
	ctx context.Context,
	ptid string,
	request *chat.ClaimDeviceQueueRequest,
) (*chat.ClaimDeviceQueueResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("messaging: claim request is required")
	}
	if request.BatchLimit == 0 || request.BatchLimit > s.policy.MaxBatchSize {
		return nil, fmt.Errorf(
			"messaging: batch limit must be between 1 and %d",
			s.policy.MaxBatchSize,
		)
	}
	if err := s.authorizeDevice(ctx, ptid, request.DeviceId); err != nil {
		return nil, err
	}

	result, err := s.repository.Claim(
		ctx,
		ptid,
		request.DeviceId,
		request.ConsumerId,
		request.ExpectedConsumerEpoch,
		request.AfterLaneSequence,
		int(request.BatchLimit),
		s.clock().UTC(),
		s.policy.LeaseDuration,
	)
	if err != nil {
		return nil, err
	}

	return &chat.ClaimDeviceQueueResponse{
		ConsumerEpoch:        result.ConsumerEpoch,
		Items:                result.Items,
		LaneHeadSequence:     result.LaneHead,
		AckedThroughSequence: result.AckedThrough,
	}, nil
}

func (s *QueueService) Acknowledge(
	ctx context.Context,
	ptid string,
	request *chat.AcknowledgeDeviceQueueItemRequest,
) (*chat.AcknowledgeDeviceQueueItemResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("messaging: acknowledge request is required")
	}
	if err := s.authorizeDevice(ctx, ptid, request.DeviceId); err != nil {
		return nil, err
	}

	ackedThrough, err := s.repository.Acknowledge(
		ctx,
		ptid,
		request.DeviceId,
		request.ItemId,
		request.LaneSequence,
		request.ConsumerEpoch,
		request.PayloadSha256,
		s.clock().UTC(),
	)
	if err != nil {
		return nil, err
	}

	return &chat.AcknowledgeDeviceQueueItemResponse{
		AckedThroughSequence: ackedThrough,
	}, nil
}

func (s *QueueService) Reject(
	ctx context.Context,
	ptid string,
	request *chat.RejectDeviceQueueItemRequest,
) (*chat.RejectDeviceQueueItemResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("messaging: reject request is required")
	}
	if err := s.authorizeDevice(ctx, ptid, request.DeviceId); err != nil {
		return nil, err
	}

	_, err := s.repository.Reject(
		ctx,
		ptid,
		request.DeviceId,
		request.ItemId,
		request.LaneSequence,
		request.ConsumerEpoch,
		messaging.RejectDecision{
			Retryable:      request.Retryable,
			ErrorCode:      request.ErrorCode,
			MaxAttempts:    s.policy.MaxAttempts,
			BaseRetryDelay: s.policy.BaseRetryDelay,
			MaxRetryDelay:  s.policy.MaxRetryDelay,
		},
		s.clock().UTC(),
	)
	if err != nil {
		return nil, err
	}

	return &chat.RejectDeviceQueueItemResponse{}, nil
}

func (s *QueueService) authorizeDevice(
	ctx context.Context,
	ptid string,
	deviceID string,
) error {
	if ptid == "" || deviceID == "" {
		return ErrDeviceUnauthorized
	}
	active, err := s.devices.IsActiveDevice(ctx, ptid, deviceID)
	if err != nil {
		return fmt.Errorf("messaging: authorize device: %w", err)
	}
	if !active {
		return ErrDeviceUnauthorized
	}

	return nil
}
