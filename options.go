package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

type NewService func(rootOpts *option.Options, opts ...option.Option) service.Service
type peersOptionsKey struct{}

type Options struct {
	*option.Options

	NewService NewService
}

func WithNewService(newService NewService) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.NewService = newService
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
