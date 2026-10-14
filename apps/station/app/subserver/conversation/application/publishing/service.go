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
	notificationdomain "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/credential"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
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
	Response         *chat.PublishMessageResponse
	NotificationWake *ports.ServiceNotificationWake
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
	idempotencyKey string,
	input *chat.PublishMessageRequest,
) (Result, error) {
	publishingID = strings.TrimSpace(publishingID)
	if publishingID == "" || strings.TrimSpace(presentedSecret) == "" {
		return Result{}, unauthorized()
	}
	normalized, err := Normalize(input, idempotencyKey)
	if err != nil {
		return Result{}, err
	}
	if normalized.Request.CommandId == "" {
		normalized.Request.CommandId = s.ids.NewID()
	}
	commandID, err := valueobject.NewCommandID(normalized.Request.CommandId)
	if err != nil {
		return Result{}, err
	}
	now := s.clock.Now().UTC()
	var result Result
	err = s.unitOfWork.ExecuteSerialized(
		ctx,
		"message-publishing:"+publishingID,
		func(tx ports.Transaction) error {
			if tx.Publishing == nil || tx.PublishingObjects == nil || tx.LocalScope == nil {
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
				if receipt.RequestHash != normalized.Hash {
					return conflict("command_id", "was already committed with a different normalized request")
				}
				if receipt.Recipient != grant.Owner {
					return unauthorized()
				}
				if err := grant.Authorize(receipt.Sender, receipt.Conversation, now); err != nil {
					return err
				}
				result.Response = publicationResponse(receipt, chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_REPLAYED)
				return nil
			}
			if err := tx.Publishing.CheckRate(ctx, publishingID, grant.RatePerMinute, now); err != nil {
				return err
			}

			target := valueobject.ConversationID(normalized.Request.Target)
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
			federationID, authorityEpoch, err := tx.LocalScope.LocalFederation(ctx)
			if err != nil {
				return err
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
				FederationID:    federationID,
				AuthorityEpoch:  authorityEpoch,
				CommandID:       genesisCommandID,
				ExactEventBytes: []byte("publishing-genesis:" + publishingID),
			})
			if err != nil {
				return err
			}
			if genesis.Conversation.ID != target {
				return conflict("target", "does not match the committed service Direct")
			}

			content := proto.Clone(normalized.Request.Content).(*chat.MessageContent)
			for _, attachment := range content.Attachments {
				object, err := tx.PublishingObjects.ValidateObject(
					ctx,
					attachment.ObjectId,
					grant.Owner,
					target,
					now,
				)
				if err != nil {
					return err
				}
				attachment.Filename = object.Filename
				attachment.MediaType = object.MediaType
				attachment.Size = object.Size
			}
			payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
				&chat.DirectServicePlaintextPayload{
					MessageContent:  content,
					SourceContext:   normalized.Request.SourceContext,
					SourceNamespace: grant.SourceNamespace,
				},
			)
			if err != nil {
				return err
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
				Payload:        payload,
			})
			if err != nil {
				return err
			}
			receipt = entity.PublicationReceipt{
				PublishingID:  publishingID,
				CommandID:     string(commandID),
				RequestHash:   normalized.Hash,
				Sender:        grant.Sender,
				Recipient:     grant.Owner,
				Conversation:  target,
				MessageID:     messageID,
				EventID:       delivered.Event.ID,
				EventSequence: delivered.Event.Sequence,
				CreatedAt:     now,
			}

			if tx.ServiceNotifications != nil {
				notificationType, category := notificationClassification(content)
				notification, err := tx.ServiceNotifications.ProduceInTx(
					ctx,
					ports.ServiceNotificationInput{
						RecipientPTID:  string(grant.Owner),
						ActorPTID:      string(grant.Sender),
						Type:           notificationType,
						Category:       category,
						TargetType:     "conversation",
						TargetID:       string(target),
						Title:          grant.Name,
						Body:           content.FallbackText,
						GroupKey:       notificationGroup(grant.SourceNamespace, content),
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
						NotificationType: notificationType,
						Category:         category,
						GroupKey:         notificationGroup(grant.SourceNamespace, content),
						CreatedAtUnixMs:  now.UnixMilli(),
					}
				}
			}
			if err := tx.Publishing.RecordPublication(ctx, receipt); err != nil {
				return err
			}
			result.Response = publicationResponse(
				receipt,
				chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_ACCEPTED,
			)
			return nil
		},
	)
	return result, err
}

func publicationResponse(
	receipt entity.PublicationReceipt,
	outcome chat.PublishMessageOutcome,
) *chat.PublishMessageResponse {
	return &chat.PublishMessageResponse{
		CommandId:           receipt.CommandID,
		MessageId:           string(receipt.MessageID),
		ConversationId:      string(receipt.Conversation),
		ConversationEventId: string(receipt.EventID),
		EventSequence:       int64(receipt.EventSequence),
		Outcome:             outcome,
	}
}

func notificationClassification(content *chat.MessageContent) (int32, int32) {
	if event := content.GetEvent(); event != nil && event.GetTaskState() != nil {
		return NotificationTypeTaskEvent, notificationdomain.CategoryTask
	}
	return NotificationTypeServiceMessage, notificationdomain.CategoryChat
}

func notificationGroup(namespace string, content *chat.MessageContent) string {
	event := content.GetEvent()
	if event == nil || event.GetTaskState() == nil || event.Subject == nil ||
		event.Subject.Kind == "" || event.Subject.Id == "" ||
		event.Subject.ExecutionId == "" {
		return ""
	}
	return valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("publishing-notification-group"),
		[]byte(namespace),
		[]byte(event.Subject.Kind),
		[]byte(event.Subject.Id),
		[]byte(event.Subject.ExecutionId),
	)).String()
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

func unauthorized() error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"publishing.authenticate",
		"credential",
		"publishing credential is invalid",
	)
}

func conflict(field, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeCommandConflict,
		"publishing.publish",
		field,
		message,
	)
}
