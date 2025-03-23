package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"gorm.io/gorm"
)

// region Errors

// ErrDBNotFound is returned when the requested database is not found in the rdsMap.
var ErrDBNotFound = errors.New("database not found")
var ErrStoreNotDefined = errors.New("store not defined")
var ErrStoreAlreadyExists = errors.New("store already exists")
var ErrStoreNotFound = errors.New("store already exists")
var ErrStoreInitFailed = func(name string) error { return fmt.Errorf("store[%s] init failed", name) }
var ErrStoreInjectOvertime = errors.New("store injection over time")

// endregion

// region Stores' constructor

type constructor func(ctx context.Context, opts ...option.Option) (Store, error)

var (
	storeConstructorMap = make(map[string]Store)
	storeConstructors   []constructor

	initialized = atomic.Bool{}
	initLock    sync.Mutex
)

// endregion

type Store interface {
	Init(ctx context.Context, opts ...option.Option) error
	RDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error)
	Name() string
}

func GetRDS(ctx context.Context, opts ...RDSDMLOption) (*gorm.DB, error) {
	options := &RDSQueryOptions{}
	for _, opt := range opts {
		opt(options)
	}

	if options.StoreName == "" {
		return nil, ErrStoreNotDefined
	}

	if options.Name == "" {
		return nil, ErrDBNotFound
	}

	if options.DBName == "" {
		options.DBName = "default"
	}

	st, err := GetStore(ctx, WithStoreName(options.StoreName))
	if err != nil {
		return nil, err
	}

	return st.RDS(ctx, opts...)
}

func GetStore(ctx context.Context, opts ...GetOption) (Store, error) {
	options := &GetOptions{}
	for _, opt := range opts {
		opt(options)
	}

	if st, ok := storeConstructorMap[options.StoreName]; ok {
		return st, nil
	}

	return nil, ErrStoreInitFailed(options.StoreName)
}

func InjectStore(c constructor) {
	if initialized.Load() {
		panic(ErrStoreInjectOvertime)
	}

	storeConstructors = append(storeConstructors, c)
}

func Init(ctx context.Context, opts ...option.Option) error {
	initLock.Lock()
	defer initLock.Unlock()

	options := &option.Options{}
	for _, opt := range opts {
		opt(options)
	}

	for _, c := range storeConstructors {
		s, err := c(ctx, opts...)
		if err != nil {
			return err
		}

		if storeConstructorMap[s.Name()] != nil {
			return ErrStoreAlreadyExists
		}

		err = s.Init(ctx)
		if err != nil {
			return ErrStoreInitFailed(s.Name())
		}

		storeConstructorMap[s.Name()] = s
	}

	initialized.Store(true)

	return nil
}
