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

func (n *nativeStore) Name() string {
	return "native"
}

func (n *nativeStore) Init(ctx context.Context, opts ...option.Option) (err error) {
	for _, opt := range opts {
		n.opts.Apply(opt)
	}

	if n.opts.RDSMap != nil {
		logger.Infof(ctx, "init rds map")
		n.db = make(map[string]*gorm.DB)
		for _, rds := range n.opts.RDSMap {
			if rds.Enable {
				dialector := store.GetDialector(rds.Name)
				if dialector == nil {
					panic("dialector not found")
				}

				n.db[rds.Name], err = gorm.Open(dialector(rds.DSN), &gorm.Config{})
			} else {
				logger.Warnf(ctx, "rds[%s] is disabled, skip init", rds.Name)
			}
		}
	}

	if err = store.InjectStore(ctx, n); err != nil {
		return err
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

	return n.db[qOpts.Name], nil
}

// NewStore returns a new native store
// if you don't want to use the global store, you can follow store.Store to create a new one.
// and actually, the native store is good enough for most cases
func NewStore(opts ...option.Option) store.Store {
	if nativeErots == nil {
		nativeErots = &nativeStore{
			opts: store.GetOptions(opts...),
		}
	}

	return nativeErots
}
