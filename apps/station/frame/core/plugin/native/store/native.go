package native

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
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
		dsnToDB := make(map[string]*gorm.DB)
		for _, rds := range n.opts.RDSMap {
			if rds.Enable {
				if rds.Default {
					n.defaultRDS = rds.Name
				}

				dsnKey := rds.Driver + "://" + rds.DSN
				if existing, ok := dsnToDB[dsnKey]; ok {
					n.db[rds.Name] = existing
					logger.Infof(ctx, "rds[%s] sharing connection with identical DSN", rds.Name)
					continue
				}

				dialector := store.GetDialector(rds.Driver)
				if dialector == nil {
					panic("dialector not found for driver: " + rds.Driver)
				}

				gormConfig := &gorm.Config{
					Logger:                                   NewGormLogger().LogMode(gormlogger.Info),
					DisableForeignKeyConstraintWhenMigrating: true,
					NamingStrategy: schema.NamingStrategy{
						NameReplacer: strings.NewReplacer(
							"SPKID", "SpkId",
							"OPKID", "OpkId",
							"ULID", "Ulid",
							"PTID", "Ptid",
							"MIME", "Mime",
							"DID", "Did",
							"CID", "Cid",
							"URL", "Url",
						),
					},
				}

				n.db[rds.Name], err = gorm.Open(dialector(rds.DSN), gormConfig)
				if err != nil {
					return err
				}
				if rds.Driver == "sqlite" {
					sqlDB, _ := n.db[rds.Name].DB()
					if sqlDB != nil {
						sqlDB.SetMaxOpenConns(1)
						sqlDB.SetMaxIdleConns(1)
					}
				}
				dsnToDB[dsnKey] = n.db[rds.Name]
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
