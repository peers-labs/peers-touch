package cli

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/cli"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/source"
)

type contextKey struct{}

// Context sets the cli context
func Context(c *cli.Context) source.Option {
	return func(o *source.Options) {
		if o.Context == nil {
			o.Context = context.Background()
		}
		o.Context = context.WithValue(o.Context, contextKey{}, c)
	}
}
