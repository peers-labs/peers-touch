package memory

import (
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/pkg/config/source"
)

type changeSetKey struct{}

type Options struct {
	*option.Options

	cs *source.ChangeSet
}

func withData(d []byte, f string) option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(changeSetKey{}, &source.ChangeSet{
			Data:   d,
			Format: f,
		})
	})
}

// WithChangeSet allows a changeset to be set
func WithChangeSet(cs *source.ChangeSet) option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(changeSetKey{}, cs)
	})
}

// WithJSON allows the source data to be set to json
func WithJSON(d []byte) option.Option {
	return withData(d, "json")
}

// WithYAML allows the source data to be set to yaml
func WithYAML(d []byte) option.Option {
	return withData(d, "yaml")
}
