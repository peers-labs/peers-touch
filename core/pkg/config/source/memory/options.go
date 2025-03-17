package memory

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type memSourceKey struct{}

type changeSetKey struct{}

func withData(d []byte, f string) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *source.Options) {
			opts.Ctx = context.WithValue(opts.Ctx, changeSetKey{}, &source.ChangeSet{
				Data:   d,
				Format: f,
			})
		})
	}
}

// WithChangeSet allows a changeset to be set
func WithChangeSet(cs *source.ChangeSet) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *source.Options) {
			opts.Ctx = context.WithValue(opts.Ctx, changeSetKey{}, cs)
		})
	}
}

// WithJSON allows the source data to be set to json
func WithJSON(d []byte) option.Option {
	return withData(d, "json")
}

// WithYAML allows the source data to be set to yaml
func WithYAML(d []byte) option.Option {
	return withData(d, "yaml")
}

func optionWrap(o *option.Options, f func(*source.Options)) {
	if o.Ctx == nil {
		o.Ctx = context.Background()
	}

	var opts *source.Options
	if o.Ctx().Value(memSourceKey{}) == nil {
		opts = &source.Options{}
		o.AppendCtx(memSourceKey{}, opts)
	} else {
		opts = o.Ctx().Value(memSourceKey{}).(*source.Options)
	}

	f(opts)
}
