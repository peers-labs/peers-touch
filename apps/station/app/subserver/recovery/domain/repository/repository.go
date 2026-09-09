package repository

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
)

type StoreResult struct {
	Revision domain.Revision
	Replay   bool
}

type RevisionRepository interface {
	StoreRecoveryRevision(
		ctx context.Context,
		revision domain.Revision,
	) (StoreResult, error)
	ReadLatestRecoveryRevision(
		ctx context.Context,
		ptid string,
	) (domain.Revision, error)
}
