package file

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type filePathKey struct{}

// WithPath sets the path to file
func WithPath(p string) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(o *source.Options) {
			o.Ctx = context.WithValue(o.Ctx, filePathKey{}, p)
		})
	}
}

func optionWrap(o *option.Options, f func(*source.Options)) {
	if o.Ctx == nil {
		o.Ctx = context.Background()
	}

	var opts *source.Options
	if o.Ctx.Value(filePathKey{}) == nil {
		opts = &source.Options{}
		o.Ctx = context.WithValue(o.Ctx, filePathKey{}, opts)
	} else {
		opts = o.Ctx.Value(filePathKey{}).(*source.Options)
	}

	f(opts)
}
