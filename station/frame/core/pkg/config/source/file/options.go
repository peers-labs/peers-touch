package file

import (
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/pkg/config/source"
)

type filePathKey struct{}

// WithPath sets the path to file
func WithPath(p string) option.Option {
	return source.WrapOption(func(o *source.Options) {
		o.AppendCtx(filePathKey{}, p)
	})
}
