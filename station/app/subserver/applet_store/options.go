package applet_store

import (
    "github.com/peers-labs/peers-touch/station/frame/core/option"
)

type Options struct{
    *option.Options
    PathBase string
    DBName   string
    StorePath string
}

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(o *option.Options) *Options{
    return &Options{Options: o}
})

func WithPathBase(p string) option.Option {
    return wrapper.Wrap(func(o *Options){ o.PathBase = p })
}

func WithDBName(name string) option.Option {
    return wrapper.Wrap(func(o *Options){ o.DBName = name })
}

func WithStorePath(p string) option.Option {
    return wrapper.Wrap(func(o *Options){ o.StorePath = p })
}

// expose server options key used in constructor
type serverOptionsKey struct{}
