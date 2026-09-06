package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type RecoveryPolicy struct {
	MaxEncryptedArchiveBytes int
}

type RecoveryService struct {
	repository messaging.RecoveryRepository
	devices    DeviceAccess
	policy     RecoveryPolicy
	clock      func() time.Time
}

func NewRecoveryService(
	repository messaging.RecoveryRepository,
	devices DeviceAccess,
	policy RecoveryPolicy,
	clock func() time.Time,
) (*RecoveryService, error) {
	if repository == nil || devices == nil || clock == nil {
		return nil, fmt.Errorf("messaging: recovery dependencies are required")
	}
	if policy.MaxEncryptedArchiveBytes <= 0 {
		return nil, fmt.Errorf("messaging: positive recovery archive limit is required")
	}
	return &RecoveryService{
		repository: repository,
		devices:    devices,
		policy:     policy,
		clock:      clock,
	}, nil
}

func (s *RecoveryService) Put(
	ctx context.Context,
	ptid string,
	deviceID string,
	request *chat.PutRecoveryRevisionRequest,
) (*chat.PutRecoveryRevisionResponse, error) {
	if request == nil ||
		request.RevisionId == "" ||
		request.FormatVersion == 0 ||
		len(request.EncryptedArchive) == 0 ||
		len(request.EncryptedArchiveSha256) != sha256.Size {
		return nil, messaging.ErrRecoveryIntegrity
	}
	if len(request.EncryptedArchive) > s.policy.MaxEncryptedArchiveBytes {
		return nil, messaging.ErrRecoveryTooLarge
	}
	active, err := s.devices.IsActiveDevice(ctx, ptid, deviceID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, ErrDeviceUnauthorized
	}
	hash := sha256.Sum256(request.EncryptedArchive)
	if !bytes.Equal(hash[:], request.EncryptedArchiveSha256) {
		return nil, messaging.ErrRecoveryIntegrity
	}
	now := s.clock().UTC()
	if err := s.repository.PutRecoveryRevision(ctx, &messaging.RecoveryRevision{
		RevisionID:       request.RevisionId,
		PTID:             ptid,
		FormatVersion:    request.FormatVersion,
		EncryptedArchive: request.EncryptedArchive,
		ArchiveSHA256:    request.EncryptedArchiveSha256,
		CreatedByDevice:  deviceID,
		CreatedAt:        now,
	}); err != nil {
		return nil, err
	}
	return &chat.PutRecoveryRevisionResponse{
		RevisionId: request.RevisionId,
		CreatedAt:  timestamppb.New(now),
	}, nil
}

func (s *RecoveryService) GetLatest(
	ctx context.Context,
	ptid string,
) (*chat.GetLatestRecoveryRevisionResponse, error) {
	revision, err := s.repository.GetLatestRecoveryRevision(ctx, ptid)
	if err != nil {
		return nil, err
	}
	return &chat.GetLatestRecoveryRevisionResponse{
		RevisionId:             revision.RevisionID,
		FormatVersion:          revision.FormatVersion,
		EncryptedArchive:       revision.EncryptedArchive,
		EncryptedArchiveSha256: revision.ArchiveSHA256,
		CreatedAt:              timestamppb.New(revision.CreatedAt),
	}, nil
}
