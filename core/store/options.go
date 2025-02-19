package store

type Option func(*Options)

type Options struct {

	// region RDS
	// endregion
}

type RDSQueryOption func(*RDSQueryOptions)
type RDSQueryOptions struct {
	DBName string
}

// region rds query options

// WithRDSDBName sets the database name for the RDS query.
func WithRDSDBName(name string) RDSQueryOption {
	return func(o *RDSQueryOptions) {
		o.DBName = name
	}
}

// endregion
