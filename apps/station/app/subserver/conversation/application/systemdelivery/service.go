// Package systemdelivery owns the internal, Station-triggered delivery of
// non-E2EE bot events: it guarantees one direct-conversation message and at
// most one notification row per webhook request, all in the Conversation
// unit of work. Public webhook authentication lives in the bot sub-server;
// this package only executes the already-authorized dual-product effect.
package systemdelivery

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/ingest"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	notificationdomain "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// NotificationTypeBotEvent matches NOTIFICATION_TYPE_BOT_EVENT=410.
const NotificationTypeBotEvent int32 = 410

// Service orchestrates dual-product bot delivery inside one transaction.
type Service struct {
	unitOfWork ports.UnitOfWork
	commands   *command.Service
	clock      func() time.Time
}

// NewService constructs the orchestrator over the same unit of work and
// command service used by the human command path.
func NewService(
	unitOfWork ports.UnitOfWork,
	commands *command.Service,
	clock func() time.Time,
) (*Service, error) {
	if unitOfWork == nil || commands == nil {
		return nil, errInvalid("system delivery requires a unit of work and command service")
	}
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		unitOfWork: unitOfWork,
		commands:   commands,
		clock:      clock,
	}, nil
}

type deliveryError struct{ message string }

func (e *deliveryError) Error() string { return e.message }

func errInvalid(message string) error { return &deliveryError{message: message} }

// Deliver executes the idempotent dual-product effect. It returns the
// committed conversation event id; replayed=true for a request id already
// processed inside the idempotency window.
func (s *Service) Deliver(
	ctx context.Context,
	instruction ingest.DeliverCommand,
) (eventID string, replayed bool, err error) {
	if instruction.Bot == nil ||
		instruction.Bot.BotPtid == "" ||
		instruction.Bot.OwnerPtid == "" ||
		instruction.RequestID == "" {
		return "", false, errInvalid("complete delivery instruction is required")
	}
	botPTID := valueobject.PTID(instruction.Bot.BotPtid)
	ownerPTID := valueobject.PTID(instruction.Bot.OwnerPtid)
	systemSender := valueobject.Endpoint{
		Actor:  botPTID,
		Device: valueobject.SystemStationDeviceID,
	}
	lockKey := "bot-delivery:" + instruction.Bot.BotPtid + ":" + instruction.Bot.OwnerPtid
	now := instruction.Now
	if now.IsZero() {
		now = s.clock()
	}

	err = s.unitOfWork.ExecuteSerialized(ctx, lockKey, func(tx ports.Transaction) error {
		if tx.SystemDirectories == nil {
			return errInvalid("system directories port is not wired")
		}

		// 1. Idempotency short-circuit (BOT-A13/A28).
		existing, found, loadErr := tx.SystemDirectories.LoadIngestion(
			ctx,
			botPTID,
			instruction.RequestID,
			now,
		)
		if loadErr != nil {
			return loadErr
		}
		if found {
			eventID = existing
			replayed = true
			return nil
		}

		// 2. Internal Federation scope (v1 home-local).
		if tx.LocalScope == nil {
			return errInvalid("local scope port is not wired")
		}
		federationID, authorityEpoch, scopeErr := tx.LocalScope.LocalFederation(ctx)
		if scopeErr != nil {
			return scopeErr
		}

		// 3. Resolve real owner device routes; the bot system device is not a
		//    routed endpoint.
		ownerRoutes, routeErr := tx.Identity.ListActiveEndpoints(
			ctx,
			[]valueobject.PTID{ownerPTID},
		)
		if routeErr != nil {
			return routeErr
		}
		if len(ownerRoutes) == 0 {
			return errInvalid("bot owner has no active device to deliver to")
		}

		// Command service reuses this exact transaction.
		bound, bindErr := s.commands.BindUnitOfWork(transactionUnitOfWork{tx: tx})
		if bindErr != nil {
			return bindErr
		}

		// 4. Lazy system Direct Conversation genesis (BOT-A20).
		genesisCommand := valueobject.CommandID("bot-direct-genesis:" + instruction.RequestID)
		genesisExact := []byte("bot-direct-genesis:" + instruction.RequestID)
		genesis, genesisErr := bound.EnsureSystemDirect(ctx, command.EnsureSystemDirectRequest{
			Bot:             botPTID,
			Owner:           ownerPTID,
			BotSystemSender: systemSender,
			OwnerRoutes:     ownerRoutes,
			FederationID:    federationID,
			AuthorityEpoch:  authorityEpoch,
			CommandID:       genesisCommand,
			ExactEventBytes: genesisExact,
		})
		if genesisErr != nil {
			return genesisErr
		}
		conversationID := genesis.Conversation.ID

		// 5. Explicit system grant (idempotent) before the system-sender port
		//    inside DeliverSystemMessage authorizes against it.
		if grantErr := tx.SystemDirectories.EnsureSystemGrant(
			ctx,
			botPTID,
			ownerPTID,
			conversationID,
			now,
		); grantErr != nil {
			return grantErr
		}

		// 6. Build the readable payload (fallback + structured card body).
		payload, payloadErr := buildServicePayload(instruction)
		if payloadErr != nil {
			return payloadErr
		}
		messageCommand := valueobject.CommandID("bot-event:" + instruction.RequestID)
		messageID := valueobject.MessageID("bot-msg:" + instruction.RequestID)
		delivered, deliverErr := bound.DeliverSystemMessage(ctx, command.SystemMessageRequest{
			ConversationID: conversationID,
			Bot:            botPTID,
			Owner:          ownerPTID,
			CommandID:      messageCommand,
			MessageID:      messageID,
			Payload:        payload,
		})
		if deliverErr != nil {
			return deliverErr
		}
		eventID = string(delivered.Event.ID)

		// 7. Notification row in the same transaction (BOT-A05B silence leaves
		//    the message intact; BOT-A28 idempotent).
		if tx.ServiceNotifications != nil {
			if _, notifyErr := tx.ServiceNotifications.ProduceInTx(
				ctx,
				ports.ServiceNotificationInput{
					RecipientPTID:  instruction.Bot.OwnerPtid,
					ActorPTID:      instruction.Bot.BotPtid,
					Type:           NotificationTypeBotEvent,
					Category:       notificationdomain.CategoryTask,
					TargetType:     "conversation",
					TargetID:       string(conversationID),
					Title:          instruction.Bot.Name,
					Body:           instruction.Event.FallbackText(),
					GroupKey:       instruction.Event.GroupKey,
					IdempotencyKey: "bot-event:" + instruction.RequestID,
					Metadata:       notificationMetadata(instruction, conversationID),
				},
				now,
			); notifyErr != nil {
				return notifyErr
			}
		}

		// 8. Idempotency record last: a crash before this point retries the
		//    whole effect; receipt replay inside the command path keeps
		//    retried messages single.
		return tx.SystemDirectories.RecordIngestion(
			ctx,
			botPTID,
			instruction.RequestID,
			eventID,
			now,
		)
	})
	if err != nil {
		return "", false, err
	}
	return eventID, replayed, nil
}

