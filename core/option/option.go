package option

import (
	"context"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"
)

var (
	// cache the context of runtime from init & run
	// rootOpts is the key component of Peers' lifecycle. it manages entire options info for peers' service.
	rootOpts *Options

	ctxLock       sync.RWMutex
	appendCtxLock sync.RWMutex

	// runtimeCtx is the context of runtime from init & run
	// don't use it to set a request context or something else like.
	runtimeCtx context.Context

	applyLock sync.Mutex

	executedLock sync.Mutex
)

type Options struct {
	ctx context.Context

	ExtOptions any
}

func (o *Options) Apply(opts ...*Option) {
	applyLock.Lock()
	defer applyLock.Unlock()

	for i := 0; i < len(opts); i++ {
		if ok := opts[i].bRun(); ok {
			log.Debugf("option %v already executed.", &opts[i])
			continue
		}
		opts[i].Option(o)
	}
}

func (o *Options) Ctx() context.Context {
	if o.ctx == nil {
		panic("option ctx is nil")
	}

	return o.ctx
}

func (o *Options) AppendCtx(key interface{}, value interface{}) {
	appendCtxLock.Lock()
	defer appendCtxLock.Unlock()

	if o.ctx == nil {
		panic("option ctx is nil")
	}

	o.ctx = context.WithValue(o.ctx, key, value)
	return
}

type Option struct {
	Option func(o *Options)

	executed bool
}

// bRun returns true if the Option Func is already executed
func (o *Option) bRun() bool {
	executedLock.Lock()
	defer executedLock.Unlock()

	if !o.executed {
		o.executed = true
		return false
	}

	return true
}

// WithRootCtx sets the context
// It will be used as the root context for all other contexts. so don't use it to set a context for a subcomponent if you use
// components together. but when you want to use only one component like config as a lib, you can convey WithRootCtx as the first
// Option to the component's init.
// If you want to use a custom peer service, please refer to peers.NewPeer's init function.
func WithRootCtx(ctx context.Context) Option {
	return Option{Option: func(o *Options) {
		ctxLock.Lock()
		defer ctxLock.Unlock()

		if o.ctx != nil {
			log.Errorf("context already set")
			return
		}

		// todo, there are too many ways to set ctx, see AppendCtx
		// these two ways are not safe
		o.ctx = ctx
		rootOpts = o
		runtimeCtx = ctx
	}}
}

type Wrapper[T any] struct {
	key     interface{}
	NewFunc func(*Options) *T
}

func NewWrapper[T any](key interface{}, NewFunc func(*Options) *T) *Wrapper[T] {
	return &Wrapper[T]{key: key, NewFunc: NewFunc}
}

func (w *Wrapper[T]) Wrap(f func(*T)) *Option {
	return &Option{Option: func(o *Options) {
		var opts *T
		if o.Ctx().Value(w.key) == nil {
			opts = w.NewFunc(o)
			o.AppendCtx(w.key, opts)
		} else {
			opts = o.Ctx().Value(w.key).(*T)
		}

		// Add any additional common logic here
		f(opts)
	}}
}

func GetOptions(opts ...*Option) *Options {
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
