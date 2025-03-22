package store

import (
	"context"
	"errors"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"gorm.io/gorm"
)

// region Errors

// ErrDBNotFound is returned when the requested database is not found in the rdsMap.
var ErrDBNotFound = errors.New("database not found")

// endregion

type Store interface {
	Init(ctx context.Context, opts ...option.Option) error
	RDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error)
}

func GetRDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error) {
	options := &RDSQueryOptions{}
	for _, opt := range opts {
		opt(options)
	}

	if options.Name == "" {
		return nil, ErrDBNotFound
	}

	options.DBName = "default"
	return nativeErots.RDS(ctx, opts...)
}

func InjectStore(setFunc func(ctx context.Context, opts ...option.Option) error) {
}
