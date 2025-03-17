package option

import (
	"context"
	"sync"

	"github.com/bytedance/gopkg/util/logger"
)

var (
	// cache the context of runtime from init & run
	// rootOpts is the key component of Peers' lifecycle. it manages entire options info for peers' service.
	rootOpts *Options

	lock sync.RWMutex
)

type Options struct {
	ctx context.Context
}

func (o *Options) Apply(opts ...Option) {
	for _, opt := range opts {
		opt(o)
	}
}

func (o *Options) Ctx() context.Context {
	if o.ctx == nil {
		panic("option ctx is nil")
	}

	return o.ctx
}

func (o *Options) AppendCtx(key struct{}, value interface{}) context.Context {
	if o.ctx == nil {
		panic("option ctx is nil")
	}

	o.ctx = context.WithValue(o.ctx, key, value)
	return o.ctx
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
		if o.ctx != nil {
			logger.Errorf("context already set")
			return
		}
		o.ctx = ctx
	}
}

func GetOptions(opts ...Option) *Options {
	lock.Lock()
	defer lock.Unlock()

	if rootOpts != nil {
		return rootOpts
	}

	newOpts := &Options{}
	newOpts.Apply(opts...)
	if newOpts.ctx == nil {
		panic("WithCtx should be conveyed within.")
	}

	rootOpts = newOpts
	return rootOpts
}
