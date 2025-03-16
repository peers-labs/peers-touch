package peers

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

type peersOptionsKey struct{}

type Options struct {
	*option.Options

	Name string

	serviceOpts *service.Options
}

// ServiceOptions helps to convert the options of service
// calling this should confirm the Init already done.
func (o *Options) ServiceOptions() (ret []option.Option) {
	if len(o.Name) > 0 {
		ret = append(ret, service.Name(o.Name))
	}

	return
}

func WithName(name string) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.Name = name
		})
	}
}

func WithAppendHandlers(handlers ...server.Handler) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.serviceOpts.ServerOptions = append(opts.serviceOpts.ServerOptions, server.WithHandlers(handlers...))
		})
	}
}

func WithSubServer(srv server.SubServer, sOpts ...server.SubServerOption) option.Option {
	return func(o *option.Options) {
		optionWrap(o, func(opts *Options) {
			opts.serviceOpts.ServerOptions = append(opts.serviceOpts.ServerOptions, server.WithSubServer(srv, sOpts...))
		})
	}
}

func optionWrap(o *option.Options, f func(*Options)) {
	if o.Ctx == nil {
		o.Ctx = context.Background()
	}

	var opts *Options
	if o.Ctx.Value(peersOptionsKey{}) == nil {
		opts = &Options{}
		o.Ctx = context.WithValue(o.Ctx, peersOptionsKey{}, opts)
	} else {
		opts = o.Ctx.Value(peersOptionsKey{}).(*Options)
	}

	f(opts)
}
