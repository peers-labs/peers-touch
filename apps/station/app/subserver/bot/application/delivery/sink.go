// Package delivery owns the Bot-to-Conversation effect boundary. The bot
// ingest pipeline depends only on the Sink port here; the production adapter
// is implemented by the Conversation sub-server and resolved lazily at
// request time through the shared sub-server registry, mirroring the Social
// direct-conversation capability boundary (no import cycle, no init ordering).
package delivery

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/ingest"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// ConversationSink is the capability the Conversation sub-server exposes for
// internal, non-E2EE bot event delivery. The capability name intentionally
// does not mention repository storage.
type ConversationSink interface {
	DeliverBotEvent(
		ctx context.Context,
		command ingest.DeliverCommand,
	) (eventID string, replayed bool, err error)
}

// conversationInstanceKey is the registered sub-server instance name.
const conversationInstanceKey = "conversation"

// ErrSinkUnavailable indicates the Conversation capability is not registered
// yet; the edge maps this to a retryable gateway error rather than 401/400.
var ErrSinkUnavailable = errors.New("bot delivery: conversation sink is unavailable")

// LazySink resolves the Conversation capability per request so sub-server
// initialization order is irrelevant.
type LazySink struct{}

// NewLazySink constructs the runtime resolver.
func NewLazySink() *LazySink { return &LazySink{} }

// Deliver implements ingest.DeliverySink by delegating to the registered
// Conversation sub-server capability.
func (LazySink) Deliver(
	ctx context.Context,
	command ingest.DeliverCommand,
) (string, bool, error) {
	instance := server.GetOptions().SubserverInstances[conversationInstanceKey]
	provider, ok := instance.(ConversationSink)
	if !ok || provider == nil {
		return "", false, ErrSinkUnavailable
	}
	return provider.DeliverBotEvent(ctx, command)
}
