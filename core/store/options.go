package store

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

type rdsOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](rdsOptionsKey{}, func(options *option.Options) *Options {
		return &Options{
			Options: options,
		}
	})
)

type Options struct {
	*option.Options

	// region RDSMap
	RDSMap map[string]*RDSInit
	// endregion
}

func WithRDS(rds *RDSInit) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		if opts.RDSMap == nil {
			opts.RDSMap = make(map[string]*RDSInit)
		}

		opts.RDSMap[rds.Name] = rds
	})
}

// region rds init options

type RDSInit struct {
	Name       string // use to identify the RDSMap instance
	DriverName string // use to identify the RDSMap instance
	Address    string // Server address
	Timeout    int    // Server timeout
	SQLConnURL string // Standard SQL connection URL
}

// endregion

// region rds query options

type RDSDMLOption func(*RDSQueryOptions)
type RDSQueryOptions struct {
	Name   string
	DBName string
}

// WithRDSName sets the rds name for the RDSMap query.
// not same as WithRDSDBName which is used to set the database name.
func WithRDSName(name string) RDSDMLOption {
	return func(o *RDSQueryOptions) {
		o.Name = name
	}
}

// WithRDSDBName sets the database name for the RDSMap query.
func WithRDSDBName(name string) RDSDMLOption {
	return func(o *RDSQueryOptions) {
		o.DBName = name
	}
}

// endregion
