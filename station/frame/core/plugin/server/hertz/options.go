package hertz

import (
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

// loggerKey is the context key for hertz logger.
type loggerKey struct{}

// WithLogger injects a logger into hertz server options.
func WithLogger(l log.Logger) option.Option {
	return func(o *option.Options) {
		o.AppendCtx(loggerKey{}, l)
	}
}
