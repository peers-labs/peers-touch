package option

import (
	"context"

	"github.com/bytedance/gopkg/util/logger"
)

type Options struct {
	Ctx context.Context
}

func (o *Options) Apply(opts ...Option) {
	for _, opt := range opts {
		opt(o)
	}
}

type Option func(o *Options)

// BRun returns true if the Option Func is already run
func (o Option) BRun() bool {
	return false
}

// WithCtx sets the context
// It will be used as the root context for all other contexts. so don't use it to set a context for a subcomponent.
// If you want to use a custom peer service, please refer to peers.NewPeer's init function.
func WithCtx(ctx context.Context) Option {
	return func(o *Options) {
		if o.Ctx != nil {
			logger.Errorf("context already set")
			return
		}
		o.Ctx = ctx
	}
}
