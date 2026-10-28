package publishing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/credential"
)

const (
	NotificationTypeServiceMessage = int32(205)
	NotificationTypeTaskEvent      = int32(410)
)

type Clock interface {
	Now() time.Time
}

type IDGenerator interface {
	NewID() string
}

type Service struct {
	unitOfWork ports.UnitOfWork
	commands   *command.Service
	clock      Clock
	ids        IDGenerator
}

type Result struct {
	Response         *Response
	NotificationWake *ports.ServiceNotificationWake
	// Inbound is populated only for a newly accepted publication. It is the
	// projection consumed by Station-internal automation (bot↔Agent replies);
	// replays never re-project an inbound event.
	Inbound *CommittedInbound
}

// CommittedInbound describes one accepted external publication after its
// conversation event committed.
type CommittedInbound struct {
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

func NewService(
	unitOfWork ports.UnitOfWork,
	commands *command.Service,
	clock Clock,
	ids IDGenerator,
) (*Service, error) {
	if unitOfWork == nil || commands == nil || clock == nil || ids == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"publishing.new_service",
			"dependencies",
			"unit of work, command service, clock, and ID generator are required",
		)
	}
	return &Service{unitOfWork: unitOfWork, commands: commands, clock: clock, ids: ids}, nil
}

func (s *Service) Publish(
	ctx context.Context,
	publishingID string,
	presentedSecret string,
	request Request,
) (Result, error) {
	publishingID = strings.TrimSpace(publishingID)
	if publishingID == "" || strings.TrimSpace(presentedSecret) == "" {
		return Result{}, unauthorized()
	}
	request.CommandID = strings.TrimSpace(request.CommandID)
	if request.Message == nil || len(request.IdentityBytes) == 0 {
		return Result{}, invalid("request", "normalized message identity is required")
	}
	if request.CommandID == "" {
		request.CommandID = s.ids.NewID()
	}
	commandID, err := valueobject.NewCommandID(request.CommandID)
	if err != nil {
		return Result{}, err
	}
	if request.Target != "" {
		if _, err := valueobject.NewConversationID(string(request.Target)); err != nil {
			return Result{}, err
		}
	}
	requestHash := valueobject.HashBytes(request.IdentityBytes)
	now := s.clock.Now().UTC()
	var result Result
	err = s.unitOfWork.ExecuteSerialized(
		ctx,
		"message-publishing:"+publishingID,
		func(tx ports.Transaction) error {
			if tx.Publishing == nil || tx.PublishingObjects == nil {
				return fmt.Errorf("publishing transaction adapters are not wired")
			}
			grant, loadErr := tx.Publishing.GetGrant(ctx, publishingID)
			if loadErr != nil {
				credential.Verify("", presentedSecret)
				return unauthorized()
			}
			if !grant.Active(now) || !credential.Verify(grant.SecretHash, presentedSecret) {
				return unauthorized()
			}

			receipt, found, receiptErr := tx.Publishing.GetPublication(
				ctx,
				publishingID,
				string(commandID),
			)
			if receiptErr != nil {
				return receiptErr
			}
			if found {
				if receipt.RequestHash != requestHash {
					return conflict("command_id", "was already committed with a different normalized request")
				}
				if receipt.Recipient != grant.Owner {
					return unauthorized()
				}
				if err := grant.Authorize(receipt.Sender, receipt.Conversation, now); err != nil {
					return err
				}
				result.Response = publicationResponse(receipt, OutcomeReplayed)
				return nil
			}
			if err := tx.Publishing.CheckRate(ctx, publishingID, grant.RatePerMinute, now); err != nil {
				return err
			}

			target := request.Target
			if target == "" {
				target = grant.DefaultTarget
			}
			if err := grant.Authorize(grant.Sender, target, now); err != nil {
				return err
			}
			expected, err := valueobject.DirectConversationID(grant.Sender, grant.Owner)
			if err != nil {
				return err
			}
			if target != expected {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeUnauthorized,
					"publishing.publish",
					"target",
					"service plaintext target is not the provisioned local service Direct",
				)
			}
			routes, err := tx.Identity.ListActiveEndpoints(ctx, []valueobject.PTID{grant.Owner})
			if err != nil {
				return err
			}
			if len(routes) == 0 {
				return conflict("recipient", "has no active device")
			}
			bound, err := s.commands.BindUnitOfWork(boundUnitOfWork{tx: tx})
			if err != nil {
				return err
			}
			systemSender := valueobject.Endpoint{
				Actor:  grant.Sender,
				Device: valueobject.SystemStationDeviceID,
			}
			genesisCommandID := valueobject.CommandID("publishing-genesis:" + publishingID)
			genesis, err := bound.EnsureSystemDirect(ctx, command.EnsureSystemDirectRequest{
				Sender:          grant.Sender,
				Recipient:       grant.Owner,
				SystemSender:    systemSender,
				RecipientRoutes: routes,
				CommandID:       genesisCommandID,
				ExactEventBytes: []byte("publishing-genesis:" + publishingID),
			})
			if err != nil {
				return err
			}
			if genesis.Conversation.ID != target {
				return conflict("target", "does not match the committed service Direct")
			}

			objectIDs := request.Message.AttachmentObjectIDs()
			attachments := make([]Attachment, 0, len(objectIDs))
			for _, objectID := range objectIDs {
				object, err := tx.PublishingObjects.ValidateObject(
					ctx,
					objectID,
					grant.Owner,
					target,
					now,
				)
				if err != nil {
					return err
				}
				attachments = append(attachments, Attachment{
					ObjectID:  objectID,
					Filename:  object.Filename,
					MediaType: object.MediaType,
					Size:      object.Size,
				})
			}
			message, err := request.Message.Materialize(grant.SourceNamespace, attachments)
			if err != nil {
				return err
			}
			if len(message.Payload) == 0 {
				return fmt.Errorf("publishing message adapter returned an empty payload")
			}
			messageCommandID := valueobject.CommandID(
				"publishing:" + publishingID + ":" + string(commandID),
			)
			messageID := valueobject.MessageID(
				"publishing-message:" + publishingID + ":" + string(commandID),
			)
			delivered, err := bound.DeliverSystemMessage(ctx, command.SystemMessageRequest{
				ConversationID: target,
				PublishingID:   publishingID,
				Sender:         grant.Sender,
				Recipient:      grant.Owner,
				CommandID:      messageCommandID,
				MessageID:      messageID,
				Payload:        message.Payload,
			})
			if err != nil {
				return err
			}
			receipt = entity.PublicationReceipt{
				PublishingID:  publishingID,
				CommandID:     string(commandID),
				RequestHash:   requestHash,
				Sender:        grant.Sender,
				Recipient:     grant.Owner,
				Conversation:  target,
				MessageID:     messageID,
				EventID:       delivered.Event.ID,
				EventSequence: delivered.Event.Sequence,
				CreatedAt:     now,
			}

			if tx.ServiceNotifications != nil {
				notification, err := tx.ServiceNotifications.ProduceInTx(
					ctx,
					ports.ServiceNotificationInput{
						RecipientPTID:  string(grant.Owner),
						ActorPTID:      string(grant.Sender),
						Type:           message.NotificationType,
						Category:       message.NotificationCategory,
						TargetType:     "conversation",
						TargetID:       string(target),
						Title:          grant.Name,
						Body:           message.FallbackText,
						GroupKey:       message.NotificationGroupKey,
						IdempotencyKey: "publishing:" + publishingID + ":" + string(commandID),
						Metadata: map[string]string{
							"publishing_id":    publishingID,
							"source_namespace": grant.SourceNamespace,
							"message_id":       string(messageID),
							"event_id":         string(delivered.Event.ID),
						},
					},
					now,
				)
				if err != nil {
					return err
				}
				if notification.Produced {
					result.NotificationWake = &ports.ServiceNotificationWake{
						RecipientActor:   grant.Owner,
						NotificationID:   notification.NotificationID,
						NotificationType: message.NotificationType,
						Category:         message.NotificationCategory,
						GroupKey:         message.NotificationGroupKey,
						CreatedAtUnixMs:  now.UnixMilli(),
					}
				}
			}
			if err := tx.Publishing.RecordPublication(ctx, receipt); err != nil {
				return err
			}
			result.Inbound = &CommittedInbound{
				PublishingID:    publishingID,
				SenderPTID:      string(grant.Sender),
				OwnerPTID:       string(grant.Owner),
				ConversationID:  string(target),
				CommandID:       string(commandID),
				MessageID:       string(messageID),
				EventID:         string(delivered.Event.ID),
				Text:            message.FallbackText,
				SourceNamespace: grant.SourceNamespace,
			}
			result.Response = publicationResponse(
				receipt,
				OutcomeAccepted,
			)
			return nil
		},
	)
	return result, err
}

func publicationResponse(
	receipt entity.PublicationReceipt,
	outcome Outcome,
) *Response {
	return &Response{
		CommandID:           receipt.CommandID,
		MessageID:           receipt.MessageID,
		ConversationID:      receipt.Conversation,
		ConversationEventID: receipt.EventID,
		EventSequence:       receipt.EventSequence,
		Outcome:             outcome,
	}
}

type boundUnitOfWork struct {
	tx ports.Transaction
}

func (u boundUnitOfWork) Execute(_ context.Context, fn func(ports.Transaction) error) error {
	return fn(u.tx)
}

func (u boundUnitOfWork) ExecuteSerialized(
	_ context.Context,
	_ string,
	fn func(ports.Transaction) error,
) error {
	return fn(u.tx)
}
