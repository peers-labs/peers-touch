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

// SystemMessageRequest is the internal, Station-only request to deliver a
// non-E2EE service-plaintext message (bot webhook event) into the bot-owner
// direct conversation. It intentionally carries no FederationID or endpoint
// routes: those are sourced inside the transaction from the loaded authority
// and the identity directory (G-BOT-03).
type SystemMessageRequest struct {
	ConversationID valueobject.ConversationID
	Bot            valueobject.PTID
	Owner          valueobject.PTID
	CommandID      valueobject.CommandID
	MessageID      valueobject.MessageID
	// Payload is the canonical marshaled DirectServicePlaintextPayload
	// (peers-touch.bot-event.v1 or fallback-only). It is both the fact payload
	// and the per-endpoint readable body.
	Payload []byte
}

// DeliverSystemMessage commits a service-plaintext message through the
// conversation application port. The explicit {bot, owner, conversation}
// grant is asserted transactionally via the SystemSender port implemented by
// the bot edge; this service only touches Conversation-owned repositories.
func (s *Service) DeliverSystemMessage(
	ctx context.Context,
	request SystemMessageRequest,
) (Result, error) {
	const operation = "application.deliver_system_message"
	if request.ConversationID == "" || request.Bot == "" || request.Owner == "" ||
		request.CommandID == "" || request.MessageID == "" {
		return Result{}, invalid(operation, "request", "complete system message input is required")
	}
	if request.Bot == request.Owner {
		return Result{}, invalid(operation, "bot_owner", "bot and owner must be distinct actors")
	}
	if len(request.Payload) == 0 || len(request.Payload) > MaxSystemMessagePayloadBytes {
		return Result{}, invalid(
			operation,
			"payload",
			"service payload must be present and within the bounded size",
		)
	}
	sender := valueobject.Endpoint{
		Actor:  request.Bot,
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
				request.Bot,
				request.Owner,
				request.ConversationID,
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
			ownerRoutes, err := resolveActorRoutes(
				ctx,
				transaction.Identity,
				[]valueobject.PTID{request.Owner},
			)
			if err != nil {
				return err
			}
			// v1 is home-local by contract: an owner device homed on another
			// Station is refused at the application port as well as in the
			// aggregate, so no kind-8 delivery ever crosses federation.
			for _, route := range ownerRoutes {
				if route.HomeStation != s.localStation {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeUnauthorized,
						operation,
						"home_station",
						"service plaintext v1 cannot target a federated owner endpoint",
					)
				}
			}
			deliveries := make([]valueobject.PreparedDelivery, 0, len(ownerRoutes))
			for _, route := range ownerRoutes {
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
					Bot:         request.Bot,
					Owner:       request.Owner,
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
