package rds

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

// region Errors

// ErrDBNotFound is returned when the requested database is not found in the rdsMap.
var ErrDBNotFound = errors.New("database not found")

// endregion

type NativeStore struct {
	// injected by config-driven
	// todo: see config
	rdsMap map[string]*sql.DB

	mu sync.Mutex // Add a mutex for concurrent safety
}

func (n *NativeStore) Init(ctx context.Context, opts ...store.Option) error {
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

	// Process RDS options

	return nil
}

func (n *NativeStore) RDS(ctx context.Context, opts ...store.RDSQueryOption) (*sql.DB, error) {
	options := store.RDSQueryOptions{}
	for _, opt := range opts {
		opt(&options)
	}

	if options.DBName == "" || n.rdsMap[options.DBName] == nil {
		return nil, store.ErrDBNotFound
	}

	return n.rdsMap[options.DBName], nil
}
