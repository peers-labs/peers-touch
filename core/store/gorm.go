package store

import (
	"sync"

	"gorm.io/gorm"
)

var (
	drivers = make(map[string]func(name string) gorm.Dialector)

	lock sync.Mutex
)

func RegisterDriver(name string, open func(dsn string) gorm.Dialector) {
	lock.Lock()
	defer lock.Unlock()

	if _, ok := drivers[name]; ok {
		panic("duplicate driver " + name)
	}
	drivers[name] = open
}

func GetDialector(name string) func(name string) gorm.Dialector {
	lock.Lock()
	defer lock.Unlock()

	return drivers[name]
}
