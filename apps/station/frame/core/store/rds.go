package store

import (
	"context"

	"gorm.io/gorm"
)

var (
	afterInitHooks []func(ctx context.Context, rds *gorm.DB)
)

// InitTableHooks is used to register hooks for table initialization.
// TODO: it should be set as Option, but not hooks.
func InitTableHooks(funcs ...func(ctx context.Context, rds *gorm.DB)) {
	afterInitHooks = append(afterInitHooks, funcs...)
}
