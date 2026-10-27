package conversation

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	publishingapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/publishing"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// maxBotReplyTextRunes bounds an Agent reply republished as the bot actor. It
// stays below the system-message payload limit after protobuf wrapping.
const maxBotReplyTextRunes = 8000

// PublishedInbound is the post-commit projection of one accepted external
// publishing message. It carries only data the automation owner is allowed
// to see: the bot owner is the recipient of the Direct.
type PublishedInbound struct {
	PublishingID    string
	SenderPTID      string
	OwnerPTID       string
	ConversationID  string
	CommandID       string
	MessageID       string
	EventID         string
	Text            string
	SourceNamespace string
}

// InboundAutomationSink receives accepted inbound publications after commit.
// The agent subserver installs the only production implementation through
// structural subserver wiring (channel_wire pattern).
type InboundAutomationSink interface {
	// OnInboundPublished must be idempotent on MessageID and must not block on
	// the Agent execution itself.
	OnInboundPublished(ctx context.Context, event PublishedInbound) error
}

// SetInboundAutomationSink installs the Station-internal inbound projector.
func (s *subServer) SetInboundAutomationSink(sink InboundAutomationSink) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.inboundAutomation = sink
}

func (s *subServer) dispatchInboundAutomation(
	ctx context.Context,
	result *publishingapp.Result,
) {
	if result == nil || result.Inbound == nil {
		return
	}
	s.mu.RLock()
	sink := s.inboundAutomation
	s.mu.RUnlock()
	if sink == nil {
		return
	}
	event := PublishedInbound{
		PublishingID:    result.Inbound.PublishingID,
		SenderPTID:      result.Inbound.SenderPTID,
		OwnerPTID:       result.Inbound.OwnerPTID,
		ConversationID:  result.Inbound.ConversationID,
		CommandID:       result.Inbound.CommandID,
		MessageID:       result.Inbound.MessageID,
		EventID:         result.Inbound.EventID,
		Text:            result.Inbound.Text,
		SourceNamespace: result.Inbound.SourceNamespace,
	}
	if err := sink.OnInboundPublished(ctx, event); err != nil {
		// The inbound event is already committed; surface the projection
		// failure diagnostically but never report the publication as failed.
		logger.Errorf(ctx, "[message-publishing] inbound automation enqueue failed: %v", err)
	}
}

// PublishBotReply republishes a completed Agent turn as a service-plaintext
// message authored by the bot actor in the provisioned Direct. It is the
// Station-internal counterpart of the authenticated publishing ingress:
// caller identity is structural, but the same grant authorization and
// idempotent command path apply. replyKey provides idempotent command/message
// identity for the inbound message being answered.
func (s *subServer) PublishBotReply(
	ctx context.Context,
	publishingID string,
	senderPTID string,
	ownerPTID string,
	conversationID string,
	replyKey string,
	text string,
) error {
	if s.composition == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"conversation.publish_bot_reply",
			"composition",
			"conversation composition is unavailable",
		)
	}
	publishingID = strings.TrimSpace(publishingID)
	senderPTID = strings.TrimSpace(senderPTID)
	ownerPTID = strings.TrimSpace(ownerPTID)
	conversationID = strings.TrimSpace(conversationID)
	replyKey = strings.TrimSpace(replyKey)
	text = strings.TrimSpace(text)
	if publishingID == "" || senderPTID == "" || ownerPTID == "" ||
		conversationID == "" || replyKey == "" || text == "" {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"conversation.publish_bot_reply",
			"request",
			"complete bot reply input is required",
		)
	}
	if runes := utf8.RuneCountInString(text); runes > maxBotReplyTextRunes {
		text = string([]rune(text)[:maxBotReplyTextRunes])
	}
	grant, err := s.composition.PublishingManagement.GetOwned(
		ctx,
		valueobject.PTID(ownerPTID),
		publishingID,
	)
	if err != nil {
		return err
	}
	if string(grant.Sender) != senderPTID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"conversation.publish_bot_reply",
			"sender",
			"reply actor does not match the publishing grant",
		)
	}
	if string(grant.DefaultTarget) != conversationID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"conversation.publish_bot_reply",
			"conversation",
			"reply target is not the provisioned service Direct",
		)
	}
	content := &chat.MessageContent{
		Primary:      &chat.MessageContent_Text{Text: &chat.MessageTextContent{Text: text}},
		FallbackText: text,
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.DirectServicePlaintextPayload{
			MessageContent:  content,
			SourceContext:   nil,
			SourceNamespace: grant.SourceNamespace,
		},
	)
	if err != nil {
		return err
	}
	commandID, err := valueobject.NewCommandID("bot-reply:" + publishingID + ":" + replyKey)
	if err != nil {
		return err
	}
	messageID, err := valueobject.NewMessageID("bot-reply-message:" + publishingID + ":" + replyKey)
	if err != nil {
		return err
	}
	target, err := valueobject.NewConversationID(conversationID)
	if err != nil {
		return err
	}
	_, err = s.composition.CommandService.DeliverSystemMessage(ctx, command.SystemMessageRequest{
		ConversationID: target,
		PublishingID:   publishingID,
		Sender:         valueobject.PTID(senderPTID),
		Recipient:      valueobject.PTID(ownerPTID),
		CommandID:      commandID,
		MessageID:      messageID,
		Payload:        payload,
	})
	return err
}
