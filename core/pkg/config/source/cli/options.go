package cli

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/cli"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type contextKey struct{}

// Context sets the cli context
func Context(c *cli.Context) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(o *source.Options) {
			o.AppendCtx(contextKey{}, c)
		})
	}
}

func optionWrap(o *option.Options, f func(*source.Options)) {
	var opts *source.Options
	if o.Ctx().Value(contextKey{}) == nil {
		opts = &source.Options{}
		o.AppendCtx(contextKey{}, opts)
	} else {
		opts = o.Ctx().Value(contextKey{}).(*source.Options)
	}

	f(opts)
}