func buildServicePayload(
	instruction ingest.DeliverCommand,
) ([]byte, error) {
	event := instruction.Event
	content := &chat.ServiceBotEventContent{
		Schema:    "peers-touch.bot-event.v1",
		BotPtid:   instruction.Bot.BotPtid,
		EventType: mapEventKind(event.Kind),
		Severity:  mapSeverity(event.Severity),
		GroupKey:  event.GroupKey,
		DedupeKey: event.DedupeKey,
		ActionUrl: event.Source.ActionURL,
		Source: &chat.ServiceBotEventSource{
			Agent:     event.Source.Agent,
			Workspace: event.Source.Workspace,
			SessionId: event.Source.SessionID,
			Labels:    event.Source.Labels,
		},
	}
	payload := &chat.DirectServicePlaintextPayload{
		FallbackText: event.FallbackText(),
		Content:      &chat.DirectServicePlaintextPayload_BotEvent{BotEvent: content},
	}
	return proto.MarshalOptions{Deterministic: true}.Marshal(payload)
}

func mapEventKind(kind domain.EventKind) chat.ServiceBotEventKind {
	switch kind {
	case domain.KindTaskCompleted:
		return chat.ServiceBotEventKind_SERVICE_BOT_EVENT_KIND_TASK_COMPLETED
	case domain.KindWaitingInput:
		return chat.ServiceBotEventKind_SERVICE_BOT_EVENT_KIND_WAITING_INPUT
	case domain.KindTaskFailed:
		return chat.ServiceBotEventKind_SERVICE_BOT_EVENT_KIND_TASK_FAILED
	case domain.KindIdle:
		return chat.ServiceBotEventKind_SERVICE_BOT_EVENT_KIND_IDLE
	case domain.KindCustom:
		return chat.ServiceBotEventKind_SERVICE_BOT_EVENT_KIND_CUSTOM
	default:
		return chat.ServiceBotEventKind_SERVICE_BOT_EVENT_KIND_UNSPECIFIED
	}
}

func mapSeverity(severity domain.Severity) chat.ServiceBotEventSeverity {
	switch severity {
	case domain.SeverityInfo:
		return chat.ServiceBotEventSeverity_SERVICE_BOT_EVENT_SEVERITY_INFO
	case domain.SeverityAttention:
		return chat.ServiceBotEventSeverity_SERVICE_BOT_EVENT_SEVERITY_ATTENTION
	case domain.SeverityError:
		return chat.ServiceBotEventSeverity_SERVICE_BOT_EVENT_SEVERITY_ERROR
	default:
		return chat.ServiceBotEventSeverity_SERVICE_BOT_EVENT_SEVERITY_UNSPECIFIED
	}
}

func eventKindWire(kind domain.EventKind) string {
	switch kind {
	case domain.KindTaskCompleted:
		return "task_completed"
	case domain.KindWaitingInput:
		return "waiting_input"
	case domain.KindTaskFailed:
		return "task_failed"
	case domain.KindIdle:
		return "idle"
	case domain.KindCustom:
		return "custom"
	default:
		return "unspecified"
	}
}

func notificationMetadata(
	instruction ingest.DeliverCommand,
	conversationID valueobject.ConversationID,
) map[string]string {
	return map[string]string{
		"event_kind":      eventKindWire(instruction.Event.Kind),
		"conversation_id": string(conversationID),
		"webhook_id":      instruction.Bot.WebhookID,
		"request_id":      instruction.RequestID,
	}
}

// transactionUnitOfWork runs callbacks against an already-open transaction;
// it never starts or commits its own transaction.
type transactionUnitOfWork struct {
	tx ports.Transaction
}

func (u transactionUnitOfWork) Execute(
	ctx context.Context,
	fn func(ports.Transaction) error,
) error {
	return fn(u.tx)
}

func (u transactionUnitOfWork) ExecuteSerialized(
	_ context.Context,
	_ string,
	fn func(ports.Transaction) error,
) error {
	return fn(u.tx)
}

var _ ports.UnitOfWork = transactionUnitOfWork{}
