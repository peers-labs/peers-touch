package agent

import (
	"context"

	agentsvc "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	botdomain "github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// inboundAutomationTarget is implemented by the conversation subserver.
type inboundAutomationTarget interface {
	SetInboundAutomationSink(sink conversation.InboundAutomationSink)
}

// botReplyTarget republished completed Agent turns through Conversation's
// generic publishing capability, keeping the bot actor as the author.
type botReplyTarget interface {
	PublishBotReply(
		ctx context.Context,
		publishingID string,
		senderPTID string,
		ownerPTID string,
		conversationID string,
		replyKey string,
		text string,
	) error
}

// botBindingTarget is implemented by the bot subserver for the enabled
// binding lookup.
type botBindingTarget interface {
	ActiveAgentBinding(
		ctx context.Context,
		botPTID string,
	) (*botdomain.AgentBinding, bool, error)
}

type botBindingReader struct {
	target botBindingTarget
}

func (r botBindingReader) ActiveAgentBinding(
	ctx context.Context,
	botPTID string,
) (agentsvc.BotBindingView, bool, error) {
	binding, found, err := r.target.ActiveAgentBinding(ctx, botPTID)
	if err != nil || !found || binding == nil {
		return agentsvc.BotBindingView{}, false, err
	}
	return agentsvc.BotBindingView{
		BotPtid:   binding.BotPtid,
		OwnerPtid: binding.OwnerPtid,
		AgentID:   binding.AgentID,
		Enabled:   binding.Enabled,
		Version:   binding.Version,
	}, true, nil
}

type botInboundSink struct {
	bridge *agentsvc.BotTurnBridge
}

func (s botInboundSink) OnInboundPublished(
	ctx context.Context,
	event conversation.PublishedInbound,
) error {
	return s.bridge.OnInboundPublished(ctx, agentsvc.BotInboundEvent{
		PublishingID:   event.PublishingID,
		SenderPTID:     event.SenderPTID,
		OwnerPTID:      event.OwnerPTID,
		ConversationID: event.ConversationID,
		MessageID:      event.MessageID,
		Text:           event.Text,
	})
}

// wireBotTurnBridge installs the durable bot↔Agent turn projection across the
// conversation, bot and agent subservers. Wiring is structural (channel_wire
// pattern): when any peer is absent the feature stays disabled and bots keep
// their receive-only behavior.
func (s *agentSubServer) wireBotTurnBridge(
	executor *agentsvc.ChannelTurnExecutor,
) *agentsvc.BotTurnBridge {
	serverOptions := server.GetOptions()
	if serverOptions == nil || executor == nil || s.agentDB == nil {
		return nil
	}
	conversationInstance := serverOptions.SubserverInstances["conversation"]
	automation, automationOK := conversationInstance.(inboundAutomationTarget)
	publisher, publisherOK := conversationInstance.(botReplyTarget)
	botInstance := serverOptions.SubserverInstances["bot"]
	bindingSource, bindingOK := botInstance.(botBindingTarget)
	if !automationOK || !publisherOK || !bindingOK {
		return nil
	}
	bridge := agentsvc.NewBotTurnBridge(
		s.agentDB,
		executor,
		botBindingReader{target: bindingSource},
		publisher,
	)
	automation.SetInboundAutomationSink(botInboundSink{bridge: bridge})
	return bridge
}
