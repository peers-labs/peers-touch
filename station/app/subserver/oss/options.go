package oss

import "github.com/peers-labs/peers-touch/station/frame/core/option"

type serverOptionsKey struct{}

var wrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
    return &Options{Options: options}
})

type Options struct {
    *option.Options
    Path       string
    DBName     string
    StorePath  string
    Token      string
    SignSecret string
}

func WithPath(p string) option.Option {
    return wrapper.Wrap(func(o *Options) { o.Path = p })
}
func WithDBName(n string) option.Option {
    return wrapper.Wrap(func(o *Options) { o.DBName = n })
}
func WithStorePath(p string) option.Option {
    return wrapper.Wrap(func(o *Options) { o.StorePath = p })
}
func WithToken(t string) option.Option {
    return wrapper.Wrap(func(o *Options) { o.Token = t })
}
func WithSignSecret(s string) option.Option {
    return wrapper.Wrap(func(o *Options) { o.SignSecret = s })
}

func getOptions(opts ...option.Option) *Options {
    return option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options)
}

