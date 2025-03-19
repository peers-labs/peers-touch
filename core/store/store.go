package store

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// region Errors

// ErrDBNotFound is returned when the requested database is not found in the rdsMap.
var ErrDBNotFound = errors.New("database not found")

// endregion

type Store interface {
	Init(ctx context.Context, opts ...Option) error
	RDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error)
}

func GetRDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error) {
	return getRDS(ctx, opts...)
}
