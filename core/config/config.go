// Package config is an interface for dynamic configuration.
package config

import (
	"context"
	"fmt"
	"reflect"
	"runtime"

	"github.com/dirty-bro-tech/peers-touch-go/core/config/loader"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/reader"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/source"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/source/file"
)

// Config is an interface abstraction for dynamic configuration
type Config interface {
	// provide the reader.Values interface
	reader.Values

	Init(opts ...Option) error
	// Stop the config loader/watcher
	Close() error
	// Load config sources
	Load(source ...source.Source) error
	// Force a source changeset sync
	Sync() error
	// Watch a value for changes
	Watch(path ...string) (Watcher, error)
}

// Watcher is the config watcher
type Watcher interface {
	Next() (reader.Value, error)
	Stop() error
}

type Options struct {
	Loader  loader.Loader
	Reader  reader.Reader
	Sources []source.Source

	// for alternative data
	Context context.Context

	// HierarchyMerge merges the query args to one
	// eg. Get("a","b","c") can be used as Get("a.b.c")
	// the default is false
	HierarchyMerge      bool
	WithWatcherDisabled bool
	Storage             bool
}

type Option func(o *Options)

var (
	// Default Config Manager
	DefaultConfig = NewConfig()

	// Define the tag name for setting autowired value of Options
	// sc equals stack-config :)
	// todo support custom tagName
	DefaultOptionsTagName     = "sc"
	DefaultHierarchySeparator = "."

	// holds all the Options
	optionsPool = make(map[string]reflect.Value)
)

// NewConfig returns new config
func NewConfig(opts ...Option) Config {
	return newConfig(opts...)
}

// Bytes Return config as raw json
func Bytes() []byte {
	return DefaultConfig.Bytes()
}

// Map Return config as a map
func Map() map[string]interface{} {
	return DefaultConfig.Map()
}

// Scan values to a go type
func Scan(v interface{}) error {
	return DefaultConfig.Scan(v)
}

// Sync Force a source changeset sync
func Sync() error {
	return DefaultConfig.Sync()
}

// Get a value from the config
func Get(path ...string) reader.Value {
	return DefaultConfig.Get(path...)
}

// Load config sources
func Load(source ...source.Source) error {
	return DefaultConfig.Load(source...)
}

// Watch a value for changes
func Watch(path ...string) (Watcher, error) {
	return DefaultConfig.Watch(path...)
}

// LoadFile is shorthand for creating a file source and loading it
func LoadFile(path string) error {
	return Load(file.NewSource(
		file.WithPath(path),
	))
}

func RegisterOptions(options ...interface{}) {
	for _, option := range options {
		val := reflect.ValueOf(option)
		if val.Kind() != reflect.Ptr {
			panic("option must be a pointer")
			return
		}

		_, file, line, _ := runtime.Caller(1)

		key := fmt.Sprintf("%s#L%d", file, line)

		optionsPool[key] = val
	}
}
