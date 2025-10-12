package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/node"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

type NewNode func(rootOpts *option.Options, opts ...option.Option) node.Node

type peersOptionsKey struct{}

type Options struct {
	*option.Options

	NewService NewNode
}

/*func WithNewService(newService NewNode) option.Option {
	return &option.Option{Option: func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.NewNode = newService
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
