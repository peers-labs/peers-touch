package store

import (
	"context"
	"sync"

	"gorm.io/gorm"
)

var (
	drivers = make(map[string]func(name string) gorm.Dialector)

	lock sync.Mutex
)

// RegisterDriver registers a gorm dialector factory under a name.
func RegisterDriver(name string, open func(dsn string) gorm.Dialector) {
	lock.Lock()
	defer lock.Unlock()

	if _, ok := drivers[name]; ok {
		panic("duplicate driver " + name)
	}
	drivers[name] = open
}

// GetDialector fetches a dialector factory by name.
func GetDialector(name string) func(name string) gorm.Dialector {
	lock.Lock()
	defer lock.Unlock()

	return drivers[name]
}

// GetAfterInitHooks returns registered hooks to run after init.
func GetAfterInitHooks() []func(ctx context.Context, rds *gorm.DB) {
	return afterInitHooks
}
