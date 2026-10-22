package ingress

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

// RecoverMiddleware turns a handler panic into a regular error so one bad
// event never kills the host dispatch goroutine.
func RecoverMiddleware() Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, event *model.NormalizedInboundEvent) (reply string, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("channel handler panic: %v", r)
				}
			}()
			return next(ctx, event)
		}
	}
}
