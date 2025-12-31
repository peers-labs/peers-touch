package hertz

import (
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type loggerKey struct{}

// WithLogger sets the logger for the Hertz server
func WithLogger(l logger.Logger) option.Option {
	return func(o *option.Options) {
		o.AppendCtx(loggerKey{}, l)
	}
}
