package bootstrap

import "github.com/peers-touch/peers-touch-go/core/option"

type Bootstrap struct {
	opts *Options
}

func New(opts ...option.Option) *Bootstrap {
	options := wrapper.NewFunc(&option.Options{}, opts...)
	return &Bootstrap{
		opts: options,
	}
}

func NewBootstrap(baseOpts *option.Options, opts ...option.Option) Bootstrap {
	options := wrapper.NewFunc(baseOpts, opts...)
	return Bootstrap{
		opts: options,
	}
}

func (b *Bootstrap) Options() *Options {
	return b.opts
}

func (b *Bootstrap) Apply(opts ...option.Option) {
	for _, opt := range opts {
		opt(b.opts.Options)
	}
}
