package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain/repository"
)

type StoreRecoveryRevisionCommand struct {
	PTID                   string
	DeviceID               string
	RevisionID             string
	FormatVersion          uint32
	EncryptedArchive       []byte
	EncryptedArchiveSHA256 []byte
}

type StoreRecoveryRevisionResult struct {
	Revision domain.Revision
	Replay   bool
}

type Service struct {
	repository repository.RevisionRepository
	authorizer ports.ActorDeviceAuthorizer
	clock      ports.Clock
	policy     domain.ArchivePolicy
}

func NewService(
	revisionRepository repository.RevisionRepository,
	authorizer ports.ActorDeviceAuthorizer,
	clock ports.Clock,
	maxEncryptedArchiveBytes int,
) (*Service, error) {
	if revisionRepository == nil || authorizer == nil || clock == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"application.new_service",
			"dependencies",
			"repository, authorizer, and clock are required",
		)
	}
	policy, err := domain.NewArchivePolicy(maxEncryptedArchiveBytes)
	if err != nil {
		return nil, err
	}
	return &Service{
		repository: revisionRepository,
		authorizer: authorizer,
		clock:      clock,
		policy:     policy,
	}, nil
}

func (s *Service) StoreRecoveryRevision(
	ctx context.Context,
	command StoreRecoveryRevisionCommand,
) (StoreRecoveryRevisionResult, error) {
	const operation = "application.store_recovery_revision"

	if err := domain.ValidatePTID(operation, command.PTID); err != nil {
		return StoreRecoveryRevisionResult{}, err
	}
	if err := domain.ValidateDeviceID(operation, command.DeviceID); err != nil {
		return StoreRecoveryRevisionResult{}, err
	}
	authorized, err := s.authorizer.IsDeviceAuthorizedForRecovery(
		ctx,
		command.PTID,
		command.DeviceID,
	)
	if err != nil {
		return StoreRecoveryRevisionResult{}, domain.WrapError(
			domain.ErrorCodeDependencyFailure,
			operation,
			"actor_device_authorization",
			"failed to authorize the actor device",
			err,
		)
	}
	if !authorized {
		return StoreRecoveryRevisionResult{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device_id",
			"device is not authorized to store recovery revisions for the actor",
		)
	}

	revision, err := domain.NewRevision(
		command.RevisionID,
		command.PTID,
		command.FormatVersion,
		command.EncryptedArchive,
		command.EncryptedArchiveSHA256,
		command.DeviceID,
		s.clock.Now(),
		s.policy,
	)
	if err != nil {
		return StoreRecoveryRevisionResult{}, err
	}
	stored, err := s.repository.StoreRecoveryRevision(ctx, revision)
	if err != nil {
		return StoreRecoveryRevisionResult{}, err
	}
	if err := s.policy.Validate(stored.Revision); err != nil {
		return StoreRecoveryRevisionResult{}, domain.WrapError(
			domain.ErrorCodePersistence,
			operation,
			"stored_revision",
			"repository returned an invalid revision",
			err,
		)
	}
	if !stored.Revision.SameImmutableContent(revision) {
		return StoreRecoveryRevisionResult{}, domain.NewError(
			domain.ErrorCodePersistence,
			operation,
			"stored_revision",
			"repository returned a different immutable revision",
		)
	}
	return StoreRecoveryRevisionResult{
		Revision: stored.Revision.Clone(),
		Replay:   stored.Replay,
	}, nil
}

func (s *Service) ReadLatestRecoveryRevision(
	ctx context.Context,
	ptid string,
) (domain.Revision, error) {
	const operation = "application.read_latest_recovery_revision"

	if err := domain.ValidatePTID(operation, ptid); err != nil {
		return domain.Revision{}, err
	}
	authorized, err := s.authorizer.IsActorAuthorizedForRecovery(ctx, ptid)
	if err != nil {
		return domain.Revision{}, domain.WrapError(
			domain.ErrorCodeDependencyFailure,
			operation,
			"actor_authorization",
			"failed to authorize the actor",
			err,
		)
	}
	if !authorized {
		return domain.Revision{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"ptid",
			"actor is not authorized to read recovery revisions",
		)
	}

	revision, err := s.repository.ReadLatestRecoveryRevision(ctx, ptid)
	if err != nil {
		return domain.Revision{}, err
	}
	if revision.PTID != ptid {
		return domain.Revision{}, domain.NewError(
			domain.ErrorCodePersistence,
			operation,
			"ptid",
			"repository returned a revision owned by another actor",
		)
	}
	if err := s.policy.Validate(revision); err != nil {
		return domain.Revision{}, domain.WrapError(
			domain.ErrorCodePersistence,
			operation,
			"stored_revision",
			"repository returned an invalid revision",
			err,
		)
	}
	return revision.Clone(), nil
}
