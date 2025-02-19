package store

type Option func(*Options)

type Options struct {

	// region RDSMap
	RDSMap map[string]*RDSInit
	// endregion
}

func WithRDS(rds *RDSInit) Option {
	return func(o *Options) {
		if o.RDSMap == nil {
			o.RDSMap = make(map[string]*RDSInit)
		}

		o.RDSMap[rds.Name] = rds
	}
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

type RDSQueryOption func(*RDSQueryOptions)
type RDSQueryOptions struct {
	DBName string
}

// WithRDSDBName sets the database name for the RDSMap query.
func WithRDSDBName(name string) RDSQueryOption {
	return func(o *RDSQueryOptions) {
		o.DBName = name
	}
}

// endregion
