package native

import (
	"context"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var (
	nativeErots *nativeStore
)

type nativeStore struct {
	opts *store.Options

	defaultRDS string
	db         map[string]*gorm.DB
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
				dialector := store.GetDialector(rds.Driver)
				if dialector == nil {
					panic("dialector not found for driver: " + rds.Driver)
				}

				if rds.Default {
					n.defaultRDS = rds.Name
				}

				gormConfig := &gorm.Config{
					// todo: let gorm logger level follow the one of frame's
					Logger: NewGormLogger().LogMode(gormlogger.Info),
				}

				n.db[rds.Name], err = gorm.Open(dialector(rds.DSN), gormConfig)
			} else {
				logger.Warnf(ctx, "rds[%s] is disabled, skip init", rds.Name)
			}
		}
	}

	if err = store.InjectStore(ctx, n); err != nil {
		return err
	}

	for _, afterInit := range store.GetAfterInitHooks() {
		afterInit(ctx, n.db[n.defaultRDS])
	}

	return nil
}

func (n *nativeStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
	qOpts := &store.RDSDMLOptions{}
	for _, opt := range opts {
		opt(qOpts)
	}

	rdsName := qOpts.DBName
	if rdsName == "" {
		rdsName = n.defaultRDS
	}

	if n.db == nil || n.db[rdsName] == nil {
		logger.Errorf(ctx, "db[%s] not found", rdsName)
		return nil, store.ErrDBNotFound
	}

	return n.db[rdsName], nil
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
