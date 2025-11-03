package store

import (
	"github.com/peers-touch/peers-touch/station/frame/core/option"
)

type storeOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](storeOptionsKey{}, func(options *option.Options) *Options {
		return &Options{
			Options: options,
		}
	})
)

type Options struct {
	*option.Options

	RDSMap map[string]*RDSInit
}

func WithRDS(rds *RDSInit) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		if opts.RDSMap == nil {
			opts.RDSMap = make(map[string]*RDSInit)
		}

		opts.RDSMap[rds.Name] = rds
	})
}

// region store get options

type GetStoreOptions struct {
	StoreName string
}
type GetOption func(*GetStoreOptions)

// endregion

// region rds init options

type RDSInit struct {
	Name    string // use to identify the RDSMap instance
	Driver  string
	Default bool
	Enable  bool
	DSN     string // use to connect to the database, gorm protocol
}

// endregion

// region rds query options

type RDSDMLOption func(*RDSDMLOptions)
type RDSDMLOptions struct {
	Name   string
	DBName string
}

// WithRDSName sets the rds name for the RDSMap query.
// not same as WithRDSDBName which is used to set the database name, cause a system probably connects multiple rds and
// a rds maybe has multiple databases.
func WithRDSName(name string) RDSDMLOption {
	return func(o *RDSDMLOptions) {
		o.Name = name
	}
}

// WithRDSDBName sets the database name for the RDSMap query.
func WithRDSDBName(name string) RDSDMLOption {
	return func(o *RDSDMLOptions) {
		o.DBName = name
	}
}

// endregion

func GetOptions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(storeOptionsKey{}).(*Options)
}
