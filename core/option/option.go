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

	// runtimeCtx is the context of runtime from init & run
	// don't use it to set a request context or something else like.
	runtimeCtx context.Context
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

func (o *Options) AppendCtx(key interface{}, value interface{}) {
	if o.ctx == nil {
		panic("option ctx is nil")
	}

	o.ctx = context.WithValue(o.ctx, key, value)
	return
}

type Option func(o *Options)

// BRun returns true if the Option Func is already run
func (o Option) BRun() bool {
	return false
}

// WithRootCtx sets the context
// It will be used as the root context for all other contexts. so don't use it to set a context for a subcomponent.
// If you want to use a custom peer service, please refer to peers.NewPeer's init function.
func WithRootCtx(ctx context.Context) Option {
	return func(o *Options) {
		lock.Lock()
		defer lock.Unlock()
		
		if o.ctx != nil {
			logger.Errorf("context already set")
			return
		}

		o.ctx = ctx
		rootOpts = o
		runtimeCtx = ctx
	}
}

type Wrapper[T any] struct {
	key interface{}
}

func NewWrapper[T any](key interface{}) *Wrapper[T] {
	return &Wrapper[T]{key: key}
}

func (w *Wrapper[T]) Wrap(f func(*T)) Option {
	return func(o *Options) {
		var opts *T
		if o.Ctx().Value(w.key) == nil {
			opts = new(T)
			o.AppendCtx(w.key, opts)
		} else {
			opts = o.Ctx().Value(w.key).(*T)
		}

		// Add any additional common logic here
		f(opts)
	}
}

func GetOptions(opts ...Option) *Options {
	lock.Lock()
	defer lock.Unlock()

	var ret *Options
	if rootOpts != nil {
		ret = rootOpts
	} else {
		ret = &Options{}
	}

	ret.Apply(opts...)
	if ret.ctx == nil {
		panic("WithRootCtx should be conveyed within.")
	}

	rootOpts = ret
	return ret
}
