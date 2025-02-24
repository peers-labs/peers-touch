package config

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
)

type Options struct {
	Sources []source.Source
	Storage bool
	Watch   bool
	// HierarchyMerge merges the query args to one
	// eg. Get("a","b","c") can be used as Get("a.b.c")
	// the default is false
	HierarchyMerge bool

	Context context.Context
}

type Option func(o *Options)

func WithSources(s ...source.Source) Option {
	return func(o *Options) {
		o.Sources = append(o.Sources, s...)
	}
}

func WithStorage(s bool) Option {
	return func(o *Options) {
		o.Storage = s
	}
}

func WithWatch(w bool) Option {
	return func(o *Options) {
		o.Watch = w
	}
}

func WithHierarchyMerge(h bool) Option {
	return func(o *Options) {
		o.HierarchyMerge = h
	}
}

func WithContext(ctx context.Context) Option {
	return func(o *Options) {
		o.Context = ctx
	}
}
