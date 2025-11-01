package config

import (
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/pkg/config/source"
)

type configOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](configOptionsKey{}, func(options *option.Options) *Options {
		return &Options{
			Options: options,
			Watch:   true,
		}
	})
)

type Options struct {
	*option.Options

	Sources []source.Source
	Storage bool
	Watch   bool
	// HierarchyMerge merges the query args to one
	// eg. Get("a","b","c") can be used as Get("a.b.c")
	// the default is false
	HierarchyMerge bool
}

func WithSources(s ...source.Source) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Sources = append(opts.Sources, s...)
	})
}

func WithStorage(s bool) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Storage = s
	})
}

func WithWatch(w bool) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Watch = w
	})
}

func WithHierarchyMerge(h bool) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.HierarchyMerge = h
	})
}
