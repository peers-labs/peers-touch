package domain

import (
	"context"
	"errors"
	"time"
)

var (
	ErrRecoveryIntegrity = errors.New("messaging: recovery revision integrity mismatch")
	ErrRecoveryTooLarge  = errors.New("messaging: recovery revision exceeds policy")
)

type RecoveryRevision struct {
	RevisionID       string
	PTID             string
	FormatVersion    uint32
	EncryptedArchive []byte
	ArchiveSHA256    []byte
	CreatedByDevice  string
	CreatedAt        time.Time
}

type RecoveryRepository interface {
	PutRecoveryRevision(ctx context.Context, revision *RecoveryRevision) error
	GetLatestRecoveryRevision(ctx context.Context, ptid string) (*RecoveryRevision, error)
}
