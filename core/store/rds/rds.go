package rds

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

type Store struct {
	// injected by config-driven
	// todo: see config
	rdsMap map[string]*sql.DB

	mu sync.Mutex // Add a mutex for concurrent safety
}

func (n *Store) Init(ctx context.Context, opts ...store.Option) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	// Initialize rdsMap
	if n.rdsMap == nil {
		n.rdsMap = make(map[string]*sql.DB)
	}

	// Apply global options
	var options store.Options
	for _, opt := range opts {
		opt(&options)
	}

	// Process RDSMap options
	for dbName, rds := range options.RDSMap {
		if rds == nil {
			return errors.New("RDSMap configuration is nil for database: " + dbName)
		}

		db, err := sql.Open(rds.DriverName, rds.SQLConnURL)
		if err != nil {
			return err
		}

		// Ping the database to check the connection
		err = db.PingContext(ctx)
		if err != nil {
			db.Close()
			return err
		}

		// Add the database instance to the rdsMap
		n.rdsMap[dbName] = db
	}

	return nil
}

func (n *Store) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*sql.DB, error) {
	options := store.RDSQueryOptions{}
	for _, opt := range opts {
		opt(&options)
	}

	if options.DBName == "" || n.rdsMap[options.DBName] == nil {
		return nil, store.ErrDBNotFound
	}

	return n.rdsMap[options.DBName], nil
}
