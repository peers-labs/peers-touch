package native

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"gorm.io/gorm"
)

var (
	nativeErots *nativeStore
)

type nativeStore struct {
	opts *store.Options

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
			dialector := store.GetDialector(rds.DriverName)
			if dialector == nil {
				panic("dialector not found")
			}

			n.db[rds.Name], err = gorm.Open(dialector(rds.Address), &gorm.Config{})
		}
	}

	return nil
}

func (n *nativeStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
	qOpts := &store.RDSQueryOptions{}
	for _, opt := range opts {
		opt(qOpts)
	}

	if qOpts.Name == "" {
		logger.Errorf(ctx, "db name is empty")
		return nil, store.ErrDBNotFound
	}

	if n.db == nil || n.db[qOpts.Name] == nil {
		logger.Errorf(ctx, "db[%s] not found", qOpts.DBName)
		return nil, store.ErrDBNotFound
	}

	return n.db[qOpts.DBName], nil
}

// NewStore returns a new native store
// if you don't want to use the global store, you can follow store.Store to create a new one.
// and actually, the native store is good enough for most cases
func NewStore(opts ...option.Option) store.Store {
	if nativeErots == nil {
		nativeErots = &nativeStore{
			opts: &store.Options{
				Options: &option.Options{},
			},
		}

		nativeErots.opts.Apply(opts...)
	}

	return nativeErots
}
