package adapter

import (
	"fmt"
	"sync"
)

var (
	adapters = make(map[string]Adapter)
	mu       sync.RWMutex
)

// Register registers an adapter
func Register(adapter Adapter) {
	mu.Lock()
	defer mu.Unlock()
	if adapter == nil {
		panic("identity: Register adapter is nil")
	}
	name := adapter.Name()
	if _, dup := adapters[name]; dup {
		panic(fmt.Sprintf("identity: Register called twice for adapter %s", name))
	}
	adapters[name] = adapter
}

// Get returns an adapter by name
func Get(name string) (Adapter, bool) {
	mu.RLock()
	defer mu.RUnlock()
	adapter, ok := adapters[name]
	return adapter, ok
}

// List returns all registered adapters
func List() []Adapter {
	mu.RLock()
	defer mu.RUnlock()
	list := make([]Adapter, 0, len(adapters))
	for _, adapter := range adapters {
		list = append(list, adapter)
	}
	return list
}
