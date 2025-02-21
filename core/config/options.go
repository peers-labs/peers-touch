package config

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/config/loader"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/reader"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/source"
)

// WithLoader sets the loader for manager config
func WithLoader(l loader.Loader) Option {
	return func(o *Options) {
		o.Loader = l
	}
}

// WithSource appends a source to list of sources
func WithSource(s source.Source) Option {
	return func(o *Options) {
		o.Source = append(o.Source, s)
	}
}

// WithReader sets the config reader
func WithReader(r reader.Reader) Option {
	return func(o *Options) {
		o.Reader = r
	}
}

func WithHierarchyMerge(h bool) Option {
	return func(o *Options) {
		o.HierarchyMerge = h
	}
}

func WithStorage(s bool) Option {
	return func(o *Options) {
		o.Storage = s
	}
}
