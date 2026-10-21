package pluginlark

import (
	"context"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

// WSConfigForTest mirrors WSConfig for external package tests.
type WSConfigForTest = WSConfig

// NewWSClientForTest exposes the generation client constructor.
func NewWSClientForTest(cfg WSConfigForTest) *wsClient {
	return newWSClient(cfg)
}

// RunForTest runs one generation.
func (c *wsClient) RunForTest(ctx context.Context) error { return c.Run(ctx) }

// StopForTest waits for generation exit.
func (c *wsClient) StopForTest() { c.Stop() }

// TerminalErrorForTest re-exports the terminal error type.
type TerminalErrorForTest = TerminalError

// NormalizeMessageForTest exposes the normalization function to tests.
func NormalizeMessageForTest(bindingID, provider string, event *larkim.P2MessageReceiveV1) *model.NormalizedInboundEvent {
	return normalizeMessage(bindingID, provider, event)
}

func SummarizeReferencedMessagesForTest(
	items []*larkim.Message,
	skipMessageID string,
) (string, []*model.ChannelResourceRef) {
	return summarizeReferencedMessages(items, skipMessageID)
}
