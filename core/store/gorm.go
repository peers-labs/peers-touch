package store

import (
	"gorm.io/gorm"
	"sync"
)

var (
	drivers = make(map[string]func(name string) gorm.Dialector)

	lock sync.Mutex
)

func RegisterDriver(driverName string, open func(dsn string) gorm.Dialector) {
	lock.Lock()
	defer lock.Unlock()

	if _, ok := drivers[driverName]; ok {
		panic("duplicate driver " + driverName)
	}
	drivers[driverName] = open
}

func GetDialector(driverName string) func(name string) gorm.Dialector {
	lock.Lock()
	defer lock.Unlock()

	return drivers[driverName]
}
