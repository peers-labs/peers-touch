package store

import (
	"context"
	"database/sql"
)

type Store interface {
	Init(ctx context.Context, opts ...Option) error
	RDS(ctx context.Context, opts ...RDSQueryOption) (*sql.DB, error)
}
