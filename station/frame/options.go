package peers

import (
	"github.com/peers-touch/peers-touch/station/frame/core/node"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
)

type NewService func(rootOpts *option.Options, opts ...option.Option) node.Node

type peersOptionsKey struct{}

type Options struct {
	*option.Options

	NewService NewService
}

/*func WithNewService(newService NewService) option.Option {
	return &option.Option{Option: func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.NewService = newService
		})
	}}
}*/

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
