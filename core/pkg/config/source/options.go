package source

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/cli"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/encoder"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/encoder/json"
)

type sourceOptionsKey struct{}
type contextKey struct{}

type Options struct {
	*option.Options

	// Encoder
	Encoder encoder.Encoder
}

func NewOptions(opts ...option.Option) Options {
	// todo check existed or set by more appropriate way
	options := Options{
		Encoder: json.NewEncoder(),
	}

	for _, o := range opts {
		options.Apply(o)
	}

	return options
}

// WithEncoder sets the source encoder
func WithEncoder(e encoder.Encoder) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.Encoder = e
		})
	}
}

// Context sets the cli context
func Context(c *cli.Context) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			o.AppendCtx(contextKey{}, c)
		})
	}
}

func optionWrap(o *option.Options, f func(*Options)) {
	var opts *Options
	if o.Ctx().Value(sourceOptionsKey{}) == nil {
		opts = &Options{}
		o.AppendCtx(sourceOptionsKey{}, opts)
	} else {
		opts = o.Ctx().Value(sourceOptionsKey{}).(*Options)
	}

	f(opts)
}
