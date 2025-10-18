package cli

import (
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/pkg/cli"
	"github.com/peers-touch/peers-touch-go/core/pkg/config/source"
)

type contextKey struct{}

var (
	ctxKey = &contextKey{}
)

// Context sets the cli context
func Context(c *cli.Context) option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(ctxKey, c)
	})
}
