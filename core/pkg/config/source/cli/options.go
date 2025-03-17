package cli

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/cli"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type contextKey struct{}

var (
	ctxKey = &contextKey{}
)

// Context sets the cli context
func Context(c *cli.Context) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(o *source.Options) {
			o.AppendCtx(ctxKey, c)
		})
	}
}

func optionWrap(o *option.Options, f func(*source.Options)) {
	var opts *source.Options
	if o.Ctx().Value(ctxKey) == nil {
		opts = &source.Options{}
		o.AppendCtx(ctxKey, opts)
	} else {
		opts = o.Ctx().Value(ctxKey).(*source.Options)
	}

	f(opts)
}
