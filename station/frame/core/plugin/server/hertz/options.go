package hertz

import (
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type loggerKey struct{}

func WithLogger(l log.Logger) option.Option {
	return func(o *option.Options) {
		o.AppendCtx(loggerKey{}, l)
	}
}
