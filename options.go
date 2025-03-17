package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

type peersOptionsKey struct{}

type Options struct {
	*option.Options

	Name string
}

func WithName(name string) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.Name = name
		})
	}
}

func optionWrap(o *option.Options, f func(*Options)) {
	var opts *Options
	if o.Ctx().Value(peersOptionsKey{}) == nil {
		opts = &Options{}
		o.AppendCtx(peersOptionsKey{}, opts)
	} else {
		opts = o.Ctx().Value(peersOptionsKey{}).(*Options)
	}

	f(opts)
}
