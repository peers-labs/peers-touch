package command

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// MaxSystemMessagePayloadBytes bounds the readable
// DirectServicePlaintextPayload body accepted by the system sender. It mirrors
// the webhook edge limit and is checked before the aggregate commit.
const MaxSystemMessagePayloadBytes = 32 * 1024

// SystemMessageRequest is the Station-only service-plaintext command.
type SystemMessageRequest struct {
	ConversationID valueobject.ConversationID
	PublishingID   string
	Sender         valueobject.PTID
	Recipient      valueobject.PTID
	CommandID      valueobject.CommandID
	MessageID      valueobject.MessageID
	// Payload is the canonical DirectServicePlaintextPayload.
	Payload []byte
}

// DeliverSystemMessage commits a service-plaintext message through the
// Conversation-owned publishing grant is asserted transactionally.
func (s *Service) DeliverSystemMessage(
	ctx context.Context,
	request SystemMessageRequest,
) (Result, error) {
	const operation = "application.deliver_system_message"
	if request.ConversationID == "" || request.PublishingID == "" ||
		request.Sender == "" || request.Recipient == "" ||
		request.CommandID == "" || request.MessageID == "" {
		return Result{}, invalid(operation, "request", "complete system message input is required")
	}
	if request.Sender == request.Recipient {
		return Result{}, invalid(operation, "sender_recipient", "sender and recipient must be distinct actors")
	}
	if len(request.Payload) == 0 || len(request.Payload) > MaxSystemMessagePayloadBytes {
		return Result{}, invalid(
			operation,
			"payload",
			"service payload must be present and within the bounded size",
		)
	}
	sender := valueobject.Endpoint{
		Actor:  request.Sender,
		Device: valueobject.SystemStationDeviceID,
	}
	commandHash := valueobject.HashBytes(request.Payload)

	var result Result
	var notifications []ports.CommittedDelivery
	err := s.unitOfWork.ExecuteSerialized(
		ctx,
		conversationGenesisLockKey(request.ConversationID),
		func(transaction ports.Transaction) error {
			if err := validateTransaction(transaction); err != nil {
				return err
			}
			if transaction.SystemSender == nil {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeUnauthorized,
					operation,
					"system_sender",
					"system sender authorization port is not wired in this transaction",
				)
			}
			if err := transaction.SystemSender.AuthorizeSystemMessage(
				ctx,
				request.PublishingID,
				request.Sender,
				request.ConversationID,
				s.clock.Now(),
			); err != nil {
				return err
			}

			snapshot, err := transaction.Repositories.Authority.LoadForUpdate(
				ctx,
				request.ConversationID,
			)
			if err != nil {
				return err
			}
			if snapshot.AuthorityStation != s.localStation {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeCommandConflict,
					operation,
					"authority_station",
					"service plaintext is produced only by the local authority Station",
				)
			}
			conversation, err := aggregate.Rehydrate(snapshot)
			if err != nil {
				return err
			}

			// FederationID/epoch are read from the loaded authority; recipient
			// routing is resolved internally from the identity directory.
			recipientRoutes, err := resolveActorRoutes(
				ctx,
				transaction.Identity,
				[]valueobject.PTID{request.Recipient},
			)
			if err != nil {
				return err
			}
			// v1 is home-local by contract: an owner device homed on another
			// Station is refused at the application port as well as in the
			// aggregate, so no kind-8 delivery ever crosses federation.
			for _, route := range recipientRoutes {
				if route.HomeStation != s.localStation {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeUnauthorized,
						operation,
						"home_station",
						"service plaintext v1 cannot target a federated owner endpoint",
					)
				}
			}
			deliveries := make([]valueobject.PreparedDelivery, 0, len(recipientRoutes))
			for _, route := range recipientRoutes {
				delivery, err := valueobject.NewPreparedDelivery(
					route.Endpoint,
					route.HomeStation,
					valueobject.DeliveryKindDirectServicePlaintext,
					request.Payload,
				)
				if err != nil {
					return err
				}
				deliveries = append(deliveries, delivery)
			}

			transition, err := conversation.CommitSystemServiceMessage(
				aggregate.SystemServiceMessageInput{
					CommandID:   request.CommandID,
					MessageID:   request.MessageID,
					SenderActor: request.Sender,
					Recipient:   request.Recipient,
					Sender:      sender,
					Deliveries:  deliveries,
					Payload:     append([]byte(nil), request.Payload...),
					CommittedAt: s.clock.Now(),
					EventSealer: s.eventSealer,
				},
			)
			if err != nil {
				return err
			}
			if err := s.persistTransition(
				ctx,
				transaction,
				conversation,
				transition,
				request.CommandID,
				commandHash,
				s.localStation,
			); err != nil {
				return directPersistTransitionStage(err)
			}
			notifications = committedDeliveries(transition, s.localStation)
			result = Result{
				Conversation: conversation.Snapshot(),
				Event:        transition.Event,
			}
			return nil
		},
	)
	if err != nil {
		return Result{}, err
	}
	result.PostCommitError = s.notify(ctx, notifications)
	return result, nil
}
