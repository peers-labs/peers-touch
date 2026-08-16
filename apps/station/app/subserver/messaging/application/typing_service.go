package application

import (
	"context"
	"fmt"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type TypingPublisher interface {
	PublishTyping(
		ctx context.Context,
		recipientPTID string,
		conversationID string,
		senderPTID string,
		isTyping bool,
	) error
}

// TypingService validates membership before ephemeral actor-level fan-out.
type TypingService struct {
	unitOfWork messaging.AuthorityUnitOfWork
	publisher  TypingPublisher
}

func NewTypingService(
	unitOfWork messaging.AuthorityUnitOfWork,
	publisher TypingPublisher,
) (*TypingService, error) {
	if unitOfWork == nil {
		return nil, fmt.Errorf("messaging: typing service requires unit of work")
	}
	if publisher == nil {
		return nil, fmt.Errorf("messaging: typing service requires ephemeral publisher")
	}
	return &TypingService{
		unitOfWork: unitOfWork,
		publisher:  publisher,
	}, nil
}

func (s *TypingService) BroadcastTyping(
	ctx context.Context,
	sender *chat.CryptoEndpoint,
	conversationID string,
	isTyping bool,
) error {
	if sender == nil || sender.Ptid == "" || sender.DeviceId == "" {
		return fmt.Errorf("messaging: typing sender endpoint is required")
	}
	if conversationID == "" {
		return fmt.Errorf("messaging: typing conversation_id is required")
	}

	var recipients []string
	if err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		active, err := repositories.Devices.IsActive(ctx, sender)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}

		conversation, err := repositories.Authority.LockConversation(ctx, conversationID)
		if err != nil {
			return err
		}
		if !conversation.Active {
			return messaging.ErrConversationState
		}
		member, err := repositories.Authority.GetMember(ctx, conversationID, sender.Ptid)
		if err != nil {
			return err
		}
		if !member.Active {
			return messaging.ErrSenderUnauthorized
		}
		members, err := repositories.Authority.ListActiveMembers(ctx, conversationID)
		if err != nil {
			return err
		}
		recipients = make([]string, 0, len(members))
		for _, recipient := range members {
			if recipient.Active && recipient.PTID != sender.Ptid {
				recipients = append(recipients, recipient.PTID)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	for _, recipientPTID := range recipients {
		if err := s.publisher.PublishTyping(
			ctx,
			recipientPTID,
			conversationID,
			sender.Ptid,
			isTyping,
		); err != nil {
			return err
		}
	}
	return nil
}
