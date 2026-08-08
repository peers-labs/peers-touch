package key_exchange

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *subServer) handlePutCryptoBackup(
	ctx context.Context,
	req *chat.PutCryptoBackupRequest,
) (*chat.PutCryptoBackupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	backup, err := s.service.PutCryptoBackup(
		ctx,
		subject.ID,
		newCryptoBackupFromProto(req),
	)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidBackup) {
			return nil, server.BadRequest(err.Error())
		}
		return nil, server.InternalErrorWithCause("store crypto backup failed", err)
	}
	return &chat.PutCryptoBackupResponse{Backup: cryptoBackupToProto(backup)}, nil
}

func (s *subServer) handleGetLatestCryptoBackup(
	ctx context.Context,
	_ *chat.GetLatestCryptoBackupRequest,
) (*chat.GetLatestCryptoBackupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	backup, err := s.service.GetLatestCryptoBackup(ctx, subject.ID)
	if err != nil {
		if errors.Is(err, domain.ErrBackupNotFound) {
			return nil, server.NotFound("crypto backup not found")
		}
		return nil, server.InternalErrorWithCause("get latest crypto backup failed", err)
	}
	return &chat.GetLatestCryptoBackupResponse{Backup: cryptoBackupToProto(backup)}, nil
}

func (s *subServer) handleListCryptoBackups(
	ctx context.Context,
	req *chat.ListCryptoBackupRevisionsRequest,
) (*chat.ListCryptoBackupRevisionsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	var limit uint32
	if req != nil {
		limit = req.GetLimit()
	}
	backups, err := s.service.ListCryptoBackups(ctx, subject.ID, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list crypto backups failed", err)
	}
	response := make([]*chat.CryptoBackupRevision, 0, len(backups))
	for index := range backups {
		response = append(response, cryptoBackupToProto(&backups[index]))
	}
	return &chat.ListCryptoBackupRevisionsResponse{Backups: response}, nil
}

func newCryptoBackupFromProto(req *chat.PutCryptoBackupRequest) domain.NewCryptoBackup {
	if req == nil {
		return domain.NewCryptoBackup{}
	}
	kdf := req.GetKdf()
	input := domain.NewCryptoBackup{
		EncryptedBlob: append([]byte(nil), req.GetEncryptedBlob()...),
		Nonce:         append([]byte(nil), req.GetNonce()...),
		IntegrityTag:  append([]byte(nil), req.GetIntegrityTag()...),
	}
	if kdf != nil {
		input.KDF = domain.BackupKDFParameters{
			Salt:          append([]byte(nil), kdf.GetSalt()...),
			MemoryCostKiB: kdf.GetMemoryCostKib(),
			TimeCost:      kdf.GetTimeCost(),
			Parallelism:   kdf.GetParallelism(),
			OutputLength:  kdf.GetOutputLength(),
		}
	}
	return input
}

func cryptoBackupToProto(backup *domain.CryptoBackupRevision) *chat.CryptoBackupRevision {
	if backup == nil {
		return nil
	}
	return &chat.CryptoBackupRevision{
		BackupId:      backup.BackupID,
		Ptid:          backup.Ptid,
		Revision:      backup.Revision,
		EncryptedBlob: append([]byte(nil), backup.EncryptedBlob...),
		Nonce:         append([]byte(nil), backup.Nonce...),
		IntegrityTag:  append([]byte(nil), backup.IntegrityTag...),
		Kdf: &chat.BackupKdfParameters{
			Salt:          append([]byte(nil), backup.KDF.Salt...),
			MemoryCostKib: backup.KDF.MemoryCostKiB,
			TimeCost:      backup.KDF.TimeCost,
			Parallelism:   backup.KDF.Parallelism,
			OutputLength:  backup.KDF.OutputLength,
		},
		CreatedAt: timestamppb.New(backup.CreatedAt),
	}
}
