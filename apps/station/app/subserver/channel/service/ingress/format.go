package ingress

import (
	"context"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

// maxReplyRunes bounds a single outbound plain-text reply per platform.
// Values mirror the reference product's proven limits; unknown providers are
// left unbounded (the provider API is the final validator).
var maxReplyRunes = map[string]int{
	"lark": 30000,
}

// FormatMiddleware truncates an outbound reply to the platform maximum.
func FormatMiddleware() Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, event *model.NormalizedInboundEvent) (string, error) {
			reply, err := next(ctx, event)
			if err != nil || reply == "" {
				return reply, err
			}
			maxLen := maxReplyRunes[event.GetProviderKind()]
			if maxLen > 0 && utf8.RuneCountInString(reply) > maxLen {
				runes := []rune(reply)
				reply = string(runes[:maxLen-20]) + "\n\n[message truncated]"
			}
			return reply, nil
		}
	}
}

// HostPipeline returns the standard middleware order for host inbound
// dispatch: dedup first (no downstream work for duplicates), then panic
// recovery, then outbound formatting.
func HostPipeline(handler Handler) Handler {
	return ApplyMiddleware(handler,
		DeduplicateMiddleware(),
		RecoverMiddleware(),
		FormatMiddleware(),
	)
}
