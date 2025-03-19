package store

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"gorm.io/gorm"
)

var (
	nativeErots nativeStore
)

type nativeStore struct {
	opts *Options

	db map[string]*gorm.DB
}

func (n *nativeStore) Init(ctx context.Context, opts ...option.Option) (err error) {
	for _, opt := range opts {
		n.opts.Apply(opt)
	}

	if n.opts.RDSMap != nil {
		logger.Infof(ctx, "init rds map")
		n.db = make(map[string]*gorm.DB)
		for _, rds := range n.opts.RDSMap {
			dialector := GetDialector(rds.DriverName)
			if dialector == nil {
				panic("dialector not found")
			}

			n.db[rds.Name], err = gorm.Open(dialector(rds.Address), &gorm.Config{})
		}
	}

	return nil
}

func (n *nativeStore) RDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error) {
	options := &RDSQueryOptions{}
	for _, opt := range opts {
		opt(options)
	}

	if options.DBName == "" {
		logger.Errorf(ctx, "db name is empty")
		return nil, ErrDBNotFound
	}

	if n.db == nil || n.db[options.DBName] == nil {
		logger.Errorf(ctx, "db[%s] not found", options.DBName)
		return nil, ErrDBNotFound
	}

	return n.db[options.DBName], nil
}
