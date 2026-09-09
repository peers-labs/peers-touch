package http

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	recoverymodel "github.com/peers-labs/peers-touch/station/app/subserver/recovery/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type AuthenticatedActorDevice struct {
	PTID     string
	DeviceID string
}

type RecoveryApplication interface {
	StoreRecoveryRevision(
		ctx context.Context,
		command application.StoreRecoveryRevisionCommand,
	) (application.StoreRecoveryRevisionResult, error)
	ReadLatestRecoveryRevision(
		ctx context.Context,
		ptid string,
	) (domain.Revision, error)
}

var _ RecoveryApplication = (*application.Service)(nil)

type ContractAdapter struct {
	application RecoveryApplication
}

func NewContractAdapter(applicationService RecoveryApplication) (*ContractAdapter, error) {
	if applicationService == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"interface.new_contract_adapter",
			"application",
			"is required",
		)
	}
	return &ContractAdapter{application: applicationService}, nil
}

func (a *ContractAdapter) StoreRecoveryRevision(
	ctx context.Context,
	authenticated AuthenticatedActorDevice,
	request *recoverymodel.StoreRecoveryRevisionRequest,
) (*recoverymodel.StoreRecoveryRevisionResponse, error) {
	if request == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"interface.store_recovery_revision",
			"request",
			"is required",
		)
	}
	result, err := a.application.StoreRecoveryRevision(
		ctx,
		application.StoreRecoveryRevisionCommand{
			PTID:             authenticated.PTID,
			DeviceID:         authenticated.DeviceID,
			RevisionID:       request.GetRevisionId(),
			FormatVersion:    request.GetFormatVersion(),
			EncryptedArchive: append([]byte(nil), request.GetEncryptedArchive()...),
			EncryptedArchiveSHA256: append(
				[]byte(nil),
				request.GetEncryptedArchiveSha256()...,
			),
		},
	)
	if err != nil {
		return nil, err
	}
	return &recoverymodel.StoreRecoveryRevisionResponse{
		RevisionId: result.Revision.RevisionID,
		CreatedAt:  timestamppb.New(result.Revision.CreatedAt),
	}, nil
}

func (a *ContractAdapter) ReadLatestRecoveryRevision(
	ctx context.Context,
	authenticated AuthenticatedActorDevice,
	request *recoverymodel.ReadLatestRecoveryRevisionRequest,
) (*recoverymodel.ReadLatestRecoveryRevisionResponse, error) {
	if request == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"interface.read_latest_recovery_revision",
			"request",
			"is required",
		)
	}
	revision, err := a.application.ReadLatestRecoveryRevision(ctx, authenticated.PTID)
	if err != nil {
		return nil, err
	}
	return &recoverymodel.ReadLatestRecoveryRevisionResponse{
		RevisionId:             revision.RevisionID,
		FormatVersion:          revision.FormatVersion,
		EncryptedArchive:       append([]byte(nil), revision.EncryptedArchive...),
		EncryptedArchiveSha256: append([]byte(nil), revision.EncryptedArchiveSHA256...),
		CreatedAt:              timestamppb.New(revision.CreatedAt),
	}, nil
}
